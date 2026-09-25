/* School self-registration — apex domain only.
   Three steps so a phone user is never facing a fifteen-field form. */

import "../styles/marketing.css";
import { h, mount, setBusy } from "../lib/dom.js";
import { field, inlineAlert, toastError } from "../lib/ui.js";
import { toSlug, validateSlug, tenantUrl, ROOT } from "../lib/tenant.js";
import { supabase } from "../lib/supabase.js";
import { humanError, logError } from "../lib/errors.js";
import { templatePicker } from "../lib/template-picker.js";

const SCHOOL_TYPES = [
  ["nursery_primary", "Nursery / Primary"],
  ["secondary",       "Secondary (JSS / SS)"],
  ["combined",        "Nursery through Secondary"],
  ["islamiyya",       "Islamiyya / Qur'anic"],
  ["other",           "Other"],
];

const SECTION_OPTIONS = [
  ["nursery",   "Nursery",           "Creche and nursery classes"],
  ["primary",   "Primary",           "Primary 1 to Primary 6"],
  ["jss",       "JSS",               "Junior Secondary, JSS 1 to JSS 3"],
  ["ss",        "Senior Secondary",  "SS 1 to SS 3"],
  ["islamiyya", "Islamiyya",         "Islamiyya or Qur'anic classes"],
  ["other",     "Other",             "Something else. You will add your own classes."],
];

/** The sections a school of this type most likely runs. The school can
 *  change the ticks; this only saves most people the trouble. */
function defaultSections(type) {
  const map = {
    nursery_primary: ["nursery", "primary"],
    secondary: ["jss", "ss"],
    combined: ["nursery", "primary", "jss", "ss"],
    islamiyya: ["islamiyya"],
    other: ["other"],
  };
  return new Set(map[type] || map.combined);
}

export default function render({ outlet }) {
  document.title = "Register a school — AMA EDU";

  const form = {
    name: "", type: "combined", email: "", phone: "", address: "", ward: "", lga: "", state: "", country: "Nigeria",
    website: "", registrationNumber: "", adminPhone: "", message: "",
    slug: new URLSearchParams(window.location.search).get("slug") || "",
    adminName: "", adminEmail: "", password: "",
    sections: defaultSections("combined"), studentCount: "", template: "classic",
  };

  let step = 0;
  const host = h("div.panel-page.registration-page", {});
  mount(outlet, host);
  draw();

  function draw() {
    mount(host,
      h("a.wordmark", { href: "/", style: { marginBottom: "20px" } }, "AMA ", h("b", { text: "EDU" })),
      h("div.panel.wide.registration-panel", {},
        h("div.steps", { "aria-hidden": "true" },
          [0, 1, 2, 3].map(i => h(`div.step${i <= step ? ".done" : ""}`))),
        h("div.panel-head", {},
          h("h1.panel-title", { text: ["Tell us about the school", "Sections and report card", "Choose your web address", "Send your application"][step] }),
          h("p.panel-sub", { text: ["This appears on report cards, certificates and the portal itself.", "Tell us which sections you run, so your portal only shows what applies to you.", "This is the address your staff, students and parents will use.", "AMA EDU will review the application before creating the live school portal."][step] }),
        ),
        [stepSchool, stepSetup, stepSlug, stepAdmin][step](),
      ),
      h("div.panel-foot", {}, "Already registered? ",
        h("a", { href: "/find-school", text: "Find your school portal" })),
    );
  }

  // A function declaration, so it exists when draw() first runs above. As a
  // `const` here it was still uninitialised on the first render and the
  // registration page threw "Cannot access 'bind' before initialization".
  function bind(key) { return (e) => { form[key] = e.target.value; }; }

  /* ---------- Step 1: the school ---------- */
  function stepSchool() {
    const name  = h("input.input", { id: "sName", required: true, value: form.name, autocomplete: "organization", oninput: bind("name") });
    const type  = h("select.select", { id: "sType", onchange: (e) => { form.type = e.target.value; form.sections = defaultSections(form.type); } },
      SCHOOL_TYPES.map(([v, label]) => h("option", { value: v, selected: form.type === v, text: label })));
    const email = h("input.input", { id: "sEmail", type: "email", required: true, value: form.email, autocomplete: "email", oninput: bind("email") });
    const phone = h("input.input", { id: "sPhone", type: "tel", value: form.phone, autocomplete: "tel", placeholder: "0803 000 0000", oninput: bind("phone") });
    const addr  = h("textarea.textarea", { id: "sAddr", oninput: bind("address") }, form.address);
    const ward = h("input.input", { id: "sWard", value: form.ward, autocomplete: "address-level3", oninput: bind("ward") });
    const lga = h("input.input", { id: "sLga", value: form.lga, autocomplete: "address-level2", oninput: bind("lga") });
    const state = h("input.input", { id: "sState", value: form.state, autocomplete: "address-level1", oninput: bind("state") });
    const country = h("input.input", { id: "sCountry", value: form.country, autocomplete: "country-name", oninput: bind("country") });
    const website = h("input.input", { id: "sWebsite", type: "url", value: form.website, placeholder: "https://…", oninput: bind("website") });
    const registrationNumber = h("input.input", { id: "sRegistrationNumber", value: form.registrationNumber, oninput: bind("registrationNumber") });
    const error = h("div");

    return h("form", { novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      if (!form.name.trim()) return mount(error, inlineAlert("Enter the school's name."));
      if (!/^\S+@\S+\.\S+$/.test(form.email)) return mount(error, inlineAlert("Enter a valid school email address."));
      if (!form.slug) { form.slug = toSlug(form.name).split("-").slice(0, 3).join("-"); }
      step = 1; draw();
    } },
      error,
      field({ label: "School name", id: "sName", control: name, hint: "Write it exactly as it should appear on a report card." }),
      field({ label: "Type of school", id: "sType", control: type }),
      h("div.form-grid.cols-2", {},
        field({ label: "School email", id: "sEmail", control: email }),
        field({ label: "Phone number", id: "sPhone", control: phone }),
      ),
      field({ label: "Address", id: "sAddr", control: addr }),
      h("div.form-grid.cols-2", {},
        field({ label: "Ward", id: "sWard", control: ward }),
        field({ label: "LGA", id: "sLga", control: lga }),
        field({ label: "State", id: "sState", control: state }),
        field({ label: "Country", id: "sCountry", control: country }),
      ),
      h("div.form-grid.cols-2", {},
        field({ label: "School website", id: "sWebsite", control: website, hint: "Optional — include https://" }),
        field({ label: "School registration number", id: "sRegistrationNumber", control: registrationNumber, hint: "Optional" }),
      ),
      h("button.btn.btn-primary.btn-block.btn-lg", { type: "submit", text: "Continue" }),
    );
  }

  /* ---------- Step 2: sections, size, report card ---------- */
  function stepSetup() {
    const error = h("div");
    const count = h("input.input", {
      id: "sCount", type: "number", min: "0", inputmode: "numeric",
      value: form.studentCount, placeholder: "e.g. 350", oninput: bind("studentCount"),
    });

    const boxes = SECTION_OPTIONS.map(([value, label, hint]) => {
      const cb = h("input", {
        type: "checkbox", checked: form.sections.has(value),
        style: { width: "20px", height: "20px", flex: "none" },
        onchange: (e) => { if (e.target.checked) form.sections.add(value); else form.sections.delete(value); },
      });
      return h("label.u-row", {
        style: { gap: "10px", padding: "10px 12px", border: "1px solid var(--ama-line)", borderRadius: "10px", cursor: "pointer", alignItems: "center" },
      }, cb, h("span.u-grow", {},
        h("span", { style: { fontWeight: "600", display: "block" }, text: label }),
        h("span.u-xs.u-muted", { text: hint })));
    });

    const picker = templatePicker({
      value: form.template,
      school: { name: form.name.trim() || undefined },
      onChange: (v) => { form.template = v; },
    });

    return h("form", { novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      mount(error);
      if (!form.sections.size) return mount(error, inlineAlert("Choose at least one section your school operates."));
      const n = form.studentCount === "" ? null : Number(form.studentCount);
      if (n !== null && (!Number.isInteger(n) || n < 0)) {
        return mount(error, inlineAlert("Enter the number of students as a whole number, or leave it blank."));
      }
      step = 2; draw();
    } },
      error,
      h("fieldset", { style: { border: "0", padding: "0", margin: "0 0 16px" } },
        h("legend", { style: { fontWeight: "600", marginBottom: "8px" }, text: "Which sections does your school operate?" }),
        h("div", { style: { display: "grid", gap: "8px" } }, boxes),
        h("p.u-xs.u-muted", { text: "Only these sections will appear in your portal. You can switch on more later from Academic settings." }),
      ),
      field({
        label: "Approximately how many students does your school have?", id: "sCount", control: count,
        hint: "This helps us plan. Billing is worked out from your actual active students, not from this number.",
      }),
      h("div", { style: { margin: "16px 0 8px", fontWeight: "600" }, text: "Choose your report card" }),
      picker.node,
      h("div.u-row.u-mt-6", {},
        h("button.btn.btn-outline", { type: "button", text: "Back", onclick: () => { step = 0; draw(); } }),
        h("div.u-grow", {}, h("button.btn.btn-primary.btn-block.btn-lg", { type: "submit", text: "Continue" })),
      ),
    );
  }

  /* ---------- Step 3: the subdomain ---------- */
  function stepSlug() {
    const input = h("input.input", {
      id: "slug", value: form.slug, autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    });
    const note = h("div.claim-note", {});
    const submit = h("button.btn.btn-primary.btn-block.btn-lg", { type: "submit", text: "Check and continue" });
    let available = null;
    let timer;

    const evaluate = async () => {
      const slug = toSlug(input.value);
      if (input.value !== slug) input.value = slug;
      form.slug = slug;
      available = null;

      const check = validateSlug(slug);
      if (!check.ok) {
        note.className = "claim-note is-bad";
        note.textContent = check.reason;
        return;
      }
      note.className = "claim-note";
      note.textContent = "Checking availability…";
      try {
        const { data, error } = await supabase.rpc("is_slug_available", { p_slug: slug });
        if (error) throw error;
        available = Boolean(data);
        note.className = `claim-note ${available ? "is-good" : "is-bad"}`;
        note.textContent = available
          ? `${slug}.${ROOT} is available`
          : `${slug}.${ROOT} is already taken. Try another.`;
      } catch (err) {
        logError("is_slug_available", err);
        note.className = "claim-note";
        note.textContent = "Could not check that right now — you can continue and we will confirm when you finish.";
        available = null;
      }
    };

    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(evaluate, 350); });
    setTimeout(evaluate, 0);

    return h("form", { novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      const check = validateSlug(form.slug);
      if (!check.ok) return;
      if (available === false) return;
      step = 3; draw();
    } },
      field({
        label: "Portal address", id: "slug",
        control: h("div.claim-row", {}, input, h("span.affix", { text: `.${ROOT}` })),
      }),
      note,
      h("p.u-small.u-muted.u-mt-4", { text: "Short and memorable works best — staff will type it often. It cannot be changed later without breaking saved links." }),
      h("div.u-row.u-mt-6", {},
        h("button.btn.btn-outline", { type: "button", text: "Back", onclick: () => { step = 1; draw(); } }),
        h("div.u-grow", {}, submit),
      ),
    );
  }

  /* ---------- Step 4: the administrator ---------- */
  function stepAdmin() {
    const name  = h("input.input", { id: "aName", required: true, value: form.adminName, autocomplete: "name", oninput: bind("adminName") });
    const email = h("input.input", { id: "aEmail", type: "email", required: true, value: form.adminEmail, autocomplete: "email", oninput: bind("adminEmail") });
    const phone = h("input.input", { id: "aPhone", type: "tel", value: form.adminPhone, autocomplete: "tel", oninput: bind("adminPhone") });
    const message = h("textarea.textarea", { id: "aMessage", rows: "4", oninput: bind("message") }, form.message);
    const error = h("div");
    const submit = h("button.btn.btn-primary.btn-block.btn-lg", { type: "submit", text: "Submit application" });

    return h("form", { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      mount(error);
      if (!form.adminName.trim()) return mount(error, inlineAlert("Enter the administrator's full name."));
      if (!/^\S+@\S+\.\S+$/.test(form.adminEmail)) return mount(error, inlineAlert("Enter a valid email address for the administrator."));

      setBusy(submit, true, "Submitting…");
      try {
        const created = await createSchool(form);
        renderDone(created);
      } catch (err) {
        logError("register school", err);
        mount(error, inlineAlert(humanError(err, "Registration could not be completed. Try again in a moment.")));
        toastError("Registration failed");
      } finally {
        setBusy(submit, false);
      }
    } },
      error,
      field({ label: "Administrator's full name", id: "aName", control: name }),
      field({ label: "Administrator's email", id: "aEmail", control: email, hint: "Used to sign in and to receive password resets." }),
      field({ label: "Administrator's phone number", id: "aPhone", control: phone, hint: "Optional — useful for onboarding." }),
      field({ label: "Additional information", id: "aMessage", control: message, hint: "Anything else AMA EDU should know about the school or application." }),
      h("p.u-xs.u-muted", { text: "By applying you confirm you are authorised to represent this school. Do not send a password; the administrator account is created after approval." }),
      h("div.u-row.u-mt-4", {},
        h("button.btn.btn-outline", { type: "button", text: "Back", onclick: () => { step = 2; draw(); } }),
        h("div.u-grow", {}, submit),
      ),
    );
  }

  function renderDone({ reference, status }) {
    mount(host,
      h("div.panel", {},
        h("div.panel-head", {},
          h("div.panel-crest", { text: "✓" }),
          h("h1.panel-title", { text: "Application received" }),
          h("p.panel-sub", { text: "Keep this reference. The AMA EDU team will review your application and contact the administrator email supplied." }),
        ),
        h("div.alert.alert-success", {}, h("div", { text: `${reference} · ${status}` })),
        h("a.btn.btn-outline.btn-block.btn-lg.u-mt-4", { href: "/find-school", "data-native": "true", text: "Find a school portal" }),
        h("p.u-small.u-muted.u-mt-4", { text: "Once approved and provisioned, the administrator will receive the live portal address and setup instructions." }),
      ),
      h("div.panel-foot", { text: "Copyright © AMAEdu 2026 All Rights Reserved!" }),
    );
  }
}

/**
 * Registration submits one validated application. Provisioning is deliberately
 * a separate platform-admin action so an anonymous visitor cannot create a
 * live tenant or an administrator login without review.
 */
async function createSchool(form) {
  const { data, error } = await supabase.rpc("submit_school_application", { p_payload: {
    school_name: form.name.trim(), slug: form.slug, school_type: form.type,
    school_email: form.email.trim(), school_phone: form.phone.trim(), address: form.address.trim(),
    ward: form.ward.trim(), lga: form.lga.trim(), state: form.state.trim(), country: form.country.trim() || "Nigeria",
    website: form.website.trim(), registration_number: form.registrationNumber.trim(), admin_phone: form.adminPhone.trim(), message: form.message.trim(),
    sections: [...form.sections], declared_student_count: form.studentCount === "" ? null : Number(form.studentCount),
    report_card_template: form.template, admin_full_name: form.adminName.trim(), admin_email: form.adminEmail.trim(),
  } });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
