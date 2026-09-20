/* ===============================================================
   My report card — a student's own results for the active term.

   Ports: renderMyReport / loadMyReport (MyPAS1 app-tabs.js). RLS
   already refuses to return scores or the summary row when fees are
   unpaid (app.report_visible, migration 0006) — this page just reads
   public.fee_status first so it can show an honest explanation
   instead of a table that looks broken.
   =============================================================== */

import "../styles/marketing.css";
import { h, mount, skeleton } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, inlineAlert } from "../lib/ui.js";
import { fetchActiveTerm } from "../lib/data.js";
import { renderReportCard, loadReportCardContext } from "../lib/reportcard.js";
import { session } from "../lib/auth.js";
import { context } from "../main.js";
import { onDataChanged } from "../lib/realtime.js";
import { resolve } from "../lib/router.js";

export default async function render({ outlet }) {
  if (!requireRole(outlet, "student")) return;

  const body = h("div.u-stack");
  mount(outlet, page({ title: "My report card", body }));
  mount(body, skeleton(4));
  onDataChanged(() => resolve());

  try {
    const term = await fetchActiveTerm();
    if (!term) return mount(body, emptyState({ title: "No active term", body: "Your school hasn't started a term yet." }));

    // One call answers both gates — publication and fees — and returns the
    // reason only, never a score. Without this the student would just see an
    // empty table and assume the portal was broken.
    const [student, availRows, rc] = await Promise.all([
      unwrap(await supabase.from("students").select("id, full_name, admission_no, classes(id, name)").eq("id", session.studentId).single(), "fetch my record"),
      unwrap(await supabase.rpc("my_result_availability", { p_student_id: session.studentId, p_term_id: term.id }), "result availability"),
      loadReportCardContext(supabase, unwrap),
    ]);

    const availability = Array.isArray(availRows) ? availRows[0] : availRows;
    if (availability && !availability.available) {
      return mount(body, h("div.card", {}, inlineAlert(
        availability.message || "Your report card is not available yet.",
        availability.reason === "fees_outstanding" ? "warn" : "info"
      )));
    }

    const [scores, summaryRows] = await Promise.all([
      unwrap(await supabase.from("student_scores").select("ca1,ca2,ca3,exam,total,grade,subject_position,subjects(name)").eq("student_id", session.studentId).eq("term_id", term.id).eq("is_offered", true), "fetch scores"),
      unwrap(await supabase.from("student_term_summary").select("*").eq("student_id", session.studentId).eq("term_id", term.id).limit(1), "fetch summary"),
    ]);

    if (!scores.length) {
      return mount(body, emptyState({ title: "No scores published yet", body: "Check back once your teachers have entered this term's scores." }));
    }

    mount(body,
      h("div.no-print.u-row", { style: { justifyContent: "flex-end", marginBottom: "12px" } },
        h("button.btn.btn-outline.btn-sm", { type: "button", text: "Print", onclick: () => window.print() })),
      renderReportCard({
        school: context.school, student, class: student.classes, term,
        scores, summary: summaryRows?.[0] || null,
        weights: rc.weights || { ca1_max: 20, ca2_max: 20, ca3_max: 20, exam_max: 40 },
        template: context.school?.report_card_template,
        components: rc.components, bands: rc.bands, remarks: rc.remarks, settings: rc.settings,
      }),
    );
  } catch (err) {
    logError("my-report", err);
    mount(body, errorState(humanError(err)));
  }
}
