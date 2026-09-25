/* ===============================================================
   AMA EDU platform console — overview across every registered
   school. No MyPAS1 equivalent; this is the operator's view.

   Platform admins pass app.owns() for every school_id (that check
   is "is_platform_admin() OR same tenant" — the first branch always
   wins for them), so these are plain reads, not special RPCs.
   =============================================================== */

import "../../styles/marketing.css";
import { h, mount, skeleton } from "../../lib/dom.js";
import { supabase } from "../../lib/supabase.js";
import { unwrap, humanError, logError } from "../../lib/errors.js";
import { errorState, footerNote } from "../../lib/ui.js";
import { signOut } from "../../lib/auth.js";
import { tenantUrl } from "../../lib/tenant.js";
import { fmtDate } from "../../lib/data.js";

export default async function render({ outlet }) {
  document.title = "AMA EDU console";
  const body = h("div.shell-width", { style: { paddingBlock: "24px" } });
  mount(outlet, h("div", {},
    topbar(),
    body,
    footerNote(),
  ));
  mount(body, skeleton(4));

  try {
    const schools = unwrap(await supabase.from("schools").select("id, name, slug, status, school_type, created_at").order("created_at", { ascending: false }), "fetch schools");
    const [{ count: studentTotal }, { count: staffTotal }, { count: pendingApplications }] = await Promise.all([
      supabase.from("students").select("id", { count: "exact", head: true }),
      supabase.from("staff").select("id", { count: "exact", head: true }),
      supabase.from("school_applications").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);

    const byStatus = { active: 0, pending: 0, suspended: 0, closed: 0 };
    schools.forEach((s) => { byStatus[s.status] = (byStatus[s.status] || 0) + 1; });

    mount(body,
      h("div.page-head", {}, h("h1", { text: "Platform overview" })),
      h("div.stat-grid", {},
        stat("Schools", schools.length), stat("Active", byStatus.active),
        stat("Students (all schools)", studentTotal ?? "—"), stat("Staff (all schools)", staffTotal ?? "—"), stat("Pending applications", pendingApplications ?? "—"),
      ),
      h("section.card.u-mt-6", {},
        h("div.card-head", {},
          h("div", {}, h("h2.card-title", { text: "Content and payments" }), h("div.card-sub", { text: "Manage what visitors see, pricing, payment settings, and blog posts." })),
        ),
        h("div.u-row", { style: { gap: "8px", flexWrap: "wrap" } },
          h("a.btn.btn-primary.btn-sm", { href: "/admin/content?tab=site", text: "Website content" }),
          h("a.btn.btn-outline.btn-sm", { href: "/admin/content?tab=plans", text: "Plans & pricing" }),
          h("a.btn.btn-outline.btn-sm", { href: "/admin/content?tab=payments", text: "Payment gateway" }),
          h("a.btn.btn-outline.btn-sm", { href: "/admin/content?tab=posts", text: "Blog & posts" }),
        ),
      ),
      h("section.card.u-mt-6", {}, h("div.card-head", {}, h("div", {}, h("h2.card-title", { text: "School onboarding" }), h("div.card-sub", { text: "Review applications and bring approved schools online." })), h("a.btn.btn-primary.btn-sm", { href: "/admin/applications", text: "Review applications" }))),
      h("section.card.u-mt-6", {},
        h("div.card-head", {}, h("h2.card-title", { text: "Recently registered" }), h("a.btn.btn-outline.btn-sm", { href: "/admin/schools", text: "All schools" })),
        h("div.table-wrap", {}, h("table.table", {},
          h("thead", {}, h("tr", {}, h("th", { text: "School" }), h("th", { text: "Address" }), h("th", { text: "Status" }), h("th", { text: "Registered" }))),
          h("tbody", {}, schools.slice(0, 8).map((s) => h("tr", {},
            h("td", {}, h("a", { href: `/admin/schools/${s.id}`, style: { fontWeight: "600", textDecoration: "none", color: "inherit" }, text: s.name })),
            h("td", {}, h("a.u-xs", { href: tenantUrl(s.slug, "/"), target: "_blank", rel: "noopener", text: `${s.slug}.amaedu.com.ng` })),
            h("td", {}, statusBadge(s.status)),
            h("td.u-xs.u-muted", { text: fmtDate(s.created_at) }),
          ))),
        )),
      ),
    );
  } catch (err) {
    logError("platform console", err);
    mount(body, errorState(humanError(err)));
  }
}

function stat(label, value) {
  return h("div.stat", {}, h("div.stat-value", { text: value }), h("div.stat-label", { text: label }));
}

export function statusBadge(status) {
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
