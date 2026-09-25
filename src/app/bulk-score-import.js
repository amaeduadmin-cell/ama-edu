import { h, mount, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { errorState, inlineAlert, toastOk, toastError } from "../lib/ui.js";
import { fetchClasses, fetchActiveTerm, fetchSubjectsForClass } from "../lib/data.js";

const PERIODS = ["ca1", "ca2", "ca3", "exam"];
export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin", "headmaster", "principal", "teacher")) return;
  const state = { classes: [], subjects: [], term: null, classId: "", subjectId: "", raw: "", rows: [], preview: [] };
  const body = h("div.u-stack");
  mount(outlet, page({ title: "Bulk score import", subtitle: "Paste a tabular AI or spreadsheet result, preview server validation, then commit only after review.", body }));
  try { state.classes = await fetchClasses(); state.term = await fetchActiveTerm(); state.classId = state.classes[0]?.id || ""; await loadSubjects(); draw(); }
  catch (err) { logError("bulk score import boot", err); mount(body, errorState(humanError(err))); }

  async function loadSubjects() { state.subjects = state.classId ? await fetchSubjectsForClass(state.classId) : []; state.subjectId = state.subjects[0]?.id || ""; }
  function select(label, options, onChange) { const sel = h("select.select", { onchange: onChange }, options.map(([value, text]) => h("option", { value, selected: value === (value === state.classId ? state.classId : value), text }))); return { label, sel }; }
  function draw() {
    const classSel = h("select.select", { onchange: async (e) => { state.classId = e.target.value; await loadSubjects(); draw(); } }, state.classes.map((c) => h("option", { value: c.id, selected: c.id === state.classId, text: c.name })));
    const subjectSel = h("select.select", { onchange: (e) => { state.subjectId = e.target.value; } }, state.subjects.map((s) => h("option", { value: s.id, selected: s.id === state.subjectId, text: s.name })));
    const area = h("textarea.textarea", { rows: "10", value: state.raw, placeholder: "Admission No | Student Name | CA1 | CA2 | CA3 | Exam\nADM0001 | Amina Suleiman | 12 | 15 | 18 | 55" });
    const message = h("div");
    const previewHost = h("div");
    const parse = h("button.btn.btn-outline", { type: "button", text: "Preview" });
    const copyPrompt = h("button.btn.btn-ghost", { type: "button", text: "Copy AI prompt" });
    const copyList = h("button.btn.btn-ghost", { type: "button", text: "Copy class student list" });
    const commit = h("button.btn.btn-primary", { type: "button", text: "Commit validated rows", disabled: true });
    classSel.addEventListener("change", () => {});
    parse.addEventListener("click", () => { state.raw = area.value; state.rows = parseRows(state.raw); state.preview = []; if (!state.rows.length) return mount(message, inlineAlert("Paste a header row and at least one data row.", "warn")); mount(message, inlineAlert(`${state.rows.length} row(s) parsed. Server validation is next.`, "success")); runPreview(previewHost, commit); });
    copyPrompt.addEventListener("click", async () => { await navigator.clipboard?.writeText(`Return only a pipe-separated table with this exact header: Admission No | Student Name | CA1 | CA2 | CA3 | Exam. Class: ${state.classes.find((c) => c.id === state.classId)?.name || "selected class"}. Subject: ${state.subjects.find((s) => s.id === state.subjectId)?.name || "selected subject"}. Use blank for missing scores and never invent students.`); toastOk("AI prompt copied"); });
    copyList.addEventListener("click", async () => { const rows = await supabase.from("students").select("admission_no,full_name").eq("class_id", state.classId).eq("is_active", true).order("full_name"); await navigator.clipboard?.writeText((rows.data || []).map((r) => `${r.admission_no} | ${r.full_name}`).join("\n")); toastOk("Class student list copied"); });
    commit.addEventListener("click", () => runServer(previewHost, commit, false));
    mount(body, h("section.card", {}, h("div.form-grid.cols-2", {}, h("div.field", {}, h("label", { text: "Class" }), classSel), h("div.field", {}, h("label", { text: "Subject" }), subjectSel)), h("p.u-xs.u-muted", { text: "Expected format: Admission No | Student Name | CA1 | CA2 | CA3 | Exam. The browser only parses; PostgreSQL performs the authoritative validation and write." }), h("div.u-row.u-wrap", {}, copyPrompt, copyList), area, h("div.u-row.u-wrap", {}, parse, commit), message, previewHost));
  }
  function parseRows(text) { const lines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean); if (lines.length < 2) return []; const header = lines[0].split(/[|\t,]/).map((x) => x.trim().toLowerCase()); return lines.slice(1).map((line) => { const c = line.split(/[|\t,]/).map((x) => x.trim()); const row = {}; header.forEach((key, i) => row[key.replace(/\s+/g, "_")] = c[i] || ""); return { admission_no: row.admission_no || row.admission_number || c[0] || "", ca1: row.ca1 || c[2] || "", ca2: row.ca2 || c[3] || "", ca3: row.ca3 || c[4] || "", exam: row.exam || c[5] || "" }; }); }
  async function runPreview(host, commit) { await runServer(host, commit, true); }
  async function runServer(host, commit, dry) { if (!state.classId || !state.subjectId || !state.term?.id) return toastError("Choose a class, subject and active term."); setBusy(commit, true, dry ? "Validating…" : "Committing…"); try { const rows = unwrap(await supabase.rpc("bulk_import_scores", { p_class_id: state.classId, p_subject_id: state.subjectId, p_term_id: state.term.id, p_rows: state.rows, p_dry_run: dry }), "bulk score import"); state.preview = rows || []; mount(host, h("div.table-wrap", {}, h("table.table", {}, h("thead", {}, h("tr", {}, ["Admission no.", "Status", "Detail"].map((x) => h("th", { text: x })))), h("tbody", {}, state.preview.map((r) => h("tr", {}, h("td", { text: r.admission_no }), h("td", {}, h(`span.badge.${r.status === "imported" || r.status === "existing_score_preserved" ? "badge-ok" : "badge-warn"}`, { text: r.status })), h("td", { text: r.detail || "" }))))))); commit.disabled = !dry || state.preview.some((r) => !["imported", "existing_score_preserved"].includes(r.status)); if (!dry) { toastOk("Scores imported and recomputed"); commit.disabled = true; } } catch (err) { mount(host, inlineAlert(humanError(err))); } finally { setBusy(commit, false); } }
}
