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
import { fetchClasses, fetchActiveTerm, fetchSessionTermAverages, fetchHeadSignatory, fetchVerificationCode } from "../lib/data.js";
import { renderReportCard, loadReportCardContext } from "../lib/reportcard.js";
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
    const [classes, term, rc] = await Promise.all([
      fetchClasses(),
      fetchActiveTerm(),
      loadReportCardContext(supabase, unwrap),
    ]);
    state.classes = classes;
    state.term = term;
    state.rc = rc;
    state.weights = rc.weights || { ca1_max: 20, ca2_max: 20, ca3_max: 20, exam_max: 40 };
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
        await supabase.from("students").select("id, full_name, admission_no, photo_url, gender, date_of_birth").eq("class_id", state.classId).eq("is_active", true).order("full_name"),
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
    const printBtn = h("button.btn.btn-outline.no-print", { type: "button", text: "Print student", onclick: () => window.print(), disabled: true });
    const classPrintBtn = h("button.btn.btn-primary.no-print", { type: "button", text: `Print class (${state.students.length})`, onclick: printClass });
    const preview = h("div#reportPreview.u-mt-4");

    studentSel.addEventListener("change", async () => {
      state.studentId = studentSel.value;
      printBtn.disabled = !state.studentId;
      if (state.studentId) await loadReport();
    });

    mount(host, h("div.u-row.no-print", { style: { marginBottom: "12px" } }, studentSel, printBtn, classPrintBtn), preview);
  }

  async function loadReport() {
    const preview = document.getElementById("reportPreview");
    mount(preview, skeleton(4));
    try {
      const klass = state.classes.find((c) => c.id === state.classId);
      const student = state.students.find((s) => s.id === state.studentId);
      mount(preview, await renderCardForStudent(student, klass));
    } catch (err) {
      logError("load report", err);
      mount(preview, errorState(humanError(err), loadReport));
    }
  }

  async function renderCardForStudent(student, klass) {
    const [scores, summaryRows] = await Promise.all([
      supabase.from("student_scores").select("ca1,ca2,ca3,exam,total,grade,subject_position,subjects(name)").eq("student_id", student.id).eq("term_id", state.term.id).eq("is_offered", true),
      supabase.from("student_term_summary").select("*").eq("student_id", student.id).eq("term_id", state.term.id).limit(1),
    ]);
    const scoreRows = unwrap(scores, "fetch scores");
    const summary = unwrap(summaryRows, "fetch summary");
    let sessionSummaries = null, headSignatory = null, verificationCode = null;
    if (context.school?.report_card_template === "pariya") {
      [sessionSummaries, headSignatory, verificationCode] = await Promise.all([
        fetchSessionTermAverages(student.id, state.term.session_id),
        fetchHeadSignatory(klass?.category, context.school),
        fetchVerificationCode(student.id, state.term.id),
      ]);
    }
    return renderReportCard({
      school: context.school, student, class: klass, term: state.term,
      scores: scoreRows, summary: summary?.[0] || null, weights: state.weights,
      template: context.school?.report_card_template,
      components: state.rc.components, bands: state.rc.bands,
      remarks: state.rc.remarks, settings: state.rc.settings,
      sessionSummaries, headSignatory, verificationCode,
    });
  }

  async function printClass() {
    const host = document.getElementById("reportHost");
    const klass = state.classes.find((c) => c.id === state.classId);
    const studentsInSelectedClass = state.students.slice();
    if (!klass || !studentsInSelectedClass.length) return;
    mount(host, h("div.no-print", {}, h("p.u-muted", { text: `Preparing ${studentsInSelectedClass.length} report cards for ${klass.name}…` })));
    try {
      const cards = await Promise.all(studentsInSelectedClass.map((student) => renderCardForStudent(student, klass)));
      mount(host, h("div.report-card-batch", {}, cards));
      requestAnimationFrame(() => window.print());
    } catch (err) {
      logError("print class reports", err);
      mount(host, errorState(humanError(err), loadStudents));
    }
  }
}
