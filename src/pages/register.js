/* School self-registration — apex domain only.
   Three steps so a phone user is never facing a fifteen-field form. */

import "../styles/marketing.css";
import { h, mount, setBusy } from "../lib/dom.js";
import { field, passwordField, inlineAlert, toastError } from "../lib/ui.js";
import { toSlug, validateSlug, tenantUrl, ROOT } from "../lib/tenant.js";
import { supabase } from "../lib/supabase.js";
import { humanError, logError } from "../lib/errors.js";

const SCHOOL_TYPES = [
  ["nursery_primary", "Nursery / Primary"],
  ["secondary",       "Secondary (JSS / SS)"],
  ["combined",        "Nursery through Secondary"],
  ["islamiyya",       "Islamiyya / Qur'anic"],
  ["other",           "Other"],
];

export default function render({ outlet }) {
  document.title = "Register a school — AMA EDU";

  const form = {
    name: "", type: "combined", email: "", phone: "", address: "",
    slug: new URLSearchParams(window.location.search).get("slug") || "",
    adminName: "", adminEmail: "", password: "",
  };

  let step = 0;
  const host = h("div.panel-page", {});
  mount(outlet, host);
  draw();

  function draw() {
    mount(host,
      h("a.wordmark", { href: "/", style: { marginBottom: "20px" } }, "AMA ", h("b", { text: "EDU" })),
      h("div.panel.wide", {},
        h("div.steps", { "aria-hidden": "true" },
          [0, 1, 2].map(i => h(`div.step${i <= step ? ".done" : ""}`))),
        h("div.panel-head", {},
          h("h1.panel-title", { text: ["Tell us about the school", "Choose your web address", "Create the administrator account"][step] }),
          h("p.panel-sub", { text: ["This appears on report cards, certificates and the portal itself.", "This is the address your staff, students and parents will use.", "This account can do everything inside your school portal."][step] }),
        ),
        [stepSchool, stepSlug, stepAdmin][step](),
      ),
      h("div.panel-foot", {}, "Already registered? ",
        h("a", { href: "/find-school", text: "Find your school portal" })),
    );
  }

  const bind = (key) => (e) => { form[key] = e.target.value; };

  /* ---------- Step 1: the school ---------- */
  function stepSchool() {
    const name  = h("input.input", { id: "sName", required: true, value: form.name, autocomplete: "organization", oninput: bind("name") });
    const type  = h("select.select", { id: "sType", onchange: bind("type") },
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

  /* ---------- Step 2: the subdomain ---------- */
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
      step = 2; draw();
    } },
      field({
        label: "Portal address", id: "slug",
        control: h("div.claim-row", {}, input, h("span.affix", { text: `.${ROOT}` })),
      }),
      note,
      h("p.u-small.u-muted.u-mt-4", { text: "Short and memorable works best — staff will type it often. It cannot be changed later without breaking saved links." }),
      h("div.u-row.u-mt-6", {},
        h("button.btn.btn-outline", { type: "button", text: "Back", onclick: () => { step = 0; draw(); } }),
        h("div.u-grow", {}, submit),
      ),
    );
  }

  /* ---------- Step 3: the administrator ---------- */
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
        h("button.btn.btn-outline", { type: "button", text: "Back", onclick: () => { step = 1; draw(); } }),
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
  const { data, error } = await supabase.functions.invoke("register-school", {
    body: {
      school: {
        name: form.name.trim(),
        slug: form.slug,
        school_type: form.type,
        email: form.email.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
      },
      admin: {
        full_name: form.adminName.trim(),
        email: form.adminEmail.trim(),
        password: form.password,
      },
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
