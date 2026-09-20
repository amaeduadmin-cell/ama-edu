/* ===============================================================
   Parent portal — one card per linked child.

   A parent sees exactly the children in parent_students and nothing
   else; that is enforced by app.my_children() inside every RPC and
   policy this page touches, not by the filtering here.

   Results obey the same two gates as everywhere else: the class must
   be published AND the school's fee policy must allow it. When they
   don't, the parent is told why rather than shown an empty page.
   =============================================================== */

import { h, mount, skeleton } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, inlineAlert } from "../lib/ui.js";
import { fetchActiveTerm } from "../lib/data.js";
import { renderReportCard, loadReportCardContext } from "../lib/reportcard.js";
import { context } from "../main.js";
import { initials, fmtDate } from "../lib/data.js";
import { onDataChanged } from "../lib/realtime.js";
import { resolve } from "../lib/router.js";

export default async function render({ outlet }) {
  if (!requireRole(outlet, "parent")) return;

  const body = h("div.u-stack");
  mount(outlet, page({ title: "My children", subtitle: "Results, attendance and homework for each child.", body }));
  mount(body, skeleton(5));
  onDataChanged(() => resolve());

  let term, children, rc;
  try {
    term = await fetchActiveTerm();
    if (!term) return mount(body, emptyState({ title: "No active term", body: "The school has not started a term yet." }));
    [children, rc] = await Promise.all([
      unwrap(await supabase.rpc("my_children_overview"), "children overview"),
      loadReportCardContext(supabase, unwrap),
    ]);
  } catch (err) {
    logError("parent boot", err);
    return mount(body, errorState(humanError(err)));
  }

  if (!children?.length) {
    return mount(body, emptyState({
      title: "No children linked yet",
      body: "Ask the school office to link your children to your account.",
    }));
  }

  mount(body, children.map(childCard));

  function childCard(c) {
    const host = h("div.u-mt-4");
    return h("div.card", {},
      h("div.u-row", { style: { gap: "14px", alignItems: "center", flexWrap: "wrap" } },
        c.photo_url
          ? h("img", { src: c.photo_url, alt: "", style: { width: "52px", height: "52px", borderRadius: "50%", objectFit: "cover" } })
          : h("div.avatar", { style: { width: "52px", height: "52px", display: "grid", placeItems: "center", borderRadius: "50%", background: "var(--ama-green-soft)", fontWeight: "700", color: "var(--ama-green-deep)" }, text: initials(c.full_name) }),
        h("div.u-grow", {},
          h("div", { style: { fontWeight: "700", fontSize: "16px" }, text: c.full_name }),
          h("div.u-xs.u-muted", { text: `${c.class_name || "No class"} · ${c.admission_no}` }),
        ),
      ),
      h("div.u-row", { style: { gap: "8px", flexWrap: "wrap", marginTop: "12px" } },
        stat("Attendance", c.attendance_rate != null ? `${c.attendance_rate}%` : "—"),
        stat("Present", c.days_present ?? "—"),
        stat("Absent", c.days_absent ?? "—"),
        stat("Homework due", c.homework_pending ?? 0),
        stat("Fees", c.fees_settled ? "Settled" : "Outstanding"),
      ),
      h("div.u-row", { style: { gap: "6px", marginTop: "12px", flexWrap: "wrap" } },
        h("button.btn.btn-outline.btn-sm", { type: "button", text: "Report card", onclick: () => showReport(host, c) }),
        h("button.btn.btn-outline.btn-sm", { type: "button", text: "Attendance", onclick: () => showAttendance(host, c) }),
        h("button.btn.btn-outline.btn-sm", { type: "button", text: "Homework", onclick: () => showHomework(host, c) }),
        h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Exams & tests", onclick: () => showExams(host, c) }),
      ),
      host,
    );
  }

  function stat(label, value) {
    return h("div", { style: { minWidth: "92px" } },
      h("div.u-xs.u-muted", { text: label }),
      h("div", { style: { fontWeight: "600" }, text: String(value) }));
  }

  async function showReport(host, c) {
    mount(host, skeleton(3));
    if (!c.result_available) {
      return mount(host, inlineAlert(c.result_message || "This report card is not available yet.",
        /fee/i.test(c.result_message || "") ? "warn" : "info"));
    }
    try {
      const [scores, summaryRows, student] = await Promise.all([
        unwrap(await supabase.from("student_scores")
          .select("ca1,ca2,ca3,exam,total,grade,subject_position,subjects(name)")
          .eq("student_id", c.student_id).eq("term_id", term.id).eq("is_offered", true), "scores"),
        unwrap(await supabase.from("student_term_summary").select("*")
          .eq("student_id", c.student_id).eq("term_id", term.id).limit(1), "summary"),
        unwrap(await supabase.from("students").select("id, full_name, admission_no, photo_url, classes(name)")
          .eq("id", c.student_id).single(), "student"),
      ]);
      if (!scores.length) {
        return mount(host, emptyState({ title: "No scores yet", body: "No results have been recorded for this term." }));
      }
      mount(host,
        h("div.no-print.u-row", { style: { justifyContent: "flex-end", marginBottom: "8px" } },
          h("button.btn.btn-outline.btn-sm", { type: "button", text: "Print", onclick: () => window.print() })),
        renderReportCard({
          school: context.school, student, class: student.classes, term,
          scores, summary: summaryRows?.[0] || null,
          template: context.school?.report_card_template,
          components: rc.components, bands: rc.bands, remarks: rc.remarks,
          settings: rc.settings, weights: rc.weights,
        }));
    } catch (err) {
      mount(host, errorState(humanError(err)));
    }
  }

  async function showAttendance(host, c) {
    mount(host, skeleton(3));
    try {
      const rows = unwrap(await supabase
        .from("attendance_records")
        .select("status, attendance_sessions(taken_on)")
        .eq("student_id", c.student_id)
        .order("id", { ascending: false })
        .limit(60), "attendance");
      if (!rows.length) return mount(host, emptyState({ title: "No attendance yet", body: "No register has been taken for this class." }));
      mount(host, h("div.table-wrap", {}, h("table.table", {},
        h("thead", {}, h("tr", {}, h("th", { text: "Date" }), h("th", { text: "Status" }))),
        h("tbody", {}, rows.map((r) => h("tr", {},
          h("td", { text: fmtDate(r.attendance_sessions?.taken_on) }),
          h("td", {}, h(`span.badge.${r.status === "absent" ? "badge-warn" : "badge-ok"}`, { text: r.status })),
        ))),
      )));
    } catch (err) { mount(host, errorState(humanError(err))); }
  }

  async function showHomework(host, c) {
    mount(host, skeleton(3));
    try {
      const rows = unwrap(await supabase.rpc("my_assignments", {
        p_student_id: c.student_id, p_term_id: term.id,
      }), "homework");
      if (!rows.length) return mount(host, emptyState({ title: "No homework set", body: "Nothing has been set this term." }));
      mount(host, h("div.table-wrap", {}, h("table.table", {},
        h("thead", {}, h("tr", {},
          h("th", { text: "Homework" }), h("th", { text: "Subject" }),
          h("th", { text: "Due" }), h("th", { text: "Status" }), h("th.u-num", { text: "Grade" }))),
        h("tbody", {}, rows.map((a) => h("tr", {},
          h("td", { text: a.title }),
          h("td", { text: a.subject_name }),
          h("td.u-xs", { text: a.due_at ? new Date(a.due_at).toLocaleDateString() : "—" }),
          h("td", {}, h("span.badge", { text: a.my_status })),
          h("td.u-num", { text: a.my_grade == null ? "—" : `${a.my_grade}${a.max_score ? ` / ${a.max_score}` : ""}` }),
        ))),
      )));
    } catch (err) { mount(host, errorState(humanError(err))); }
  }

  async function showExams(host, c) {
    mount(host, skeleton(3));
    try {
      const rows = unwrap(await supabase
        .from("assessment_attempts")
        .select("score, total_marks, percentage, status, submitted_at, assessments(title, assessment_type, subjects(name))")
        .eq("student_id", c.student_id)
        .order("submitted_at", { ascending: false }), "attempts");
      if (!rows.length) return mount(host, emptyState({ title: "No tests taken", body: "No exam or test has been sat this term." }));
      mount(host, h("div.table-wrap", {}, h("table.table", {},
        h("thead", {}, h("tr", {},
          h("th", { text: "Assessment" }), h("th", { text: "Subject" }),
          h("th.u-num", { text: "Score" }), h("th.u-num", { text: "%" }), h("th", { text: "Taken" }))),
        h("tbody", {}, rows.map((a) => h("tr", {},
          h("td", { text: a.assessments?.title || "—" }),
          h("td", { text: a.assessments?.subjects?.name || "—" }),
          h("td.u-num", { text: a.score == null ? "—" : `${a.score} / ${a.total_marks}` }),
          h("td.u-num", { text: a.percentage == null ? "—" : `${a.percentage}%` }),
          h("td.u-xs", { text: a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : "—" }),
        ))),
      )));
    } catch (err) { mount(host, errorState(humanError(err))); }
  }
}
