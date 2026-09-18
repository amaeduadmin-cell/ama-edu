/* ===============================================================
   AMA EDU platform console — one school's detail: profile,
   administrators, subscription, and the same activate/suspend
   controls as the list, scoped to this school. No MyPAS1 equivalent.
   =============================================================== */

import "../../styles/marketing.css";
import { h, mount, skeleton, setBusy, safeUrl } from "../../lib/dom.js";
import { supabase } from "../../lib/supabase.js";
import { unwrap, humanError, logError } from "../../lib/errors.js";
import { errorState, footerNote, confirmAction, toastOk, toastError, field } from "../../lib/ui.js";
import { signOut } from "../../lib/auth.js";
import { tenantUrl } from "../../lib/tenant.js";
import { fmtDate, initials } from "../../lib/data.js";

const STATUSES = ["pending", "active", "suspended", "closed"];
const PLANS = ["free", "standard", "premium"];

export default async function render({ outlet, params }) {
  const schoolId = params.id;
  const body = h("div.shell-width", { style: { paddingBlock: "24px" } });
  mount(outlet, h("div", {}, topbar(), body, footerNote()));
  mount(body, skeleton(6));

  await load();

  async function load() {
    try {
      const [school, admins, studentCount, staffCount] = await Promise.all([
        unwrap(await supabase.from("schools").select("*").eq("id", schoolId).single(), "fetch school"),
        unwrap(await supabase.from("school_members").select("role, staff(full_name, email, phone)").eq("school_id", schoolId).eq("role", "admin"), "fetch admins"),
        supabase.from("students").select("id", { count: "exact", head: true }).eq("school_id", schoolId).then((r) => r.count ?? 0),
        supabase.from("staff").select("id", { count: "exact", head: true }).eq("school_id", schoolId).then((r) => r.count ?? 0),
      ]);
      document.title = `${school.name} — AMA EDU console`;
      draw(school, admins, studentCount, staffCount);
    } catch (err) {
      logError("school-detail load", err);
      mount(body, errorState(humanError(err), load));
    }
  }

  function draw(school, admins, studentCount, staffCount) {
    const logo = safeUrl(school.logo_url);

    mount(body,
      h("div.page-head", {},
        h("a.u-xs.u-muted", { href: "/admin/schools", text: "← All schools" }),
        h("div.u-row.u-mt-4", { style: { alignItems: "center" } },
          logo ? h("img", { src: logo, alt: "", style: { width: "48px", height: "48px", borderRadius: "8px", objectFit: "contain" } })
               : h("div.sidebar-crest", { style: { width: "48px", height: "48px", display: "grid", placeItems: "center", fontWeight: "700" }, text: initials(school.name) }),
          h("div.u-grow", {}, h("h1", { text: school.name }), h("div.card-sub", {},
            h("a", { href: tenantUrl(school.slug, "/"), target: "_blank", rel: "noopener", text: `${school.slug}.amaedu.com.ng` }))),
          statusBadge(school.status),
        ),
      ),
      h("div.stat-grid", {}, stat("Students", studentCount), stat("Staff", staffCount), stat("Registered", fmtDate(school.created_at)), stat("Plan", school.subscription_plan)),

      h("section.card.u-mt-6", {},
        h("h2.card-title", { text: "Status" }),
        h("p.u-small.u-muted.u-mt-4", { text: "Suspending a school signs its administrators, staff, students and parents out immediately — their portal shows a paused message, and no data is deleted." }),
        h("div.u-row.u-mt-4.u-wrap", {}, STATUSES.map((s) => h(`button.btn.${s === school.status ? "btn-primary" : "btn-outline"}.btn-sm`, {
          type: "button", text: s[0].toUpperCase() + s.slice(1), disabled: s === school.status,
          onclick: () => changeStatus(school, s),
        }))),
      ),

      h("section.card.u-mt-6", {},
        h("h2.card-title", { text: "Subscription plan" }),
        h("div.u-row.u-mt-4", {},
          (() => {
            const sel = h("select.select", { style: { maxWidth: "200px" } }, PLANS.map((p) => h("option", { value: p, selected: p === school.subscription_plan, text: p[0].toUpperCase() + p.slice(1) })));
            const btn = h("button.btn.btn-outline.btn-sm", { type: "button", text: "Save", onclick: async () => {
              setBusy(btn, true, "Saving…");
              try {
                unwrap(await supabase.from("schools").update({ subscription_plan: sel.value }).eq("id", school.id), "save plan");
                toastOk("Plan updated");
                await load();
              } catch (err) { toastError(humanError(err)); } finally { setBusy(btn, false); }
            } });
            return [sel, btn];
          })(),
        ),
      ),

      h("section.card.u-mt-6", {},
        h("h2.card-title", { text: "Contact" }),
        h("div.form-grid.cols-2.u-mt-4", {},
          infoRow("Email", school.email), infoRow("Phone", school.phone),
          infoRow("Address", school.address), infoRow("Type", school.school_type),
        ),
      ),

      h("section.card.u-mt-6", {},
        h("h2.card-title", { text: "Administrators" }),
        admins.length
          ? h("div.u-stack.u-mt-4", { style: { gap: "4px" } }, admins.map((a) => h("div.u-row", { style: { justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--ama-line-2)" } },
              h("div", { text: a.staff?.full_name || "—" }),
              h("div.u-xs.u-muted", { text: [a.staff?.email, a.staff?.phone].filter(Boolean).join(" · ") }),
            )))
          : h("p.u-small.u-muted.u-mt-4", { text: "No administrator on record." }),
      ),
    );
  }

  async function changeStatus(school, status) {
    const ok = await confirmAction({
      title: `Set ${school.name} to ${status}?`,
      message: status === "suspended" ? "Everyone at this school will be signed out immediately." : status === "closed" ? "This school will no longer be reachable. Data is kept." : "This school's portal becomes reachable.",
      confirmLabel: "Confirm",
      danger: status === "suspended" || status === "closed",
    });
    if (!ok) return;
    try {
      unwrap(await supabase.from("schools").update({ status }).eq("id", school.id), "update status");
      toastOk("Status updated");
      await load();
    } catch (err) { toastError(humanError(err)); }
  }
}

function stat(label, value) {
  return h("div.stat", {}, h("div.stat-value", { style: { fontSize: "1.1rem" }, text: value ?? "—" }), h("div.stat-label", { text: label }));
}
function infoRow(label, value) {
  return h("div", {}, h("div.u-xs.u-muted", { text: label }), h("div", { text: value || "—" }));
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
