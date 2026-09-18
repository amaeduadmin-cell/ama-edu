import "../styles/marketing.css";
import { h, mount } from "../lib/dom.js";
import { signOut, session } from "../lib/auth.js";

export default function render({ outlet }) {
  document.title = "No access — AMA EDU";
  mount(outlet,
    h("div.panel-page", {},
      h("div.panel", {},
        h("div.panel-head", {},
          h("h1.panel-title", { text: "You do not have access to that" }),
          h("p.panel-sub", { text: session.authed
            ? "Your account does not include this area. If you think that is wrong, ask your school administrator to check your role."
            : "Sign in to continue." }),
        ),
        h("div.u-stack", {},
          h("a.btn.btn-primary.btn-block", { href: "/dashboard", text: "Back to dashboard" }),
          h("button.btn.btn-ghost.btn-block", { type: "button", text: "Sign out", onclick: () => signOut() }),
        ),
      ),
      h("div.panel-foot", { text: "Copyright © AMAEdu 2026 All Rights Reserved!" }),
    ));
}
