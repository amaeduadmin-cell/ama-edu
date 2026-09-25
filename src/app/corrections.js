import { h, mount, skeleton, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, confirmAction, toastOk, toastError, inlineAlert } from "../lib/ui.js";

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin")) return;
  const body = h("div.u-stack");
  mount(outlet, page({ title: "Score corrections", subtitle: "Review proposed changes before they alter a result.", body }));
  mount(body, skeleton(5));
  await load();

  async function load() {
    try {
      const requests = unwrap(await supabase.from("score_correction_requests").select("id,score_id,requested_by,proposed_values,reason,status,decided_at,created_at").order("created_at", { ascending: false }).limit(100), "fetch correction requests");
      if (!requests.length) return mount(body, emptyState({ title: "No correction requests", body: "Teachers' correction requests will appear here for review." }));
      const scoreIds = [...new Set(requests.map(r => r.score_id))];
      const staffIds = [...new Set(requests.map(r => r.requested_by).filter(Boolean))];
      const [scores, staff] = await Promise.all([
        unwrap(await supabase.from("student_scores").select("id,students(full_name,admission_no),subjects(name),classes(name),ca1,ca2,ca3,exam,total,grade").in("id", scoreIds), "fetch corrected scores"),
        staffIds.length ? unwrap(await supabase.from("staff").select("id,full_name,staff_code").in("id", staffIds), "fetch correction staff") : [],
      ]);
      const byScore = new Map(scores.map(s => [s.id, s]));
      const byStaff = new Map(staff.map(s => [s.id, s]));
      draw(requests.map(r => ({ ...r, score: byScore.get(r.score_id), requester: byStaff.get(r.requested_by) })));
    } catch (err) { logError("corrections load", err); mount(body, errorState(humanError(err), load)); }
  }

  function draw(rows) {
    const pending = rows.filter(r => r.status === "pending").length;
    mount(body, h("div.stat-grid", {}, stat("Pending", pending), stat("Approved", rows.filter(r => r.status === "approved").length), stat("Declined", rows.filter(r => r.status === "declined").length)), h("div.card", {}, inlineAlert("Approved corrections are written through a database RPC, captured as a new immutable score revision, and included in the audit trail.", "info"), h("div.table-wrap", {}, h("table.table", {}, h("thead", {}, h("tr", {}, ["Result", "Requested by", "Current", "Proposed", "Reason", "Status", "Action"].map(x => h("th", { text: x })))), h("tbody", {}, rows.map(row))))));
  }

  function row(request) {
    const score = request.score || {};
    const current = values(score);
    const proposed = request.proposed_values || {};
    const action = request.status === "pending" ? h("div.u-row", {}, decision("Approve", "approved", "btn-primary", request), decision("Decline", "declined", "btn-outline", request)) : h("span.u-xs.u-muted", { text: request.decided_at ? new Date(request.decided_at).toLocaleString() : "Resolved" });
    return h("tr", {}, h("td", {}, h("strong", { text: `${score.students?.full_name || "Student"} · ${score.subjects?.name || "Subject"}` }), h("div.u-xs.u-muted", { text: score.classes?.name || "" })), h("td", {}, h("div", { text: request.requester?.full_name || "Unknown" }), h("div.u-xs.u-muted", { text: request.requester?.staff_code || "" })), h("td.u-xs", { text: formatValues(current) }), h("td.u-xs", { text: formatValues(proposed) }), h("td", { text: request.reason }), h("td", {}, h(`span.badge.${request.status === "pending" ? "badge-warn" : request.status === "approved" ? "badge-ok" : "badge-info"}`, { text: request.status })), h("td", {}, action));
  }

  function decision(label, value, style, request) {
    const button = h(`button.btn.${style}.btn-sm`, { type: "button", text: label });
    button.onclick = async () => {
      if (!await confirmAction({ title: `${label} correction?`, message: value === "approved" ? "This will change the stored score and create a new immutable revision." : "This will decline the proposed change.", confirmLabel: label, danger: value === "declined" })) return;
      setBusy(button, true, "Working…");
      try { unwrap(await supabase.rpc("resolve_score_correction", { p_request_id: request.id, p_decision: value, p_note: null }), "resolve correction"); toastOk(`Correction ${value}`); await load(); } catch (err) { toastError(humanError(err)); } finally { setBusy(button, false); }
    };
    return button;
  }

  function values(score) { return { ca1: score.ca1, ca2: score.ca2, ca3: score.ca3, exam: score.exam }; }
  function formatValues(values) { return ["ca1", "ca2", "ca3", "exam"].map(key => `${key.toUpperCase()}: ${values[key] ?? "—"}`).join(" · "); }
  function stat(label, value) { return h("div.stat", {}, h("div.stat-label", { text: label }), h("div.stat-value", { text: String(value) })); }
}
