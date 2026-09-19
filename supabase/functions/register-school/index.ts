// ===============================================================
// AMA EDU — register-school
//
// Public signup endpoint, so verify_jwt is off by design (nobody has
// an account yet). Everything it trusts is re-validated here and in
// the database: the slug regex, the reserved-word table, and the
// uniqueness constraint on schools.slug.
//
// Creating a school is four writes across two systems (auth + five
// tables). Postgres cannot roll back the auth user, so this function
// unwinds by hand on any failure -- otherwise a phone losing signal
// midway would leave half-built schools and orphaned accounts behind.
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

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  let userId: string | null = null;
  let schoolId: string | null = null;

  try {
    const body = await req.json().catch(() => null);
    const school = body?.school ?? {};
    const adminIn = body?.admin ?? {};

    const name = String(school.name ?? "").trim();
    const slug = String(school.slug ?? "").trim().toLowerCase();
    const schoolEmail = String(school.email ?? "").trim().toLowerCase();
    const adminName = String(adminIn.full_name ?? "").trim();
    const adminEmail = String(adminIn.email ?? "").trim().toLowerCase();
    const password = String(adminIn.password ?? "");

    if (name.length < 2 || name.length > 160) return json({ error: "Enter the school's name." }, 400);
    if (!SLUG_RE.test(slug)) return json({ error: "That web address is not valid." }, 400);
    if (!EMAIL_RE.test(schoolEmail)) return json({ error: "Enter a valid school email address." }, 400);
    if (adminName.length < 2) return json({ error: "Enter the administrator's full name." }, 400);
    if (!EMAIL_RE.test(adminEmail)) return json({ error: "Enter a valid administrator email address." }, 400);
    if (password.length < 8) return json({ error: "Choose a password of at least 8 characters." }, 400);

    const allowedTypes = ["nursery_primary", "secondary", "combined", "islamiyya", "other"];
    const schoolType = allowedTypes.includes(school.school_type) ? school.school_type : "combined";

    // Re-check availability server-side. The UI checks too, but that
    // check is advisory -- this one and the unique index are binding.
    const { data: available, error: availErr } = await admin.rpc("is_slug_available", { p_slug: slug });
    if (availErr) throw availErr;
    if (!available) return json({ error: "That web address is already taken. Choose another." }, 409);

    // 1. the administrator's account
    const { data: created, error: userErr } = await admin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: adminName, school_slug: slug },
    });
    if (userErr) {
      const already = /already|registered|exists/i.test(userErr.message ?? "");
      return json({ error: already
        ? "An account with that email already exists. Sign in instead, or use another address."
        : "Could not create the administrator account." }, already ? 409 : 400);
    }
    userId = created.user.id;

    // 2. the tenant
    const { data: schoolRow, error: schoolErr } = await admin.from("schools").insert({
      name,
      slug,
      school_type: schoolType,
      status: "active",
      email: schoolEmail,
      phone: String(school.phone ?? "").trim() || null,
      address: String(school.address ?? "").trim() || null,
    }).select("id, slug").single();
    if (schoolErr) throw schoolErr;
    schoolId = schoolRow.id;

    // 3. session, terms, grading scale, classes, curriculum
    const { error: bootErr } = await admin.rpc("bootstrap_school_defaults", { p_school_id: schoolId });
    if (bootErr) throw bootErr;

    // 4. the administrator as a staff member of this school
    const { data: staffRow, error: staffErr } = await admin.from("staff").insert({
      school_id: schoolId,
      user_id: userId,
      staff_code: "ADMIN",
      full_name: adminName,
      email: adminEmail,
      position: "School Administrator",
    }).select("id").single();
    if (staffErr) throw staffErr;

    // 5. the membership row that binds the account to this tenant.
    //    Until this exists, app.current_school_id() returns null and
    //    RLS shows the account nothing at all.
    const { error: memberErr } = await admin.from("school_members").insert({
      school_id: schoolId,
      user_id: userId,
      role: "admin",
      staff_id: staffRow.id,
    });
    if (memberErr) throw memberErr;

    await admin.from("audit_log").insert({
      school_id: schoolId,
      user_id: userId,
      action: "school.registered",
      entity: "schools",
      entity_id: schoolId,
      detail: { slug, name },
    });

    // Best-effort welcome email. A missing RESEND_API_KEY or a delivery
    // failure here must never fail a registration that already
    // succeeded -- the school and account are real either way.
    try {
      const rootDomain = Deno.env.get("ROOT_DOMAIN") || "amaedu.com.ng";
      const portalUrl = `https://${slug}.${rootDomain}/login`;
      await sendEmail({
        to: adminEmail,
        subject: `${name} is ready on AMA EDU`,
        html:
          `<p>Hello ${escapeHtml(adminName)},</p>` +
          `<p><strong>${escapeHtml(name)}</strong> now has its own AMA EDU portal:</p>` +
          `<p><a href="${portalUrl}">${portalUrl}</a></p>` +
          `<p>Sign in with this email address and the password you just chose. Next, add your classes and staff, then bring in your students.</p>` +
          `<p>Copyright &copy; AMAEdu 2026 All Rights Reserved!</p>`,
        text: `${name} now has its own AMA EDU portal: ${portalUrl}\nSign in with ${adminEmail} and the password you just chose.`,
      });
    } catch (emailErr) {
      console.error("register-school welcome email failed", emailErr);
    }

    return json({ school_id: schoolId, slug: schoolRow.slug });
  } catch (err) {
    // Unwind, so a partial registration never blocks the slug or
    // strands an account that belongs to no school.
    console.error("register-school failed", err);
    try { if (schoolId) await admin.from("schools").delete().eq("id", schoolId); } catch (_) { /* best effort */ }
    try { if (userId) await admin.auth.admin.deleteUser(userId); } catch (_) { /* best effort */ }
    return json({ error: "Registration could not be completed. Nothing was saved -- try again." }, 500);
  }
});
