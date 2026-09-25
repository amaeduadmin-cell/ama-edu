import { h, mount, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, field, inlineAlert, openModal, confirmAction, toastOk, toastError } from "../lib/ui.js";
import { session } from "../lib/auth.js";

const CATEGORIES = [["nursery", "Nursery"], ["primary", "Primary"], ["jss", "Junior secondary"], ["ss", "Senior secondary"]];

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin")) return;
  const body = h("div.u-stack");
  mount(outlet, page({
    title: "Class management",
    subtitle: "Create, edit, reorder and deactivate classes without deleting historical records.",
    actions: [h("button.btn.btn-primary", { type: "button", text: "New class", onclick: () => openForm() })],
    body,
  }));
  await load();

  async function load() {
    mount(body, h("div.card", {}, h("div.skeleton", { style: { height: "160px" } })));
    try {
      const rows = unwrap(await supabase.from("classes")
        .select("id,name,category,sort_order,is_graduating,is_active,students(count)")
        .order("sort_order").order("name"), "fetch classes");
      if (!rows.length) return mount(body, emptyState({ title: "No classes", body: "Create the first class for this school." }));
      const headers = ["Class", "Category", "Order", "Graduating", "Students", "Status", ""];
      mount(body, h("div.table-wrap.card.card-flush", {}, h("table.table", {},
        h("thead", {}, h("tr", {}, headers.map((x) => h("th", { text: x })))),
        h("tbody", {}, rows.map((c) => row(c))),
      )));
    } catch (err) {
      logError("class management", err);
      mount(body, errorState(humanError(err), load));
    }
  }

  function row(c) {
    const category = CATEGORIES.find(([value]) => value === c.category)?.[1] || c.category;
    return h("tr", {},
      h("td", { style: { fontWeight: "600" }, text: c.name }),
      h("td", { text: category }),
      h("td.u-num", { text: c.sort_order }),
      h("td", { text: c.is_graduating ? "Yes" : "No" }),
      h("td.u-num", { text: c.students?.[0]?.count ?? 0 }),
      h("td", {}, h(`span.badge.${c.is_active ? "badge-ok" : "badge-warn"}`, { text: c.is_active ? "Active" : "Inactive" })),
      h("td", {}, h("div.u-row", { style: { justifyContent: "flex-end", gap: "6px" } },
        h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Edit", onclick: () => openForm(c) }),
        h("button.btn.btn-outline.btn-sm", { type: "button", text: c.is_active ? "Deactivate" : "Reactivate", onclick: () => toggle(c) }),
      )),
    );
  }

  function openForm(existing = null) {
    const name = h("input.input", { value: existing?.name || "", required: true });
    const category = h("select.select", {}, CATEGORIES.map(([value, label]) => h("option", { value, selected: (existing?.category || "primary") === value, text: label })));
    const order = h("input.input", { type: "number", min: "0", value: existing?.sort_order ?? 0 });
    const graduating = h("input", { type: "checkbox", checked: existing?.is_graduating === true, style: { width: "18px", height: "18px" } });
    const slot = h("div");
    const save = h("button.btn.btn-primary", { type: "button", text: existing ? "Save changes" : "Create class" });
    const close = openModal({
      title: existing ? "Edit class" : "New class",
      body: h("div", {},
        slot,
        field({ label: "Class name", id: "className", control: name }),
        h("div.form-grid.cols-2", {},
          field({ label: "Category", id: "classCategory", control: category }),
          field({ label: "Sort order", id: "classOrder", control: order }),
        ),
        h("label.u-row", {}, graduating, h("span", { text: "Graduating class" })),
      ),
      actions: [h("button.btn.btn-outline", { type: "button", text: "Cancel", onclick: () => close() }), save],
    });
    save.addEventListener("click", async () => {
      if (name.value.trim().length < 2) return mount(slot, inlineAlert("Enter a class name."));
      setBusy(save, true, "Saving…");
      try {
        const payload = { school_id: session.schoolId, name: name.value.trim(), category: category.value, sort_order: Number(order.value) || 0, is_graduating: graduating.checked };
        if (existing) unwrap(await supabase.from("classes").update(payload).eq("id", existing.id), "update class");
        else unwrap(await supabase.from("classes").insert(payload), "create class");
        toastOk(existing ? "Class updated" : "Class created");
        close();
        await load();
      } catch (err) { mount(slot, inlineAlert(humanError(err))); }
      finally { setBusy(save, false); }
    });
  }

  async function toggle(c) {
    const ok = await confirmAction({
      title: `${c.is_active ? "Deactivate" : "Reactivate"} ${c.name}?`,
      message: c.is_active ? "Historical scores remain safe; the class will leave active workflows." : "The class will return to active workflows.",
      confirmLabel: c.is_active ? "Deactivate" : "Reactivate",
      danger: c.is_active,
    });
    if (!ok) return;
    try {
      unwrap(await supabase.from("classes").update({ is_active: !c.is_active }).eq("id", c.id), "toggle class");
      toastOk(c.is_active ? "Class deactivated" : "Class reactivated");
      await load();
    } catch (err) { toastError(humanError(err)); }
  }
}
