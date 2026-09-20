// ===============================================================
// AMA EDU — invite-parent
//
// Creates or updates a parent record, links it to one or more of the
// caller's own students, and — for a first-time invite — generates a
// Supabase recovery link and emails it through our own pipeline
// (_shared/email.ts) rather than relying on Supabase's built-in invite
// email, so a parent's first message looks like every other AMA EDU
// email and doesn't depend on whether the project's SMTP is configured.
//
// Parents authenticate with a real email and a password they choose
// themselves — unlike staff and students, there is no shadow-email
// scheme here, because a parent's email is genuinely theirs.
//
// Every student_id the caller supplies is verified against their own
// school before any link is written. A registrar or admin at one
// school cannot link a parent to a student at another school by
// passing a foreign id -- the ownership check below rejects it.
//
// NOTE: this file was recovered from the deployed function (version 1).
// It was live on the project but missing from the repository snapshot.
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

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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

  try {
    const { data: me, error: meErr } = await caller.rpc("current_app_user");
    if (meErr) throw meErr;
    const who = Array.isArray(me) ? me[0] : me;
    if (!who?.school_id) return json({ error: "Not signed in to a school." }, 401);

    const roles: string[] = who.roles ?? [];
    const mayInvite = who.is_platform_admin || roles.includes("admin") ||
      roles.includes("registrar_primary") || roles.includes("registrar_secondary");
    if (!mayInvite) return json({ error: "You do not have permission to invite parents." }, 403);

    const body = await req.json().catch(() => null);
    const fullName = String(body?.full_name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const phone = String(body?.phone ?? "").trim();
    const studentIds: string[] = Array.isArray(body?.student_ids) ? body.student_ids.map(String) : [];

    if (fullName.length < 2) return json({ error: "Enter the parent's full name." }, 400);
    if (!EMAIL_RE.test(email)) return json({ error: "Enter a valid email address." }, 400);

    const schoolId = who.is_platform_admin ? String(body?.school_id ?? who.school_id) : who.school_id;

    // Verify every student belongs to this school before linking anything.
    if (studentIds.length) {
      const { data: rows, error } = await admin
        .from("students").select("id, school_id, full_name").in("id", studentIds);
      if (error) throw error;
      const foreign = (rows ?? []).find((r) => r.school_id !== schoolId);
      if (foreign || (rows?.length ?? 0) !== studentIds.length) {
        return json({ error: "One of the selected students could not be found at this school." }, 403);
      }
    }

    // 1. the parent record
    const { data: parentRow, error: parentErr } = await admin
      .from("parents")
      .upsert({ school_id: schoolId, full_name: fullName, email, phone: phone || null }, { onConflict: "school_id,email" })
      .select("id, user_id")
      .single();
    if (parentErr) throw parentErr;

    // 2. link the children
    if (studentIds.length) {
      const { error: linkErr } = await admin.from("parent_students").upsert(
        studentIds.map((student_id) => ({ school_id: schoolId, parent_id: parentRow.id, student_id })),
        { onConflict: "parent_id,student_id" },
      );
      if (linkErr) throw linkErr;
    }

    // 3. first-time invite: create the auth account and email a
    //    recovery link so the parent sets their own password.
    let invited = false;
    if (!parentRow.user_id) {
      const tempPassword = crypto.randomUUID() + crypto.randomUUID();
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password: tempPassword, email_confirm: true,
        user_metadata: { school_slug: who.school_slug, kind: "parent", full_name: fullName },
      });
      if (createErr) throw createErr;
      const userId = created.user.id;

      await admin.from("parents").update({ user_id: userId }).eq("id", parentRow.id);
      await admin.from("school_members").upsert(
        { school_id: schoolId, user_id: userId, role: "parent" },
        { onConflict: "user_id,school_id,role" },
      );

      const rootDomain = Deno.env.get("ROOT_DOMAIN") || "amaedu.com.ng";
      const portalUrl = `https://${who.school_slug}.${rootDomain}/reset-password`;
      try {
        const { data: link, error: linkGenErr } = await admin.auth.admin.generateLink({
          type: "recovery", email, options: { redirectTo: portalUrl },
        });
        if (linkGenErr) throw linkGenErr;
        const actionLink = link?.properties?.action_link;
        if (actionLink) {
          await sendEmail({
            to: email,
            subject: `Set your parent account password — ${who.school_slug}`,
            html:
              `<p>Hello ${escapeHtml(fullName)},</p>` +
              `<p>An AMA EDU parent account has been created for you so you can view your ` +
              `${studentIds.length === 1 ? "child's" : "children's"} results.</p>` +
              `<p><a href="${actionLink}">Set your password</a> to finish setting up your account.</p>` +
              `<p>Copyright &copy; AMAEdu 2026 All Rights Reserved!</p>`,
            text: `Set your AMA EDU parent account password: ${actionLink}`,
          });
        }
      } catch (linkErr) {
        console.error("invite-parent: recovery link failed", linkErr);
      }
      invited = true;
    }

    await admin.from("audit_log").insert({
      school_id: schoolId,
      user_id: who.staff_id ?? null,
      action: "parent.invited",
      entity: "parents",
      entity_id: parentRow.id,
      detail: { email, student_ids: studentIds },
    });

    return json({ ok: true, parent_id: parentRow.id, invited });
  } catch (err) {
    console.error("invite-parent failed", err);
    return json({ error: "Could not save this parent. Try again." }, 500);
  }
});
