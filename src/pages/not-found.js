import "../styles/marketing.css";
import { h, mount } from "../lib/dom.js";
import { context } from "../main.js";

export default function render({ outlet }) {
  document.title = "Page not found — AMA EDU";
  const home = context.tenantSlug ? "/dashboard" : "/";
  mount(outlet,
    h("div.panel-page", {},
      h("div.panel", {},
        h("div.panel-head", {},
          h("div.panel-crest", { "aria-hidden": "true", text: "404" , style: { fontSize: "18px" } }),
          h("h1.panel-title", { text: "That page does not exist" }),
          h("p.panel-sub", { text: "The link may be out of date, or the page may have moved." }),
        ),
        h("a.btn.btn-primary.btn-block", { href: home, text: context.tenantSlug ? "Go to dashboard" : "Go to the home page" }),
      ),
      h("div.panel-foot", { text: "Copyright © AMAEdu 2026 All Rights Reserved!" }),
    ));
}
