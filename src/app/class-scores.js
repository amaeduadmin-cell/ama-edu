/* Score entry for one class, one subject, the active term. */
import { h, mount, skeleton, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, toastOk, toastError, inlineAlert, openModal } from "../lib/ui.js";
import { fetchActiveTerm } from "../lib/data.js";
import { hasRole, session } from "../lib/auth.js";

const PERIODS = [
  ["ca1", "CA1", "ca1_max"],
  ["ca2", "CA2", "ca2_max"],
  ["ca3", "CA3", "ca3_max"],
  ["exam", "Exam", "exam_max"],
];

export default async function render({ outlet, params }) {
  if (!requireRole(outlet, "admin", "headmaster", "principal", "teacher")) return;
  const classId = params.id;
  const isAdmin = hasRole("admin", "headmaster", "principal");
  const state = { klass: null, term: null, subjects: [], subjectId: "", weights: null, students: [], dirty: new Set(), locks: new Map(), windows: new Map() };
  const body = h("div.u-stack");
  mount(outlet, page({ title: "Score entry", subtitle: "Enter scores by period, submit completed periods, or request an administrator unlock.", body }));

  try {
    const [klass, term, weightsRows] = await Promise.all([
      unwrap(await supabase.from("classes").select("id,name,school_id").eq("id", classId).single(), "fetch class"),
      fetchActiveTerm(),
      unwrap(await supabase.from("score_weights").select("*").limit(1), "fetch weights"),
    ]);
    state.klass = klass; state.term = term; state.weights = weightsRows?.[0] || { ca1_max: 20, ca2_max: 20, ca3_max: 20, exam_max: 40 };
    state.subjects = isAdmin
      ? unwrap(await supabase.from("class_subjects").select("subject_id, subjects(id,name)").eq("class_id", classId), "fetch subjects").map((r) => r.subjects)
      : unwrap(await supabase.from("class_teacher_subjects").select("subject_id, subjects(id,name)").eq("class_id", classId).eq("staff_id", session.staffId || ""), "fetch my subjects").map((r) => r.subjects);
    draw();
    if (state.subjects.length) { state.subjectId = state.subjects[0].id; await loadScores(); }
  } catch (err) { logError("class-scores boot", err); mount(body, errorState(humanError(err))); }

  function draw() {
    if (!state.term) return mount(body, emptyState({ title: "No active term", body: "Ask an administrator to activate a term before entering scores." }));
    if (!state.subjects.length) return mount(body, emptyState({ title: "Nothing to mark here", body: isAdmin ? "This class has no subjects assigned." : "You are not assigned to teach any subject in this class." }));
    const subjSel = h("select.select", { style: { maxWidth: "260px" }, onchange: async (e) => { state.subjectId = e.target.value; await loadScores(); } }, state.subjects.map((s) => h("option", { value: s.id, selected: s.id === state.subjectId, text: s.name })));
    mount(body, h("div.card-head", {}, h("div", {}, h("h2.card-title", { text: state.klass.name }), h("div.card-sub", { text: `${state.term.label} Term · ${state.term.sessions?.label || ""}` })), subjSel), h("div#scoreGridHost"));
  }

  async function loadScores() {
    const host = document.getElementById("scoreGridHost"); if (!host) return;
    mount(host, skeleton(5));
    try {
      const [students, scores, locks, windows] = await Promise.all([
        unwrap(await supabase.from("students").select("id,full_name,admission_no").eq("class_id", classId).eq("is_active", true).order("full_name"), "fetch students"),
        unwrap(await supabase.from("student_scores").select("*").eq("class_id", classId).eq("subject_id", state.subjectId).eq("term_id", state.term.id), "fetch scores"),
        unwrap(await supabase.from("subject_score_locks").select("period,locked,locked_at,locked_by").eq("class_id", classId).eq("subject_id", state.subjectId).eq("term_id", state.term.id), "fetch locks"),
        unwrap(await supabase.from("term_period_windows").select("period,is_open,opens_at,closes_at").eq("term_id", state.term.id), "fetch period windows"),
      ]);
      state.students = students.map((student) => ({ ...student, score: scores.find((score) => score.student_id === student.id) || null, _edits: {} }));
      state.locks = new Map(locks.map((lock) => [lock.period, lock]));
      state.windows = new Map(windows.map((window) => [window.period, window]));
      state.dirty.clear(); renderGrid(host);
    } catch (err) { logError("load scores", err); mount(host, errorState(humanError(err), loadScores)); }
  }

  function periodOpen(period) {
    const window = state.windows.get(period);
    if (!window) return true;
    const now = Date.now();
    return window.is_open !== false && (!window.opens_at || new Date(window.opens_at).getTime() <= now) && (!window.closes_at || new Date(window.closes_at).getTime() > now);
  }
  function periodLocked(period) { return state.locks.get(period)?.locked === true; }
  function canEdit(period) { return isAdmin || (periodOpen(period) && !periodLocked(period)); }

  function renderGrid(host) {
    if (!state.students.length) return mount(host, emptyState({ title: "No students in this class", body: "Admit students from the Students page first." }));
    const w = state.weights;
    const saveBtn = h("button.btn.btn-primary", { type: "button", text: "Save scores", disabled: !PERIODS.some(([period]) => canEdit(period)) });
    const note = h("div.u-xs.u-muted");
    const numInput = (student, key, max) => h("input.input.u-num", { type: "number", min: "0", max: String(max), step: "0.5", value: student.score?.[key] ?? "", style: { maxWidth: "76px" }, disabled: !canEdit(key), oninput: (e) => { student._edits[key] = e.target.value === "" ? null : Number(e.target.value); state.dirty.add(student.id); saveBtn.disabled = false; } });
    const controls = PERIODS.map(([period, label]) => periodControl(period, label));
    const headings = ["Student", `CA1 /${w.ca1_max}`, `CA2 /${w.ca2_max}`, `CA3 /${w.ca3_max}`, `Exam /${w.exam_max}`, "Total", "Grade", "Pos."];
    const rows = state.students.map((student) => h("tr", {},
      h("td", {}, h("div", { style: { fontWeight: "600" }, text: student.full_name }), h("div.u-xs.u-muted", { text: student.admission_no })),
      h("td.num", {}, numInput(student, "ca1", w.ca1_max)),
      h("td.num", {}, numInput(student, "ca2", w.ca2_max)),
      h("td.num", {}, numInput(student, "ca3", w.ca3_max)),
      h("td.num", {}, numInput(student, "exam", w.exam_max)),
      h("td.num.u-num", { text: student.score?.total ?? "—" }),
      h("td.num", {}, student.score?.grade ? h("span.badge.badge-ok", { text: student.score.grade }) : "—"),
      h("td.num", { text: student.score?.subject_position ?? "—" }),
    ));
    mount(host,
      h("div.u-row.u-wrap.u-mb-3", {}, controls),
      PERIODS.some(([period]) => !periodOpen(period) && !isAdmin) ? inlineAlert("One or more score periods are currently closed by the school administrator.", "warn") : null,
      h("div.table-wrap.card.card-flush", {}, h("table.table", {}, h("thead", {}, h("tr", {}, headings.map((heading) => h("th", { text: heading })))), h("tbody", {}, rows))),
      h("div.u-row.u-mt-4", {}, saveBtn, note),
    );
    saveBtn.addEventListener("click", () => save(saveBtn, note));
  }

  function periodControl(period, label) {
    const locked = periodLocked(period); const open = periodOpen(period);
    const status = locked ? "Submitted / locked" : open ? "Open" : "Closed";
    const badgeClass = locked ? "badge-info" : open ? "badge-ok" : "badge-warn";
    const submit = h("button.btn.btn-outline.btn-sm", { type: "button", text: locked ? "Locked" : "Submit" , disabled: locked || !open });
    const request = h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Request unlock", disabled: !locked });
    submit.addEventListener("click", async () => { setBusy(submit, true, "Submitting…"); try { unwrap(await supabase.rpc("submit_score_period", { p_class_id: classId, p_subject_id: state.subjectId, p_term_id: state.term.id, p_period: period }), "submit score period"); toastOk(`${label} submitted and locked`); await loadScores(); } catch (err) { toastError(humanError(err)); } finally { setBusy(submit, false); } });
    request.addEventListener("click", () => openUnlockRequest(period, label));
    return h("div.card", { style: { minWidth: "185px", flex: "1 1 185px" } }, h("div.u-row", { style: { justifyContent: "space-between" } }, h("strong", { text: label }), h(`span.badge.${badgeClass}`, { text: status })), h("div.u-row.u-mt-2", {}, submit, request));
  }

  function openUnlockRequest(period, label) {
    const eligible = state.students.filter((student) => student.score && ["ca1", "ca2", "ca3", "exam"].some((key) => student.score[key] != null));
    const checks = eligible.map((student) => { const input = h("input", { type: "checkbox", checked: true }); return { student, input, node: h("label.u-row", {}, input, h("span", { text: `${student.full_name} (${student.admission_no})` })) }; });
    const reason = h("textarea.textarea", { rows: "3", placeholder: "Explain what needs correction and why." }); const message = h("div"); const send = h("button.btn.btn-primary", { type: "button", text: "Send request" });
    const close = openModal({ title: `Request ${label} unlock`, wide: true, body: h("div.u-stack", {}, h("p.u-small.u-muted", { text: "Select the affected students and explain the correction. An administrator must approve the request." }), h("div", {}, checks.length ? checks.map((x) => x.node) : h("p.u-muted", { text: "No scored students found." })), h("label", { text: "Reason" }), reason, message), actions: [h("button.btn.btn-outline", { type: "button", text: "Cancel", onclick: () => close() }), send] });
    send.addEventListener("click", async () => { const selected = checks.filter((x) => x.input.checked).map((x) => x.student.id); if (!selected.length) return mount(message, inlineAlert("Select at least one affected student.")); if (reason.value.trim().length < 5) return mount(message, inlineAlert("Provide a short reason for the unlock request.")); setBusy(send, true, "Sending…"); try { unwrap(await supabase.rpc("request_score_unlock", { p_class_id: classId, p_subject_id: state.subjectId, p_term_id: state.term.id, p_period: period, p_student_ids: selected, p_reason: reason.value.trim() }), "request score unlock"); toastOk("Unlock request sent to the administrator"); close(); } catch (err) { mount(message, inlineAlert(humanError(err))); } finally { setBusy(send, false); } });
  }

  async function save(saveBtn, note) {
    const changed = state.students.filter((student) => state.dirty.has(student.id)); if (!changed.length) return;
    const rows = changed.map((student) => ({ school_id: state.klass.school_id, student_id: student.id, class_id: classId, subject_id: state.subjectId, term_id: state.term.id, ca1: student._edits.ca1 ?? student.score?.ca1 ?? null, ca2: student._edits.ca2 ?? student.score?.ca2 ?? null, ca3: student._edits.ca3 ?? student.score?.ca3 ?? null, exam: student._edits.exam ?? student.score?.exam ?? null, entered_by: session.staffId || null }));
    setBusy(saveBtn, true, "Saving…");
    try { unwrap(await supabase.from("student_scores").upsert(rows, { onConflict: "student_id,subject_id,term_id" }), "save scores"); mount(note, "Recalculating averages and positions…"); await supabase.rpc("recompute_class_term", { p_class_id: classId, p_term_id: state.term.id }); toastOk("Scores saved"); await loadScores(); }
    catch (err) { toastError(humanError(err, "Some scores could not be saved.")); mount(note, inlineAlert(humanError(err))); }
    finally { setBusy(saveBtn, false); }
  }
}
