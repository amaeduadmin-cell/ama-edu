import { h, mount } from "../lib/dom.js";
import { supabase } from "../lib/supabase.js";
import { platformUrl } from "../lib/tenant.js";

export default async function render({ outlet }) {
  document.title = "Maintenance — AMA EDU";
  const body = h("div.panel-page", {}, h("div.panel", {},
    h("a.wordmark", { href: platformUrl("/") }, "AMA ", h("b", { text: "EDU" })),
    h("div.panel-head", {}, h("div.eyebrow", { text: "AMA EDU" }), h("h1.panel-title", { text: "We’ll be back shortly" }), h("p.panel-sub", { text: "The platform is undergoing maintenance. Your data is safe and access will return when the maintenance window ends." })),
    h("div#maintenanceBody", {}, h("p.u-muted", { text: "Checking maintenance status…" })),
    h("div.panel-foot", {}, h("a", { href: platformUrl("/status"), text: "View system status" })),
  ));
  mount(outlet, body);
  try {
    const { data, error } = await supabase.rpc("public_platform_maintenance");
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (row && !row.enabled) {
      mount(document.getElementById("maintenanceBody"), h("div.alert.alert-info", {}, h("div", { text: "No active maintenance window is currently recorded." }), h("a.btn.btn-outline.btn-sm.u-mt-3", { href: platformUrl("/"), text: "Continue to AMA EDU" })));
    } else if (row) {
      mount(document.getElementById("maintenanceBody"), h("div.card", {}, h("p", { text: row.message }), row.ends_at ? h("p.u-small.u-muted", { text: `Expected end: ${new Date(row.ends_at).toLocaleString()}` }) : null));
    }
  } catch {
    mount(document.getElementById("maintenanceBody"), h("div.alert.alert-error", { text: "Maintenance details are temporarily unavailable." }));
  }
}
