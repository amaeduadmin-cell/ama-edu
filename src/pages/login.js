/* School portal sign-in. Rendered on <slug>.amaedu.com.ng/login. */

import "../styles/marketing.css";
import { h, mount, setBusy, safeUrl } from "../lib/dom.js";
import { field, passwordField, inlineAlert } from "../lib/ui.js";
import { signIn } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { humanError, logError } from "../lib/errors.js";
import { context, landingRouteFor } from "../main.js";
import { navigate } from "../lib/router.js";

export default async function render({ outlet }) {
  const school = context.school;
  document.title = `Sign in — ${school?.name || "AMA EDU"}`;

  let mode = "staff";
  const host = h("div.panel-page", {});
  mount(outlet, host);
  draw();

  function draw() {
    mount(host,
      h("div.panel", {},
        h("div.panel-head", {}, crest(school),
          h("h1.panel-title", { text: school?.name || "School portal" }),
          school?.motto ? h("p.panel-sub", { text: school.motto }) : null,
        ),
        h("div.seg", { role: "tablist" },
          h(`button${mode === "staff" ? ".active" : ""}`, {
            type: "button", role: "tab", "aria-selected": String(mode === "staff"),
            text: "Staff", onclick: () => { mode = "staff"; draw(); },
          }),
          h(`button${mode === "student" ? ".active" : ""}`, {
            type: "button", role: "tab", "aria-selected": String(mode === "student"),
            text: "Student", onclick: () => { mode = "student"; draw(); },
          }),
        ),
        mode === "staff" ? staffForm() : studentForm(),
      ),
      h("div.panel-foot", {},
        h("div", { text: "Copyright © AMAEdu 2026 All Rights Reserved!" })),
    );
  }

  function crest(school) {
    const url = safeUrl(school?.logo_url);
    if (url) return h("img.panel-crest", { src: url, alt: "", loading: "eager" });
    const initials = (school?.name || "AMA EDU").split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
    return h("div.panel-crest", { "aria-hidden": "true", text: initials });
  }

  function staffForm() {
    const code = h("input.input", { id: "staffCode", required: true, autocomplete: "username", autocapitalize: "characters" });
    const pw = passwordField({ label: "Password", id: "staffPw" });
    const error = h("div");
    const submit = h("button.btn.btn-primary.btn-block.btn-lg.u-mt-4", { type: "submit", text: "Sign in" });

    return h("form", { novalidate: true, onsubmit: (e) => attempt(e, submit, error, {
      kind: "staff", identifier: code.value, password: pw.input.value,
    }) },
      error,
      field({ label: "Staff ID", id: "staffCode", control: code, hint: "Given to you by your school administrator." }),
      pw.node,
      submit,
      h("p.u-xs.u-muted.u-center.u-mt-4", { text: "Forgotten your password? Your school administrator can reset it for you." }),
    );
  }

  function studentForm() {
    const adm = h("input.input", { id: "adm", required: true, autocomplete: "username", autocapitalize: "characters" });
    const cls = h("select.select", { id: "cls", required: true },
      h("option", { value: "", text: "Loading classes…" }));
    const pw = passwordField({ label: "Password", id: "stuPw" });
    const error = h("div");
    const submit = h("button.btn.btn-primary.btn-block.btn-lg.u-mt-4", { type: "submit", text: "Sign in" });

    // Class names are the only thing readable before sign-in, and only
    // for this school — see the public_school_classes RPC.
    loadClasses(cls);

    return h("form", { novalidate: true, onsubmit: (e) => attempt(e, submit, error, {
      kind: "student", identifier: adm.value, password: pw.input.value, classId: cls.value || null,
    }) },
      error,
      field({ label: "Admission number", id: "adm", control: adm }),
      field({ label: "Class", id: "cls", control: cls }),
      pw.node,
      submit,
    );
  }

  async function loadClasses(select) {
    try {
      const { data, error } = await supabase.rpc("public_school_classes", { p_school_id: school.id });
      if (error) throw error;
      mount(select,
        h("option", { value: "", text: "Select your class" }),
        (data || []).map(c => h("option", { value: c.id, text: c.name })));
    } catch (err) {
      logError("public_school_classes", err);
      mount(select, h("option", { value: "", text: "Classes unavailable — reload the page" }));
    }
  }

  async function attempt(event, submit, errorSlot, payload) {
    event.preventDefault();
    mount(errorSlot);
    if (payload.kind === "student" && !payload.classId) {
      return mount(errorSlot, inlineAlert("Choose your class."));
    }
    setBusy(submit, true, "Signing in…");
    try {
      await signIn({ schoolId: school.id, schoolSlug: school.slug, ...payload });
      navigate(landingRouteFor());
    } catch (err) {
      mount(errorSlot, inlineAlert(humanError(err, "Sign in failed. Try again.")));
    } finally {
      setBusy(submit, false);
    }
  }
}
