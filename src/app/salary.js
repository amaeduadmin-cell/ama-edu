import { h, mount, skeleton, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, toastOk, toastError } from "../lib/ui.js";
import { fetchActiveTerm } from "../lib/data.js";
import { session } from "../lib/auth.js";

const MONEY = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin")) return;
  const state = { term: null, terms: [], staff: [], payments: new Map(), termId: "" };
  const body = h("div.u-stack");
  mount(outlet, page({ title: "Staff salaries", subtitle: "Track three salary-payment checkpoints per staff member.", actions: [h("button.btn.btn-outline", { type: "button", text: "Print report", onclick: () => window.print() })], body }));
  mount(body, h("div.card", {}, skeleton(5)));
  try {
    const [term, terms] = await Promise.all([
      fetchActiveTerm(),
      unwrap(await supabase.from("terms").select("id,label,order_index,sessions(label)").order("order_index"), "fetch terms"),
    ]);
    state.term = term; state.terms = terms; state.termId = term?.id || terms[0]?.id || "";
    await load();
  } catch (err) { logError("salary boot", err); mount(body, errorState(humanError(err))); }

  async function load() {
    mount(body, h("div.card", {}, skeleton(5)));
    try {
      state.staff = unwrap(await supabase.from("staff").select("id,staff_code,full_name,position,salary_amount").eq("is_active", true).order("full_name"), "fetch active staff");
      const rows = state.termId ? unwrap(await supabase.from("staff_salary_payments").select("*").eq("term_id", state.termId), "fetch salary payments") : [];
      state.payments = new Map(rows.map((r) => [`${r.staff_id}:${r.month_no}`, r]));
      draw();
    } catch (err) { logError("salary load", err); mount(body, errorState(humanError(err), load)); }
  }

  function draw() {
    if (!state.staff.length) return mount(body, emptyState({ title: "No active staff", body: "Active staff members will appear here." }));
    const termSel = h("select.select", { style: { maxWidth: "240px", marginBottom: "12px" }, onchange: async (e) => { state.termId = e.target.value; await load(); } },
      state.terms.map((t) => h("option", { value: t.id, selected: t.id === state.termId, text: `${t.label} Term · ${t.sessions?.label || ""}` })));
    const tableRows = state.staff.map((staff) => {
      const cells = [1, 2, 3].map((month) => salaryCell(staff, month));
      const statuses = cells.map((c) => c.status);
      const summary = statuses.every((s) => s === "paid") ? "Fully Paid" : statuses.some((s) => s === "paid") ? "Partial" : "Unpaid";
      return h("tr", {}, h("td", {}, h("div", { style: { fontWeight: "600" }, text: staff.full_name }), h("div.u-xs.u-muted", { text: `${staff.staff_code} · ${staff.position || "Staff"}` })), cells.map((c) => c.node), h("td", {}, h(`span.badge.${summary === "Fully Paid" ? "badge-ok" : summary === "Partial" ? "badge-info" : "badge-warn"}`, { text: summary })));
    });
    mount(body, h("div.card-head", {}, h("h2.card-title", { text: "Salary payments" }), termSel), h("div.table-wrap.card.card-flush", {}, h("table.table", {},
      h("thead", {}, h("tr", {}, h("th", { text: "Staff" }), h("th", { text: "Month 1" }), h("th", { text: "Month 2" }), h("th", { text: "Month 3" }), h("th", { text: "Status" }))),
      h("tbody", {}, tableRows))));
  }

  function salaryCell(staff, month) {
    const existing = state.payments.get(`${staff.id}:${month}`) || {};
    const paid = h("input", { type: "checkbox", checked: existing.paid === true });
    const amount = h("input.input.u-num", { type: "number", min: "0", step: "100", placeholder: "Amount", value: existing.amount ?? "", style: { width: "110px" } });
    const note = h("input.input", { placeholder: "Note", value: existing.note || "", style: { width: "150px" } });
    const save = h("button.btn.btn-outline.btn-sm", { type: "button", text: "Save" });
    const status = existing.paid ? "paid" : "unpaid";
    save.addEventListener("click", async () => {
      setBusy(save, true, "Saving…");
      try {
        unwrap(await supabase.from("staff_salary_payments").upsert({ school_id: session.schoolId, staff_id: staff.id, term_id: state.termId, month_no: month, paid: paid.checked, paid_on: paid.checked ? new Date().toISOString().slice(0, 10) : null, amount: amount.value ? Number(amount.value) : null, note: note.value.trim() || null, recorded_by: session.staffId || null }, { onConflict: "staff_id,term_id,month_no" }), "save salary payment");
        toastOk(`${staff.full_name}: Month ${month} saved`); await load();
      } catch (err) { toastError(humanError(err)); } finally { setBusy(save, false); }
    });
    return { status, node: h("td", {}, h("div.u-row", { style: { gap: "5px", flexWrap: "wrap" } }, paid, h("span.u-xs", { text: "Paid" }), amount, note, save)) };
  }
}
