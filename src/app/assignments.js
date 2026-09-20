/* ===============================================================
   Homework & assignments.

   One file, two faces: teachers set and grade, students submit and
   read feedback. The status a student sees (pending / submitted /
   late / graded / overdue) is decided by the database from the
   stored due date — the browser clock has no say.
   =============================================================== */

import { h, mount, skeleton, setBusy } from "../lib/dom.js";
import { page } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, field, inlineAlert, openModal, confirmAction, toastOk, toastError } from "../lib/ui.js";
import { fetchClasses, fetchActiveTerm, fetchSubjectsForClass } from "../lib/data.js";
import { session, hasRole } from "../lib/auth.js";
import { onDataChanged } from "../lib/realtime.js";

const STATUS_BADGE = {
  pending: "badge", submitted: "badge-info", late: "badge-warn",
  graded: "badge-ok", overdue: "badge-danger",
};

export default async function render({ outlet }) {
  const isStudent = hasRole("student");
  const body = h("div.u-stack");
  mount(outlet, page({
    title: "Homework",
    subtitle: isStudent ? "What has been set for your class." : "Set homework, then grade what comes in.",
    actions: isStudent ? [] : [h("button.btn.btn-primary", { type: "button", text: "Set homework", onclick: () => openForm() })],
    body,
  }));

  const state = { term: null, classes: [], list: [] };

  try {
    state.term = await fetchActiveTerm();
    if (!isStudent) state.classes = await fetchClasses();
  } catch (err) {
    logError("assignments boot", err);
    return mount(body, errorState(humanError(err)));
  }
  if (!state.term) return mount(body, emptyState({ title: "No active term", body: "No term is active yet." }));

  if (isStudent) onDataChanged(() => load());
  await load();

  async function load() {
    mount(body, skeleton(4));
    try {
      state.list = isStudent
        ? unwrap(await supabase.rpc("my_assignments", { p_student_id: session.studentId, p_term_id: state.term.id }), "my assignments")
        : unwrap(await supabase.from("assignments")
            .select("id, title, instructions, due_at, max_score, requires_portal_submission, class_id, subject_id, classes(name), subjects(name)")
            .eq("term_id", state.term.id).order("due_at", { ascending: true, nullsFirst: false }), "assignments");
      draw();
    } catch (err) {
      logError("load assignments", err);
      mount(body, errorState(humanError(err), load));
    }
  }

  function draw() {
    if (!state.list.length) {
      return mount(body, emptyState({
        title: isStudent ? "No homework set" : "No homework yet",
        body: isStudent ? "Nothing has been set for your class this term." : "Set your first piece of homework for a class.",
      }));
    }
    mount(body, h("div.u-stack", {}, state.list.map(isStudent ? studentCard : teacherCard)));
  }

  /* ---------------- student ---------------- */
  function studentCard(a) {
    const due = a.due_at ? new Date(a.due_at) : null;
    const canSubmit = a.requires_submission && !["graded"].includes(a.my_status);
    return h("div.card", {},
      h("div.u-row", { style: { justifyContent: "space-between", gap: "12px", flexWrap: "wrap" } },
        h("div.u-grow", {},
          h("div", { style: { fontWeight: "600" }, text: a.title }),
          h("div.u-xs.u-muted", { text: a.subject_name }),
          due ? h("div.u-xs.u-muted", { text: `Due ${due.toLocaleString()}` }) : null,
        ),
        h("div", {}, h(`span.badge.${STATUS_BADGE[a.my_status] || "badge"}`, { text: a.my_status })),
      ),
      a.instructions ? h("p.u-small", { style: { marginTop: "8px" }, text: a.instructions }) : null,
      a.my_grade != null
        ? h("div", { style: { marginTop: "8px" } },
            h("span.badge.badge-ok", { text: `Grade: ${a.my_grade}${a.max_score ? ` / ${a.max_score}` : ""}` }),
            a.my_feedback ? h("p.u-xs.u-muted", { style: { marginTop: "6px" }, text: `Teacher's feedback: ${a.my_feedback}` }) : null)
        : null,
      canSubmit
        ? h("div.u-row", { style: { justifyContent: "flex-end", marginTop: "10px" } },
            h("button.btn.btn-primary.btn-sm", {
              type: "button", text: a.my_status === "pending" || a.my_status === "overdue" ? "Submit" : "Edit submission",
              onclick: () => openSubmit(a),
            }))
        : null,
    );
  }

  function openSubmit(a) {
    const answer = h("textarea.input", { rows: "8", placeholder: "Write your answer here" });
    const slot = h("div");
    const save = h("button.btn.btn-primary", { type: "button", text: "Submit" });
    const close = openModal({
      title: a.title, wide: true,
      body: h("div", {}, slot,
        a.instructions ? h("p.u-small", { text: a.instructions }) : null,
        a.due_at && new Date(a.due_at) < new Date()
          ? inlineAlert("This is past its due date. Your submission will be recorded as late.", "warn") : null,
        field({ label: "Your answer", id: "hwAnswer", control: answer }),
      ),
      actions: [h("button.btn.btn-outline", { type: "button", text: "Cancel", onclick: () => close() }), save],
    });

    save.addEventListener("click", async () => {
      mount(slot);
      if (!answer.value.trim()) return mount(slot, inlineAlert("Write your answer before submitting."));
      setBusy(save, true, "Submitting…");
      try {
        const rows = unwrap(await supabase.rpc("submit_assignment", {
          p_assignment_id: a.assignment_id, p_answer: answer.value.trim(),
        }), "submit assignment");
        const result = Array.isArray(rows) ? rows[0] : rows;
        toastOk(result?.out_status === "late" ? "Submitted (recorded as late)" : "Submitted");
        close();
        await load();
      } catch (err) {
        mount(slot, inlineAlert(humanError(err, "Your work could not be submitted.")));
      } finally { setBusy(save, false); }
    });
  }

  /* ---------------- teacher ---------------- */
  function teacherCard(a) {
    const due = a.due_at ? new Date(a.due_at) : null;
    return h("div.card", {},
      h("div.u-row", { style: { justifyContent: "space-between", gap: "12px", flexWrap: "wrap" } },
        h("div.u-grow", {},
          h("div", { style: { fontWeight: "600" }, text: a.title }),
          h("div.u-xs.u-muted", { text: `${a.classes?.name || "—"} · ${a.subjects?.name || "—"}` }),
          due ? h("div.u-xs.u-muted", { text: `Due ${due.toLocaleString()}` }) : null,
        ),
        h("div.u-row", { style: { gap: "6px" } },
          h("button.btn.btn-outline.btn-sm", { type: "button", text: "Submissions", onclick: () => openSubmissions(a) }),
          h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Delete", onclick: () => remove(a) }),
        ),
      ),
    );
  }

  async function remove(a) {
    const ok = await confirmAction({
      title: "Delete this homework?",
      message: `"${a.title}" and every submission for it will be removed. This cannot be undone.`,
      confirmLabel: "Delete", danger: true,
    });
    if (!ok) return;
    try {
      unwrap(await supabase.from("assignments").delete().eq("id", a.id), "delete assignment");
      toastOk("Deleted");
      await load();
    } catch (err) { toastError(humanError(err)); }
  }

  async function openSubmissions(a) {
    const host = h("div", {}, skeleton(4));
    const close = openModal({ title: `Submissions — ${a.title}`, wide: true, body: host, actions: [
      h("button.btn.btn-outline", { type: "button", text: "Close", onclick: () => close() }),
    ]});
    await refresh();

    async function refresh() {
      try {
        const rows = unwrap(await supabase.rpc("assignment_submission_overview", { p_assignment_id: a.id }), "submissions");
        mount(host, rows?.length
          ? h("div.table-wrap", {}, h("table.table", {},
              h("thead", {}, h("tr", {},
                h("th", { text: "Student" }), h("th", { text: "Status" }),
                h("th.u-num", { text: "Grade" }), h("th", { text: "Submitted" }), h("th", { text: "" }))),
              h("tbody", {}, rows.map((r) => h("tr", {},
                h("td", {}, h("div", { text: r.full_name }), h("div.u-xs.u-muted", { text: r.admission_no })),
                h("td", {}, h(`span.badge.${STATUS_BADGE[r.status] || "badge"}`, { text: r.status })),
                h("td.u-num", { text: r.grade == null ? "—" : `${r.grade}${a.max_score ? ` / ${a.max_score}` : ""}` }),
                h("td.u-xs.u-muted", { text: r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "—" }),
                h("td", {}, r.submission_id
                  ? h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Grade", onclick: () => openGrade(r, a, refresh) })
                  : h("span.u-xs.u-muted", { text: "Nothing to grade" })),
              ))),
            ))
          : emptyState({ title: "No students", body: "This class has no active students." }));
      } catch (err) { mount(host, errorState(humanError(err), refresh)); }
    }
  }

  function openGrade(row, a, after) {
    const grade = h("input.input", { type: "number", min: "0", max: a.max_score || undefined, step: "0.5", value: row.grade ?? "" });
    const feedback = h("textarea.input", { rows: "3" });
    const slot = h("div");
    const save = h("button.btn.btn-primary", { type: "button", text: "Save grade" });
    const close = openModal({
      title: `Grade — ${row.full_name}`,
      body: h("div", {}, slot,
        field({ label: `Grade${a.max_score ? ` (out of ${a.max_score})` : ""}`, id: "gGrade", control: grade }),
        field({ label: "Feedback for the student", id: "gFeedback", control: feedback }),
      ),
      actions: [h("button.btn.btn-outline", { type: "button", text: "Cancel", onclick: () => { close(); openSubmissions(a); } }), save],
    });

    save.addEventListener("click", async () => {
      mount(slot);
      const value = grade.value === "" ? null : Number(grade.value);
      if (value != null && (Number.isNaN(value) || value < 0)) return mount(slot, inlineAlert("Enter a valid grade."));
      if (value != null && a.max_score && value > a.max_score) {
        return mount(slot, inlineAlert(`The grade cannot be more than ${a.max_score}.`));
      }
      setBusy(save, true, "Saving…");
      try {
        unwrap(await supabase.rpc("grade_assignment", {
          p_submission_id: row.submission_id, p_grade: value,
          p_feedback: feedback.value.trim() || null, p_release: true,
        }), "grade assignment");
        toastOk("Graded");
        close();
        openSubmissions(a);
      } catch (err) {
        mount(slot, inlineAlert(humanError(err, "The grade could not be saved.")));
      } finally { setBusy(save, false); }
    });
  }

  /* ---------------- create ---------------- */
  function openForm() {
    const classSel = h("select.select", {}, state.classes.map((c) => h("option", { value: c.id, text: c.name })));
    const subjectSel = h("select.select", {}, h("option", { value: "", text: "Select a class first" }));
    const titleInput = h("input.input", { required: true });
    const instructions = h("textarea.input", { rows: "4" });
    const dueInput = h("input.input", { type: "datetime-local" });
    const maxScore = h("input.input", { type: "number", min: "1", step: "1", placeholder: "Optional" });
    const requires = h("input", { type: "checkbox", checked: true });
    const slot = h("div");
    const submit = h("button.btn.btn-primary", { type: "submit", form: "hwForm", text: "Set homework" });

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
      title: "Set homework", wide: true,
      body: h("form", {
        id: "hwForm", novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          mount(slot);
          if (!subjectSel.value) return mount(slot, inlineAlert("Choose a subject."));
          if (titleInput.value.trim().length < 2) return mount(slot, inlineAlert("Give the homework a title."));
          setBusy(submit, true, "Saving…");
          try {
            unwrap(await supabase.from("assignments").insert({
              class_id: classSel.value, subject_id: subjectSel.value, term_id: state.term.id,
              title: titleInput.value.trim(), instructions: instructions.value.trim() || null,
              due_at: dueInput.value ? new Date(dueInput.value).toISOString() : null,
              max_score: maxScore.value ? Number(maxScore.value) : null,
              requires_portal_submission: requires.checked,
            }), "create assignment");
            toastOk("Homework set");
            close();
            await load();
          } catch (err) {
            mount(slot, inlineAlert(humanError(err, "The homework could not be saved.")));
          } finally { setBusy(submit, false); }
        },
      },
        slot,
        h("div.form-grid.cols-2", {},
          field({ label: "Class", id: "hwClass", control: classSel }),
          field({ label: "Subject", id: "hwSubject", control: subjectSel })),
        field({ label: "Title", id: "hwTitle", control: titleInput }),
        field({ label: "Instructions", id: "hwInstructions", control: instructions }),
        h("div.form-grid.cols-2", {},
          field({ label: "Due", id: "hwDue", control: dueInput }),
          field({ label: "Marked out of", id: "hwMax", control: maxScore })),
        h("label.u-row", { style: { gap: "8px" } }, requires, "Students submit their answer through the portal"),
      ),
      actions: [h("button.btn.btn-outline", { type: "button", text: "Cancel", onclick: () => close() }), submit],
    });
  }
}
