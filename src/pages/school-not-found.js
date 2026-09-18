/* Shown when a subdomain resolves to no active school. */

import "../styles/marketing.css";
import { h, mount } from "../lib/dom.js";
import { platformUrl, ROOT } from "../lib/tenant.js";

export default function render({ outlet, params }) {
  const { slug, networkProblem } = params || {};
  document.title = "School not found — AMA EDU";

  mount(outlet,
    h("div.panel-page", {},
      h("div.panel", {},
        h("div.panel-head", {},
          h("div.panel-crest", { "aria-hidden": "true", text: "?" }),
          h("h1.panel-title", { text: networkProblem ? "Cannot reach AMA EDU" : "No school at this address" }),
          h("p.panel-sub", {
            text: networkProblem
              ? "Your connection dropped while the portal was loading. Check your internet and reload."
              : `${slug || "This address"}.${ROOT} is not registered, or the school's portal has been closed.`,
          }),
        ),
        networkProblem
          ? h("button.btn.btn-primary.btn-block", { type: "button", text: "Reload", onclick: () => window.location.reload() })
          : h("div.u-stack", {},
              h("a.btn.btn-primary.btn-block", { href: platformUrl("/find-school"), "data-native": "true", text: "Find my school" }),
              h("a.btn.btn-outline.btn-block", { href: platformUrl("/register"), "data-native": "true", text: "Register a school" }),
            ),
      ),
      h("div.panel-foot", { text: "Copyright © AMAEdu 2026 All Rights Reserved!" }),
    ));
}

/** A registered school the platform has deactivated (unpaid, closed, or suspended). */
export function renderSuspended({ outlet, school }) {
  document.title = `${school?.name || "School"} — unavailable`;
  mount(outlet,
    h("div.panel-page", {},
      h("div.panel", {},
        h("div.panel-head", {},
          h("h1.panel-title", { text: `${school?.name || "This portal"} is not available` }),
          h("p.panel-sub", { text: "The portal has been paused. Your school's administrator can contact AMA EDU support to restore it. No data has been deleted." }),
        ),
        h("a.btn.btn-outline.btn-block", { href: "mailto:support@amaedu.com.ng", "data-native": "true", text: "Email support" }),
      ),
      h("div.panel-foot", { text: "Copyright © AMAEdu 2026 All Rights Reserved!" }),
    ));
}
