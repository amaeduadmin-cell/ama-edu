/* ===============================================================
   Fees — set the class fee for the term, record payments, see who
   has paid.

   Ports: renderFees / loadFeesGrid / saveFeeRow (MyPAS1 app-admin.js).
   MyPAS1 had a real fail-open bug here: a student with no payment
   row on file was silently treated as paid. That's fixed at the
   schema level (app.student_fees_settled defaults to false with no
   row — migration 0005) and this page shows that honestly: no
   payment row reads as "Unpaid", never blank.
   =============================================================== */

import { h, mount, skeleton, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, toastOk, toastError, inlineAlert } from "../lib/ui.js";
import { fetchClasses, fetchActiveTerm } from "../lib/data.js";
import { hasRole, session } from "../lib/auth.js";

const MONEY = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin", "bursar")) return;

  const isAdmin = hasRole("admin");
  const state = { classes: [], term: null, classId: "", structure: null, students: [], dirty: new Set() };
  const body = h("div.u-stack");

  mount(outlet, page({ title: "Fees", subtitle: "Record payments and see who has paid this term.", body }));

  try {
    state.classes = await fetchClasses();
    state.term = await fetchActiveTerm();
    state.classId = state.classes[0]?.id || "";
  } catch (err) {
    logError("fees boot", err);
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
      h("div.card-head", {},
        h("div", {}, h("h2.card-title", { text: "Class fees" }), h("div.card-sub", { text: `${state.term.label} Term · ${state.term.sessions?.label || ""}` })),
        classSel,
      ),
      h("div#feesHost", {}, skeleton(4)),
    );
  }

  async function loadClass() {
    draw();
    const host = document.getElementById("feesHost");
    try {
      const [structureRows, students] = await Promise.all([
        unwrap(await supabase.from("fee_structure").select("*").eq("class_id", state.classId).eq("term_id", state.term.id).limit(1), "fetch fee structure"),
        unwrap(await supabase.from("students").select("id, full_name, admission_no").eq("class_id", state.classId).eq("is_active", true).order("full_name"), "fetch students"),
      ]);
      const studentIds = students.map((s) => s.id);
      const payments = studentIds.length
        ? unwrap(await supabase.from("fee_payments").select("*").eq("term_id", state.term.id).in("student_id", studentIds), "fetch payments")
        : [];
      state.structure = structureRows?.[0] || null;
      const byStudent = new Map(payments.map((p) => [p.student_id, p]));
      state.students = students.map((s) => ({ ...s, payment: byStudent.get(s.id) || null }));
      state.dirty.clear();
      renderStructure(host);
    } catch (err) {
      logError("load fees", err);
      mount(host, errorState(humanError(err), loadClass));
    }
  }

  function renderStructure(host) {
    const amountInput = h("input.input.u-num", { type: "number", min: "0", step: "100", style: { maxWidth: "160px" },
      value: state.structure?.amount ?? "", disabled: !isAdmin, placeholder: isAdmin ? "Set amount" : "Not set" });
    const saveStructBtn = h("button.btn.btn-outline.btn-sm", { type: "button", text: "Save amount", disabled: !isAdmin });
    const structNote = h("div.u-xs.u-muted");

    saveStructBtn.addEventListener("click", async () => {
      const amount = Number(amountInput.value);
      if (!(amount >= 0)) return mount(structNote, inlineAlert("Enter a valid amount.", "error"));
      setBusy(saveStructBtn, true, "Saving…");
      try {
        unwrap(await supabase.from("fee_structure").upsert(
          { school_id: session.schoolId, class_id: state.classId, term_id: state.term.id, amount },
          { onConflict: "class_id,term_id" }
        ), "save fee structure");
        toastOk("Fee amount saved");
        await loadClass();
      } catch (err) {
        mount(structNote, inlineAlert(humanError(err), "error"));
      } finally { setBusy(saveStructBtn, false); }
    });

    mount(host,
      h("div.card.u-mt-4", { style: { marginBottom: "16px" } },
        h("div.u-row.u-wrap", {},
          h("div.u-grow", {}, h("div.stat-label", { text: "Fee for this class, this term" }), amountInput),
          saveStructBtn,
        ),
        structNote,
      ),
      grid(),
    );
  }

  function grid() {
    if (!state.students.length) return emptyState({ title: "No students in this class", body: "Admit students from the Students page first." });

    const saveBtn = h("button.btn.btn-primary", { type: "button", text: "Save payments" });
    const expected = Number(state.structure?.amount || 0);

    const rows = state.students.map((s) => {
      const amountInput = h("input.input.u-num", { type: "number", min: "0", step: "100", style: { maxWidth: "130px" },
        value: s.payment?.amount_paid ?? "0",
        oninput: (e) => { s._amount = Number(e.target.value); state.dirty.add(s.id); } });

      const overrideSel = h("select.select", { style: { maxWidth: "130px" } },
        h("option", { value: "", selected: s.payment?.is_paid_override == null, text: "Auto" }),
        h("option", { value: "true", selected: s.payment?.is_paid_override === true, text: "Force paid" }),
        h("option", { value: "false", selected: s.payment?.is_paid_override === false, text: "Force unpaid" }));
      overrideSel.addEventListener("change", () => { s._override = overrideSel.value; state.dirty.add(s.id); });

      const settled = s.payment?.is_paid_override != null ? s.payment.is_paid_override : Number(s.payment?.amount_paid || 0) >= expected;

      return h("tr", {},
        h("td", {}, h("div", { style: { fontWeight: "600" }, text: s.full_name }), h("div.u-xs.u-muted", { text: s.admission_no })),
        h("td.num", {}, amountInput),
        h("td.num", {}, overrideSel),
        h("td.num", {}, settled ? h("span.badge.badge-ok", { text: "Paid" }) : h("span.badge.badge-warn", { text: "Unpaid" })),
      );
    });

    saveBtn.addEventListener("click", () => save(saveBtn));

    return h("div.card.card-flush", {},
      h("div.table-wrap", {}, h("table.table", {},
        h("thead", {}, h("tr", {}, h("th", { text: "Student" }), h("th.num", { text: "Amount paid" }), h("th.num", { text: "Override" }), h("th.num", { text: "Status" }))),
        h("tbody", {}, rows),
      )),
      h("div", { style: { padding: "16px" } }, saveBtn),
    );
  }

  async function save(saveBtn) {
    const changed = state.students.filter((s) => state.dirty.has(s.id));
    if (!changed.length) return;
    const rows = changed.map((s) => ({
      school_id: session.schoolId,
      student_id: s.id,
      term_id: state.term.id,
      amount_paid: s._amount ?? s.payment?.amount_paid ?? 0,
      is_paid_override: s._override === "" || s._override == null ? (s.payment?.is_paid_override ?? null) : s._override === "true",
      recorded_by: session.staffId || null,
    }));
    setBusy(saveBtn, true, "Saving…");
    try {
      unwrap(await supabase.from("fee_payments").upsert(rows, { onConflict: "student_id,term_id" }), "save payments");
      toastOk("Payments saved");
      await loadClass();
    } catch (err) {
      toastError(humanError(err));
    } finally { setBusy(saveBtn, false); }
  }
}
