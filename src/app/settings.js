/* ===============================================================
   Settings — school profile, branding, academic term, admission
   scheme, and (for everyone) changing your own password.

   Ports: renderSettings / saveSchoolSettings / setActiveTermFn /
   changeMyPassword (MyPAS1 app-admin.js). Branding saved here is
   what applyTenantBranding() reads on every future visit — this is
   the "no code change per school" promise from the design doc, and
   this page also re-applies it live so the sidebar updates without
   a reload.
   =============================================================== */

import { h, mount, skeleton, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, field, passwordField, inlineAlert, confirmAction, toastOk, toastError } from "../lib/ui.js";
import { hasRole, session, changeOwnPassword } from "../lib/auth.js";
import { applyTenantBranding } from "../lib/tenant.js";
import { context } from "../main.js";

export default async function render({ outlet }) {
  const isAdmin = hasRole("admin");
  const body = h("div.u-stack");
  mount(outlet, page({ title: isAdmin ? "Settings" : "My profile", body }));

  mount(body, skeleton(4));

  if (isAdmin) {
    try {
      const [school, terms] = await Promise.all([
        unwrap(await supabase.from("schools").select("*").eq("id", session.schoolId).single(), "fetch school"),
        unwrap(await supabase.from("terms").select("id, label, order_index, is_active, ends_on, next_term_starts_on, sessions(label)").order("order_index"), "fetch terms"),
      ]);
      const activeTerm = terms.find((term) => term.is_active) || terms[0];
      const sectionFees = activeTerm
        ? unwrap(await supabase.from("school_section_fees").select("id, section, amount").eq("term_id", activeTerm.id), "fetch section fees")
        : [];
      mount(body,
        generalCard(school),
        brandingCard(school),
        academicCard(terms),
        sectionFeesCard(activeTerm, sectionFees),
        admissionCard(school),
        passwordCard(),
      );
    } catch (err) {
      logError("settings boot", err);
      mount(body, errorState(humanError(err)));
    }
  } else {
    mount(body, passwordCard());
  }
}

function sectionFeesCard(term, rows) {
  if (!term) return null;
  const sections = [["nursery", "Nursery"], ["primary", "Primary"], ["jss", "Junior Secondary (JSS)"], ["ss", "Senior Secondary (SS)"], ["islamiyya", "Islamiyya"]];
  const values = new Map(rows.map((row) => [row.section, row.amount]));
  const controls = new Map();
  const note = h("div");
  const save = h("button.btn.btn-primary", { type: "button", text: "Save section fees" });
  save.addEventListener("click", async () => {
    const payload = [];
    for (const [section] of sections) {
      const amount = Number(controls.get(section).value);
      if (!Number.isFinite(amount) || amount < 0) return mount(note, inlineAlert("Enter a valid amount for every section, or use 0 for a free section."));
      payload.push({ school_id: session.schoolId, term_id: term.id, section, amount, updated_by: session.staffId || null });
    }
    setBusy(save, true, "Saving…");
    try {
      unwrap(await supabase.from("school_section_fees").upsert(payload, { onConflict: "school_id,term_id,section" }), "save section fees");
      toastOk("Section fees saved");
    } catch (err) { mount(note, inlineAlert(humanError(err))); } finally { setBusy(save, false); }
  });
  return h("section.card", {},
    h("div.card-head", {}, h("div", {}, h("h2.card-title", { text: "Section fee schedule" }), h("div.card-sub", { text: `${term.label} Term · These are defaults; a class-specific fee can override them on Fees.` })), h("span.badge.badge-info", { text: "NGN" })),
    h("div.form-grid.cols-2", {}, sections.map(([section, label]) => {
      const input = h("input.input.u-num", { type: "number", min: "0", step: "100", value: values.get(section) ?? "", placeholder: "e.g. 25000" });
      controls.set(section, input);
      return field({ label, id: `section-fee-${section}`, control: input });
    })),
    h("p.u-xs.u-muted", { text: "Fee calculations use the class-specific amount first, then this section default. Nursery, Primary, JSS, SS, and Islamiyya are intentionally independent." }),
    note, save,
  );
}

/* ---------------- General ---------------- */
function generalCard(school) {
  const nameInput  = h("input.input", { value: school.name, required: true });
  const mottoInput = h("input.input", { value: school.motto || "" });
  const emailInput = h("input.input", { type: "email", value: school.email || "" });
  const phoneInput = h("input.input", { type: "tel", value: school.phone || "" });
  const addrInput  = h("textarea.textarea", {}, school.address || "");
  const errorSlot = h("div");
  const saveBtn = h("button.btn.btn-primary", { type: "submit", form: "generalForm", text: "Save" });

  return h("section.card", {},
    h("div.card-head", {}, h("h2.card-title", { text: "General" })),
    h("form", { id: "generalForm", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      mount(errorSlot);
      const name = nameInput.value.trim();
      if (!name) return mount(errorSlot, inlineAlert("Enter the school's name."));
      setBusy(saveBtn, true, "Saving…");
      try {
        unwrap(await supabase.from("schools").update({
          name, motto: mottoInput.value.trim() || null, email: emailInput.value.trim() || null,
          phone: phoneInput.value.trim() || null, address: addrInput.value.trim() || null,
        }).eq("id", school.id), "save general");
        if (context.school) { context.school.name = name; context.school.motto = mottoInput.value.trim(); }
        toastOk("Saved");
      } catch (err) {
        mount(errorSlot, inlineAlert(humanError(err)));
      } finally { setBusy(saveBtn, false); }
    } },
      errorSlot,
      h("div.form-grid.cols-2", {}, field({ label: "School name", id: "gName", control: nameInput }), field({ label: "Motto", id: "gMotto", control: mottoInput })),
      h("div.form-grid.cols-2", {}, field({ label: "Email", id: "gEmail", control: emailInput }), field({ label: "Phone", id: "gPhone", control: phoneInput })),
      field({ label: "Address", id: "gAddr", control: addrInput }),
      saveBtn,
    ),
  );
}

/* ---------------- Branding ---------------- */
function brandingCard(school) {
  const logoInput = h("input.input", { type: "url", value: school.logo_url || "", placeholder: "https://…" });
  const faviconInput = h("input.input", { type: "url", value: school.favicon_url || "", placeholder: "https://…" });
  const primaryInput = h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(school.primary_color) ? school.primary_color : "#0f6b3f", style: { width: "100%", height: "42px", border: "1px solid var(--ama-line)", borderRadius: "8px", padding: "2px" } });
  const secondaryInput = h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(school.secondary_color) ? school.secondary_color : "#b8862b", style: { width: "100%", height: "42px", border: "1px solid var(--ama-line)", borderRadius: "8px", padding: "2px" } });
  const errorSlot = h("div");
  const saveBtn = h("button.btn.btn-primary", { type: "submit", form: "brandForm", text: "Save branding" });

  return h("section.card", {},
    h("div.card-head", {}, h("h2.card-title", { text: "Branding" }), h("div.card-sub", { text: "Applies immediately, across the whole portal, without a code change." })),
    h("form", { id: "brandForm", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      mount(errorSlot);
      const payload = {
        logo_url: logoInput.value.trim() || null,
        favicon_url: faviconInput.value.trim() || null,
        primary_color: primaryInput.value,
        secondary_color: secondaryInput.value,
      };
      setBusy(saveBtn, true, "Saving…");
      try {
        unwrap(await supabase.from("schools").update(payload).eq("id", school.id), "save branding");
        Object.assign(school, payload);
        if (context.school) { Object.assign(context.school, payload); applyTenantBranding(context.school); }
        toastOk("Branding saved");
      } catch (err) {
        mount(errorSlot, inlineAlert(humanError(err)));
      } finally { setBusy(saveBtn, false); }
    } },
      errorSlot,
      h("div.form-grid.cols-2", {}, field({ label: "Primary colour", id: "bPrimary", control: primaryInput }), field({ label: "Secondary colour", id: "bSecondary", control: secondaryInput })),
      field({ label: "Logo URL", id: "bLogo", control: logoInput }),
      field({ label: "Favicon URL", id: "bFavicon", control: faviconInput }),
      saveBtn,
    ),
  );
}

/* ---------------- Academic term ---------------- */
function academicCard(terms) {
  const list = h("div.u-stack", { style: { gap: "8px" } }, terms.map((t) => termRow(t)));
  return h("section.card", {},
    h("div.card-head", {}, h("h2.card-title", { text: "Academic term" }), h("div.card-sub", { text: "Only one term is active at a time — this is what score entry, fees and dashboards use." })),
    list,
  );

  function termRow(term) {
    const btn = h("button.btn.btn-outline.btn-sm", { type: "button", text: "Make active", disabled: term.is_active });
    btn.addEventListener("click", async () => {
      const ok = await confirmAction({
        title: `Make ${term.label} Term the active term?`,
        message: "Score entry, fees and the dashboard will switch to this term immediately.",
        confirmLabel: "Make active",
      });
      if (!ok) return;
      setBusy(btn, true, "Switching…");
      try {
        unwrap(await supabase.from("terms").update({ is_active: false }).neq("id", term.id), "deactivate terms");
        unwrap(await supabase.from("terms").update({ is_active: true }).eq("id", term.id), "activate term");
        toastOk(`${term.label} Term is now active`);
        window.location.reload();
      } catch (err) {
        toastError(humanError(err));
        setBusy(btn, false);
      }
    });

    // "Closing date" / "resumption date" — reuses terms.ends_on and
    // terms.next_term_starts_on rather than adding new columns; the
    // report card's holiday-duration line is computed from these two.
    const closingInput = h("input.input", { type: "date", value: term.ends_on || "" });
    const resumptionInput = h("input.input", { type: "date", value: term.next_term_starts_on || "" });
    const datesErrorSlot = h("div");
    const datesSaveBtn = h("button.btn.btn-outline.btn-sm", { type: "button", text: "Save dates" });
    datesSaveBtn.addEventListener("click", async () => {
      mount(datesErrorSlot);
      setBusy(datesSaveBtn, true, "Saving…");
      try {
        unwrap(await supabase.from("terms").update({
          ends_on: closingInput.value || null,
          next_term_starts_on: resumptionInput.value || null,
        }).eq("id", term.id), "save term dates");
        term.ends_on = closingInput.value || null;
        term.next_term_starts_on = resumptionInput.value || null;
        toastOk(`${term.label} Term dates saved`);
      } catch (err) {
        mount(datesErrorSlot, inlineAlert(humanError(err)));
      } finally { setBusy(datesSaveBtn, false); }
    });

    return h("div", { style: { padding: "10px 0", borderBottom: "1px solid var(--ama-line-2)" } },
      h("div.u-row", { style: { justifyContent: "space-between" } },
        h("div", {}, h("div", { style: { fontWeight: "600" }, text: `${term.label} Term` }), h("div.u-xs.u-muted", { text: term.sessions?.label || "" })),
        term.is_active ? h("span.badge.badge-ok", { text: "Active" }) : btn,
      ),
      datesErrorSlot,
      h("div.form-grid.cols-2", { style: { marginTop: "8px" } },
        field({ label: "Closing date", id: `closing-${term.id}`, control: closingInput }),
        field({ label: "Resumption date", id: `resumption-${term.id}`, control: resumptionInput }),
      ),
      h("div.u-row", { style: { justifyContent: "flex-end", marginTop: "4px" } }, datesSaveBtn),
    );
  }
}

/* ---------------- Admission scheme ---------------- */
function admissionCard(school) {
  const prefixInput = h("input.input", { value: school.admission_prefix || "", style: { maxWidth: "140px" } });
  const nextInput = h("input.input.u-num", { type: "number", min: "1", value: school.admission_next_no ?? 1, style: { maxWidth: "140px" } });
  const errorSlot = h("div");
  const saveBtn = h("button.btn.btn-primary", { type: "submit", form: "admForm", text: "Save" });

  return h("section.card", {},
    h("div.card-head", {}, h("h2.card-title", { text: "Admission numbers" })),
    h("form", { id: "admForm", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      mount(errorSlot);
      setBusy(saveBtn, true, "Saving…");
      try {
        unwrap(await supabase.from("schools").update({
          admission_prefix: prefixInput.value.trim() || "ADM",
          admission_next_no: Number(nextInput.value) || 1,
        }).eq("id", school.id), "save admission scheme");
        toastOk("Saved");
      } catch (err) {
        mount(errorSlot, inlineAlert(humanError(err)));
      } finally { setBusy(saveBtn, false); }
    } },
      errorSlot,
      h("div.form-grid.cols-2", {}, field({ label: "Prefix", id: "admPrefix", control: prefixInput }), field({ label: "Next number", id: "admNext", control: nextInput })),
      h("p.u-xs.u-muted", { text: "Used only as a suggestion when admitting a student — you can always type a different admission number." }),
      saveBtn,
    ),
  );
}

/* ---------------- Password ---------------- */
function passwordCard() {
  const pw = passwordField({ label: "New password", id: "myPw", autocomplete: "new-password", hint: "At least 8 characters." });
  const errorSlot = h("div");
  const saveBtn = h("button.btn.btn-primary", { type: "submit", form: "pwForm", text: "Update password" });

  return h("section.card", {},
    h("div.card-head", {}, h("h2.card-title", { text: "Your password" })),
    h("form", { id: "pwForm", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      mount(errorSlot);
      if (pw.input.value.length < 8) return mount(errorSlot, inlineAlert("Use at least 8 characters."));
      setBusy(saveBtn, true, "Saving…");
      try {
        await changeOwnPassword(pw.input.value);
        pw.input.value = "";
        toastOk("Password updated");
      } catch (err) {
        mount(errorSlot, inlineAlert(humanError(err)));
      } finally { setBusy(saveBtn, false); }
    } },
      errorSlot, pw.node, saveBtn,
    ),
  );
}
