/* ===============================================================
   Curriculum — subjects, which classes offer them, who teaches what.

   Ports: renderAssignments / addSubject / assignClassSubject /
   addTeacherAssignment (MyPAS1 app-phase2.js). This is the page that
   populates class_teacher_subjects, which score entry (class-scores.js)
   depends on to know what a teacher may mark — without this page,
   a teacher's subject list there is always empty.
   =============================================================== */

import { h, mount, skeleton, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, inlineAlert, confirmAction, toastOk, toastError, openModal, field } from "../lib/ui.js";
import { fetchClasses } from "../lib/data.js";

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin")) return;

  const state = { classes: [], subjects: [], classId: "", classSubjects: [], assignments: [], staff: [], loading: true };
  const body = h("div.u-stack");
  mount(outlet, page({ title: "Curriculum", subtitle: "Subjects, which classes offer them, and who teaches what.", body }));

  await loadAll();

  async function loadAll() {
    state.loading = true; draw();
    try {
      const [classes, subjects, staff] = await Promise.all([
        fetchClasses(),
        unwrap(await supabase.from("subjects").select("id, name, is_active").order("name"), "fetch subjects"),
        unwrap(await supabase.from("staff").select("id, full_name").eq("is_active", true).order("full_name"), "fetch staff"),
      ]);
      state.classes = classes;
      state.subjects = subjects;
      state.staff = staff;
      state.classId = state.classId || classes[0]?.id || "";
      if (state.classId) await loadClassData();
    } catch (err) {
      logError("curriculum load", err);
      state.error = humanError(err);
    } finally {
      state.loading = false; draw();
    }
  }

  async function loadClassData() {
    const [classSubjects, assignments] = await Promise.all([
      unwrap(await supabase.from("class_subjects").select("id, subject_id").eq("class_id", state.classId), "fetch class subjects"),
      unwrap(await supabase.from("class_teacher_subjects").select("id, subject_id, staff_id, staff(full_name)").eq("class_id", state.classId), "fetch teacher assignments"),
    ]);
    state.classSubjects = classSubjects;
    state.assignments = assignments;
  }

  function draw() {
    if (state.loading) return mount(body, h("div.card", {}, skeleton(6)));
    if (state.error) return mount(body, errorState(state.error, loadAll));

    mount(body,
      h("div.u-row.u-wrap", { style: { alignItems: "stretch" } },
        h("div", { style: { flex: "1 1 280px" } }, subjectsCard()),
        h("div", { style: { flex: "2 1 420px" } }, classCard()),
      ));
  }

  /* ---------------- Subjects ---------------- */
  function subjectsCard() {
    const nameInput = h("input.input", { placeholder: "New subject name" });
    const addBtn = h("button.btn.btn-primary.btn-sm", { type: "button", text: "Add" });
    const errorSlot = h("div");

    addBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) return;
      setBusy(addBtn, true, "Adding…");
      try {
        unwrap(await supabase.from("subjects").insert({ name }), "add subject");
        nameInput.value = "";
        toastOk("Subject added");
        await loadAll();
      } catch (err) {
        mount(errorSlot, inlineAlert(humanError(err, "That subject may already exist.")));
      } finally { setBusy(addBtn, false); }
    });

    return h("section.card", {},
      h("div.card-head", {}, h("h2.card-title", { text: "Subjects" }), h("span.u-xs.u-muted", { text: `${state.subjects.length}` })),
      h("div.u-row.u-mt-4", {}, nameInput, addBtn),
      errorSlot,
      h("div.u-stack.u-mt-4", { style: { gap: "4px" } }, state.subjects.length
        ? state.subjects.map((s) => subjectRow(s))
        : [emptyState({ title: "No subjects yet", body: "Add your school's subjects above." })]),
    );
  }

  function subjectRow(subject) {
    const nameEl = h("span", { text: subject.name, style: subject.is_active ? {} : { textDecoration: "line-through", color: "var(--ama-slate)" } });
    return h("div.u-row", { style: { justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--ama-line-2)" } },
      nameEl,
      h("div.u-row", { style: { gap: "4px" } },
        h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Rename", onclick: () => renameSubject(subject) }),
        h("button.btn.btn-ghost.btn-sm", { type: "button", text: subject.is_active ? "Retire" : "Restore", onclick: () => toggleSubject(subject) }),
      ));
  }

  async function renameSubject(subject) {
    const input = h("input.input", { value: subject.name });
    const errorSlot = h("div");
    const close = openModal({
      title: "Rename subject",
      body: h("div.u-stack", {}, errorSlot, field({ label: "Subject name", id: "renameSubj", control: input })),
      actions: [
        h("button.btn.btn-outline", { type: "button", text: "Cancel", onclick: () => close() }),
        h("button.btn.btn-primary", { type: "button", text: "Save", onclick: async () => {
          const name = input.value.trim();
          if (!name) return;
          try {
            unwrap(await supabase.from("subjects").update({ name }).eq("id", subject.id), "rename subject");
            toastOk("Subject renamed");
            close();
            await loadAll();
          } catch (err) { mount(errorSlot, inlineAlert(humanError(err))); }
        } }),
      ],
    });
  }

  async function toggleSubject(subject) {
    const ok = await confirmAction({
      title: subject.is_active ? "Retire this subject?" : "Restore this subject?",
      message: subject.is_active ? "It will disappear from class assignment and score entry, but past scores are kept." : "It becomes available to assign to classes again.",
      confirmLabel: subject.is_active ? "Retire" : "Restore", danger: subject.is_active,
    });
    if (!ok) return;
    try {
      unwrap(await supabase.from("subjects").update({ is_active: !subject.is_active }).eq("id", subject.id), "toggle subject");
      toastOk("Saved");
      await loadAll();
    } catch (err) { toastError(humanError(err)); }
  }

  /* ---------------- Class assignment ---------------- */
  function classCard() {
    const classSel = h("select.select", { style: { maxWidth: "220px" }, onchange: async (e) => { state.classId = e.target.value; await loadClassData(); draw(); } },
      state.classes.map((c) => h("option", { value: c.id, selected: c.id === state.classId, text: c.name })));

    const offeredIds = new Set(state.classSubjects.map((cs) => cs.subject_id));
    const activeSubjects = state.subjects.filter((s) => s.is_active);

    return h("section.card", {},
      h("div.card-head", {}, h("h2.card-title", { text: "Class curriculum" }), classSel),
      !activeSubjects.length
        ? emptyState({ title: "No subjects to assign", body: "Add a subject on the left first." })
        : h("div.table-wrap", {}, h("table.table", {},
            h("thead", {}, h("tr", {}, h("th", { text: "Subject" }), h("th", { text: "Offered" }), h("th", { text: "Teachers" }))),
            h("tbody", {}, activeSubjects.map((subject) => subjectClassRow(subject, offeredIds))),
          )),
    );
  }

  function subjectClassRow(subject, offeredIds) {
    const isOffered = offeredIds.has(subject.id);
    const cb = h("input", {
      type: "checkbox", checked: isOffered,
      onchange: async (e) => { await toggleOffered(subject, e.target.checked); },
    });

    const myAssignments = state.assignments.filter((a) => a.subject_id === subject.id);
    const teacherSel = h("select.select.btn-sm", { style: { maxWidth: "170px" } },
      h("option", { value: "", text: "Assign teacher…" }),
      state.staff.filter((s) => !myAssignments.some((a) => a.staff_id === s.id)).map((s) => h("option", { value: s.id, text: s.full_name })));
    const addBtn = h("button.btn.btn-outline.btn-sm", { type: "button", text: "Add", disabled: !isOffered,
      onclick: () => addTeacher(subject, teacherSel.value) });

    return h("tr", {},
      h("td", { text: subject.name }),
      h("td", {}, cb),
      h("td", {},
        h("div.u-row.u-wrap", { style: { gap: "4px", marginBottom: myAssignments.length ? "6px" : "0" } },
          myAssignments.map((a) => h("span.badge.badge-info", {},
            a.staff?.full_name || "—",
            h("button", { type: "button", "aria-label": "Remove", style: { border: "none", background: "none", cursor: "pointer", marginLeft: "4px", color: "inherit" }, text: "×", onclick: () => removeTeacher(a) }),
          ))),
        isOffered ? h("div.u-row", { style: { gap: "4px" } }, teacherSel, addBtn) : h("span.u-xs.u-muted", { text: "Offer the subject first" }),
      ));
  }

  async function toggleOffered(subject, checked) {
    try {
      if (checked) {
        unwrap(await supabase.from("class_subjects").insert({ class_id: state.classId, subject_id: subject.id }), "offer subject");
      } else {
        unwrap(await supabase.from("class_subjects").delete().eq("class_id", state.classId).eq("subject_id", subject.id), "remove subject");
        unwrap(await supabase.from("class_teacher_subjects").delete().eq("class_id", state.classId).eq("subject_id", subject.id), "clear assignments");
      }
      await loadClassData();
      draw();
    } catch (err) { toastError(humanError(err)); await loadClassData(); draw(); }
  }

  async function addTeacher(subject, staffId) {
    if (!staffId) return;
    try {
      unwrap(await supabase.from("class_teacher_subjects").insert({ class_id: state.classId, subject_id: subject.id, staff_id: staffId }), "assign teacher");
      toastOk("Teacher assigned");
      await loadClassData();
      draw();
    } catch (err) { toastError(humanError(err)); }
  }

  async function removeTeacher(assignment) {
    try {
      unwrap(await supabase.from("class_teacher_subjects").delete().eq("id", assignment.id), "remove assignment");
      await loadClassData();
      draw();
    } catch (err) { toastError(humanError(err)); }
  }
}
