// ============================================================
// ROUTER — lightweight hash-based SPA router (no framework, no
// server config needed). Uses "#/classes" style URLs instead of
// clean paths: a browser never sends anything after "#" to the
// server, so every route always just requests "/" underneath —
// meaning it works identically on GitHub Pages, Netlify, Vercel, a
// zipped folder opened locally, anywhere. No 404.html trick, no
// _redirects file, no deploy-order gotchas.
//
// Design: renderTab(id) in app-tabs.js does the actual DOM
// rendering and never touches the URL. Everything else — sidebar
// clicks, "Back to Classes" buttons, post-login redirect, browser
// Back/Forward, direct URL entry, page refresh — goes through
// switchTab(id) / navigate(path) below, which update location.hash
// and then call renderRoute() to resolve what should actually be on
// screen (auth + role checked every time).
// ============================================================

const TAB_TO_ROUTE = {
  dashboard: "/dashboard", classes: "/classes", masterlist: "/master-list",
  assignments: "/assignments", staffDirectory: "/staff", students: "/students",
  timetable: "/timetable", certificates: "/certificates", analytics: "/analytics",
  catracker: "/ca-tracker", fees: "/fees", websites: "/websites", importTool: "/import",
  classManagement: "/manage-classes", salaryTracker: "/salary",
  transferStudents: "/transfer-students", scoreControl: "/score-control",
  printReports: "/print-reports", unassignedStudents: "/unassigned-students",
  settings: "/settings", myReport: "/my-report", registerStudent: "/register-student",
  assessments: "/assessments", examsTests: "/exams-tests", homework: "/homework", announcements: "/announcements",
};
const ROUTE_TO_TAB = Object.fromEntries(Object.entries(TAB_TO_ROUTE).map(([k, v]) => [v, k]));

function isLoggedIn() { return !!state.session; }

function isRouteAuthorized(tabId) {
  const roles = state.allRoles || [state.role];
  return roles.some(r => (NAV_BY_ROLE[r] || []).some(item => item[0] === tabId));
}

function defaultRouteForCurrentUser() {
  const roles = state.allRoles || [state.role];
  for (const r of roles) {
    const first = (NAV_BY_ROLE[r] || [])[0];
    if (first) return TAB_TO_ROUTE[first[0]] || "/dashboard";
  }
  return "/dashboard";
}

// Reads the current route from the URL fragment. "#/classes" -> "/classes".
// No fragment at all (fresh visit to the bare domain) -> "/".
function currentPath() {
  const h = location.hash.slice(1);
  return h || "/";
}

// Public entry point — every existing onclick="switchTab('id')" call
// (sidebar, "Back to Classes" buttons, post-login redirect) now goes
// through here instead of rendering directly.
function switchTab(id) {
  navigate(TAB_TO_ROUTE[id] || ("/" + id));
}

function navigate(path, { push = true } = {}) {
  const newHash = "#" + path;
  if (push) {
    if (location.hash === newHash) renderRoute(); // no actual change -> hashchange won't fire
    else location.hash = path; // triggers the hashchange listener below, which renders
  } else {
    history.replaceState(null, "", newHash);
    renderRoute();
  }
}

window.addEventListener("hashchange", renderRoute);

function showNotFound() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("appShell").style.display = "none";
  document.getElementById("notFoundScreen").style.display = "flex";
}
function hideNotFound() {
  document.getElementById("notFoundScreen").style.display = "none";
}
function goHomeFromNotFound() {
  navigate(isLoggedIn() ? defaultRouteForCurrentUser() : "/login");
}

// The single source of truth for "what should be on screen right
// now", driven entirely by the URL fragment. Called on: initial
// load (once auth state is known), every hashchange (Back/Forward,
// typing a new hash, clicking a link), and every call to navigate().
// Idempotent and safe to call repeatedly.
function renderRoute() {
  const path = currentPath();

  if (!isLoggedIn()) {
    hideNotFound();
    if (path === "/" || path === "/login") {
      showAppShell(false);
    } else if (ROUTE_TO_TAB[path]) {
      navigate("/login", { push: false });
    } else {
      showNotFound();
    }
    return;
  }

  if (path === "/" || path === "/login") {
    navigate(defaultRouteForCurrentUser(), { push: false });
    return;
  }
  const tabId = ROUTE_TO_TAB[path];
  if (!tabId) { showNotFound(); return; }
  if (!isRouteAuthorized(tabId)) {
    navigate(defaultRouteForCurrentUser(), { push: false });
    return;
  }
  hideNotFound();
  showAppShell(true);
  renderTab(tabId);
}

// Called once bootAfterLogin() has state.session/role/allRoles ready
// — covers both a fresh login and a page refresh with a live
// session — and resolves whatever URL fragment is actually present
// (a deep link survives a refresh; "/" or "/login" lands on the
// role's default tab).
function handlePostAuthRouting() {
  renderRoute();
}
