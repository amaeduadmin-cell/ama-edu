// ===============================================================
// AMA EDU — bulk-credential-reset
//
// Admin-only. Four actions, always scoped to the CALLER's own school_id
// (never taken from the request body — see the schema-permission trap
// noted across this batch's migrations: cross-tenant leakage is the
// exact class of bug that note exists to prevent):
//
//   reset_student_passwords { new_default_password }
//   reset_teacher_passwords { new_password }
//   renumber_students       { prefix, new_default_password }
//   renumber_teachers       { prefix, new_password }
//
// Numbering math (renumber_*) is done by the matching SQL function
// (migration 0042) under the caller's own JWT, so app.is_school_admin()
// and app.current_school_id() are the real enforcement — this function
// re-checks admin status itself only because the two password-only
// actions have no SQL function of their own to enforce it for them.
//
// auth.users cannot be touched from SQL, so every action that changes a
// login (all four: a password reset IS a login change, and renumbering
// changes the identifier the login is built from) updates it here, one
// person at a time, with the service_role client — same division of
// labour provision-user already uses. A student/teacher with no user_id
// yet has no login to reset; they are counted separately, never treated
// as a failure.
//
// Passwords are never logged: audit_log entries record counts only.
// ===============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ama-client",
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

type PersonRow = { id: string; user_id: string | null; full_name: string; identifier: string };

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
    if (!isAdmin) return json({ error: "Only a school administrator can run a bulk credential reset." }, 403);

    // The caller's OWN school, resolved server-side — never accepted from the request body.
    const schoolId = who.school_id as string;

    const body = await req.json().catch(() => null);
    const action = body?.action;

    stage = "looking up your school";
    const { data: school, error: schoolErr } = await admin
      .from("schools").select("slug").eq("id", schoolId).single();
    if (schoolErr || !school) throw schoolErr ?? new Error("School not found");
    const slug = school.slug as string;

    const { data: actor } = await admin.auth.getUser(authHeader.slice(7));
    const actorId = actor?.user?.id ?? null;

    async function resetLogins(kind: "student" | "staff", people: PersonRow[], newPlain: string) {
      let reset = 0;
      let skippedNoLogin = 0;
      let failed = 0;
      for (const p of people) {
        if (!p.user_id) { skippedNoLogin++; continue; }
        const { error } = await admin.auth.admin.updateUserById(p.user_id, {
          password: shadowPassword(schoolId, p.identifier, newPlain),
        });
        if (error) failed++; else reset++;
      }
      return { reset, skippedNoLogin, failed, total: people.length };
    }

    async function relinkLogins(
      kind: "student" | "staff",
      rows: { user_id: string | null; new_identifier: string }[],
      newPlain: string | null,
    ) {
      let relinked = 0;
      let skippedNoLogin = 0;
      let failed = 0;
      for (const r of rows) {
        if (!r.user_id) { skippedNoLogin++; continue; }
        const update: Record<string, string> = { email: shadowEmail(kind, r.new_identifier, slug) };
        if (newPlain) update.password = shadowPassword(schoolId, r.new_identifier, newPlain);
        const { error } = await admin.auth.admin.updateUserById(r.user_id, update);
        if (error) failed++; else relinked++;
      }
      return { relinked, skippedNoLogin, failed };
    }

    if (action === "reset_student_passwords") {
      const newPw = String(body?.new_default_password ?? "").trim();
      if (newPw.length < 6) return json({ error: "Choose a default password of at least 6 characters." }, 400);

      stage = "reading active students";
      const { data: students, error } = await caller
        .from("students").select("id, user_id, full_name, admission_no")
        .eq("school_id", schoolId).eq("is_active", true);
      if (error) throw error;

      stage = "resetting student logins";
      const people: PersonRow[] = (students ?? []).map((s) => ({
        id: s.id, user_id: s.user_id, full_name: s.full_name, identifier: s.admission_no,
      }));
      const result = await resetLogins("student", people, newPw);

      stage = "saving the new default";
      const { error: saveErr } = await caller.from("schools")
        .update({ student_default_password: newPw }).eq("id", schoolId);
      if (saveErr) throw saveErr;

      await admin.from("audit_log").insert({
        school_id: schoolId, user_id: actorId, action: "bulk_credential_reset.students",
        entity: "students", entity_id: null,
        detail: { reset: result.reset, skipped_no_login: result.skippedNoLogin, failed: result.failed, total: result.total },
      });

      return json({ ok: true, ...result });
    }

    if (action === "reset_teacher_passwords") {
      const newPw = String(body?.new_password ?? "").trim();
      if (newPw.length < 6) return json({ error: "Choose a password of at least 6 characters." }, 400);

      stage = "reading active teachers";
      const { data: staff, error } = await caller
        .from("staff").select("id, user_id, full_name, staff_code, roles")
        .eq("school_id", schoolId).eq("is_active", true);
      if (error) throw error;

      // ONLY staff whose roles are EXACTLY {teacher} — never admin/headmaster/principal/
      // bursar/director, even if 'teacher' is one of several roles they hold.
      const teachers = (staff ?? []).filter(
        (s) => Array.isArray(s.roles) && s.roles.length === 1 && s.roles[0] === "teacher",
      );

      stage = "resetting teacher logins";
      const people: PersonRow[] = teachers.map((s) => ({
        id: s.id, user_id: s.user_id, full_name: s.full_name, identifier: s.staff_code,
      }));
      const result = await resetLogins("staff", people, newPw);

      stage = "saving the new default";
      const { error: saveErr } = await caller.from("schools")
        .update({ staff_default_password: newPw }).eq("id", schoolId);
      if (saveErr) throw saveErr;

      await admin.from("audit_log").insert({
        school_id: schoolId, user_id: actorId, action: "bulk_credential_reset.teachers",
        entity: "staff", entity_id: null,
        detail: { reset: result.reset, skipped_no_login: result.skippedNoLogin, failed: result.failed, total: result.total },
      });

      return json({ ok: true, ...result });
    }

    if (action === "renumber_students") {
      const prefix = String(body?.prefix ?? "").trim();
      const newPw = String(body?.new_default_password ?? "").trim();
      if (!prefix) return json({ error: "Enter a prefix for the new admission numbers." }, 400);
      if (newPw.length < 6) return json({ error: "Choose a default password of at least 6 characters." }, 400);

      stage = "renumbering students";
      const { data: mapping, error } = await caller.rpc("renumber_students", { p_prefix: prefix });
      if (error) throw error;

      stage = "resetting student logins";
      const rows = (mapping ?? []).map((m: { user_id: string | null; new_admission_no: string }) => ({
        user_id: m.user_id, new_identifier: m.new_admission_no,
      }));
      const linkResult = await relinkLogins("student", rows, newPw);

      stage = "saving the new default";
      const { error: saveErr } = await caller.from("schools")
        .update({ student_default_password: newPw }).eq("id", schoolId);
      if (saveErr) throw saveErr;

      await admin.from("audit_log").insert({
        school_id: schoolId, user_id: actorId, action: "bulk_credential_reset.renumber_students",
        entity: "students", entity_id: null,
        detail: { prefix, count: (mapping ?? []).length, logins_relinked: linkResult.relinked, skipped_no_login: linkResult.skippedNoLogin, failed: linkResult.failed },
      });

      return json({ ok: true, count: (mapping ?? []).length, mapping, ...linkResult });
    }

    if (action === "renumber_teachers") {
      const prefix = String(body?.prefix ?? "").trim();
      const newPw = String(body?.new_password ?? "").trim();
      if (!prefix) return json({ error: "Enter a prefix for the new Staff IDs." }, 400);
      if (newPw.length < 6) return json({ error: "Choose a password of at least 6 characters." }, 400);

      stage = "renumbering teachers";
      const { data: mapping, error } = await caller.rpc("renumber_teachers", { p_prefix: prefix });
      if (error) throw error;

      stage = "resetting teacher logins";
      const rows = (mapping ?? []).map((m: { user_id: string | null; new_staff_code: string }) => ({
        user_id: m.user_id, new_identifier: m.new_staff_code,
      }));
      const linkResult = await relinkLogins("staff", rows, newPw);

      stage = "saving the new default";
      const { error: saveErr } = await caller.from("schools")
        .update({ staff_default_password: newPw }).eq("id", schoolId);
      if (saveErr) throw saveErr;

      await admin.from("audit_log").insert({
        school_id: schoolId, user_id: actorId, action: "bulk_credential_reset.renumber_teachers",
        entity: "staff", entity_id: null,
        detail: { prefix, count: (mapping ?? []).length, logins_relinked: linkResult.relinked, skipped_no_login: linkResult.skippedNoLogin, failed: linkResult.failed },
      });

      return json({ ok: true, count: (mapping ?? []).length, mapping, ...linkResult });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    console.error(`bulk-credential-reset failed while ${stage}`, err);
    return json({
      error: `The bulk reset could not finish (failed while ${stage}). Nothing already saved was undone; try again.`,
      stage,
    }, 500);
  }
});
