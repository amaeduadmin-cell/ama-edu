import { h, mount } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError } from "../lib/errors.js";
import { errorState, emptyState } from "../lib/ui.js";
import { fetchActiveTerm } from "../lib/data.js";

const MONEY = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin", "bursar")) return;
  const body = h("div.u-stack");
  mount(outlet, page({ title: "Fee overview", subtitle: "School-wide collection summary from the existing fee structure and payment tables.", actions: [h("button.btn.btn-outline", { type: "button", text: "Print", onclick: () => window.print() })], body }));
  try {
    const term = await fetchActiveTerm();
    if (!term) return mount(body, emptyState({ title: "No active term", body: "Activate a term before reviewing fees." }));
    const [classes, students, structures, payments] = await Promise.all([
      unwrap(await supabase.from("classes").select("id,name").eq("is_active", true).order("sort_order"), "fetch classes"),
      unwrap(await supabase.from("students").select("id,class_id,is_active").eq("is_active", true), "fetch students"),
      unwrap(await supabase.from("fee_structure").select("class_id,amount").eq("term_id", term.id), "fetch fee structures"),
      unwrap(await supabase.from("fee_payments").select("student_id,amount_paid,is_paid_override,waived").eq("term_id", term.id), "fetch payments"),
    ]);
    const feeByClass = new Map(structures.map((r) => [r.class_id, Number(r.amount || 0)]));
    const paymentByStudent = new Map(payments.map((r) => [r.student_id, r]));
    const rows = classes.map((c) => { const members = students.filter((s) => s.class_id === c.id); const expected = members.reduce((n) => n + (feeByClass.get(c.id) || 0), 0); let paid = 0, partial = 0, unpaid = 0, waived = 0; for (const s of members) { const p = paymentByStudent.get(s.id); if (p?.waived) { waived++; continue; } const amount = Number(p?.amount_paid || 0); const settled = p?.is_paid_override === true || (!p?.is_paid_override && amount >= (feeByClass.get(c.id) || 0)); if (settled) paid += amount; else if (amount > 0) { partial++; paid += amount; } else unpaid++; } return { name: c.name, students: members.length, expected, paid, partial, unpaid, waived }; });
    const total = rows.reduce((a, r) => ({ students: a.students + r.students, expected: a.expected + r.expected, paid: a.paid + r.paid, partial: a.partial + r.partial, unpaid: a.unpaid + r.unpaid, waived: a.waived + r.waived }), { students: 0, expected: 0, paid: 0, partial: 0, unpaid: 0, waived: 0 });
    mount(body, h("div.stat-grid", {}, stat("Active students", total.students), stat("Expected", MONEY.format(total.expected)), stat("Paid", MONEY.format(total.paid)), stat("Collection", `${total.expected ? Math.round(total.paid / total.expected * 100) : 0}%`)), h("div.table-wrap.card.card-flush", {}, h("table.table", {}, h("thead", {}, h("tr", {}, ["Class", "Students", "Expected", "Paid", "Partial", "Unpaid", "Waived"].map((x) => h("th", { text: x })))), h("tbody", {}, rows.map((r) => h("tr", {}, h("td", { text: r.name }), h("td.u-num", { text: r.students }), h("td.num", { text: MONEY.format(r.expected) }), h("td.num", { text: MONEY.format(r.paid) }), h("td.u-num", { text: r.partial }), h("td.u-num", { text: r.unpaid }), h("td.u-num", { text: r.waived })))))));
  } catch (err) { mount(body, errorState(humanError(err))); }
}
function stat(label, value) { return h("div.stat", {}, h("div.stat-label", { text: label }), h("div.stat-value", { text: String(value) })); }
