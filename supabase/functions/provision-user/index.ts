// ===============================================================
// AMA EDU — provision-user
//
// Creates (or resets) the sign-in for ONE staff member or student that
// already exists as a database record. The record is created first and
// separately (Staff / Students pages), so a failure here never loses a
// person: the record stays, this function can simply be run again, and
// it is safe to run repeatedly (it adopts an account left over from an
// earlier half-finished attempt instead of failing on it).
//
// Changes from the version first deployed:
//  * Roles are NOT taken from the request. The old code trusted a
//    `role` field in the body, so a registrar could send role:"admin"
//    and promote any staff member. Roles now come only from staff.roles,
//    which only an administrator can write, and a database trigger
//    (migration 0018) turns them into memberships. Registrars can create
//    STUDENT logins only.
//  * A staff login needs at least one saved role, with a message saying
//    so, instead of silently defaulting to "teacher".
//  * The "already exists" recovery no longer calls listUsers() (first
//    page only, so it broke once a project had more than a page of
//    users); it asks the database directly.
//  * Failures name the step that failed and say what is safe to do.
//  * The audit entry records the signed-in person who did it.
// ===============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendEmail, escapeHtml } from "./_shared/email.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const shadowEmail = (kind: string, identifier: string, slug: string) =>
  `${kind}.${identifier.toLowerCase().replace(/[^a-z0-9._-]/g, "-")}@${slug.toLowerCase()}.tenant.amaedu.internal`;

const shadowPassword = (schoolId: string, identifier: string, plain: string) =>
  `ama:${schoolId}:${identifier.trim().toLowerCase()}:${plain}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Not signed in." }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let stage = "checking your permission";

  try {
    const { data: me, error: meErr } = await caller.rpc("current_app_user");
    if (meErr) throw meErr;
    const who = Array.isArray(me) ? me[0] : me;
    if (!who?.school_id) return json({ error: "Not signed in to a school." }, 401);

    const roles: string[] = who.roles ?? [];
    const isAdmin = Boolean(who.is_platform_admin) || roles.includes("admin");
    const isRegistrar = roles.includes("registrar_primary") || roles.includes("registrar_secondary");

    const body = await req.json().catch(() => null);
    const kind = body?.kind;
    const rowId = String(body?.table_id ?? "");
    const password = String(body?.password ?? "");

    if (kind !== "staff" && kind !== "student") return json({ error: "Unknown account type." }, 400);
    if (!rowId) return json({ error: "Missing record id." }, 400);
    if (password.length < 6) return json({ error: "Choose a password of at least 6 characters." }, 400);

    if (kind === "staff" && !isAdmin) {
      return json({ error: "Only a school administrator can create or reset staff logins." }, 403);
    }
    if (kind === "student" && !isAdmin && !isRegistrar) {
      return json({ error: "You do not have permission to create student logins." }, 403);
    }

    const table = kind === "staff" ? "staff" : "students";
    const idColumn = kind === "staff" ? "staff_code" : "admission_no";
    const emailColumn = kind === "staff" ? "email" : "guardian_email";
    const extra = kind === "staff" ? ", roles" : "";

    stage = "finding the record";
    const { data: row, error: rowErr } = await admin
      .from(table)
      .select(`id, school_id, user_id, is_active, full_name, ${idColumn}, ${emailColumn}${extra}, schools!inner(name, slug)`)
      .eq("id", rowId)
      .single();
    if (rowErr || !row) return json({ error: "That record was not found." }, 404);

    if (!who.is_platform_admin && row.school_id !== who.school_id) {
      return json({ error: "That record belongs to another school." }, 403);
    }
    if (row.is_active === false) {
      return json({ error: "This record is inactive. Reactivate it before creating a login." }, 400);
    }
    if (kind === "staff" && !row.user_id && !((row as { roles?: string[] }).roles ?? []).length) {
      return json({
        error: "Give this person at least one role and save the record before creating a login.",
        stage: "roles",
      }, 400);
    }

    const identifier = String((row as Record<string, unknown>)[idColumn] ?? "");
    const notifyEmail = String((row as Record<string, unknown>)[emailColumn] ?? "");
    const schoolInfo = (row as { schools: { name: string; slug: string } }).schools;
    const email = shadowEmail(kind, identifier, schoolInfo.slug);
    const secret = shadowPassword(row.school_id, identifier, password);

    let userId = row.user_id as string | null;
    const isNewLogin = !userId;

    stage = "creating the sign-in account";
    if (userId) {
      const { error } = await admin.auth.admin.updateUserById(userId, { password: secret, email });
      if (error) throw error;
    } else {
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: secret,
        email_confirm: true,
        user_metadata: { school_slug: schoolInfo.slug, kind, identifier },
      });
      if (error) {
        // An earlier attempt may have created the account but not linked
        // it. Adopt it rather than fail; the password is reset below.
        const { data: existingId, error: findErr } = await admin.rpc("admin_find_auth_user", { p_email: email });
        if (findErr || !existingId) throw error;
        userId = existingId as string;
        const { error: pwErr } = await admin.auth.admin.updateUserById(userId, { password: secret });
        if (pwErr) throw pwErr;
      } else {
        userId = created.user.id;
      }

      stage = "linking the account to the record";
      // For staff this UPDATE also fires the trigger that turns staff.roles
      // into school_members rows, so it is what actually grants the roles.
      const { error: linkErr } = await admin.from(table).update({ user_id: userId }).eq("id", rowId);
      if (linkErr) throw linkErr;
    }

    stage = "granting access";
    if (kind === "student") {
      const { error: memberErr } = await admin.from("school_members").upsert(
        { school_id: row.school_id, user_id: userId, role: "student", student_id: rowId },
        { onConflict: "user_id,school_id,role" },
      );
      if (memberErr) throw memberErr;
    }

    // Prove access exists before saying the login is ready.
    const { count } = await admin.from("school_members")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("school_id", row.school_id).eq("is_active", true);
    if (!count) {
      return json({
        error: "The account was created but has no access yet. Check the record's roles and press Create login again.",
        stage: "membership",
      }, 500);
    }

    const { data: actor } = await admin.auth.getUser(authHeader.slice(7));
    await admin.from("audit_log").insert({
      school_id: row.school_id,
      user_id: actor?.user?.id ?? null,
      action: isNewLogin ? "login.provisioned" : "login.password_reset",
      entity: table,
      entity_id: rowId,
      detail: { kind, identifier },
    });

    if (isNewLogin && notifyEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(notifyEmail)) {
      try {
        const rootDomain = Deno.env.get("ROOT_DOMAIN") || "amaedu.com.ng";
        const portalUrl = `https://${schoolInfo.slug}.${rootDomain}/login`;
        const who2 = escapeHtml(row.full_name ?? identifier);
        await sendEmail({
          to: notifyEmail,
          subject: `${kind === "staff" ? "Staff" : "Student"} login ready — ${schoolInfo.name}`,
          html:
            kind === "staff"
              ? `<p>Hello ${who2},</p><p>Your AMA EDU login for <strong>${escapeHtml(schoolInfo.name)}</strong> is ready.</p>` +
                `<p>Sign in at <a href="${portalUrl}">${portalUrl}</a> with Staff ID <strong>${escapeHtml(identifier)}</strong> and the password your administrator gave you.</p>`
              : `<p>Hello,</p><p>A student login for <strong>${who2}</strong> at <strong>${escapeHtml(schoolInfo.name)}</strong> is now ready.</p>` +
                `<p>Sign in at <a href="${portalUrl}">${portalUrl}</a> with admission number <strong>${escapeHtml(identifier)}</strong> and the password the school gave you.</p>`,
        });
      } catch (emailErr) {
        console.error("provision-user notification email failed", emailErr);
      }
    }

    return json({ ok: true, user_id: userId, login_id: identifier, created: isNewLogin });
  } catch (err) {
    // The technical detail goes to the function logs; the person gets the
    // step that failed and what is safe to do next.
    console.error(`provision-user failed while ${stage}`, err);
    return json({
      error: `The login could not be set up (failed while ${stage}). The record itself is saved and nothing was lost. Try again; if it keeps failing, contact support.`,
      stage,
    }, 500);
  }
});
