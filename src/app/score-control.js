import { h, mount, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { errorState, toastOk, toastError, openModal, confirmAction } from "../lib/ui.js";
import { fetchActiveTerm } from "../lib/data.js";

const PERIODS = [["ca1", "CA1"], ["ca2", "CA2"], ["ca3", "CA3"], ["exam", "Exam"]];
const STATUS = [["pending", "Pending"], ["approved", "Approved"], ["declined", "Declined"], ["all", "All"]];

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin")) return;
  const body = h("div.u-stack");
  mount(outlet, page({ title: "Score control", subtitle: "Manage score windows and review teacher unlock requests with an auditable decision trail.", body }));
  try {
    const term = await fetchActiveTerm();
    if (!term) return mount(body, h("div.empty", {}, h("div.empty-title", { text: "No active term" }), h("p.empty-body", { text: "Activate a term before managing score controls." })));
    await load(term);
  } catch (err) { logError("score control", err); mount(body, errorState(humanError(err))); }

  async function load(term) {
    mount(body, h("div.card", {}, h("div.skeleton", { style: { height: "220px" } })));
    try {
      const [windows, requests, analytics] = await Promise.all([
        unwrap(await supabase.from("term_period_windows").select("*").eq("term_id", term.id), "fetch period windows"),
        unwrap(await supabase.from("score_unlock_requests").select("id,class_id,subject_id,term_id,period,requested_by,reason,status,resolved_by,resolved_at,created_at,classes(name),subjects(name)").eq("term_id", term.id).order("created_at", { ascending: false }), "fetch unlock requests"),
        unwrap(await supabase.rpc("unlock_request_analytics", { p_term_id: term.id }), "fetch unlock analytics"),
      ]);
      const staffIds = [...new Set(requests.flatMap((r) => [r.requested_by, r.resolved_by].filter(Boolean)))];
      const staff = staffIds.length ? unwrap(await supabase.from("staff").select("id,full_name,staff_code").in("id", staffIds), "fetch request staff") : [];
      const staffById = new Map(staff.map((s) => [s.id, s]));
      const requestIds = requests.map((r) => r.id);
      const affectedRows = requestIds.length ? unwrap(await supabase.from("score_unlock_request_students").select("request_id,student_id,students(full_name,admission_no)").in("request_id", requestIds), "fetch affected students") : [];
      const affectedByRequest = new Map();
      for (const row of affectedRows) { if (!affectedByRequest.has(row.request_id)) affectedByRequest.set(row.request_id, []); affectedByRequest.get(row.request_id).push(row.students); }
      renderDashboard(term, windows, requests.map((r) => ({ ...r, requester: staffById.get(r.requested_by), resolver: staffById.get(r.resolved_by), affected: affectedByRequest.get(r.id) || [] })), analytics || []);
    } catch (err) { logError("score-control load", err); mount(body, errorState(humanError(err), () => load(term))); }
  }

  function renderDashboard(term, windows, requests, analytics) {
    const byWindow = new Map(windows.map((w) => [w.period, w]));
    const controls = PERIODS.map(([value, label]) => renderWindow(term, value, label, byWindow.get(value)));
    const statusFilter = h("select.select", { style: { maxWidth: "170px" }, value: "pending" }, STATUS.map(([value, label]) => h("option", { value, text: label })));
    const search = h("input.input", { placeholder: "Search class, subject, teacher, or student", style: { maxWidth: "300px" } });
    const listHost = h("div");
    const pendingCount = requests.filter((r) => r.status === "pending").length;
    const count = h("span.badge.badge-info", { text: `${pendingCount} pending` });
    const renderList = () => {
      const query = search.value.trim().toLowerCase();
      const filtered = requests.filter((r) => (statusFilter.value === "all" || r.status === statusFilter.value) && (!query || [r.classes?.name, r.subjects?.name, r.requester?.full_name, r.requester?.staff_code, r.reason, ...(r.affected || []).map((s) => `${s?.full_name} ${s?.admission_no}`)].join(" ").toLowerCase().includes(query)));
      const table = h("div.table-wrap.card.card-flush", {},
        h("table.table", {},
          h("thead", {}, h("tr", {}, ["Request", "Teacher", "Affected students", "Reason", "Created", "Status", "Action"].map((x) => h("th", { text: x })))),
          h("tbody", {}, filtered.map((r) => requestRow(term, r, load, count))),
        ),
      );
      mount(listHost, filtered.length ? table : h("div.card", {}, h("p.u-muted", { text: statusFilter.value === "pending" ? "No pending unlock requests." : "No requests match the selected filter." })));
    };
    statusFilter.addEventListener("change", renderList); search.addEventListener("input", renderList);
    mount(body,
      h("div.stat-grid", {}, stat("Pending requests", pendingCount), stat("Approved", requests.filter((r) => r.status === "approved").length), stat("Declined", requests.filter((r) => r.status === "declined").length), stat("Active windows", windows.filter((w) => w.is_open).length)),
      h("h2.section-title", { text: `${term.label} Term windows` }), h("div.u-row.u-wrap", {}, controls),
      h("div.card-head.u-mt-4", {}, h("div", {}, h("h2.card-title", { text: "Unlock requests" }), h("div.u-xs.u-muted", { text: "Approve only after reviewing the reason and affected students." })), count),
      h("div.u-row.u-wrap.u-mb-3", {}, statusFilter, search), listHost,
      renderAnalytics(analytics),
    );
    renderList();
  }

  function renderAnalytics(rows) {
    const teachers = rows.filter((r) => r.dimension === "teacher");
    const subjects = rows.filter((r) => r.dimension === "subject");
    const table = (title, data) => h("section.card", {},
      h("div.card-head", {}, h("h2.card-title", { text: title }), h("span.u-xs.u-muted", { text: "Sorted by total requests" })),
      data.length ? h("div.table-wrap", {}, h("table.table", {},
        h("thead", {}, h("tr", {}, ["Name", "Total", "Pending", "Approved", "Declined", "Approval rate", "Avg. resolution"].map((x) => h("th", { text: x })))),
        h("tbody", {}, data.map((r) => h("tr", {}, h("td", { text: r.label }), h("td.u-num", { text: r.total_count }), h("td.u-num", { text: r.pending_count }), h("td.u-num", { text: r.approved_count }), h("td.u-num", { text: r.declined_count }), h("td.u-num", { text: r.approval_rate == null ? "—" : `${r.approval_rate}%` }), h("td.u-num", { text: r.avg_resolution_hours == null ? "—" : `${r.avg_resolution_hours}h` }))))),
      ) : h("p.u-muted", { text: "No unlock requests recorded for this term." }));
    return h("div.u-stack.u-mt-4", {}, h("h2.section-title", { text: "Unlock request analytics" }), h("p.u-small.u-muted", { text: "Use these patterns to identify unclear score-entry guidance, frequent correction needs, or subjects that need review." }), table("By teacher", teachers), table("By subject", subjects));
  }

  function renderWindow(term, value, label, window) {
    const checkbox = h("input", { type: "checkbox", checked: window?.is_open !== false });
    const save = h("button.btn.btn-outline.btn-sm", { type: "button", text: "Save" });
    save.addEventListener("click", async () => { setBusy(save, true, "Saving…"); try { unwrap(await supabase.rpc("set_score_period_window", { p_term_id: term.id, p_period: value, p_is_open: checkbox.checked, p_opens_at: null, p_closes_at: null }), "save period window"); toastOk(`${label} ${checkbox.checked ? "opened" : "closed"}`); await reloadActive(term); } catch (err) { toastError(humanError(err)); } finally { setBusy(save, false); } });
    return h("div.card", { style: { minWidth: "185px", flex: "1 1 185px" } }, h("div.u-row", { style: { justifyContent: "space-between" } }, h("strong", { text: label }), h(`span.badge.${checkbox.checked ? "badge-ok" : "badge-warn"}`, { text: checkbox.checked ? "Open" : "Closed" })), h("div.u-row.u-mt-2", {}, checkbox, save));
  }

  async function reloadActive(term) { await load(term); }
}

function requestRow(term, request, reload, count) {
  const statusClass = request.status === "pending" ? "badge-warn" : request.status === "approved" ? "badge-ok" : "badge-info";
  const detail = h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Review" });
  detail.addEventListener("click", () => reviewRequest(term, request, reload));
  const action = request.status === "pending" ? h("div.u-row", {}, detail, resolveButton("Approve", "approved", "btn-primary", term, request, reload), resolveButton("Decline", "declined", "btn-outline", term, request, reload)) : detail;
  return h("tr", {}, h("td", {}, h("div", { style: { fontWeight: "600" }, text: `${request.classes?.name || "Class"} · ${request.subjects?.name || "Subject"}` }), h("div.u-xs.u-muted", { text: request.period.toUpperCase() })), h("td", {}, h("div", { text: request.requester?.full_name || "Unknown staff" }), h("div.u-xs.u-muted", { text: request.requester?.staff_code || "" })), h("td.u-num", { text: request.affected.length }), h("td", { text: request.reason || "—" }), h("td.u-xs", { text: new Date(request.created_at).toLocaleString() }), h("td", {}, h(`span.badge.${statusClass}`, { text: request.status })), h("td", {}, action));
}

function resolveButton(label, decision, style, term, request, reload) {
  const button = h(`button.btn.${style}.btn-sm`, { type: "button", text: label });
  button.addEventListener("click", async () => {
    const ok = await confirmAction({ title: `${label} unlock request?`, message: decision === "approved" ? "Approval unlocks this subject period so the teacher can edit scores." : "Declining leaves the subject period locked.", confirmLabel: label, danger: decision === "declined" });
    if (!ok) return;
    setBusy(button, true, "Working…");
    try { unwrap(await supabase.rpc("resolve_score_unlock_request", { p_request_id: request.id, p_decision: decision }), "resolve unlock request"); toastOk(`Request ${decision}`); await reload(term); } catch (err) { toastError(humanError(err)); } finally { setBusy(button, false); }
  });
  return button;
}

function reviewRequest(term, request, reload) {
  const affected = request.affected.length ? h("ul", {}, request.affected.map((s) => h("li", { text: `${s.full_name} (${s.admission_no})` }))) : h("p.u-muted", { text: "No affected students were recorded." });
  const close = openModal({ title: "Unlock request details", body: h("div.u-stack", {}, h("div", {}, h("strong", { text: `${request.classes?.name || "Class"} · ${request.subjects?.name || "Subject"}` }), h("div.u-xs.u-muted", { text: `${request.period.toUpperCase()} · Submitted ${new Date(request.created_at).toLocaleString()}` })), h("p", { text: request.reason || "No reason supplied." }), h("strong", { text: `Affected students (${request.affected.length})` }), affected, h("div.u-xs.u-muted", { text: request.requester ? `Requested by ${request.requester.full_name}` : "Requester unavailable" })), actions: [h("button.btn.btn-outline", { type: "button", text: "Close", onclick: () => close() })] });
}

function stat(label, value) { return h("div.stat", {}, h("div.stat-label", { text: label }), h("div.stat-value", { text: String(value) })); }
