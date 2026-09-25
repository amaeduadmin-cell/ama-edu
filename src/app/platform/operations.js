import { h, mount, setBusy } from "../../lib/dom.js";
import { page } from "../shell.js";
import { supabase } from "../../lib/supabase.js";
import { unwrap, humanError, logError } from "../../lib/errors.js";
import { errorState, field, inlineAlert, toastOk, toastError } from "../../lib/ui.js";
import { session } from "../../lib/auth.js";

export default async function render({ outlet }) {
  if (!session.isPlatformAdmin) return mount(outlet, page({ title: "No access", body: inlineAlert("Platform administrators only.") }));
  const body = h("div.u-stack");
  mount(outlet, page({ title: "Operations", subtitle: "Control maintenance, service health, billing plans, and platform alerts.", body }));
  mount(body, h("div.card", {}, h("p.u-muted", { text: "Loading operations…" })));
  try {
    const [maintenance, services, plans, alerts] = await Promise.all([
      unwrap(await supabase.from("platform_maintenance").select("*").eq("id", true).limit(1), "maintenance"),
      unwrap(await supabase.from("platform_service_status").select("*").order("sort_order"), "service status"),
      unwrap(await supabase.from("billing_plans").select("id,name,school_type,currency,base_price,price_per_student,billing_period,grace_days,is_active,effective_from").order("created_at", { ascending: false }), "billing plans"),
      unwrap(await supabase.from("platform_alerts").select("id,category,severity,message,created_at").is("resolved_at", null).order("created_at", { ascending: false }).limit(20), "alerts"),
    ]);
    draw({ maintenance: maintenance?.[0] || {}, services: services || [], plans: plans || [], alerts: alerts || [] });
  } catch (err) { logError("platform operations", err); mount(body, errorState(humanError(err))); }

  function draw(state) {
    const maintenanceEnabled = h("input", { type: "checkbox", checked: state.maintenance.enabled === true });
    const message = h("textarea.input", { rows: "3" }, state.maintenance.message || "AMA EDU is undergoing scheduled maintenance.");
    const saveMaintenance = h("button.btn.btn-primary.btn-sm", { type: "button", text: "Save maintenance" });
    saveMaintenance.onclick = async () => {
      setBusy(saveMaintenance, true, "Saving…");
      try {
        unwrap(await supabase.from("platform_maintenance").update({ enabled: maintenanceEnabled.checked, message: message.value.trim() || "AMA EDU is undergoing scheduled maintenance.", updated_at: new Date().toISOString(), updated_by: session.userId }).eq("id", true), "save maintenance");
        toastOk("Maintenance settings saved");
      } catch (err) { toastError(humanError(err)); } finally { setBusy(saveMaintenance, false); }
    };
    mount(body,
      h("div.card", {}, h("h2.card-title", { text: "Maintenance" }), inlineAlert("This controls the recorded maintenance state. Edge-level interception still needs to be configured at Cloudflare for traffic-wide enforcement.", "info"), h("label.u-row", { style: { gap: "8px", margin: "12px 0" } }, maintenanceEnabled, h("span", { text: "Maintenance enabled" })), field({ label: "Message", id: "maintenanceMessage", control: message }), saveMaintenance),
      h("div.card", {}, h("h2.card-title", { text: "Service status" }), state.services.map(serviceRow)),
      planForm(state.plans),
      h("div.card", {}, h("h2.card-title", { text: "Open alerts" }), state.alerts.length ? state.alerts.map(alert => h("div.alert.alert-warn.u-mb-3", {}, h("strong", { text: `${alert.category} · ${alert.severity}` }), h("div", { text: alert.message }), h("div.u-xs.u-muted", { text: new Date(alert.created_at).toLocaleString() }))) : h("p.u-muted", { text: "No open alerts recorded." })),
    );
  }

  function planForm(plans) {
    const name = h("input.input", { required: true, placeholder: "Standard" });
    const schoolType = h("select.select", {}, ["all", "private", "public", "government", "ngo", "other"].map(value => h("option", { value, text: value })));
    const base = h("input.input", { type: "number", min: "0", step: "0.01", value: "0" });
    const perStudent = h("input.input", { type: "number", min: "0", step: "0.01", value: "0" });
    const period = h("select.select", {}, ["monthly", "termly", "annually"].map(value => h("option", { value, text: value })));
    const grace = h("input.input", { type: "number", min: "0", max: "90", value: "7" });
    const note = h("div");
    const save = h("button.btn.btn-primary.btn-sm", { type: "button", text: "Create plan" });
    save.onclick = async () => {
      if (!name.value.trim()) return mount(note, inlineAlert("Enter a plan name."));
      setBusy(save, true, "Creating…");
      try {
        unwrap(await supabase.from("billing_plans").insert({ name: name.value.trim(), school_type: schoolType.value, base_price: Number(base.value || 0), price_per_student: Number(perStudent.value || 0), billing_period: period.value, grace_days: Number(grace.value || 0), is_active: true }), "create billing plan");
        toastOk("Billing plan created");
        window.location.reload();
      } catch (err) { mount(note, inlineAlert(humanError(err))); } finally { setBusy(save, false); }
    };
    return h("div.card", {}, h("h2.card-title", { text: "Billing plans" }), plans.length ? h("div.table-wrap", {}, h("table.table", {}, h("thead", {}, h("tr", {}, h("th", { text: "Plan" }), h("th", { text: "School type" }), h("th", { text: "Base" }), h("th", { text: "Per student" }), h("th", { text: "Period" }), h("th", { text: "Active" }))), h("tbody", {}, plans.map(plan => h("tr", {}, h("td", { text: plan.name }), h("td", { text: plan.school_type }), h("td", { text: `${plan.currency} ${plan.base_price}` }), h("td", { text: `${plan.currency} ${plan.price_per_student}` }), h("td", { text: plan.billing_period }), h("td", { text: plan.is_active ? "Yes" : "No" })))))) : h("p.u-muted", { text: "No billing plans configured yet. Create the first plan below." }), h("h3.card-title.u-mt-6", { text: "Create a plan" }), h("div.form-grid.cols-2", {}, field({ label: "Plan name", id: "planName", control: name }), field({ label: "School type", id: "planType", control: schoolType }), field({ label: "Base price", id: "planBase", control: base }), field({ label: "Price per student", id: "planStudent", control: perStudent }), field({ label: "Billing period", id: "planPeriod", control: period }), field({ label: "Grace days", id: "planGrace", control: grace })), note, save);
  }

  function serviceRow(service) {
    const status = h("select.select", {}, ["operational", "degraded", "partial_outage", "major_outage", "maintenance"].map(value => h("option", { value, selected: value === service.status, text: value.replaceAll("_", " ") })));
    const save = h("button.btn.btn-outline.btn-sm", { type: "button", text: "Save" });
    save.onclick = async () => {
      setBusy(save, true, "Saving…");
      try { unwrap(await supabase.from("platform_service_status").update({ status: status.value, checked_at: new Date().toISOString() }).eq("service_key", service.service_key), "save service status"); toastOk(`${service.label} status saved`); } catch (err) { toastError(humanError(err)); } finally { setBusy(save, false); }
    };
    return h("div.u-row.u-wrap", { style: { justifyContent: "space-between", gap: "12px", padding: "8px 0", borderBottom: "1px solid var(--ama-line)" } }, h("strong", { text: service.label }), h("div.u-row", {}, status, save));
  }
}
