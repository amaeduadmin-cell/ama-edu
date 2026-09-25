/* ===============================================================
   Timetable — weekly grid per class, with clash detection.

   Ports: renderTimetable / saveTimetableCell / undoTimetableChange
   (MyPAS1 app-phase2b.js). The "no double-booking" rule is a real
   database constraint (slots_no_double_booking, migration 0005) —
   this page just surfaces the 23505 it raises as a clear message
   rather than re-implementing the check in JavaScript.
   =============================================================== */

import { h, mount, skeleton, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, toastOk, toastError } from "../lib/ui.js";
import { fetchClasses, fetchActiveTerm } from "../lib/data.js";
import { session } from "../lib/auth.js";

const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"]];
const PERIODS = Array.from({ length: 8 }, (_, i) => i + 1);

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin", "headmaster", "principal")) return;

  const state = { classes: [], term: null, classId: "", timetableId: null, subjects: [], staff: [], slots: new Map() };
  const body = h("div.u-stack");
  mount(outlet, page({ title: "Timetable", subtitle: "Weekly grid per class. A teacher cannot be double-booked across the school.", actions: [
    h("button.btn.btn-outline", { type: "button", text: "Auto generate", onclick: () => autoGenerate() }),
    h("button.btn.btn-outline", { type: "button", text: "Print", onclick: () => window.print() }),
    h("button.btn.btn-ghost", { type: "button", text: "Export CSV", onclick: () => exportCsv() }),
  ], body }));

  try {
    state.classes = await fetchClasses();
    state.term = await fetchActiveTerm();
    state.staff = unwrap(await supabase.from("staff").select("id, full_name").eq("is_active", true).order("full_name"), "fetch staff");
    state.classId = state.classes[0]?.id || "";
  } catch (err) {
    logError("timetable boot", err);
    return mount(body, errorState(humanError(err)));
  }

  if (!state.term) return mount(body, emptyState({ title: "No active term", body: "Ask your school administrator to activate a term in Settings." }));
  if (!state.classes.length) return mount(body, emptyState({ title: "No classes yet", body: "Add classes from Settings first." }));

  draw();
  await loadClass();

  function draw() {
    const classSel = h("select.select", { style: { maxWidth: "220px" }, onchange: (e) => { state.classId = e.target.value; loadClass(); } },
      state.classes.map((c) => h("option", { value: c.id, selected: c.id === state.classId, text: c.name })));

    mount(body,
      h("div.card-head", {}, h("h2.card-title", { text: "Weekly timetable" }), classSel),
      h("div#ttHost", {}, skeleton(6)),
    );
  }

  async function loadClass() {
    draw();
    const host = document.getElementById("ttHost");
    try {
      const timetable = unwrap(
        await supabase.from("timetables").upsert(
          { school_id: session.schoolId, class_id: state.classId, session_id: state.term.session_id },
          { onConflict: "class_id,session_id" }
        ).select("id").single(),
        "get timetable"
      );
      state.timetableId = timetable.id;

      const [subjects, slots] = await Promise.all([
        unwrap(await supabase.from("class_subjects").select("subject_id, subjects(id, name)").eq("class_id", state.classId), "fetch subjects"),
        unwrap(await supabase.from("timetable_slots").select("*").eq("timetable_id", state.timetableId), "fetch slots"),
      ]);
      state.subjects = subjects.map((r) => r.subjects);
      state.slots = new Map(slots.map((s) => [`${s.day_of_week}-${s.period_index}`, s]));
      renderGrid(host);
    } catch (err) {
      logError("load timetable", err);
      mount(host, errorState(humanError(err), loadClass));
    }
  }

  async function autoGenerate() {
    if (!state.classId || !state.term?.session_id) return;
    try {
      const rows = unwrap(await supabase.rpc("auto_generate_timetable", { p_class_id: state.classId, p_session_id: state.term.session_id }), "generate timetable");
      const result = Array.isArray(rows) ? rows[0] : rows;
      toastOk(`Generated ${result?.generated_count || 0} slot(s); ${result?.unfilled_count || 0} unfilled.`);
      await loadClass();
    } catch (err) { toastError(humanError(err)); }
  }

  function exportCsv() {
    const rows = [["Day", "Period", "Subject", "Teacher"]];
    for (const [, slot] of state.slots) rows.push([slot.day_of_week, slot.period_index, slot.subject_id || "", slot.staff_id || ""]);
    const blob = new Blob([rows.map((r) => r.map((x) => `"${String(x).replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "ama-edu-timetable.csv"; a.click(); URL.revokeObjectURL(url);
  }

  function renderGrid(host) {
    mount(host, h("div.table-wrap.card.card-flush", {}, h("table.table", {},
      h("thead", {}, h("tr", {}, h("th", { text: "Period" }), DAYS.map(([, label]) => h("th", { text: label })))),
      h("tbody", {}, PERIODS.map((p) => h("tr", {},
        h("td.u-num", { style: { fontWeight: "600" }, text: p }),
        DAYS.map(([day]) => h("td", {}, cell(day, p))),
      ))),
    )));
  }

  function cell(day, period) {
    const key = `${day}-${period}`;
    const existing = state.slots.get(key);

    const subjectSel = h("select.select.btn-sm", { style: { width: "100%", marginBottom: "4px" } },
      h("option", { value: "", text: "—" }),
      state.subjects.map((s) => h("option", { value: s.id, selected: s.id === existing?.subject_id, text: s.name })));
    const staffSel = h("select.select.btn-sm", { style: { width: "100%" } },
      h("option", { value: "", text: "No teacher" }),
      state.staff.map((s) => h("option", { value: s.id, selected: s.id === existing?.staff_id, text: s.full_name })));
    const note = h("div.u-xs");

    const save = async () => {
      mount(note);
      try {
        unwrap(await supabase.from("timetable_slots").upsert({
          school_id: session.schoolId,
          timetable_id: state.timetableId,
          day_of_week: day, period_index: period,
          subject_id: subjectSel.value || null,
          staff_id: staffSel.value || null,
        }, { onConflict: "timetable_id,day_of_week,period_index" }), "save slot");
        await loadClass();
      } catch (err) {
        if (err.code === "23505") {
          mount(note, h("span", { style: { color: "var(--ama-danger)" }, text: "That teacher already has a class at this time." }));
          staffSel.value = existing?.staff_id || "";
          toastError("That teacher is already scheduled elsewhere at this time.");
        } else {
          toastError(humanError(err));
        }
      }
    };

    subjectSel.addEventListener("change", save);
    staffSel.addEventListener("change", save);
    return h("div", {}, subjectSel, staffSel, note);
  }
}
