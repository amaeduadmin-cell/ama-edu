/* ===============================================================
   Small shared data helpers used across feature pages.
   Nothing here bypasses RLS — every call goes through the normal
   supabase client, so a row only comes back if the caller's tenant
   context allows it.
   =============================================================== */

import { supabase } from "./supabase.js";
import { unwrap, logError } from "./errors.js";
import { session } from "./auth.js";

export async function fetchClasses({ activeOnly = true } = {}) {
  let q = supabase.from("classes").select("id, name, category, sort_order, is_graduating, is_active").order("sort_order");
  if (activeOnly) q = q.eq("is_active", true);
  return unwrap(await q, "fetch classes");
}

export async function fetchActiveTerm() {
  const rows = unwrap(
    await supabase.from("terms").select("id, label, order_index, session_id, ends_on, next_term_starts_on, sessions(label)").eq("is_active", true).limit(1),
    "fetch active term"
  );
  return rows?.[0] || null;
}

export async function fetchSubjectsForClass(classId) {
  return unwrap(
    await supabase
      .from("class_subjects")
      .select("subject_id, subjects(id, name)")
      .eq("class_id", classId),
    "fetch class subjects"
  ).map((r) => r.subjects);
}

/** Subjects the signed-in teacher may mark for this class (empty for admins,
 *  who may mark everything the class offers). */
export async function fetchMarkableSubjects(classId) {
  return unwrap(
    await supabase
      .from("class_teacher_subjects")
      .select("subject_id, subjects(id, name)")
      .eq("class_id", classId)
      .eq("staff_id", session.staffId || "00000000-0000-0000-0000-000000000000"),
    "fetch markable subjects"
  ).map((r) => r.subjects);
}

export function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export const fmtDate = (value) => {
  if (!value) return "—";
  try { return new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return "—"; }
};

/** 1st/2nd/3rd term averages for a student's session, for Template 4's
 *  annual-summary box. RLS gates each term's row exactly like reading
 *  the report card itself (app.student_result_visible for a student/
 *  parent, app.owns+is_reader for staff), so a term that was never
 *  published for that class simply won't come back here either. */
export async function fetchSessionTermAverages(studentId, sessionId) {
  if (!studentId || !sessionId) return [];
  const rows = unwrap(
    await supabase
      .from("student_term_summary")
      .select("average_score, terms!inner(label, order_index, session_id)")
      .eq("student_id", studentId)
      .eq("terms.session_id", sessionId)
      .order("terms(order_index)"),
    "fetch session term averages"
  );
  return (rows || []).map((r) => ({ label: r.terms?.label, average_score: r.average_score }));
}

/** Role-mapped Headmaster/Principal lookup for Template 4's signature
 *  block: nursery/primary classes show a Headmaster, jss/ss show a
 *  Principal, per this project's fee/report conventions. Falls back to
 *  the school's own stored fallback name when no staff member's
 *  `position` matches — schools.headmaster_name / principal_name
 *  already exist for exactly this fallback. */
export async function fetchHeadSignatory(category, school) {
  const wantsPrincipal = category === "jss" || category === "ss";
  const label = wantsPrincipal ? "Principal" : "Headmaster";
  const rows = unwrap(
    await supabase
      .from("staff")
      .select("full_name, signature_url")
      .eq("is_active", true)
      .ilike("position", wantsPrincipal ? "%principal%" : "%headmaster%")
      .limit(1),
    "fetch head signatory"
  );
  const match = rows?.[0];
  return {
    label,
    name: match?.full_name || (wantsPrincipal ? school?.principal_name : school?.headmaster_name) || null,
    signature_url: match?.signature_url || null,
  };
}

/** Fetch-or-create the report card's QR verification code (migration
 *  0036). Reusable across staff and student/parent views alike — the
 *  RPC itself checks whether the caller may see this report. */
export async function fetchVerificationCode(studentId, termId) {
  if (!studentId || !termId) return null;
  const { data, error } = await supabase.rpc("get_or_create_report_verification", {
    p_student_id: studentId, p_term_id: termId,
  });
  if (error) { logError("fetch verification code", error); return null; }
  return data || null;
}
