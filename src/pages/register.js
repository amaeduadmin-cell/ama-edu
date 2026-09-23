/* School self-registration — apex domain only.
   Three steps so a phone user is never facing a fifteen-field form. */

import "../styles/marketing.css";
import { h, mount, setBusy } from "../lib/dom.js";
import { field, passwordField, inlineAlert, toastError } from "../lib/ui.js";
import { toSlug, validateSlug, tenantUrl, ROOT } from "../lib/tenant.js";
import { supabase } from "../lib/supabase.js";
import { humanError, logError } from "../lib/errors.js";
import { invokeFunction } from "../lib/functions.js";
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
    name: "", type: "combined", email: "", phone: "", address: "",
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
          h("h1.panel-title", { text: ["Tell us about the school", "Sections and report card", "Choose your web address", "Create the administrator account"][step] }),
          h("p.panel-sub", { text: ["This appears on report cards, certificates and the portal itself.", "Tell us which sections you run, so your portal only shows what applies to you.", "This is the address your staff, students and parents will use.", "This account can do everything inside your school portal."][step] }),
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
    const pw = passwordField({ label: "Password", id: "aPass", autocomplete: "new-password", hint: "At least 8 characters. You can change it later from Settings." });
    const error = h("div");
    const submit = h("button.btn.btn-primary.btn-block.btn-lg", { type: "submit", text: "Create school portal" });

    return h("form", { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      mount(error);
      form.password = pw.input.value;

      if (!form.adminName.trim()) return mount(error, inlineAlert("Enter the administrator's full name."));
      if (!/^\S+@\S+\.\S+$/.test(form.adminEmail)) return mount(error, inlineAlert("Enter a valid email address for the administrator."));
      if (form.password.length < 8) return mount(error, inlineAlert("Choose a password of at least 8 characters."));

      setBusy(submit, true, "Creating your portal…");
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
      pw.node,
      h("p.u-xs.u-muted", { text: "By registering you confirm you are authorised to create a portal for this school." }),
      h("div.u-row.u-mt-4", {},
        h("button.btn.btn-outline", { type: "button", text: "Back", onclick: () => { step = 2; draw(); } }),
        h("div.u-grow", {}, submit),
      ),
    );
  }

  function renderDone({ slug }) {
    const url = tenantUrl(slug, "/login");
    mount(host,
      h("div.panel", {},
        h("div.panel-head", {},
          h("div.panel-crest", { text: "✓" }),
          h("h1.panel-title", { text: "Your portal is ready" }),
          h("p.panel-sub", { text: "Sign in with the administrator email and password you just set." }),
        ),
        h("div.alert.alert-success", {}, h("div", { text: `${slug}.${ROOT}` })),
        h("a.btn.btn-primary.btn-block.btn-lg.u-mt-4", { href: url, "data-native": "true", text: "Open my school portal" }),
        h("p.u-small.u-muted.u-mt-4", { text: "Next: add your classes and subjects, then your staff, then your students. Bulk Import takes a pasted CSV if you already have rosters." }),
      ),
      h("div.panel-foot", { text: "Copyright © AMAEdu 2026 All Rights Reserved!" }),
    );
  }
}

/**
 * Registration is a single server-side transaction, not a sequence of
 * browser calls: the school row, the administrator's auth account, the
 * staff record linking them, and the school's default session/terms and
 * grading setup all succeed together or none of them do. Doing it from
 * the client would leave half-built schools behind whenever a phone
 * dropped signal midway.
 */
async function createSchool(form) {
  // invokeFunction keeps the function's own message (for example "That web
  // address is already taken") instead of the generic non-2xx text.
  return invokeFunction("register-school", {
    school: {
      name: form.name.trim(),
      slug: form.slug,
      school_type: form.type,
      email: form.email.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      sections: [...form.sections],
      declared_student_count: form.studentCount === "" ? null : Number(form.studentCount),
      report_card_template: form.template,
    },
    admin: {
      full_name: form.adminName.trim(),
      email: form.adminEmail.trim(),
      password: form.password,
    },
  });
}
