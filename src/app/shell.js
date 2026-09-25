/* ===============================================================
   Portal shell: sidebar, topbar, footer.

   Navigation is built from the union of the signed-in person's
   roles — MyPAS1's behaviour, kept — so an admin who also teaches
   and registers students sees all three sets of tabs once.

   The sidebar is off-canvas below 1024px and fixed above it, which
   is the layout that matters most here: most staff will be entering
   scores on a phone.
   =============================================================== */

import { h, mount, safeUrl } from "../lib/dom.js";
import { session, signOut, hasRole } from "../lib/auth.js";
import { context } from "../main.js";
import { currentPath } from "../lib/router.js";
import { confirmAction, footerNote } from "../lib/ui.js";
import { setPrivatePage } from "../lib/seo.js";
import { clearDataChangedHandlers } from "../lib/realtime.js";

/* [path, label, group] */
const NAV_BY_ROLE = {
  admin: [
    ["/dashboard",     "Dashboard",      "Overview"],
    ["/overview",      "School overview","Overview"],
    ["/classes",         "Classes & scores", "Teaching"],
    ["/bulk-score-import", "Bulk score import", "Teaching"],
    ["/score-control",   "Score control",   "Teaching"],
    ["/class-management", "Class management", "Teaching"],
    ["/master-list",   "Master list",    "Teaching"],
    ["/curriculum",    "Curriculum",     "Teaching"],
    ["/timetable",     "Timetable",      "Teaching"],
    ["/attendance",    "Attendance",     "Teaching"],
    ["/assessments",   "Exams & tests",  "Teaching"],
    ["/assignments",   "Homework",       "Teaching"],
    ["/report-cards",  "Report cards",   "Results"],
    ["/results",       "Results & positions", "Results"],
    ["/publication",   "Publish results", "Results"],
    ["/certificates",  "Certificates",   "Results"],
    ["/analytics",     "Analytics",      "Results"],
    ["/students",        "Students",       "People"],
    ["/student-operations", "Student operations", "People"],
    ["/staff",         "Staff",          "People"],
    ["/announcements", "Announcements",  "People"],
    ["/notifications", "Notifications",  "People"],
    ["/fees",            "Fees",           "Money"],
    ["/fee-overview",    "Fee overview",   "Money"],
    ["/salary",          "Staff salaries", "Money"],
    ["/import",        "Bulk import",    "School"],
    ["/settings",      "Settings",       "School"],
    ["/academic-settings", "Academic settings", "School"],
  ],
  headmaster: [
    ["/dashboard", "Dashboard", "Overview"],
    ["/classes", "Classes & scores", "Teaching"],
    ["/master-list", "Master list", "Teaching"],
    ["/attendance", "Attendance", "Teaching"],
    ["/assessments", "Exams & tests", "Teaching"],
    ["/assignments", "Homework", "Teaching"],
    ["/report-cards", "Report cards", "Results"],
    ["/results", "Results & positions", "Results"],
    ["/publication", "Publish results", "Results"],
    ["/certificates", "Certificates", "Results"],
    ["/announcements", "Announcements", "People"],
    ["/notifications", "Notifications", "People"],
    ["/settings", "My profile", "School"],
  ],
  principal: [
    ["/dashboard", "Dashboard", "Overview"],
    ["/classes", "Classes & scores", "Teaching"],
    ["/master-list", "Master list", "Teaching"],
    ["/attendance", "Attendance", "Teaching"],
    ["/assessments", "Exams & tests", "Teaching"],
    ["/assignments", "Homework", "Teaching"],
    ["/report-cards", "Report cards", "Results"],
    ["/results", "Results & positions", "Results"],
    ["/publication", "Publish results", "Results"],
    ["/certificates", "Certificates", "Results"],
    ["/announcements", "Announcements", "People"],
    ["/notifications", "Notifications", "People"],
    ["/settings", "My profile", "School"],
  ],
  bursar: [
    ["/dashboard", "Dashboard", "Overview"],
    ["/fees", "Fees", "Money"],
    ["/settings", "My profile", "School"],
  ],
  teacher: [
    ["/dashboard", "Dashboard", "Overview"],
    ["/classes", "My classes", "Teaching"],
    ["/master-list", "Master list", "Teaching"],
    ["/timetable", "Timetable", "Teaching"],
    ["/attendance", "Attendance", "Teaching"],
    ["/assessments", "Exams & tests", "Teaching"],
    ["/assignments", "Homework", "Teaching"],
    ["/announcements", "Announcements", "People"],
    ["/notifications", "Notifications", "People"],
    ["/settings", "My profile", "School"],
  ],
  director: [
    // Read-only by design. The overview carries the numbers the Director
    // needs and the one controlled action (deactivate / reinstate staff);
    // the editing pages are deliberately not linked from here.
    ["/overview", "School overview", "Overview"],
  ],
  parent: [
    ["/my-children", "My children", "Overview"],
    ["/announcements", "Announcements", "Overview"],
    ["/settings", "My profile", "School"],
  ],
  student: [
    ["/my-report", "My report card", "Overview"],
    ["/my-exams", "Exams & tests", "Overview"],
    ["/assignments", "Homework", "Overview"],
    ["/announcements", "Announcements", "Overview"],
    ["/settings", "My profile", "School"],
  ],
  registrar_primary: [
    ["/students", "Students", "People"],
    ["/student-operations", "Student operations", "People"],
    ["/master-list", "Master list", "Teaching"],
    ["/settings", "My profile", "School"],
  ],
  registrar_secondary: [
    ["/students", "Students", "People"],
    ["/student-operations", "Student operations", "People"],
    ["/master-list", "Master list", "Teaching"],
    ["/settings", "My profile", "School"],
  ],
};

const ROLE_LABELS = {
  admin: "Administrator", headmaster: "Headmaster", principal: "Principal",
  bursar: "Bursar", teacher: "Teacher", student: "Student", director: "Director", parent: "Parent",
  registrar_primary: "Registrar (Nursery & Primary)",
  registrar_secondary: "Registrar (JSS & SS)",
};

const PLATFORM_NAV = [
  ["/admin",         "Overview",       "Platform"],
  ["/admin/schools", "Schools",        "Platform"],
  ["/admin/applications", "Applications", "Platform"],
  ["/admin/content", "Public website", "Platform"],
  ["/admin/operations", "Operations", "Platform"],
];

export function navForSession() {
  if (session.isPlatformAdmin) return PLATFORM_NAV;
  const seen = new Set();
  const items = [];
  for (const role of (session.roles.length ? session.roles : ["teacher"])) {
    for (const item of NAV_BY_ROLE[role] || []) {
      if (!seen.has(item[0])) { seen.add(item[0]); items.push(item); }
    }
  }
  return items;
}

export function roleLabel() {
  if (session.isPlatformAdmin) return "AMA EDU platform admin";
  const roles = session.roles.length ? session.roles : [];
  return roles.map(r => ROLE_LABELS[r] || r).join(" · ") || "Staff";
}

/**
 * page({ title, subtitle, actions, body })
 * Returns the whole shell with `body` mounted in the content area.
 */
export function page({ title, subtitle, actions = [], body }) {
  const school = context.school || {};
  // Every page that renders through the shell is behind a login, so it
  // is marked noindex here rather than in each of the twenty pages.
  setPrivatePage(`${title} — ${school.name || "AMA EDU"}`);
  // A new page is rendering: drop the previous page's realtime callbacks.
  clearDataChangedHandlers();

  const scrim = h("div.sidebar-scrim.no-print", { onclick: () => setOpen(false) });
  const sidebar = buildSidebar();
  const setOpen = (open) => {
    sidebar.classList.toggle("open", open);
    scrim.classList.toggle("show", open);
  };

  return h("div.shell", {},
    scrim,
    sidebar,
    h("div.shell-body", {},
      h("header.topbar.no-print", {},
        h("button.icon-btn#btnMenu", { type: "button", "aria-label": "Open menu", text: "☰", onclick: () => setOpen(true) }),
        h("div.u-grow", {},
          h("div.topbar-eyebrow", { text: session.fullName ? `${session.fullName} · ${roleLabel()}` : roleLabel() }),
          h("div.topbar-title", { text: title }),
        ),
        h("button.icon-btn", { type: "button", "aria-label": "Switch light or dark mode", text: "◐", onclick: toggleTheme }),
        h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Sign out", onclick: promptSignOut }),
      ),
      h("main.main#main", {},
        (subtitle || actions.length)
          ? h("div.page-head", {},
              subtitle ? h("p.u-muted.u-small", { text: subtitle }) : null,
              actions.length ? h("div.page-actions", {}, actions) : null)
          : null,
        body,
      ),
    footerNote(context.school?.name || "AMA EDU"),
    ),
  );
}

function buildSidebar() {
  const school = context.school || {};
  const path = currentPath();
  const logo = safeUrl(school.logo_url);

  const grouped = new Map();
  for (const [href, label, group] of navForSession()) {
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push([href, label]);
  }

  return h("aside.sidebar.no-print", { "aria-label": "Sections" },
    h("div.sidebar-head", {},
      logo
        ? h("img.sidebar-crest", { src: logo, alt: "" })
        : h("div.sidebar-crest", { "aria-hidden": "true", style: { display: "grid", placeItems: "center", color: "var(--brand-primary-deep)", fontWeight: "700" },
            text: (school.name || "AE").slice(0, 1).toUpperCase() }),
      h("div.u-grow", {},
        h("div.sidebar-school", { text: school.name || "AMA EDU" }),
        h("div.u-xs.u-muted", { text: school.slug ? `${school.slug}.amaedu.com.ng` : "" }),
      ),
    ),
    h("nav.sidebar-nav", {},
      Array.from(grouped.entries()).map(([group, items]) => [
        h("div.sidebar-group", { text: group }),
        items.map(([href, label]) =>
          h(`a.sidebar-item${path === href || path.startsWith(href + "/") ? ".active" : ""}`, {
            href, "aria-current": path === href ? "page" : null,
          }, h("span.si-icon", { "aria-hidden": "true", text: "•" }), label)),
      ])),
      h("div.sidebar-foot", {}, h("span.sidebar-foot-mark", { text: "A" }), h("span", { text: "AMA EDU" })),
  );
}

function toggleTheme() {
  const root = document.documentElement;
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("ama.theme", next); } catch {}
}

async function promptSignOut() {
  const ok = await confirmAction({
    title: "Sign out?",
    message: "You will need your ID and password to sign back in.",
    confirmLabel: "Sign out",
  });
  if (ok) signOut();
}

/** Guard a page to certain roles; returns true if the caller may proceed. */
export function requireRole(outlet, ...roles) {
  if (hasRole(...roles)) return true;
  mount(outlet, page({
    title: "No access",
    body: h("div.empty", {},
      h("div.empty-title", { text: "This area is not part of your role" }),
      h("p.empty-body", { text: "If you think you should have access, ask your school administrator to update your role." }),
      h("a.btn.btn-outline", { href: "/dashboard", text: "Back to dashboard" })),
  }));
  return false;
}

export { mount, h };
