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

// Module level on purpose. It was first declared inside render() below the
// point where render awaits, so the grid ran before the declaration did and
// the whole page failed with "Cannot access 'STATUS_BADGE' before
// initialization". Found by running the page, not by reading it.
const STATUS_BADGE = {
  paid: ["badge-ok", "Paid"], partial: ["badge-info", "Part paid"],
  unpaid: ["badge-warn", "Unpaid"], waived: ["badge-brass", "Waived"],
};

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
      const selectedClass = state.classes.find((item) => item.id === state.classId);
      const [structureRows, sectionRows, students] = await Promise.all([
        unwrap(await supabase.from("fee_structure").select("*").eq("class_id", state.classId).eq("term_id", state.term.id).limit(1), "fetch fee structure"),
        unwrap(await supabase.from("school_section_fees").select("section, amount").eq("term_id", state.term.id).eq("section", selectedClass?.category || "primary").limit(1), "fetch section fee"),
        unwrap(await supabase.from("students").select("id, full_name, admission_no").eq("class_id", state.classId).eq("is_active", true).order("full_name"), "fetch students"),
      ]);
      const studentIds = students.map((s) => s.id);
      const payments = studentIds.length
        ? unwrap(await supabase.from("fee_payments").select("*").eq("term_id", state.term.id).in("student_id", studentIds), "fetch payments")
        : [];
      state.structure = structureRows?.[0] || (sectionRows?.[0] ? { amount: sectionRows[0].amount, isSectionDefault: true } : null);
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
          h("div.u-grow", {}, h("div.stat-label", { text: state.structure?.isSectionDefault ? "Section default fee for this class" : "Fee for this class, this term" }), amountInput),
          saveStructBtn,
        ),
        structNote,
      ),
      grid(),
    );
  }

  /* Status is decided by the database (app.student_fees_settled and
     public.fee_status_detail, migration 0028). This mirrors it only so the
     grid can show the effect of an edit before it is saved. */
  function modeOf(payment) {
    if (payment?.waived) return "waived";
    if (payment?.is_paid_override === true) return "paid";
    if (payment?.is_paid_override === false) return "unpaid";
    return "auto";
  }

  function statusOf(mode, amount, expected, hasRow) {
    if (mode === "waived") return "waived";
    if (mode === "paid") return "paid";
    if (mode === "unpaid") return amount > 0 ? "partial" : "unpaid";
    if (!hasRow) return "unpaid";
    if (amount >= expected) return "paid";
    return amount > 0 ? "partial" : "unpaid";
  }

  function grid() {
    if (!state.students.length) return emptyState({ title: "No students in this class", body: "Admit students from the Students page first." });

    const saveBtn = h("button.btn.btn-primary", { type: "button", text: "Save payments" });
    const expected = Number(state.structure?.amount || 0);

    const rows = state.students.map((s) => {
      const current = { mode: modeOf(s.payment), amount: Number(s.payment?.amount_paid || 0) };
      const statusCell = h("td.num");
      const balanceCell = h("td.num");

      const paint = () => {
        const mode = s._mode ?? current.mode;
        const amount = s._amount ?? current.amount;
        const [cls, label] = STATUS_BADGE[statusOf(mode, amount, expected, !!s.payment || s.dirty)];
        mount(statusCell, h(`span.badge.${cls}`, { text: label }));
        balanceCell.textContent = mode === "waived" ? "—" : MONEY.format(Math.max(expected - amount, 0));
      };

      const amountInput = h("input.input.u-num", {
        type: "number", min: "0", step: "100", style: { maxWidth: "130px" }, "aria-label": `Amount paid by ${s.full_name}`,
        value: s.payment?.amount_paid ?? "0",
        oninput: (e) => { s._amount = Number(e.target.value) || 0; state.dirty.add(s.id); s.dirty = true; paint(); },
      });

      const modeSel = h("select.select", { style: { maxWidth: "150px" }, "aria-label": `Fee status for ${s.full_name}` },
        [["auto", "Automatic"], ["paid", "Mark as paid"], ["unpaid", "Mark as unpaid"], ["waived", "Waived / approved"]]
          .map(([v, l]) => h("option", { value: v, selected: current.mode === v, text: l })));
      modeSel.addEventListener("change", () => { s._mode = modeSel.value; state.dirty.add(s.id); s.dirty = true; paint(); });

      const reason = h("input.input", {
        placeholder: "Reason (needed when waived)", maxlength: "120", value: s.payment?.waived_reason || "",
        "aria-label": `Reason for ${s.full_name}`,
        oninput: (e) => { s._reason = e.target.value; state.dirty.add(s.id); },
      });

      paint();
      return h("tr", {},
        h("td", {}, h("div", { style: { fontWeight: "600" }, text: s.full_name }), h("div.u-xs.u-muted", { text: s.admission_no })),
        h("td.num", {}, amountInput),
        balanceCell,
        h("td.num", {}, modeSel),
        h("td", {}, reason),
        statusCell,
      );
    });

    saveBtn.addEventListener("click", () => save(saveBtn));

    return h("div.card.card-flush", {},
      h("div.table-wrap", {}, h("table.table", {},
        h("thead", {}, h("tr", {},
          h("th", { text: "Student" }), h("th.num", { text: "Amount paid" }), h("th.num", { text: "Balance" }),
          h("th.num", { text: "Status" }), h("th", { text: "Note" }), h("th.num", { text: "Result" }))),
        h("tbody", {}, rows),
      )),
      h("div", { style: { padding: "16px" } }, saveBtn),
    );
  }

  async function save(saveBtn) {
    const changed = state.students.filter((s) => state.dirty.has(s.id));
    if (!changed.length) return toastOk("Nothing to save");

    const rows = [];
    for (const s of changed) {
      const mode = s._mode ?? modeOf(s.payment);
      const reason = (s._reason ?? s.payment?.waived_reason ?? "").trim();
      if (mode === "waived" && !reason) {
        return toastError(`Add a reason for waiving ${s.full_name}'s fees.`);
      }
      rows.push({
        school_id: session.schoolId, student_id: s.id, term_id: state.term.id,
        amount_paid: s._amount ?? s.payment?.amount_paid ?? 0,
        // "Automatic" really clears the override now. The earlier version
        // kept the old value when Automatic was chosen, so a bursar could
        // never undo a forced status.
        is_paid_override: mode === "paid" ? true : mode === "unpaid" ? false : null,
        waived: mode === "waived",
        waived_reason: mode === "waived" ? reason : null,
        recorded_by: session.staffId || null,
      });
    }

    setBusy(saveBtn, true, "Saving…");
    try {
      unwrap(await supabase.from("fee_payments").upsert(rows, { onConflict: "student_id,term_id" }), "save payments");
      toastOk("Payments saved");
      await loadClass();
    } catch (err) {
      toastError(humanError(err, "Payments could not be saved."));
    } finally { setBusy(saveBtn, false); }
  }
}
