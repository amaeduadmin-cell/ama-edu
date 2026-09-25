import { h, mount } from "../lib/dom.js";
import { supabase } from "../lib/supabase.js";
import { platformUrl } from "../lib/tenant.js";

const LABELS = {
  operational: "Operational", degraded: "Degraded performance", partial_outage: "Partial outage",
  major_outage: "Major outage", maintenance: "Maintenance",
};

export default async function render({ outlet }) {
  document.title = "System status — AMA EDU";
  const body = h("div.panel-page", {}, h("div.panel.wide", {},
    h("a.wordmark", { href: platformUrl("/") }, "AMA ", h("b", { text: "EDU" })),
    h("div.panel-head", {}, h("h1.panel-title", { text: "System status" }), h("p.panel-sub", { text: "Current operational status for AMA EDU services." })),
    h("div#statusBody", {}, h("p.u-muted", { text: "Checking services…" })),
    h("div.panel-foot", {}, h("a", { href: platformUrl("/"), text: "Back to AMA EDU" })),
  ));
  mount(outlet, body);
  try {
    const { data, error } = await supabase.rpc("public_service_status");
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    mount(document.getElementById("statusBody"), rows.map((service) => h("section.card.u-mb-3", {},
      h("div.u-row", { style: { justifyContent: "space-between", gap: "16px" } },
        h("div", {}, h("h2.card-title", { text: service.label }), service.message ? h("p.card-sub", { text: service.message }) : null),
        h(`span.badge.${service.status === "operational" ? "badge-ok" : service.status === "major_outage" ? "badge-danger" : "badge-warn"}`, { text: LABELS[service.status] || service.status }),
      ),
      h("div.u-xs.u-muted", { text: `Last checked: ${service.checked_at ? new Date(service.checked_at).toLocaleString() : "Not available"}` }),
    )));
  } catch {
    mount(document.getElementById("statusBody"), h("div.alert.alert-error", { text: "The status service is temporarily unavailable." }));
  }
}
