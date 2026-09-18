/* Classes — pick a class, then enter scores for one subject at a time.
   Ports: renderClasses (MyPAS1 app-tabs.js). Which classes a teacher
   sees isn't filtered here — it's whatever their RLS-scoped subject
   assignments let them mark, shown per-class on this page. */

import { h, mount, skeleton } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState } from "../lib/ui.js";
import { fetchActiveTerm } from "../lib/data.js";

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin", "headmaster", "principal", "teacher")) return;

  const body = h("div.u-stack");
  const term = await fetchActiveTerm().catch(() => null);
  mount(outlet, page({
    title: "Classes & scores",
    subtitle: term ? `Active term: ${term.label}, ${term.sessions?.label || ""}` : "No active term is set for this school yet.",
    body,
  }));

  mount(body, h("div.stat-grid", {}, Array.from({ length: 4 }, () => h("div.skeleton", { style: { height: "72px" } }))));

  try {
    const rows = unwrap(
      await supabase.from("classes")
        .select("id, name, category, sort_order, students(count)")
        .eq("is_active", true)
        .order("sort_order"),
      "fetch classes"
    );
    if (!rows.length) {
      return mount(body, emptyState({ title: "No classes yet", body: "Add classes from Settings before entering scores." }));
    }
    mount(body, h("div.stat-grid", {}, rows.map((c) =>
      h("a.stat", { href: `/classes/${c.id}`, style: { textDecoration: "none", color: "inherit" } },
        h("div.card-title", { text: c.name }),
        h("div.stat-label", { text: `${c.students?.[0]?.count ?? 0} students · ${categoryLabel(c.category)}` }),
      ))));
  } catch (err) {
    logError("classes list", err);
    mount(body, errorState(humanError(err)));
  }
}

function categoryLabel(cat) {
  return { nursery: "Nursery", primary: "Primary", jss: "Junior secondary", ss: "Senior secondary" }[cat] || cat;
}
