/* ===============================================================
   AMA EDU platform console — all schools, search, activate/suspend.
   No MyPAS1 equivalent.
   =============================================================== */

import "../../styles/marketing.css";
import { h, mount, skeleton, setBusy } from "../../lib/dom.js";
import { supabase } from "../../lib/supabase.js";
import { unwrap, humanError, logError } from "../../lib/errors.js";
import { emptyState, errorState, footerNote, confirmAction, toastOk, toastError } from "../../lib/ui.js";
import { signOut } from "../../lib/auth.js";
import { tenantUrl } from "../../lib/tenant.js";
import { fmtDate } from "../../lib/data.js";

export default async function render({ outlet }) {
  document.title = "Schools — AMA EDU console";
  const state = { schools: [], search: "", status: "" };
  const body = h("div.shell-width", { style: { paddingBlock: "24px" } });
  mount(outlet, h("div", {}, topbar(), body, footerNote()));

  await load();

  async function load() {
    mount(body, skeleton(6));
    try {
      state.schools = unwrap(
        await supabase.from("schools").select("id, name, slug, status, school_type, created_at").order("created_at", { ascending: false }),
        "fetch schools"
      );
      draw();
    } catch (err) {
      logError("schools list", err);
      mount(body, errorState(humanError(err), load));
    }
  }

  function filtered() {
    const term = state.search.trim().toLowerCase();
    return state.schools.filter((s) => {
      if (state.status && s.status !== state.status) return false;
      if (!term) return true;
      return s.name.toLowerCase().includes(term) || s.slug.toLowerCase().includes(term);
    });
  }

  function draw() {
    const rows = filtered();
    mount(body,
      h("div.page-head", {}, h("h1", { text: "Schools" }), h("div.card-sub", { text: `${state.schools.length} registered` })),
      h("div.card.card-flush", {},
        h("div.u-row.u-wrap", { style: { padding: "16px", borderBottom: "1px solid var(--ama-line)" } },
          h("input.input.u-grow", { type: "search", placeholder: "Search by name or address", value: state.search, oninput: (e) => { state.search = e.target.value; draw(); } }),
          h("select.select", { style: { maxWidth: "160px" }, onchange: (e) => { state.status = e.target.value; draw(); } },
            h("option", { value: "", text: "All statuses" }),
            ["active", "pending", "suspended", "closed"].map((s) => h("option", { value: s, selected: s === state.status, text: s[0].toUpperCase() + s.slice(1) }))),
        ),
        rows.length ? table(rows) : h("div", { style: { padding: "16px" } }, emptyState({ title: "No schools match", body: "Try a different search or status." })),
      ),
    );
  }

  function table(rows) {
    return h("div.table-wrap", {}, h("table.table", {},
      h("thead", {}, h("tr", {}, h("th", { text: "School" }), h("th", { text: "Address" }), h("th", { text: "Status" }), h("th", { text: "Registered" }), h("th", { text: "" }))),
      h("tbody", {}, rows.map((s) => h("tr", {},
        h("td", {}, h("a", { href: `/admin/schools/${s.id}`, style: { fontWeight: "600", textDecoration: "none", color: "inherit" }, text: s.name })),
        h("td", {}, h("a.u-xs", { href: tenantUrl(s.slug, "/"), target: "_blank", rel: "noopener", text: `${s.slug}.amaedu.com.ng` })),
        h("td", {}, statusBadge(s.status)),
        h("td.u-xs.u-muted", { text: fmtDate(s.created_at) }),
        h("td", {}, actionsFor(s)),
      ))),
    ));
  }

  function actionsFor(s) {
    if (s.status === "active") return h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Suspend", onclick: () => setStatus(s, "suspended") });
    if (s.status === "suspended" || s.status === "pending") return h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Activate", onclick: () => setStatus(s, "active") });
    return null;
  }

  async function setStatus(school, status) {
    const ok = await confirmAction({
      title: `${status === "active" ? "Activate" : "Suspend"} ${school.name}?`,
      message: status === "suspended"
        ? "Its portal will show a paused message and staff, students and parents will not be able to sign in. No data is deleted."
        : "Its portal becomes reachable again immediately.",
      confirmLabel: status === "active" ? "Activate" : "Suspend",
      danger: status === "suspended",
    });
    if (!ok) return;
    try {
      unwrap(await supabase.from("schools").update({ status }).eq("id", school.id), "update school status");
      toastOk("Updated");
      await load();
    } catch (err) { toastError(humanError(err)); }
  }
}

function statusBadge(status) {
  const map = { active: "badge-ok", pending: "badge-warn", suspended: "badge-danger", closed: "badge" };
  return h(`span.badge.${map[status] || "badge"}`, { text: status[0].toUpperCase() + status.slice(1) });
}

function topbar() {
  return h("header.topbar.no-print.shell-width", { style: { borderBottom: "1px solid var(--ama-line)" } },
    h("a.wordmark", { href: "/admin" }, "AMA ", h("b", { text: "EDU" })),
    h("nav.u-row", { style: { marginLeft: "24px", gap: "16px" } },
      h("a.u-small", { href: "/admin", text: "Overview" }),
      h("a.u-small", { href: "/admin/schools", text: "Schools" }),
    ),
    h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Sign out", style: { marginLeft: "auto" }, onclick: () => signOut() }),
  );
}
