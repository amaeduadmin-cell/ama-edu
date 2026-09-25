import { h, mount, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { errorState, inlineAlert, toastOk, toastError, confirmAction, field } from "../lib/ui.js";

const SCOPES = [["school:read", "School profile"], ["students:read", "Students"], ["attendance:read", "Attendance"], ["notifications:read", "Notifications"]];

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin")) return;
  const body = h("div.u-stack");
  mount(outlet, page({ title: "API & integrations", subtitle: "Create scoped API access and deliver school notifications to approved HTTPS webhooks.", body }));
  await load();

  async function load() {
    mount(body, h("div.card", {}, h("div.skeleton", { style: { height: "220px" } })));
    try {
      const [keys, hooks, deliveries] = await Promise.all([
        unwrap(await supabase.from("school_api_keys").select("id,name,key_prefix,scopes,is_active,last_used_at,created_at").order("created_at", { ascending: false }).limit(50), "fetch API keys"),
        unwrap(await supabase.from("webhook_subscriptions").select("id,name,endpoint_url,events,is_active,created_at").order("created_at", { ascending: false }).limit(50), "fetch webhooks"),
        unwrap(await supabase.from("notification_deliveries").select("id,event_name,status,attempts,last_error,created_at,delivered_at,webhook_subscriptions(name)").order("created_at", { ascending: false }).limit(50), "fetch deliveries"),
      ]);
      draw(keys, hooks, deliveries);
    } catch (err) { logError("api access", err); mount(body, errorState(humanError(err), load)); }
  }

  function draw(keys, hooks, deliveries) {
    const name = h("input.input", { placeholder: "e.g. Finance dashboard" });
    const scopeInputs = SCOPES.map(([value, label]) => {
      const input = h("input", { type: "checkbox", value, checked: value === "school:read" });
      return { value, input, node: h("label.u-row", {}, input, h("span", { text: label })) };
    });
    const create = h("button.btn.btn-primary", { type: "button", text: "Create API key" });
    create.onclick = async () => {
      const selected = scopeInputs.filter(x => x.input.checked).map(x => x.value);
      if (!name.value.trim() || !selected.length) return;
      setBusy(create, true, "Creating…");
      try {
        const result = unwrap(await supabase.rpc("create_school_api_key", { p_name: name.value.trim(), p_scopes: selected }), "create API key")[0];
        showToken(result.token); name.value = ""; await load();
      } catch (err) { toastError(humanError(err)); } finally { setBusy(create, false); }
    };

    const hookName = h("input.input", { placeholder: "e.g. Make.com notifications" });
    const endpoint = h("input.input", { type: "url", placeholder: "https://example.com/amaedu/webhook" });
    const hookCreate = h("button.btn.btn-primary", { type: "button", text: "Add webhook" });
    hookCreate.onclick = async () => {
      if (!hookName.value.trim() || !endpoint.value.trim()) return;
      setBusy(hookCreate, true, "Saving…");
      try {
        unwrap(await supabase.rpc("create_webhook_subscription", { p_name: hookName.value.trim(), p_endpoint_url: endpoint.value.trim(), p_events: ["notification.created"] }), "create webhook");
        toastOk("Webhook added"); await load();
      } catch (err) { toastError(humanError(err)); } finally { setBusy(hookCreate, false); }
    };

    const apiCard = h("section.card", {},
      h("div.card-head", {}, h("div", {}, h("h2.card-title", { text: "API keys" }), h("div.card-sub", { text: "The full token is shown once. Store it in your integration's secret manager." })), h("span.badge.badge-info", { text: "Scoped" })),
      inlineAlert("Keys are hashed in the database, revocable by an administrator, and rate-limited to 120 requests per minute per key. Do not paste a key into browser code.", "info"),
      h("div.form-grid.cols-2", {}, field({ label: "Key name", id: "apiKeyName", control: name }), h("div", {}, h("div.u-small.u-muted", { text: "Scopes" }), h("div.u-stack.u-mt-2", {}, ...scopeInputs.map(x => x.node)))),
      h("div.u-row.u-mt-3", {}, create), keyTable(keys));
    const hookCard = h("section.card", {},
      h("div.card-head", {}, h("div", {}, h("h2.card-title", { text: "Webhook integrations" }), h("div.card-sub", { text: "Only HTTPS endpoints are accepted. Delivery payloads contain notification details and are signed by the dispatcher." })), h("span.badge.badge-info", { text: "HTTPS" })),
      h("div.form-grid.cols-2", {}, field({ label: "Integration name", id: "hookName", control: hookName }), field({ label: "HTTPS endpoint", id: "hookEndpoint", control: endpoint })),
      h("div.u-row.u-mt-3", {}, hookCreate), webhookTable(hooks));
    const deliveryCard = h("section.card", {}, h("div.card-head", {}, h("div", {}, h("h2.card-title", { text: "Recent deliveries" }), h("div.card-sub", { text: "The dispatcher retries failures with exponential backoff and marks exhausted jobs failed." })), deliveryTable(deliveries)));
    mount(body, apiCard, hookCard, deliveryCard);
  }

  function keyTable(keys) {
    return keys.length ? h("div.table-wrap.u-mt-4", {}, h("table.table", {}, h("thead", {}, h("tr", {}, ["Name", "Prefix", "Scopes", "Last used", "Status", "Action"].map(x => h("th", { text: x })))), h("tbody", {}, keys.map(keyRow)))) : h("p.u-small.u-muted.u-mt-3", { text: "No API keys created yet." });
  }
  function keyRow(key) {
    const revoke = h("button.btn.btn-outline.btn-sm", { type: "button", text: key.is_active ? "Revoke" : "Revoked", disabled: !key.is_active });
    revoke.onclick = async () => { if (!await confirmAction({ title: "Revoke API key?", message: "Any integration using this key will stop working immediately.", confirmLabel: "Revoke", danger: true })) return; try { unwrap(await supabase.rpc("revoke_school_api_key", { p_id: key.id }), "revoke API key"); toastOk("API key revoked"); await load(); } catch (err) { toastError(humanError(err)); } };
    return h("tr", {}, h("td", { text: key.name }), h("td.u-xs", { text: key.key_prefix }), h("td.u-xs", { text: (key.scopes || []).join(", ") }), h("td.u-xs", { text: key.last_used_at ? new Date(key.last_used_at).toLocaleString() : "Never" }), h("td", {}, h(`span.badge.${key.is_active ? "badge-ok" : "badge-info"}`, { text: key.is_active ? "Active" : "Revoked" })), h("td", {}, revoke));
  }
  function webhookTable(hooks) {
    return hooks.length ? h("div.table-wrap.u-mt-4", {}, h("table.table", {}, h("thead", {}, h("tr", {}, ["Name", "Endpoint", "Events", "Status", "Action"].map(x => h("th", { text: x })))), h("tbody", {}, hooks.map(hook => {
      const disconnect = h("button.btn.btn-outline.btn-sm", { type: "button", text: hook.is_active ? "Disconnect" : "Disconnected", disabled: !hook.is_active });
      disconnect.onclick = async () => { if (!await confirmAction({ title: "Disconnect webhook?", message: "New notifications will stop being delivered to this endpoint.", confirmLabel: "Disconnect", danger: true })) return; try { unwrap(await supabase.rpc("revoke_webhook_subscription", { p_id: hook.id }), "disconnect webhook"); toastOk("Webhook disconnected"); await load(); } catch (err) { toastError(humanError(err)); } };
      return h("tr", {}, h("td", { text: hook.name }), h("td.u-xs", { text: hook.endpoint_url }), h("td.u-xs", { text: (hook.events || []).join(", ") }), h("td", {}, h(`span.badge.${hook.is_active ? "badge-ok" : "badge-info"}`, { text: hook.is_active ? "Active" : "Inactive" })), h("td", {}, disconnect));
    })))) : h("p.u-small.u-muted.u-mt-3", { text: "No webhook integrations configured." });
  }
  function deliveryTable(deliveries) {
    if (!deliveries.length) return h("p.u-small.u-muted.u-mt-4", { text: "No notification deliveries yet." });
    const head = h("thead", {}, h("tr", {}, ["Integration", "Event", "Status", "Attempts", "Created", "Error"].map(x => h("th", { text: x }))));
    const rows = deliveries.map(d => {
      const badge = h(`span.badge.${d.status === "sent" ? "badge-ok" : d.status === "failed" ? "badge-warn" : "badge-info"}`, { text: d.status });
      return h("tr", {}, h("td", { text: d.webhook_subscriptions?.name || "—" }), h("td", { text: d.event_name }), h("td", {}, badge), h("td.u-num", { text: d.attempts }), h("td.u-xs", { text: new Date(d.created_at).toLocaleString() }), h("td.u-xs", { text: d.last_error || "—" }));
    });
    return h("div.table-wrap.u-mt-4", {}, h("table.table", {}, head, h("tbody", {}, rows)));
  }
  function showToken(token) {
    const modal = h("div.modal-backdrop", {});
    const copy = h("button.btn.btn-outline", { type: "button", text: "Copy token" });
    copy.onclick = async () => { await navigator.clipboard?.writeText(token); toastOk("Token copied"); };
    const close = h("button.btn.btn-primary", { type: "button", text: "I saved it", onclick: () => modal.remove() });
    mount(modal, h("div.modal", {}, h("h2", { text: "Save this API token now" }), h("p", { text: "For security, AMA EDU will not show this complete token again." }), h("pre", { text: token, style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }), h("div.u-row.u-mt-3", {}, copy, close)));
    document.body.append(modal);
  }
}
