/* Two jobs: request a reset link, and set a new password after
   following one. Which one shows depends on whether Supabase put a
   recovery session in the URL. */

import "../styles/marketing.css";
import { h, mount, setBusy } from "../lib/dom.js";
import { field, passwordField, inlineAlert, toastOk } from "../lib/ui.js";
import { requestPasswordReset, changeOwnPassword } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { humanError } from "../lib/errors.js";

export default async function render({ outlet }) {
  document.title = "Reset password — AMA EDU";
  const { data: { session: raw } } = await supabase.auth.getSession();
  const recovering = Boolean(raw) && window.location.hash.includes("type=recovery");
  mount(outlet, h("div.panel-page", {}, recovering ? setNew() : requestLink(),
    h("div.panel-foot", { text: "Copyright © AMAEdu 2026 All Rights Reserved!" })));
}

function requestLink() {
  const email = h("input.input", { id: "rEmail", type: "email", required: true, autocomplete: "email" });
  const note = h("div");
  const submit = h("button.btn.btn-primary.btn-block.u-mt-4", { type: "submit", text: "Email me a reset link" });

  return h("div.panel", {},
    h("div.panel-head", {},
      h("h1.panel-title", { text: "Reset your password" }),
      h("p.panel-sub", { text: "Enter the email address on your account and we will send a link." }),
    ),
    h("form", { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      setBusy(submit, true, "Sending…");
      await requestPasswordReset(email.value);
      setBusy(submit, false);
      // Always the same answer, whether or not the address exists.
      mount(note, inlineAlert("If that address has an account, a reset link is on its way. Check your inbox and spam folder.", "success"));
    } },
      note,
      field({ label: "Email", id: "rEmail", control: email }),
      submit,
    ),
    h("p.u-xs.u-muted.u-center.u-mt-4", { text: "Students and staff who sign in with an ID rather than an email should ask their school administrator for a reset." }),
  );
}

function setNew() {
  const pw = passwordField({ label: "New password", id: "newPw", autocomplete: "new-password", hint: "At least 8 characters." });
  const error = h("div");
  const submit = h("button.btn.btn-primary.btn-block.u-mt-4", { type: "submit", text: "Save new password" });

  return h("div.panel", {},
    h("div.panel-head", {}, h("h1.panel-title", { text: "Choose a new password" })),
    h("form", { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      mount(error);
      if (pw.input.value.length < 8) return mount(error, inlineAlert("Use at least 8 characters."));
      setBusy(submit, true, "Saving…");
      try {
        await changeOwnPassword(pw.input.value);
        toastOk("Password saved");
        window.location.assign("/login");
      } catch (err) {
        mount(error, inlineAlert(humanError(err)));
      } finally { setBusy(submit, false); }
    } },
      error, pw.node, submit,
    ),
  );
}
