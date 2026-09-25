import { h, mount, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, toastOk, toastError, confirmAction } from "../lib/ui.js";
import { fetchClasses } from "../lib/data.js";

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin", "registrar_primary", "registrar_secondary")) return;
  const state = { classes: [], students: [], selectedUnassigned: new Set(), selectedAssigned: new Set() };
  const body = h("div.u-stack");
  mount(outlet, page({ title: "Student operations", subtitle: "Assign unassigned students or transfer active students while preserving historical scores.", body }));
  try { state.classes = await fetchClasses({ activeOnly: true }); await load(); }
  catch (err) { logError("student operations", err); mount(body, errorState(humanError(err))); }

  async function load() {
    state.students = unwrap(await supabase.from("students").select("id,full_name,admission_no,gender,guardian_name,guardian_phone,date_admitted,class_id,classes(name)").eq("is_active", true).order("full_name"), "fetch students");
    draw();
  }

  function classSelect() {
    return h("select.select", { style: { maxWidth: "230px" } },
      h("option", { value: "", text: "Choose destination class" }),
      state.classes.map((c) => h("option", { value: c.id, text: c.name })),
    );
  }

  function studentTable(rows, selected, allowSelection = true) {
    if (!rows.length) return emptyState({ title: allowSelection ? "No students" : "No assigned students", body: allowSelection ? "There are no students in this queue." : "Assign students first." });
    const cells = rows.map((s) => {
      const check = allowSelection ? h("input", { type: "checkbox", checked: selected.has(s.id), onchange: (e) => e.target.checked ? selected.add(s.id) : selected.delete(s.id) }) : null;
      return h("tr", {},
        allowSelection ? h("td", {}, check) : null,
        h("td", { text: s.full_name }),
        h("td.u-num", { text: s.admission_no }),
        h("td", { text: s.gender || "—" }),
        h("td", { text: s.guardian_name || s.guardian_phone || "—" }),
        h("td", { text: s.date_admitted || "—" }),
        h("td", { text: s.classes?.name || "—" }),
      );
    });
    return h("div.table-wrap", {}, h("table.table", {},
      h("thead", {}, h("tr", {}, [allowSelection ? "" : null, "Name", "Admission no.", "Gender", "Guardian", "Registration", "Class"].filter(Boolean).map((x) => h("th", { text: x })))),
      h("tbody", {}, cells),
    ));
  }

  function draw() {
    const unassigned = state.students.filter((s) => !s.class_id);
    const assigned = state.students.filter((s) => s.class_id);
    const assignClass = classSelect();
    const assignBtn = h("button.btn.btn-primary", { type: "button", text: "Assign selected" });
    assignBtn.addEventListener("click", () => assignSelected(assignClass.value));
    const transferClass = classSelect();
    const reason = h("input.input", { placeholder: "Reason (optional)", style: { maxWidth: "260px" } });
    const transferBtn = h("button.btn.btn-primary", { type: "button", text: "Transfer selected" });
    transferBtn.addEventListener("click", () => transferSelected(transferClass.value, reason.value, transferBtn));

    mount(body,
      h("section.card", {},
        h("div.card-head", {}, h("h2.card-title", { text: "Unassigned students" }), h("span.badge.badge-warn", { text: `${unassigned.length} need a class` })),
        h("p.u-small.u-muted", { text: "Students without class_id are excluded from score entry, attendance, timetable, and report-card workflows until assigned." }),
        h("div.u-row.u-wrap", {}, assignClass, assignBtn),
        studentTable(unassigned, state.selectedUnassigned),
      ),
      h("section.card", {},
        h("div.card-head", {}, h("h2.card-title", { text: "Transfer assigned students" }), h("span.badge", { text: `${assigned.length} assigned` })),
        h("div.u-row.u-wrap", {}, transferClass, reason, transferBtn),
        studentTable(assigned, state.selectedAssigned),
      ),
    );
  }

  async function assignSelected(classId) {
    if (!classId || !state.selectedUnassigned.size) return toastError("Select students and a destination class.");
    const ok = await confirmAction({ title: "Assign selected students?", message: `${state.selectedUnassigned.size} student(s) will be assigned to this class.`, confirmLabel: "Assign" });
    if (!ok) return;
    try { unwrap(await supabase.from("students").update({ class_id: classId }).in("id", [...state.selectedUnassigned]), "assign students"); state.selectedUnassigned.clear(); toastOk("Students assigned"); await load(); }
    catch (err) { toastError(humanError(err)); }
  }

  async function transferSelected(classId, reason, button) {
    if (!classId || !state.selectedAssigned.size) return toastError("Select students and a destination class.");
    const ok = await confirmAction({ title: "Transfer selected students?", message: `${state.selectedAssigned.size} student(s) will move class. Historical scores will not move or be deleted.`, confirmLabel: "Transfer" });
    if (!ok) return;
    setBusy(button, true, "Transferring…");
    try { unwrap(await supabase.rpc("transfer_students", { p_student_ids: [...state.selectedAssigned], p_to_class_id: classId, p_reason: reason.trim() || null }), "transfer students"); state.selectedAssigned.clear(); toastOk("Students transferred"); await load(); }
    catch (err) { toastError(humanError(err)); }
    finally { setBusy(button, false); }
  }
}
