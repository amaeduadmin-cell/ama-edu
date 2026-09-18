/* ===============================================================
   Student detail — one student's profile, term history, and their
   report card for any past term.

   Ports: openStudentForm (detail view) / loadMyReport (MyPAS1
   app-admin.js, app-tabs.js). Staff can view any term's scores
   regardless of fee status — the fee gate in my-report.js is for the
   student's own view, not staff looking things up.
   =============================================================== */

import "../styles/marketing.css";
import { h, mount, skeleton, safeUrl } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState } from "../lib/ui.js";
import { renderReportCard } from "../lib/reportcard.js";
import { initials, fmtDate } from "../lib/data.js";
import { context } from "../main.js";

export default async function render({ outlet, params }) {
  if (!requireRole(outlet, "admin", "headmaster", "principal", "teacher", "registrar_primary", "registrar_secondary")) return;

  const studentId = params.id;
  const body = h("div.u-stack");
  mount(outlet, page({ title: "Student", body }));
  mount(body, skeleton(4));

  try {
    const [student, terms, weightsRows] = await Promise.all([
      unwrap(await supabase.from("students").select("*, classes(id, name)").eq("id", studentId).single(), "fetch student"),
      unwrap(await supabase.from("student_term_summary").select("term_id, average_score, class_position, class_size, overall_grade, terms(label, order_index, sessions(label))").eq("student_id", studentId).order("order_index", { foreignTable: "terms" }), "fetch history"),
      unwrap(await supabase.from("score_weights").select("*").limit(1), "fetch weights"),
    ]);

    document.title = `${student.full_name} — Student`;
    const weights = weightsRows?.[0] || { ca1_max: 20, ca2_max: 20, ca3_max: 20, exam_max: 40 };
    draw(student, terms, weights);
  } catch (err) {
    logError("student-detail boot", err);
    mount(body, errorState(humanError(err)));
  }

  function draw(student, terms, weights) {
    const photo = safeUrl(student.photo_url);

    mount(body,
      h("div.card", {},
        h("div.u-row.u-wrap", {},
          photo ? h("img", { src: photo, alt: "", style: { width: "64px", height: "64px", borderRadius: "10px", objectFit: "cover" } })
                : h("div.sidebar-crest", { style: { width: "64px", height: "64px", fontSize: "22px", display: "grid", placeItems: "center" }, text: initials(student.full_name) }),
          h("div.u-grow", {},
            h("h2.card-title", { text: student.full_name }),
            h("div.card-sub", { text: `${student.admission_no} · ${student.classes?.name || "No class"}` }),
          ),
          student.is_active ? h("span.badge.badge-ok", { text: "Active" }) : h("span.badge.badge-warn", { text: "Inactive" }),
          h("a.btn.btn-outline.btn-sm", { href: "/students", text: "Back to students" }),
        ),
        h("div.form-grid.cols-2.u-mt-6", {},
          infoRow("Gender", student.gender ? student.gender[0].toUpperCase() + student.gender.slice(1) : "—"),
          infoRow("Date admitted", fmtDate(student.date_admitted)),
          infoRow("Guardian", student.guardian_name || "—"),
          infoRow("Guardian phone", student.guardian_phone || "—"),
          infoRow("Guardian email", student.guardian_email || "—"),
          infoRow("Login", student.user_id ? "Active" : "Not set up"),
        ),
      ),
      historyCard(terms),
      reportSection(student, terms, weights),
    );
  }

  function infoRow(label, value) {
    return h("div", {}, h("div.u-xs.u-muted", { text: label }), h("div", { style: { fontWeight: "500" }, text: value }));
  }

  function historyCard(terms) {
    if (!terms.length) return h("section.card", {}, h("h2.card-title", { text: "Term history" }), emptyState({ title: "No results yet", body: "Scores will appear here once entered." }));
    return h("section.card", {},
      h("h2.card-title", { text: "Term history" }),
      h("div.table-wrap.u-mt-4", {}, h("table.table", {},
        h("thead", {}, h("tr", {}, h("th", { text: "Term" }), h("th.num", { text: "Average" }), h("th.num", { text: "Position" }), h("th.num", { text: "Grade" }))),
        h("tbody", {}, terms.map((t) => h("tr", {},
          h("td", { text: `${t.terms.label} Term, ${t.terms.sessions?.label || ""}` }),
          h("td.num.u-num", { text: t.average_score != null ? `${t.average_score}%` : "—" }),
          h("td.num.u-num", { text: t.class_position ? `${t.class_position} / ${t.class_size}` : "—" }),
          h("td.num", {}, t.overall_grade ? h("span.badge.badge-ok", { text: t.overall_grade }) : "—"),
        ))),
      )),
    );
  }

  function reportSection(student, terms, weights) {
    if (!terms.length) return null;
    const termSel = h("select.select.no-print", { style: { maxWidth: "240px" } },
      terms.map((t) => h("option", { value: t.term_id, text: `${t.terms.label} Term, ${t.terms.sessions?.label || ""}` })));
    const printBtn = h("button.btn.btn-outline.btn-sm.no-print", { type: "button", text: "Print", onclick: () => window.print() });
    const preview = h("div.u-mt-4");

    termSel.addEventListener("change", () => loadReport(termSel.value, preview, student, weights));
    loadReport(termSel.value || terms[0].term_id, preview, student, weights);

    return h("section.card", {},
      h("div.card-head.no-print", {}, h("h2.card-title", { text: "Report card" }), h("div.u-row", {}, termSel, printBtn)),
      preview,
    );
  }

  async function loadReport(termId, host, student, weights) {
    mount(host, skeleton(3));
    try {
      const [term, scores, summaryRows] = await Promise.all([
        unwrap(await supabase.from("terms").select("id, label, sessions(label)").eq("id", termId).single(), "fetch term"),
        unwrap(await supabase.from("student_scores").select("ca1,ca2,ca3,exam,total,grade,subject_position,subjects(name)").eq("student_id", student.id).eq("term_id", termId).eq("is_offered", true), "fetch scores"),
        unwrap(await supabase.from("student_term_summary").select("*").eq("student_id", student.id).eq("term_id", termId).limit(1), "fetch summary"),
      ]);
      mount(host, renderReportCard({
        school: context.school, student, class: student.classes, term,
        scores, summary: summaryRows?.[0] || null, weights,
      }));
    } catch (err) {
      logError("load student report", err);
      mount(host, errorState(humanError(err)));
    }
  }
}
