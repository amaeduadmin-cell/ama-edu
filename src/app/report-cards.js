/* ===============================================================
   Report cards — pick a class and a student, preview, print.

   Ports: buildReportCardHtml / loadBulkReportCards (MyPAS1
   app-tabs.js). Printing uses the browser's own print dialog against
   the .no-print rule already in base.css, rather than a PDF library —
   one less heavy dependency for score-entry-sized connections.
   =============================================================== */

import "../styles/marketing.css";
import { h, mount, skeleton } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState } from "../lib/ui.js";
import { fetchClasses, fetchActiveTerm } from "../lib/data.js";
import { renderReportCard } from "../lib/reportcard.js";
import { context } from "../main.js";

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin", "headmaster", "principal", "teacher")) return;

  const state = { classes: [], term: null, weights: null, classId: "", students: [], studentId: "" };
  const body = h("div.u-stack");
  mount(outlet, page({
    title: "Report cards",
    subtitle: "Pick a class and a student to preview and print their term report.",
    body,
  }));

  try {
    const [classes, term, weightsRows] = await Promise.all([
      fetchClasses(),
      fetchActiveTerm(),
      unwrap(await supabase.from("score_weights").select("*").limit(1), "fetch weights"),
    ]);
    state.classes = classes;
    state.term = term;
    state.weights = weightsRows?.[0] || { ca1_max: 20, ca2_max: 20, ca3_max: 20, exam_max: 40 };
    state.classId = classes[0]?.id || "";
  } catch (err) {
    logError("report-cards boot", err);
    return mount(body, errorState(humanError(err)));
  }

  if (!state.term) return mount(body, emptyState({ title: "No active term", body: "Ask your school administrator to activate a term in Settings." }));
  if (!state.classes.length) return mount(body, emptyState({ title: "No classes yet", body: "Add classes from Settings first." }));

  draw();
  await loadStudents();

  function draw() {
    const classSel = h("select.select", { style: { maxWidth: "220px" }, onchange: (e) => { state.classId = e.target.value; state.studentId = ""; loadStudents(); } },
      state.classes.map((c) => h("option", { value: c.id, selected: c.id === state.classId, text: c.name })));

    mount(body,
      h("div.card-head.no-print", {},
        h("div", {}, h("h2.card-title", { text: "Choose a student" }), h("div.card-sub", { text: `${state.term.label} Term · ${state.term.sessions?.label || ""}` })),
        classSel,
      ),
      h("div#reportHost", {}, skeleton(4)),
    );
  }

  async function loadStudents() {
    const host = document.getElementById("reportHost");
    try {
      state.students = unwrap(
        await supabase.from("students").select("id, full_name, admission_no").eq("class_id", state.classId).eq("is_active", true).order("full_name"),
        "fetch students"
      );
      renderPicker(host);
    } catch (err) {
      logError("load students", err);
      mount(host, errorState(humanError(err), loadStudents));
    }
  }

  function renderPicker(host) {
    if (!state.students.length) return mount(host, emptyState({ title: "No students in this class", body: "Admit students from the Students page first." }));

    const studentSel = h("select.select.no-print", { style: { maxWidth: "260px" } },
      h("option", { value: "", text: "Select a student" }),
      state.students.map((s) => h("option", { value: s.id, text: `${s.full_name} (${s.admission_no})` })));
    const printBtn = h("button.btn.btn-outline.no-print", { type: "button", text: "Print", onclick: () => window.print(), disabled: true });
    const preview = h("div#reportPreview.u-mt-4");

    studentSel.addEventListener("change", async () => {
      state.studentId = studentSel.value;
      printBtn.disabled = !state.studentId;
      if (state.studentId) await loadReport();
    });

    mount(host, h("div.u-row.no-print", { style: { marginBottom: "12px" } }, studentSel, printBtn), preview);
  }

  async function loadReport() {
    const preview = document.getElementById("reportPreview");
    mount(preview, skeleton(4));
    try {
      const klass = state.classes.find((c) => c.id === state.classId);
      const student = state.students.find((s) => s.id === state.studentId);
      const [scores, summaryRows] = await Promise.all([
        unwrap(await supabase.from("student_scores").select("ca1,ca2,ca3,exam,total,grade,subject_position,subjects(name)").eq("student_id", state.studentId).eq("term_id", state.term.id).eq("is_offered", true), "fetch scores"),
        unwrap(await supabase.from("student_term_summary").select("*").eq("student_id", state.studentId).eq("term_id", state.term.id).limit(1), "fetch summary"),
      ]);
      mount(preview, renderReportCard({
        school: context.school, student, class: klass, term: state.term,
        scores, summary: summaryRows?.[0] || null, weights: state.weights,
      }));
    } catch (err) {
      logError("load report", err);
      mount(preview, errorState(humanError(err), loadReport));
    }
  }
}
