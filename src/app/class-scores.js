/* ===============================================================
   Score entry for one class, one subject, the active term.

   Ports: loadClassScoreGrid / saveClassScores / submitPeriod
   (MyPAS1 app-tabs.js). Averages, grades and positions are never
   computed here — they are read back from Postgres after
   recompute_class_term() runs, so a tampered client cannot publish
   a wrong result.
   =============================================================== */

import { h, mount, skeleton, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, toastOk, toastError, inlineAlert } from "../lib/ui.js";
import { fetchActiveTerm } from "../lib/data.js";
import { hasRole, session } from "../lib/auth.js";

export default async function render({ outlet, params }) {
  if (!requireRole(outlet, "admin", "headmaster", "principal", "teacher")) return;

  const classId = params.id;
  const isAdmin = hasRole("admin", "headmaster", "principal");
  const state = { klass: null, term: null, subjects: [], subjectId: "", weights: null, students: [], dirty: new Set(), locked: false };

  const body = h("div.u-stack");
  mount(outlet, page({ title: "Score entry", body }));

  try {
    const [klass, term, weightsRows] = await Promise.all([
      unwrap(await supabase.from("classes").select("id, name, school_id").eq("id", classId).single(), "fetch class"),
      fetchActiveTerm(),
      unwrap(await supabase.from("score_weights").select("*").limit(1), "fetch weights"),
    ]);
    state.klass = klass;
    state.term = term;
    state.weights = weightsRows?.[0] || { ca1_max: 20, ca2_max: 20, ca3_max: 20, exam_max: 40 };

    state.subjects = isAdmin
      ? unwrap(await supabase.from("class_subjects").select("subject_id, subjects(id, name)").eq("class_id", classId), "fetch subjects").map((r) => r.subjects)
      : unwrap(await supabase.from("class_teacher_subjects").select("subject_id, subjects(id, name)").eq("class_id", classId).eq("staff_id", session.staffId || ""), "fetch my subjects").map((r) => r.subjects);

    document.title = `${klass.name} — Score entry`;
    draw();
    if (state.subjects.length) { state.subjectId = state.subjects[0].id; await loadScores(); }
  } catch (err) {
    logError("class-scores boot", err);
    return mount(body, errorState(humanError(err)));
  }

  function draw() {
    if (!state.term) {
      return mount(body, emptyState({ title: "No active term", body: "Ask your school administrator to activate a term in Settings before entering scores." }));
    }
    if (!state.subjects.length) {
      return mount(body, emptyState({
        title: "Nothing to mark here",
        body: isAdmin ? "This class has no subjects assigned. Add some from Curriculum." : "You are not assigned to teach any subject in this class.",
      }));
    }

    const subjSel = h("select.select", { style: { maxWidth: "260px" }, onchange: (e) => { state.subjectId = e.target.value; loadScores(); } },
      state.subjects.map((s) => h("option", { value: s.id, selected: s.id === state.subjectId, text: s.name })));

    mount(body,
      h("div.card-head", {},
        h("div", {}, h("h2.card-title", { text: state.klass.name }), h("div.card-sub", { text: `${state.term.label} Term · ${state.term.sessions?.label || ""}` })),
        subjSel,
      ),
      h("div#scoreGridHost"),
    );
  }

  async function loadScores() {
    const host = document.getElementById("scoreGridHost");
    if (!host) return;
    mount(host, skeleton(5));
    try {
      const [students, scores, locks] = await Promise.all([
        unwrap(await supabase.from("students").select("id, full_name, admission_no").eq("class_id", classId).eq("is_active", true).order("full_name"), "fetch students"),
        unwrap(await supabase.from("student_scores").select("*").eq("class_id", classId).eq("subject_id", state.subjectId).eq("term_id", state.term.id), "fetch scores"),
        unwrap(await supabase.from("subject_score_locks").select("period, locked").eq("class_id", classId).eq("subject_id", state.subjectId).eq("term_id", state.term.id), "fetch locks"),
      ]);
      const byStudent = new Map(scores.map((s) => [s.student_id, s]));
      state.students = students.map((st) => ({ ...st, score: byStudent.get(st.id) || null }));
      state.locked = locks.some((l) => l.locked) && !isAdmin;
      state.dirty.clear();
      renderGrid(host);
    } catch (err) {
      logError("load scores", err);
      mount(host, errorState(humanError(err), loadScores));
    }
  }

  function renderGrid(host) {
    if (!state.students.length) {
      return mount(host, emptyState({ title: "No students in this class", body: "Admit students from the Students page first." }));
    }

    const w = state.weights;
    const saveBtn = h("button.btn.btn-primary", { type: "button", text: "Save scores", disabled: state.locked });
    const recomputeNote = h("div.u-xs.u-muted");

    const numInput = (student, key, max) => {
      const value = student.score?.[key];
      const input = h("input.input.u-num", {
        type: "number", min: "0", max: String(max), step: "0.5",
        value: value == null ? "" : value,
        style: { maxWidth: "76px" },
        disabled: state.locked,
        oninput: (e) => {
          student._edits = student._edits || {};
          const raw = e.target.value;
          student._edits[key] = raw === "" ? null : Number(raw);
          state.dirty.add(student.id);
          saveBtn.disabled = state.locked;
        },
      });
      return input;
    };

    mount(host,
      state.locked ? inlineAlert("Scores for this subject are locked for the active term. Ask an administrator to unlock it.", "warn") : null,
      h("div.table-wrap.card.card-flush", {}, h("table.table", {},
        h("thead", {}, h("tr", {},
          h("th", { text: "Student" }),
          h("th.num", { text: `CA1 /${w.ca1_max}` }),
          h("th.num", { text: `CA2 /${w.ca2_max}` }),
          h("th.num", { text: `CA3 /${w.ca3_max}` }),
          h("th.num", { text: `Exam /${w.exam_max}` }),
          h("th.num", { text: "Total" }),
          h("th.num", { text: "Grade" }),
          h("th.num", { text: "Pos." }),
        )),
        h("tbody", {}, state.students.map((st) => h("tr", {},
          h("td", {}, h("div", { style: { fontWeight: "600" }, text: st.full_name }), h("div.u-xs.u-muted", { text: st.admission_no })),
          h("td.num", {}, numInput(st, "ca1", w.ca1_max)),
          h("td.num", {}, numInput(st, "ca2", w.ca2_max)),
          h("td.num", {}, numInput(st, "ca3", w.ca3_max)),
          h("td.num", {}, numInput(st, "exam", w.exam_max)),
          h("td.num.u-num", { text: st.score?.total ?? "—" }),
          h("td.num", {}, st.score?.grade ? h("span.badge.badge-ok", { text: st.score.grade }) : "—"),
          h("td.num", { text: st.score?.subject_position ?? "—" }),
        ))),
      )),
      h("div.u-row.u-mt-4", {}, saveBtn, recomputeNote),
    );

    saveBtn.addEventListener("click", () => save(saveBtn, recomputeNote));
  }

  async function save(saveBtn, note) {
    const changed = state.students.filter((s) => state.dirty.has(s.id));
    if (!changed.length) return;

    const rows = changed.map((s) => ({
      school_id: state.klass.school_id,
      student_id: s.id,
      class_id: classId,
      subject_id: state.subjectId,
      term_id: state.term.id,
      ca1: s._edits?.ca1 ?? s.score?.ca1 ?? null,
      ca2: s._edits?.ca2 ?? s.score?.ca2 ?? null,
      ca3: s._edits?.ca3 ?? s.score?.ca3 ?? null,
      exam: s._edits?.exam ?? s.score?.exam ?? null,
      entered_by: session.staffId || null,
    }));

    setBusy(saveBtn, true, "Saving…");
    try {
      unwrap(
        await supabase.from("student_scores").upsert(rows, { onConflict: "student_id,subject_id,term_id" }),
        "save scores"
      );
      mount(note, "Recalculating averages and positions…");
      await supabase.rpc("recompute_class_term", { p_class_id: classId, p_term_id: state.term.id });
      toastOk("Scores saved");
      await loadScores();
    } catch (err) {
      toastError(humanError(err, "Some scores could not be saved."));
      mount(note, inlineAlert(humanError(err), "error"));
    } finally {
      setBusy(saveBtn, false);
    }
  }
}
