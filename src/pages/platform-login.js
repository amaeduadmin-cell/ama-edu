/* AMA EDU platform administrator sign-in (apex domain). */

import "../styles/marketing.css";
import { h, mount, setBusy } from "../lib/dom.js";
import { field, passwordField, inlineAlert } from "../lib/ui.js";
import { signInPlatform } from "../lib/auth.js";
import { humanError } from "../lib/errors.js";
import { navigate } from "../lib/router.js";

export default function render({ outlet }) {
  document.title = "Platform sign in — AMA EDU";

  const email = h("input.input", { id: "pEmail", type: "email", required: true, autocomplete: "email" });
  const pw = passwordField({ label: "Password", id: "pPass" });
  const error = h("div");
  const submit = h("button.btn.btn-primary.btn-block.btn-lg.u-mt-4", { type: "submit", text: "Sign in" });

  mount(outlet,
    h("div.panel-page", {},
      h("a.wordmark", { href: "/", style: { marginBottom: "20px" } }, "AMA ", h("b", { text: "EDU" })),
      h("div.panel", {},
        h("div.panel-head", {},
          h("h1.panel-title", { text: "Platform sign in" }),
          h("p.panel-sub", { text: "For AMA EDU staff. School administrators sign in at their own school address." }),
        ),
        h("form", { novalidate: true, onsubmit: async (e) => {
          e.preventDefault();
          mount(error);
          setBusy(submit, true, "Signing in…");
          try {
            await signInPlatform({ email: email.value, password: pw.input.value });
            navigate("/admin");
          } catch (err) {
            mount(error, inlineAlert(humanError(err)));
          } finally { setBusy(submit, false); }
        } },
          error,
          field({ label: "Email", id: "pEmail", control: email }),
          pw.node,
          submit,
        ),
      ),
      h("div.panel-foot", {}, "Looking for your school? ",
        h("a", { href: "/find-school", text: "Find your portal" })),
    ));
}
