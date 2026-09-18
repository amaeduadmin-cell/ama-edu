/* ===============================================================
   Path router.

   Real paths, not hashes: amaedu.com.ng/register and
   pas.amaedu.com.ng/dashboard. public/_redirects tells Cloudflare
   Pages to serve index.html for every path so a hard refresh or a
   pasted deep link works.

   Route modules are dynamic imports, so a parent opening
   /report-cards never downloads the score-entry or settings code.
   That matters more here than usual — a lot of these users are on
   metered mobile data.
   =============================================================== */

import { logError, humanError } from "./errors.js";

const routes = [];
let notFoundHandler = null;
let beforeEach = null;
let current = null;

/** register("/students/:id", () => import("../app/student-detail.js")) */
export function register(pattern, loader, meta = {}) {
  routes.push({ ...compile(pattern), loader, meta, pattern });
}

export function setNotFound(loader) { notFoundHandler = loader; }

/** Guard run before every navigation. Return a path string to redirect. */
export function setGuard(fn) { beforeEach = fn; }

function compile(pattern) {
  const names = [];
  const source = pattern
    .replace(/\/+$/, "")
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:(\w+)/g, (_, name) => { names.push(name); return "([^/]+)"; });
  return { regex: new RegExp(`^${source || "/"}/?$`), names };
}

function match(path) {
  for (const route of routes) {
    const found = route.regex.exec(path);
    if (found) {
      const params = {};
      route.names.forEach((name, i) => { params[name] = decodeURIComponent(found[i + 1]); });
      return { route, params };
    }
  }
  return null;
}

export function currentPath() {
  return window.location.pathname.replace(/\/{2,}/g, "/") || "/";
}

/** Navigate without a page reload. */
export function navigate(path, { replace = false } = {}) {
  if (path === currentPath() + window.location.search) return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  return resolve();
}

/** Full page load — used when crossing origins (platform <-> tenant). */
export function hardNavigate(url) { window.location.assign(url); }

export async function resolve() {
  const path = currentPath();
  const outlet = document.getElementById("app");

  if (beforeEach) {
    const redirect = await beforeEach(path);
    if (redirect && redirect !== path) return navigate(redirect, { replace: true });
  }

  const found = match(path);
  const loader = found ? found.route.loader : notFoundHandler;
  if (!loader) return;

  current = { path, params: found?.params || {}, meta: found?.route.meta || {} };

  try {
    const module = await loader();
    const render = module.default || module.render;
    if (typeof render !== "function") throw new Error(`Route ${path} exports no renderer`);
    outlet.replaceChildren();
    await render({ outlet, params: current.params, path, meta: current.meta });
    if (!path.includes("#")) window.scrollTo(0, 0);
  } catch (err) {
    logError(`route ${path}`, err);
    const { errorState } = await import("./ui.js");
    outlet.replaceChildren(errorState(humanError(err), () => resolve()));
  }
}

/** Intercept same-origin <a href> clicks so links behave like SPA nav. */
export function start() {
  window.addEventListener("popstate", () => resolve());

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = event.target.closest("a[href]");
    if (!anchor) return;
    if (anchor.target && anchor.target !== "_self") return;
    if (anchor.hasAttribute("download") || anchor.dataset.native === "true") return;

    const url = new URL(anchor.href, window.location.href);
    // Cross-origin includes crossing between tenants — let the browser do it.
    if (url.origin !== window.location.origin) return;

    event.preventDefault();
    navigate(url.pathname + url.search);
  });

  return resolve();
}

export function getRoute() { return current; }
