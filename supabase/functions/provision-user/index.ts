// ===============================================================
// AMA EDU — provision-user
//
// Gives a staff member or student a real Supabase Auth account so
// they can sign in with their Staff ID / Admission No.
//
// The shadow address is namespaced per school:
//   staff.t001@pas.tenant.amaedu.internal
//   student.pas-0142@pas.tenant.amaedu.internal
// which is what stops two schools reusing "T001" from colliding.
//
// The caller's own JWT decides what they may do. The school is read
// from the TARGET ROW, never from the request body, so an admin at
// one school cannot provision an account at another by passing a
// foreign id -- the ownership check below rejects it.
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

/** Must match app.shadow_email() in migration 0007 exactly. */
const shadowEmail = (kind: string, identifier: string, slug: string) =>
  `${kind}.${identifier.toLowerCase().replace(/[^a-z0-9._-]/g, "-")}@${slug.toLowerCase()}.tenant.amaedu.internal`;

/** Must match shadowPassword() in src/lib/auth.js exactly. */
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

  // A second client carrying the CALLER's token. Anything read through
  // it passes RLS, so it answers "who is this person" honestly.
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: me, error: meErr } = await caller.rpc("current_app_user");
    if (meErr) throw meErr;
    const who = Array.isArray(me) ? me[0] : me;
    if (!who?.school_id) return json({ error: "Not signed in to a school." }, 401);

    const roles: string[] = who.roles ?? [];
    const mayProvision = who.is_platform_admin || roles.includes("admin") ||
      roles.includes("registrar_primary") || roles.includes("registrar_secondary");
    if (!mayProvision) return json({ error: "You do not have permission to create logins." }, 403);

    const body = await req.json().catch(() => null);
    const kind = body?.kind;
    const rowId = String(body?.table_id ?? "");
    const password = String(body?.password ?? "");

    if (kind !== "staff" && kind !== "student") return json({ error: "Unknown account type." }, 400);
    if (!rowId) return json({ error: "Missing record id." }, 400);
    if (password.length < 6) return json({ error: "Choose a password of at least 6 characters." }, 400);

    const table = kind === "staff" ? "staff" : "students";
    const idColumn = kind === "staff" ? "staff_code" : "admission_no";
    const emailColumn = kind === "staff" ? "email" : "guardian_email";

    const { data: row, error: rowErr } = await admin
      .from(table)
      .select(`id, school_id, user_id, full_name, ${idColumn}, ${emailColumn}, schools!inner(name, slug)`)
      .eq("id", rowId)
      .single();
    if (rowErr || !row) return json({ error: "That record was not found." }, 404);

    // The ownership check. Read from the row, compared against the
    // caller's own tenant -- not against anything they sent us.
    if (!who.is_platform_admin && row.school_id !== who.school_id) {
      return json({ error: "That record belongs to another school." }, 403);
    }

    const identifier = String((row as Record<string, unknown>)[idColumn] ?? "");
    const notifyEmail = String((row as Record<string, unknown>)[emailColumn] ?? "");
    const schoolInfo = (row as { schools: { name: string; slug: string } }).schools;
    const email = shadowEmail(kind, identifier, schoolInfo.slug);
    const secret = shadowPassword(row.school_id, identifier, password);

    let userId = row.user_id as string | null;
    const isNewLogin = !userId;

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
        // The address may already exist from an earlier attempt; adopt it.
        const { data: list } = await admin.auth.admin.listUsers();
        const existing = list?.users?.find((u) => u.email === email);
        if (!existing) throw error;
        userId = existing.id;
        await admin.auth.admin.updateUserById(userId, { password: secret });
      } else {
        userId = created.user.id;
      }

      const { error: linkErr } = await admin.from(table).update({ user_id: userId }).eq("id", rowId);
      if (linkErr) throw linkErr;
    }

    const membership: Record<string, unknown> = {
      school_id: row.school_id,
      user_id: userId,
      role: kind === "staff" ? (body?.role ?? "teacher") : "student",
    };
    membership[kind === "staff" ? "staff_id" : "student_id"] = rowId;

    const { error: memberErr } = await admin
      .from("school_members")
      .upsert(membership, { onConflict: "user_id,school_id,role" });
    if (memberErr) throw memberErr;

    await admin.from("audit_log").insert({
      school_id: row.school_id,
      user_id: who.staff_id ?? null,
      action: "login.provisioned",
      entity: table,
      entity_id: rowId,
      detail: { kind, identifier },
    });

    // Best-effort notification. Never send the password by email --
    // only that a login now exists and where to use it. A staff member
    // is told directly; a student has no email of their own on file,
    // so their guardian is told instead. Missing delivery never fails
    // the provisioning itself, which has already succeeded.
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

    return json({ ok: true, user_id: userId, login_id: identifier });
  } catch (err) {
    console.error("provision-user failed", err);
    return json({ error: "The login could not be set up. Try again." }, 500);
  }
});
