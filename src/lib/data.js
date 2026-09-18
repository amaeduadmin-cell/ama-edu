/* ===============================================================
   Small shared data helpers used across feature pages.
   Nothing here bypasses RLS — every call goes through the normal
   supabase client, so a row only comes back if the caller's tenant
   context allows it.
   =============================================================== */

import { supabase } from "./supabase.js";
import { unwrap } from "./errors.js";
import { session } from "./auth.js";

export async function fetchClasses({ activeOnly = true } = {}) {
  let q = supabase.from("classes").select("id, name, category, sort_order, is_graduating, is_active").order("sort_order");
  if (activeOnly) q = q.eq("is_active", true);
  return unwrap(await q, "fetch classes");
}

export async function fetchActiveTerm() {
  const rows = unwrap(
    await supabase.from("terms").select("id, label, order_index, session_id, sessions(label)").eq("is_active", true).limit(1),
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
