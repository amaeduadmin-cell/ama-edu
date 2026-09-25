/* ===============================================================
   Exams & Tests (staff) — create assessments, build the question
   bank, preview the distribution, read results.

   Ports app-exams-admin.js from Pariya Central. The question bank
   here never travels to a student: RLS on assessment_questions has
   no student policy at all, and the student-facing RPC omits
   correct_option. Marking is done by the database.
   =============================================================== */

import { h, mount, skeleton, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, field, inlineAlert, openModal, confirmAction, toastOk, toastError } from "../lib/ui.js";
import { fetchClasses, fetchActiveTerm, fetchSubjectsForClass } from "../lib/data.js";

const TYPES = [["ca1", "CA1 (Test)"], ["ca2", "CA2 (Test)"], ["ca3", "CA3 (Test)"], ["exam", "Examination"]];
const TYPE_LABEL = Object.fromEntries(TYPES);
/** Turn pasted text into questions. One question per line:
 *    question | A | B | C | D | answer | marks
 *  Pipes or tabs both work, so a block copied from a spreadsheet pastes
 *  straight in. C, D and marks may be left empty. Problems are reported
 *  by line number instead of silently dropping a row. */
export function parseQuestionsText(text) {
  const questions = [];
  const problems = [];
  String(text || "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const cols = (line.includes("\t") ? line.split("\t") : line.split("|")).map((c) => c.trim());
    if (cols.length < 6) return problems.push(`Line ${i + 1}: expected question, A, B, C, D, answer (and optionally marks).`);
    const [question_text, option_a, option_b, option_c, option_d, answer, marks] = cols;
    const correct = String(answer || "").toUpperCase();
    if (!question_text || !option_a || !option_b) return problems.push(`Line ${i + 1}: the question and options A and B are required.`);
    if (!["A", "B", "C", "D"].includes(correct)) return problems.push(`Line ${i + 1}: the answer must be A, B, C or D.`);
    if ((correct === "C" && !option_c) || (correct === "D" && !option_d)) return problems.push(`Line ${i + 1}: option ${correct} is the answer but is empty.`);
    if (marks && !(Number(marks) > 0)) return problems.push(`Line ${i + 1}: marks must be a positive number.`);
    questions.push({ question_text, option_a, option_b, option_c, option_d, correct_option: correct, marks: marks || "1" });
  });
  return { questions, problems };
}

const STATUS_BADGE = { draft: "badge", scheduled: "badge-warn", active: "badge-ok", closed: "badge-info" };

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin", "headmaster", "principal", "teacher")) return;

  const state = { term: null, classes: [], list: [], tab: "manage", loading: true };
  const body = h("div.u-stack");
  mount(outlet, page({
    title: "Exams & tests",
    subtitle: "Set CA tests and end-of-term examinations, build the question bank, and see results.",
    actions: [h("button.btn.btn-primary", { type: "button", text: "New assessment", onclick: () => openForm() })],
    body,
  }));

  try {
    const [classes, term] = await Promise.all([fetchClasses(), fetchActiveTerm()]);
    state.classes = classes; state.term = term;
  } catch (err) {
    logError("assessments boot", err);
    return mount(body, errorState(humanError(err)));
  }
  if (!state.term) return mount(body, emptyState({ title: "No active term", body: "Activate a term in Settings first." }));

  await load();

  async function load() {
    state.loading = true; draw();
    try {
      state.list = unwrap(await supabase
        .from("assessments")
        .select("id, title, assessment_type, status, start_at, end_at, duration_minutes, questions_per_student, class_id, subject_id, classes(name), subjects(name)")
        .eq("term_id", state.term.id)
        .order("created_at", { ascending: false }), "load assessments");
    } catch (err) {
      logError("load assessments", err);
      state.error = humanError(err);
    } finally { state.loading = false; draw(); }
  }

  function draw() {
    if (state.loading) return mount(body, h("div.card", {}, skeleton(6)));
    if (state.error) return mount(body, errorState(state.error, load));
    if (!state.list.length) {
      return mount(body, emptyState({
        title: "No assessments yet",
        body: "Create a CA test or an examination, then add its questions.",
      }));
    }

    mount(body, h("div.card.card-flush", {}, h("div.table-wrap", {}, h("table.table", {},
      h("thead", {}, h("tr", {},
        h("th", { text: "Assessment" }), h("th", { text: "Class / subject" }),
        h("th", { text: "Type" }), h("th", { text: "Status" }), h("th", { text: "" }))),
      h("tbody", {}, state.list.map((a) => h("tr", {},
        h("td", {}, h("div", { style: { fontWeight: "600" }, text: a.title }),
          h("div.u-xs.u-muted", { text: a.duration_minutes ? `${a.duration_minutes} minutes` : "Untimed" })),
        h("td", {}, h("div", { text: a.classes?.name || "—" }), h("div.u-xs.u-muted", { text: a.subjects?.name || "—" })),
        h("td", {}, h("span.badge.badge-info", { text: TYPE_LABEL[a.assessment_type] || a.assessment_type })),
        h("td", {}, h(`span.badge.${STATUS_BADGE[a.status] || "badge"}`, { text: a.status })),
        h("td", {}, h("div.u-row", { style: { gap: "6px", justifyContent: "flex-end" } },
          h("button.btn.btn-outline.btn-sm", { type: "button", text: "Questions", onclick: () => openBank(a) }),
          h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Results", onclick: () => openResults(a) }),
          h("button.btn.btn-ghost.btn-sm", { type: "button", text: statusAction(a.status), onclick: (e) => cycleStatus(e.target, a) }),
        )),
      ))),
    ))));
  }

  function statusAction(status) {
    return status === "active" ? "Close" : status === "closed" ? "Reopen" : "Open to students";
  }

  async function cycleStatus(btn, a) {
    const next = a.status === "active" ? "closed" : "active";
    const ok = await confirmAction({
      title: next === "active" ? `Open "${a.title}" to students?` : `Close "${a.title}"?`,
      message: next === "active"
        ? "Students in this class will be able to start it, subject to any start and end times you set."
        : "Students will no longer be able to start or continue this assessment.",
      confirmLabel: next === "active" ? "Open" : "Close",
      danger: next === "closed",
    });
    if (!ok) return;
    setBusy(btn, true, "…");
    try {
      unwrap(await supabase.from("assessments").update({ status: next }).eq("id", a.id), "update status");
      toastOk(next === "active" ? "Open to students" : "Closed");
      await load();
    } catch (err) { toastError(humanError(err)); } finally { setBusy(btn, false); }
  }

  /* ---------------- create ---------------- */
  function openForm() {
    const classSel = h("select.select", {}, state.classes.map((c) => h("option", { value: c.id, text: c.name })));
    const subjectSel = h("select.select", {}, h("option", { value: "", text: "Select a class first" }));
    const typeSel = h("select.select", {}, TYPES.map(([v, l]) => h("option", { value: v, text: l })));
    const titleInput = h("input.input", { required: true, placeholder: "e.g. CA1 Mathematics" });
    const durInput = h("input.input", { type: "number", min: "1", max: "600", placeholder: "Leave blank for untimed" });
    const perStudent = h("input.input", { type: "number", min: "1", placeholder: "Blank = whole question bank" });
    const startInput = h("input.input", { type: "datetime-local" });
    const endInput = h("input.input", { type: "datetime-local" });
    const errorSlot = h("div");
    const submit = h("button.btn.btn-primary", { type: "submit", form: "asmForm", text: "Create" });

    async function loadSubjects() {
      try {
        const subjects = await fetchSubjectsForClass(classSel.value);
        mount(subjectSel, subjects.length
          ? subjects.map((s) => h("option", { value: s.id, text: s.name }))
          : h("option", { value: "", text: "This class offers no subjects yet" }));
      } catch (err) { logError("load subjects", err); }
    }
    classSel.addEventListener("change", loadSubjects);
    loadSubjects();

    const close = openModal({
      title: "New assessment",
      wide: true,
      body: h("form", {
        id: "asmForm", novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          mount(errorSlot);
          const payload = {
            class_id: classSel.value, subject_id: subjectSel.value, term_id: state.term.id,
            assessment_type: typeSel.value, title: titleInput.value.trim(),
            duration_minutes: durInput.value ? Number(durInput.value) : null,
            questions_per_student: perStudent.value ? Number(perStudent.value) : null,
            start_at: startInput.value ? new Date(startInput.value).toISOString() : null,
            end_at: endInput.value ? new Date(endInput.value).toISOString() : null,
            status: "draft",
          };
          if (!payload.subject_id) return mount(errorSlot, inlineAlert("Choose a subject."));
          if (payload.title.length < 2) return mount(errorSlot, inlineAlert("Give the assessment a title."));
          if (payload.start_at && payload.end_at && payload.end_at <= payload.start_at) {
            return mount(errorSlot, inlineAlert("The closing time must be after the opening time."));
          }
          setBusy(submit, true, "Creating…");
          try {
            unwrap(await supabase.from("assessments").insert(payload), "create assessment");
            toastOk("Created — now add its questions");
            close();
            await load();
          } catch (err) {
            mount(errorSlot, inlineAlert(humanError(err, "The assessment could not be created.")));
          } finally { setBusy(submit, false); }
        },
      },
        errorSlot,
        h("div.form-grid.cols-2", {},
          field({ label: "Class", id: "asmClass", control: classSel }),
          field({ label: "Subject", id: "asmSubject", control: subjectSel })),
        h("div.form-grid.cols-2", {},
          field({ label: "Type", id: "asmType", control: typeSel }),
          field({ label: "Title", id: "asmTitle", control: titleInput })),
        h("div.form-grid.cols-2", {},
          field({ label: "Duration (minutes)", id: "asmDur", control: durInput, hint: "The deadline is enforced by the server, not the browser." }),
          field({ label: "Questions per student", id: "asmPer", control: perStudent, hint: "Fewer than the bank means each student gets a random selection." })),
        h("div.form-grid.cols-2", {},
          field({ label: "Opens", id: "asmStart", control: startInput }),
          field({ label: "Closes", id: "asmEnd", control: endInput })),
      ),
      actions: [h("button.btn.btn-outline", { type: "button", text: "Cancel", onclick: () => close() }), submit],
    });
  }

  /* ---------------- question bank ---------------- */
  async function openBank(a) {
    const host = h("div", {}, skeleton(4));
    const close = openModal({ title: `Questions — ${a.title}`, wide: true, body: host, actions: [
      h("button.btn.btn-outline", { type: "button", text: "Done", onclick: () => close() }),
    ]});
    await refresh();

    async function refresh() {
      try {
        const [questions, preview] = await Promise.all([
          unwrap(await supabase.from("assessment_questions")
            .select("id, question_text, option_a, option_b, option_c, option_d, correct_option, marks, order_index")
            .eq("assessment_id", a.id).order("order_index"), "load questions"),
          unwrap(await supabase.rpc("preview_assessment_distribution", { p_assessment_id: a.id }), "preview"),
        ]);
        const dist = Array.isArray(preview) ? preview[0] : preview;
        mount(host,
          h("div.card", {},
            h("div.u-row", { style: { gap: "10px", flexWrap: "wrap" } },
              h("span.badge.badge-info", { text: `${dist?.bank_count ?? questions.length} in bank` }),
              h("span.badge", { text: `${dist?.per_student ?? "all"} per student` }),
              h("span.badge", { text: `${dist?.eligible_students ?? 0} students` }),
            ),
            h("p.u-xs.u-muted", { text: dist?.distinct_combinations || "" }),
          ),
          h("div.u-row", { style: { justifyContent: "flex-end", gap: "6px", margin: "10px 0" } },
            h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Copy AI prompt", onclick: async () => {
              const text = `Create ${a.questions_per_student || "the full set of"} multiple-choice questions for ${a.classes?.name || "the selected class"} in ${a.subjects?.name || "the selected subject"}. Assessment type: ${TYPE_LABEL[a.assessment_type] || a.assessment_type}. Use this exact output format, one question per line: question | option A | option B | option C | option D | correct answer letter | marks. Do not add commentary.`;
              await navigator.clipboard?.writeText(text); toastOk("AI prompt copied");
            } }),
            h("button.btn.btn-outline.btn-sm", { type: "button", text: "Import from CA", onclick: async () => {
              const source = state.list.find((candidate) => candidate.assessment_type !== "exam" && candidate.subject_id === a.subject_id && candidate.class_id === a.class_id);
              if (!source) return toastError("No matching CA assessment was found for this class and subject.");
              try { const rows = unwrap(await supabase.rpc("import_assessment_questions", { p_target_assessment_id: a.id, p_source_assessment_id: source.id }), "import CA questions"); const r = Array.isArray(rows) ? rows[0] : rows; toastOk(`Imported ${r?.out_added || 0}; skipped ${r?.out_skipped || 0} duplicate(s)`); openBank(a); } catch (err) { toastError(humanError(err)); }
            } }),
            h("button.btn.btn-outline.btn-sm", { type: "button", text: "Paste many", onclick: () => pasteMany() }),
            h("button.btn.btn-primary.btn-sm", { type: "button", text: "Add question", onclick: () => addQuestion() })),
          questions.length ? questionList(questions) : emptyState({
            title: "No questions yet", body: "Add at least one question before opening this to students.",
          }),
        );
      } catch (err) {
        mount(host, errorState(humanError(err), refresh));
      }
    }

    function questionList(questions) {
      return h("div.u-stack", {}, questions.map((q, i) => h("div.card", {},
        h("div.u-row", { style: { justifyContent: "space-between", gap: "10px" } },
          h("div.u-grow", {},
            h("div", { style: { fontWeight: "600" }, text: `${i + 1}. ${q.question_text}` }),
            h("div.u-xs.u-muted", { text: `A. ${q.option_a}   B. ${q.option_b}${q.option_c ? `   C. ${q.option_c}` : ""}${q.option_d ? `   D. ${q.option_d}` : ""}` }),
            h("div.u-xs", { style: { marginTop: "4px" } },
              h("span.badge.badge-ok", { text: `Answer: ${q.correct_option}` }),
              h("span.badge", { text: `${q.marks} mark${Number(q.marks) === 1 ? "" : "s"}` })),
          ),
          h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Delete", onclick: () => removeQuestion(q) }),
        ),
      )));
    }

    async function removeQuestion(q) {
      const ok = await confirmAction({ title: "Delete this question?", message: q.question_text, confirmLabel: "Delete", danger: true });
      // confirmAction opens its own dialog, which closes this one, so the
      // question bank has to be reopened whichever way the person chose.
      if (!ok) return openBank(a);
      try {
        unwrap(await supabase.from("assessment_questions").delete().eq("id", q.id), "delete question");
      } catch (err) { toastError(humanError(err, "That question could not be deleted. Students may already have answered it.")); }
      openBank(a);
    }

    function pasteMany() {
      const area = h("textarea.input", { rows: "9", placeholder: "What is 2 + 2? | 3 | 4 | 5 | 6 | B | 1\nCapital of Nigeria? | Lagos | Abuja | Kano | Ibadan | B", style: { fontFamily: "ui-monospace, monospace", fontSize: "12px" } });
      const report = h("div");
      const add = h("button.btn.btn-primary", { type: "button", text: "Add questions", disabled: true });
      let parsed = { questions: [], problems: [] };

      area.addEventListener("input", () => {
        parsed = parseQuestionsText(area.value);
        mount(report,
          parsed.questions.length ? inlineAlert(`${parsed.questions.length} question${parsed.questions.length === 1 ? "" : "s"} ready to add.`, "success") : null,
          parsed.problems.length ? inlineAlert(parsed.problems.slice(0, 5).join("  ") + (parsed.problems.length > 5 ? `  …and ${parsed.problems.length - 5} more.` : ""), "warn") : null);
        add.disabled = parsed.questions.length === 0;
      });

      const closeP = openModal({
        title: "Paste many questions", wide: true,
        body: h("div", {},
          h("p.u-small.u-muted", { text: "One question per line: question | A | B | C | D | answer | marks. Leave C, D or marks empty if not needed. Text copied from a spreadsheet works too." }),
          field({ label: "Questions", id: "bulkText", control: area }), report),
        actions: [h("button.btn.btn-outline", { type: "button", text: "Cancel", onclick: () => { closeP(); openBank(a); } }), add],
      });

      add.addEventListener("click", async () => {
        setBusy(add, true, "Adding…");
        try {
          const rows = unwrap(await supabase.rpc("bulk_add_questions", { p_assessment_id: a.id, p_questions: parsed.questions }), "bulk add");
          const r = Array.isArray(rows) ? rows[0] : rows;
          toastOk(`Added ${r?.out_added ?? 0}${r?.out_skipped ? `, skipped ${r.out_skipped} duplicate or incomplete` : ""}`);
          closeP();
          openBank(a);
        } catch (err) {
          mount(report, inlineAlert(humanError(err, "The questions could not be added.")));
        } finally { setBusy(add, false); }
      });
    }

    function addQuestion() {
      const qText = h("textarea.input", { rows: "2", required: true });
      const oa = h("input.input", { required: true }), ob = h("input.input", { required: true });
      const oc = h("input.input"), od = h("input.input");
      const correct = h("select.select", {}, ["A", "B", "C", "D"].map((x) => h("option", { value: x, text: x })));
      const marks = h("input.input", { type: "number", min: "0.5", step: "0.5", value: "1" });
      const slot = h("div");
      const save = h("button.btn.btn-primary", { type: "button", text: "Save question" });

      const closeQ = openModal({
        title: "Add question", wide: true,
        body: h("div", {}, slot,
          field({ label: "Question", id: "qText", control: qText }),
          h("div.form-grid.cols-2", {},
            field({ label: "Option A", id: "qa", control: oa }),
            field({ label: "Option B", id: "qb", control: ob })),
          h("div.form-grid.cols-2", {},
            field({ label: "Option C", id: "qc", control: oc }),
            field({ label: "Option D", id: "qd", control: od })),
          h("div.form-grid.cols-2", {},
            field({ label: "Correct answer", id: "qcorrect", control: correct }),
            field({ label: "Marks", id: "qmarks", control: marks })),
        ),
        actions: [h("button.btn.btn-outline", { type: "button", text: "Cancel", onclick: () => { closeQ(); openBank(a); } }), save],
      });

      save.addEventListener("click", async () => {
        mount(slot);
        const text = qText.value.trim();
        if (text.length < 3) return mount(slot, inlineAlert("Write the question."));
        if (!oa.value.trim() || !ob.value.trim()) return mount(slot, inlineAlert("Options A and B are required."));
        const chosen = correct.value;
        if ((chosen === "C" && !oc.value.trim()) || (chosen === "D" && !od.value.trim())) {
          return mount(slot, inlineAlert(`Option ${chosen} is marked correct but is empty.`));
        }
        setBusy(save, true, "Saving…");
        try {
          unwrap(await supabase.from("assessment_questions").insert({
            assessment_id: a.id, question_text: text,
            option_a: oa.value.trim(), option_b: ob.value.trim(),
            option_c: oc.value.trim() || null, option_d: od.value.trim() || null,
            correct_option: chosen, marks: Number(marks.value) || 1,
          }), "add question");
          closeQ();
          openBank(a);
        } catch (err) {
          mount(slot, inlineAlert(humanError(err, "That question could not be saved. It may be a duplicate.")));
        } finally { setBusy(save, false); }
      });
    }
  }

  /* ---------------- results ---------------- */
  async function openResults(a) {
    const host = h("div", {}, skeleton(4));
    const close = openModal({ title: `Results — ${a.title}`, wide: true, body: host, actions: [
      h("button.btn.btn-outline", { type: "button", text: "Close", onclick: () => close() }),
    ]});
    try {
      // A student who walked away mid-exam leaves an attempt open; close
      // those first so their (saved) answers are marked and counted.
      await supabase.rpc("close_overdue_attempts", { p_assessment_id: a.id });
      const rows = unwrap(await supabase.rpc("assessment_results", { p_assessment_id: a.id }), "results");
      mount(host, rows?.length
        ? h("div.table-wrap", {}, h("table.table", {},
            h("thead", {}, h("tr", {},
              h("th", { text: "#" }), h("th", { text: "Student" }), h("th", { text: "Adm. no" }),
              h("th.u-num", { text: "Score" }), h("th.u-num", { text: "%" }),
              h("th", { text: "Status" }), h("th", { text: "Submitted" }))),
            h("tbody", {}, rows.map((r) => h("tr", {},
              h("td.u-num", { text: r.status === "submitted" ? r.rank_no : "—" }),
              h("td", { text: r.full_name }),
              h("td.u-num", { text: r.admission_no }),
              h("td.u-num", { text: r.score == null ? "—" : `${r.score} / ${r.total_marks}` }),
              h("td.u-num", { text: r.percentage == null ? "—" : `${r.percentage}%` }),
              h("td", {}, h(`span.badge.${r.status === "submitted" ? "badge-ok" : r.status === "not_started" ? "badge" : "badge-warn"}`,
                { text: r.status.replace("_", " ") }), r.was_late ? h("span.badge.badge-warn", { text: "late" }) : null),
              h("td.u-xs.u-muted", { text: r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "—" }),
            ))),
          ))
        : emptyState({ title: "No submissions yet", body: "Results appear here as students submit." }));
    } catch (err) {
      mount(host, errorState(humanError(err)));
    }
  }
}
