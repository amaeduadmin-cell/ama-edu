/* ===============================================================
   Results & positions — class ranking for the term, and per-subject
   rankings within a class.

   Ports: renderPositionList / subject_ranks (MyPAS1 app-phase5.js).
   Every number here was written by recompute_class_term() in
   class-scores.js — this page only reads it back.
   =============================================================== */

import { h, mount, skeleton } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState } from "../lib/ui.js";
import { fetchClasses, fetchActiveTerm } from "../lib/data.js";

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin", "headmaster", "principal", "teacher")) return;

  const state = { classes: [], term: null, classId: "", subjects: [], subjectId: "", view: "class" };
  const body = h("div.u-stack");
  mount(outlet, page({ title: "Results & positions", actions: [h("button.btn.btn-outline", { type: "button", text: "Print position list", onclick: () => window.print() })], body }));

  try {
    state.classes = await fetchClasses();
    state.term = await fetchActiveTerm();
    state.classId = state.classes[0]?.id || "";
  } catch (err) {
    logError("results boot", err);
    return mount(body, errorState(humanError(err)));
  }

  if (!state.term) return mount(body, emptyState({ title: "No active term", body: "Ask your school administrator to activate a term in Settings." }));
  if (!state.classes.length) return mount(body, emptyState({ title: "No classes yet", body: "Add classes from Settings first." }));

  await loadSubjects();
  draw();
  await loadView();

  async function loadSubjects() {
    state.subjects = unwrap(
      await supabase.from("class_subjects").select("subject_id, subjects(id, name)").eq("class_id", state.classId),
      "fetch subjects"
    ).map((r) => r.subjects);
    state.subjectId = state.subjects[0]?.id || "";
  }

  function draw() {
    const classSel = h("select.select", { style: { maxWidth: "200px" }, onchange: async (e) => { state.classId = e.target.value; await loadSubjects(); draw(); loadView(); } },
      state.classes.map((c) => h("option", { value: c.id, selected: c.id === state.classId, text: c.name })));

    const seg = h("div.seg", { style: { maxWidth: "300px" } },
      h(`button${state.view === "class" ? ".active" : ""}`, { type: "button", text: "Class position", onclick: () => { state.view = "class"; draw(); loadView(); } }),
      h(`button${state.view === "subject" ? ".active" : ""}`, { type: "button", text: "By subject", onclick: () => { state.view = "subject"; draw(); loadView(); } }),
    );

    const subjectSel = state.view === "subject"
      ? h("select.select", { style: { maxWidth: "200px" }, onchange: (e) => { state.subjectId = e.target.value; loadView(); } },
          state.subjects.map((s) => h("option", { value: s.id, selected: s.id === state.subjectId, text: s.name })))
      : null;

    mount(body,
      h("div.card-head", {},
        h("div", {}, h("h2.card-title", { text: "Results" }), h("div.card-sub", { text: `${state.term.label} Term · ${state.term.sessions?.label || ""}` })),
        h("div.u-row", {}, classSel, subjectSel),
      ),
      seg,
      h("div#resultsHost", {}, skeleton(4)),
    );
  }

  async function loadView() {
    const host = document.getElementById("resultsHost");
    if (!host) return;
    mount(host, skeleton(5));
    try {
      if (state.view === "class") {
        const rows = unwrap(
          await supabase.from("student_term_summary").select("class_position, class_size, total_score, average_score, overall_grade, students(full_name, admission_no)").eq("class_id", state.classId).eq("term_id", state.term.id).order("class_position"),
          "fetch positions"
        );
        renderClassTable(host, rows);
      } else {
        if (!state.subjectId) return mount(host, emptyState({ title: "No subjects assigned", body: "Add subjects to this class from Curriculum." }));
        const rows = unwrap(
          await supabase.from("student_scores").select("subject_position, total, grade, students(full_name, admission_no)").eq("class_id", state.classId).eq("subject_id", state.subjectId).eq("term_id", state.term.id).order("subject_position"),
          "fetch subject ranks"
        );
        renderSubjectTable(host, rows);
      }
    } catch (err) {
      logError("load results", err);
      mount(host, errorState(humanError(err), loadView));
    }
  }

  function renderClassTable(host, rows) {
    if (!rows.length) return mount(host, emptyState({ title: "No results yet", body: "Save scores in Classes & Scores, then they'll appear here." }));
    mount(host, h("div.table-wrap.card.card-flush", {}, h("table.table", {},
      h("thead", {}, h("tr", {}, h("th", { text: "Position" }), h("th", { text: "Student" }), h("th.num", { text: "Total" }), h("th.num", { text: "Average" }), h("th.num", { text: "Grade" }))),
      h("tbody", {}, rows.map((r) => h("tr", {},
        h("td.u-num", { text: r.class_position ? `${r.class_position} / ${r.class_size}` : "—" }),
        h("td", {}, h("div", { style: { fontWeight: "600" }, text: r.students?.full_name }), h("div.u-xs.u-muted", { text: r.students?.admission_no })),
        h("td.num.u-num", { text: r.total_score ?? "—" }),
        h("td.num.u-num", { text: r.average_score != null ? `${r.average_score}%` : "—" }),
        h("td.num", {}, r.overall_grade ? h("span.badge.badge-ok", { text: r.overall_grade }) : "—"),
      ))),
    )));
  }

  function renderSubjectTable(host, rows) {
    if (!rows.length) return mount(host, emptyState({ title: "No scores yet for this subject", body: "Enter scores in Classes & Scores first." }));
    mount(host, h("div.table-wrap.card.card-flush", {}, h("table.table", {},
      h("thead", {}, h("tr", {}, h("th", { text: "Position" }), h("th", { text: "Student" }), h("th.num", { text: "Total" }), h("th.num", { text: "Grade" }))),
      h("tbody", {}, rows.map((r) => h("tr", {},
        h("td.u-num", { text: r.subject_position ?? "—" }),
        h("td", {}, h("div", { style: { fontWeight: "600" }, text: r.students?.full_name }), h("div.u-xs.u-muted", { text: r.students?.admission_no })),
        h("td.num.u-num", { text: r.total ?? "—" }),
        h("td.num", {}, r.grade ? h("span.badge.badge-ok", { text: r.grade }) : "—"),
      ))),
    )));
  }
}
