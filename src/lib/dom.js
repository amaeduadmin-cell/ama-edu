/* ===============================================================
   Safe DOM construction.

   MyPAS1 built ~140 fragments with innerHTML and raw template
   interpolation of database values (student names, announcement
   bodies, school website entries). In a single-school deployment
   that is a contained stored-XSS risk. On a platform where any
   school can self-register it becomes a cross-tenant one: hostile
   markup saved by one school's admin would eventually execute in a
   PLATFORM super admin's session, which is the account that can
   read every school.

   So: no innerHTML anywhere in src/. Build nodes with h(); text is
   always set via textContent, which the browser never parses as
   markup. esc() exists only for the two places that genuinely need
   an HTML string (print windows, PDF capture).
   =============================================================== */

const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_TAGS = new Set(["svg", "path", "circle", "rect", "g", "line", "text", "polyline", "polygon", "defs", "use"]);

/**
 * h("div.card", { onclick, disabled }, child, child...)
 * Tag supports `tag.class.class#id` shorthand.
 * Children may be nodes, strings, numbers, arrays, null/false (skipped).
 */
export function h(tag, props = null, ...children) {
  let name = tag, classes = [], id = null;
  const hashAt = name.indexOf("#");
  if (hashAt > -1) { id = name.slice(hashAt + 1); name = name.slice(0, hashAt); }
  const parts = name.split(".");
  name = parts.shift() || "div";
  classes = parts;

  const el = SVG_TAGS.has(name)
    ? document.createElementNS(SVG_NS, name)
    : document.createElement(name);

  if (id) el.id = id;
  if (classes.length) el.setAttribute("class", classes.join(" "));

  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;

    if (key === "class" || key === "className") {
      const merged = [...classes, value].filter(Boolean).join(" ");
      el.setAttribute("class", merged);
    } else if (key === "style" && typeof value === "object") {
      Object.assign(el.style, value);
    } else if (key === "dataset" && typeof value === "object") {
      Object.assign(el.dataset, value);
    } else if (key === "text") {
      el.textContent = String(value);
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }

  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === true) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Replace a container's contents with new nodes. */
export function mount(target, ...children) {
  const el = typeof target === "string" ? document.getElementById(target) : target;
  if (!el) return null;
  el.replaceChildren();
  append(el, children);
  return el;
}

export function clear(el) { el && el.replaceChildren(); return el; }

/**
 * HTML-escape. Only for the handful of places that must emit an HTML
 * STRING rather than nodes — print windows and html2canvas capture.
 * Never reach for this as a shortcut back to innerHTML.
 */
export function esc(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Only http(s) URLs survive — blocks javascript: and data: in src/href. */
export function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value), window.location.origin);
    return (url.protocol === "http:" || url.protocol === "https:") ? url.href : null;
  } catch { return null; }
}

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function on(el, event, handler, opts) {
  el.addEventListener(event, handler, opts);
  return () => el.removeEventListener(event, handler, opts);
}

/** Toggle a button between idle and working, with a spinner. */
export function setBusy(button, busy, busyLabel = "Working…") {
  if (!button) return;
  if (busy) {
    button.dataset.idleLabel = button.textContent;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    mount(button, h("span.btn-spinner"), busyLabel);
  } else {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = button.dataset.idleLabel || button.textContent;
  }
}

export function skeleton(rows = 4) {
  return h("div", { "aria-hidden": "true" },
    Array.from({ length: rows }, () => h("div.skeleton.skeleton-row")));
}
