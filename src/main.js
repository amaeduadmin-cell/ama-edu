/* ===============================================================
   AMA EDU — bootstrap

   One codebase, two faces, decided by hostname:

     amaedu.com.ng        the platform: marketing site, school
                          registration, AMA EDU admin console
     <slug>.amaedu.com.ng one school's portal

   Paths stay clean in both — /register on the platform,
   /dashboard, /students, /report-cards inside a portal.
   =============================================================== */

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/reportcard.css";

import { getCurrentTenantSlug, fetchTenantConfig, applyTenantBranding } from "./lib/tenant.js";
import { register, setNotFound, setGuard, start, navigate } from "./lib/router.js";
import { loadSession, session, hasRole, onSessionChange } from "./lib/auth.js";
import { startRealtime, stopRealtime } from "./lib/realtime.js";
import { hasConfig } from "./lib/supabase.js";
import { logError } from "./lib/errors.js";

/** Shared, read-only view of the boot result. */
export const context = {
  tenantSlug: null,
  school: null,
  isPlatform: true,
};

/* Restore the user's light/dark choice before first paint of the app. */
(function initTheme() {
  try {
    const stored = localStorage.getItem("ama.theme");
    if (stored === "dark" || stored === "light") {
      document.documentElement.setAttribute("data-theme", stored);
    } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  } catch {}
})();

async function boot() {
  if (!hasConfig) {
    const { h, mount } = await import("./lib/dom.js");
    mount("app", h("div.panel-page", {}, h("div.panel", {},
      h("h1.panel-title", { text: "Configuration missing" }),
      h("p.panel-sub", { text: "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set. Copy .env.example to .env, fill both in, and restart." }),
    )));
    return;
  }

  const slug = getCurrentTenantSlug();
  context.tenantSlug = slug;
  context.isPlatform = !slug;

  if (slug) {
    try {
      const school = await fetchTenantConfig(slug);
      if (!school) return renderSchoolNotFound(slug);
      if (school.status === "suspended") return renderSuspended(school);
      context.school = school;
      session.school = school;
      applyTenantBranding(school);
    } catch (err) {
      logError("tenant config", err);
      return renderSchoolNotFound(slug, true);
    }
    registerTenantRoutes();
  } else {
    registerPlatformRoutes();
  }

  await loadSession();
  // Live "something changed" signals for the signed-in school. Best-effort:
  // if realtime is unavailable everything still works, pages just need a refresh.
  onSessionChange(() => (session.authed ? startRealtime() : stopRealtime()));
  if (session.authed) startRealtime();
  await start();
}

/* ---------------- Route tables ---------------- */

function registerPlatformRoutes() {
  register("/",                 () => import("./pages/landing.js"));
  register("/register",         () => import("./pages/register.js"));
  register("/login",            () => import("./pages/platform-login.js"));
  register("/find-school",      () => import("./pages/find-school.js"));
  register("/schools/:slug",    () => import("./pages/school-profile.js"));
  register("/blog",             () => import("./pages/blog.js"));
  register("/blog/:slug",       () => import("./pages/blog.js"));
  register("/reset-password",   () => import("./pages/reset-password.js"));
  register("/admin",            () => import("./app/platform/console.js"), { requires: "platform" });
  register("/admin/schools",    () => import("./app/platform/schools.js"), { requires: "platform" });
  register("/admin/schools/:id",() => import("./app/platform/school-detail.js"), { requires: "platform" });
  register("/admin/content",    () => import("./app/platform/content.js"), { requires: "platform" });
  setNotFound(() => import("./pages/not-found.js"));

  setGuard(async (path) => {
    if (!path.startsWith("/admin")) return null;
    if (!session.ready) await loadSession();
    if (!session.authed) return "/login";
    if (!session.isPlatformAdmin) return "/unauthorized";
    return null;
  });
}

function registerTenantRoutes() {
  register("/",                () => import("./pages/portal-home.js"));
  register("/login",           () => import("./pages/login.js"));
  register("/reset-password",  () => import("./pages/reset-password.js"));

  const page = (file) => () => import(`./app/${file}.js`);
  const staff = { requires: "auth" };

  register("/dashboard",       page("dashboard"),      staff);
  register("/classes",         page("classes"),        staff);
  register("/classes/:id",     page("class-scores"),   staff);
  register("/students",        page("students"),       staff);
  register("/students/:id",    page("student-detail"), staff);
  register("/staff",           page("staff"),          staff);
  register("/curriculum",      page("curriculum"),     staff);
  register("/timetable",       page("timetable"),      staff);
  register("/report-cards",    page("report-cards"),   staff);
  register("/results",         page("results"),        staff);
  register("/publication",     page("publication"),    staff);
  register("/attendance",      page("attendance"),     staff);
  register("/assessments",     page("assessments"),    staff);
  register("/assignments",     page("assignments"),    staff);
  register("/my-exams",        page("my-exams"),       staff);
  register("/my-children",     page("parent"),         staff);
  register("/overview",        page("director"),       staff);
  register("/master-list",     page("master-list"),    staff);
  register("/certificates",    page("certificates"),   staff);
  register("/analytics",       page("analytics"),      staff);
  register("/fees",            page("fees"),           staff);
  register("/announcements",   page("announcements"),  staff);
  register("/import",          page("import"),         staff);
  register("/settings",        page("settings"),       staff);
  register("/academic-settings", page("academic-settings"), staff);
  register("/my-report",       page("my-report"),      staff);
  register("/unauthorized",    () => import("./pages/unauthorized.js"));

  setNotFound(() => import("./pages/not-found.js"));

  setGuard(async (path) => {
    const open = ["/", "/login", "/reset-password", "/unauthorized"];
    if (open.includes(path)) {
      // Already signed in? Skip the login screen.
      if (path === "/login" && session.authed) return landingRouteFor();
      return null;
    }
    if (!session.ready) await loadSession();
    if (!session.authed) return "/login";
    return null;
  });
}

/** Where a signed-in user should land, by role. */
export function landingRouteFor() {
  if (hasRole("student")) return "/my-report";
  if (hasRole("parent")) return "/my-children";
  if (hasRole("director") && session.roles.length === 1) return "/overview";
  if (hasRole("bursar") && session.roles.length === 1) return "/fees";
  if (hasRole("registrar_primary", "registrar_secondary") && session.roles.length === 1) return "/students";
  return "/dashboard";
}

/* ---------------- Boot-time failure screens ---------------- */

async function renderSchoolNotFound(slug, networkProblem = false) {
  const { default: render } = await import("./pages/school-not-found.js");
  render({ outlet: document.getElementById("app"), params: { slug, networkProblem } });
}

async function renderSuspended(school) {
  const { renderSuspended: render } = await import("./pages/school-not-found.js");
  render({ outlet: document.getElementById("app"), school });
}

boot().catch((err) => {
  logError("boot", err);
  document.getElementById("app").textContent =
    "AMA EDU could not start. Refresh the page, and if it keeps happening contact support.";
});

export { navigate };
