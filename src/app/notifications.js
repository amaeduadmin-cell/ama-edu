import { h, mount, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, toastOk, toastError } from "../lib/ui.js";

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin", "headmaster", "principal", "teacher", "registrar_primary", "registrar_secondary", "bursar")) return;
  const body = h("div.u-stack");
  mount(outlet, page({ title: "Notifications", subtitle: "Automated updates about unlock requests and other school actions.", actions: [h("button.btn.btn-outline", { type: "button", text: "Mark all read", onclick: markAllRead })], body }));
  await load();

  async function load() {
    mount(body, h("div.card", {}, h("div.skeleton", { style: { height: "180px" } })));
    try {
      const rows = unwrap(await supabase.from("notifications").select("id,kind,title,body,entity,entity_id,read_at,created_at").order("created_at", { ascending: false }).limit(100), "fetch notifications");
      if (!rows.length) return mount(body, emptyState({ title: "You are all caught up", body: "New unlock decisions will appear here automatically." }));
      mount(body, h("div.u-stack", {}, rows.map((notification) => notificationCard(notification))));
    } catch (err) { logError("notifications", err); mount(body, errorState(humanError(err), load)); }
  }

  function notificationCard(notification) {
    const read = notification.read_at;
    const mark = h("button.btn.btn-ghost.btn-sm", { type: "button", text: read ? "Read" : "Mark read", disabled: Boolean(read) });
    mark.addEventListener("click", async () => { setBusy(mark, true, "Saving…"); try { unwrap(await supabase.rpc("mark_notification_read", { p_notification_id: notification.id }), "mark notification read"); await load(); } catch (err) { toastError(humanError(err)); } finally { setBusy(mark, false); } });
    return h(`article.card${read ? "" : ".notification-unread"}`, {}, h("div.u-row", { style: { justifyContent: "space-between", gap: "12px" } }, h("div", {}, h("div", { style: { fontWeight: "700" }, text: notification.title }), h("div.u-xs.u-muted", { text: new Date(notification.created_at).toLocaleString() })), h(`span.badge.${notification.kind === "success" ? "badge-ok" : notification.kind === "warning" ? "badge-warn" : "badge-info"}`, { text: read ? "Read" : "New" })), h("p", { text: notification.body }), mark);
  }

  async function markAllRead() {
    try {
      const unread = unwrap(await supabase.from("notifications").select("id").is("read_at", null), "fetch unread notifications");
      for (const item of unread) await supabase.rpc("mark_notification_read", { p_notification_id: item.id });
      toastOk("Notifications marked as read"); await load();
    } catch (err) { toastError(humanError(err)); }
  }
}
