/* ===============================================================
   Attendance — built for a phone held in one hand.

   Two modes, exactly as the spec asks: tick the students who are
   PRESENT (everyone else is absent), or tick the ones who are ABSENT
   (everyone else is present). The inversion happens in the database
   (save_attendance, migration 0021/0022), so a dropped connection
   can never leave a class half-marked.

   The running counts and the confirm step exist because the mode is
   easy to get backwards, and a register saved the wrong way round is
   worse than no register at all.
   =============================================================== */

import { h, mount, skeleton, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, confirmAction, toastOk, toastError, inlineAlert } from "../lib/ui.js";
import { fetchClasses, fetchActiveTerm } from "../lib/data.js";

const today = () => new Date().toISOString().slice(0, 10);

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin", "headmaster", "principal", "teacher")) return;

  const state = {
    classes: [], term: null, classId: "", date: today(),
    mode: "present_only", roster: [], ticked: new Set(),
    loading: true, existing: false,
  };

  const body = h("div.u-stack");
  mount(outlet, page({
    title: "Attendance",
    subtitle: "Mark today's register. Tick one group — everyone else is set automatically.",
    body,
  }));

  try {
    const [classes, term] = await Promise.all([fetchClasses(), fetchActiveTerm()]);
    state.classes = classes;
    state.term = term;
    state.classId = classes[0]?.id || "";
  } catch (err) {
    logError("attendance boot", err);
    return mount(body, errorState(humanError(err)));
  }

  if (!state.term) return mount(body, emptyState({ title: "No active term", body: "Ask your administrator to activate a term first." }));
  if (!state.classes.length) return mount(body, emptyState({ title: "No classes yet", body: "Add classes before taking attendance." }));

  await loadRoster();

  async function loadRoster() {
    state.loading = true; draw();
    try {
      const rows = unwrap(
        await supabase.rpc("attendance_register", { p_class_id: state.classId, p_date: state.date }),
        "attendance register"
      );
      state.roster = rows || [];
      state.existing = state.roster.some((r) => r.status);
      // Pre-tick from whatever is already recorded, so a correction
      // starts from the truth rather than from an empty sheet.
      state.ticked = new Set(
        state.roster
          .filter((r) => state.mode === "present_only"
            ? ["present", "late", "excused"].includes(r.status)
            : r.status === "absent")
          .map((r) => r.student_id)
      );
    } catch (err) {
      logError("attendance roster", err);
      state.error = humanError(err);
    } finally {
      state.loading = false; draw();
    }
  }

  function counts() {
    const ticked = state.ticked.size;
    const total = state.roster.length;
    return state.mode === "present_only"
      ? { present: ticked, absent: total - ticked }
      : { present: total - ticked, absent: ticked };
  }

  function draw() {
    const classSel = h("select.select", {
      onchange: (e) => { state.classId = e.target.value; loadRoster(); },
    }, state.classes.map((c) => h("option", { value: c.id, selected: c.id === state.classId, text: c.name })));

    const dateInput = h("input.input", {
      type: "date", value: state.date, max: today(),
      onchange: (e) => { state.date = e.target.value; loadRoster(); },
    });

    const modeSel = h("select.select", {
      onchange: (e) => { state.mode = e.target.value; loadRoster(); },
    },
      h("option", { value: "present_only", selected: state.mode === "present_only", text: "Tick who is PRESENT" }),
      h("option", { value: "absent_only",  selected: state.mode === "absent_only",  text: "Tick who is ABSENT" }),
    );

    mount(body,
      h("div.card", {},
        h("div.form-grid.cols-3", {},
          h("div.field", {}, h("label", { text: "Class" }), classSel),
          h("div.field", {}, h("label", { text: "Date" }), dateInput),
          h("div.field", {}, h("label", { text: "Marking mode" }), modeSel),
        ),
        h("p.u-xs.u-muted", {
          text: state.mode === "present_only"
            ? "Everyone you do not tick will be recorded as absent."
            : "Everyone you do not tick will be recorded as present.",
        }),
        state.existing ? inlineAlert("A register already exists for this date. Saving will correct it, and the change is recorded.", "info") : null,
      ),
      state.loading ? h("div.card", {}, skeleton(6)) : rosterCard(),
    );
  }

  function rosterCard() {
    if (state.error) return errorState(state.error, loadRoster);
    if (!state.roster.length) return emptyState({ title: "No students in this class", body: "Admit students first." });

    const c = counts();
    const summary = h("div.u-row", { style: { gap: "12px", flexWrap: "wrap" } },
      h("span.badge.badge-ok", { text: `${c.present} present` }),
      h("span.badge.badge-warn", { text: `${c.absent} absent` }),
      h("span.u-xs.u-muted", { text: `${state.roster.length} on roll` }),
    );

    const saveBtn = h("button.btn.btn-primary", { type: "button", text: "Review and save", onclick: (e) => save(e.target) });

    return h("div.u-stack", {},
      h("div.card.card-flush", {},
        h("div.u-row", { style: { padding: "14px 16px", borderBottom: "1px solid var(--ama-line)", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" } },
          summary,
          h("div.u-row", { style: { gap: "6px" } },
            h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Tick all", onclick: () => { state.roster.forEach((r) => state.ticked.add(r.student_id)); draw(); } }),
            h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Clear", onclick: () => { state.ticked.clear(); draw(); } }),
          ),
        ),
        h("ul", { style: { listStyle: "none", margin: "0", padding: "0" } },
          state.roster.map((r) => {
            const on = state.ticked.has(r.student_id);
            return h("li", {},
              h("label.u-row", {
                style: {
                  gap: "12px", padding: "14px 16px", borderBottom: "1px solid var(--ama-line)",
                  cursor: "pointer", minHeight: "52px", alignItems: "center",
                },
              },
                h("input", {
                  type: "checkbox", checked: on,
                  style: { width: "22px", height: "22px", flex: "none" },
                  onchange: (e) => {
                    if (e.target.checked) state.ticked.add(r.student_id); else state.ticked.delete(r.student_id);
                    draw();
                  },
                }),
                h("span.u-grow", {},
                  h("div", { style: { fontWeight: "600" }, text: r.full_name }),
                  h("div.u-xs.u-muted", { text: r.admission_no }),
                ),
                r.status ? h("span.u-xs.u-muted", { text: r.status }) : null,
              ),
            );
          }),
        ),
      ),
      h("div.u-row", { style: { justifyContent: "flex-end" } }, saveBtn),
    );
  }

  async function save(btn) {
    const c = counts();
    const klass = state.classes.find((k) => k.id === state.classId);
    const ok = await confirmAction({
      title: "Save this register?",
      message: `${klass?.name || "Class"} · ${state.date}\n\n${c.present} present, ${c.absent} absent, ${state.roster.length} on roll.`,
      confirmLabel: "Save attendance",
    });
    if (!ok) return;

    setBusy(btn, true, "Saving…");
    try {
      const rows = unwrap(await supabase.rpc("save_attendance", {
        p_class_id: state.classId, p_term_id: state.term.id, p_date: state.date,
        p_mode: state.mode, p_ticked: [...state.ticked], p_note: null,
      }), "save attendance");
      const saved = Array.isArray(rows) ? rows[0] : rows;
      toastOk(saved?.was_correction
        ? `Register corrected — ${saved.marked_present} present, ${saved.marked_absent} absent`
        : `Register saved — ${saved?.marked_present ?? c.present} present, ${saved?.marked_absent ?? c.absent} absent`);
      await loadRoster();
    } catch (err) {
      toastError(humanError(err, "The register could not be saved."));
    } finally {
      setBusy(btn, false);
    }
  }
}
