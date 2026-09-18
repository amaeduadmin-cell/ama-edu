/* UI primitives: toasts, modals, confirmations, empty states. */

import { h, mount, on } from "./dom.js";

/* ---------------- Toasts ---------------- */
function toastHost() {
  let host = document.getElementById("toastHost");
  if (!host) {
    host = h("div.no-print#toastHost", { role: "status", "aria-live": "polite" });
    document.body.appendChild(host);
  }
  return host;
}

export function toast(message, type = "success", ms = 3800) {
  const el = h(`div.toast.toast-${type}`, {}, h("div.u-grow", { text: message }));
  toastHost().appendChild(el);
  setTimeout(() => {
    el.classList.add("toast-out");
    setTimeout(() => el.remove(), 200);
  }, ms);
  return el;
}

export const toastOk    = (m) => toast(m, "success");
export const toastError = (m) => toast(m, "error", 5200);
export const toastInfo  = (m) => toast(m, "info");

/* ---------------- Modal ---------------- */
let closeActive = null;

/**
 * openModal({ title, body, actions, wide }) -> close()
 * `body` and `actions` are nodes, never HTML strings.
 * Restores focus to whatever opened it, traps Escape, and closes on
 * backdrop click.
 */
export function openModal({ title, body, actions = [], wide = false, onClose } = {}) {
  closeModal();
  const opener = document.activeElement;

  const box = h(`div.modal-box${wide ? ".wide" : ""}`, {
    role: "dialog", "aria-modal": "true", "aria-label": title || "Dialog", tabindex: "-1",
  },
    title ? h("h2.modal-title", { text: title }) : null,
    body || null,
    actions.length ? h("div.modal-actions", {}, actions) : null,
  );

  const overlay = h("div.modal-overlay.show", {}, box);
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  box.focus();

  const offClick = on(overlay, "click", (e) => { if (e.target === overlay) close(); });
  const offKey = on(document, "keydown", (e) => { if (e.key === "Escape") close(); });

  function close() {
    offClick(); offKey();
    overlay.remove();
    document.body.style.overflow = "";
    closeActive = null;
    if (opener && opener.focus) opener.focus();
    if (onClose) onClose();
  }

  closeActive = close;
  return close;
}

export function closeModal() { if (closeActive) closeActive(); }

/** Promise-based confirmation. Destructive actions get the red button. */
export function confirmAction({
  title = "Are you sure?",
  message = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; close(); resolve(value); } };

    const close = openModal({
      title,
      body: message ? h("p.u-muted.u-small", { text: message }) : null,
      actions: [
        h("button.btn.btn-outline", { type: "button", text: cancelLabel, onclick: () => finish(false) }),
        h(`button.btn.${danger ? "btn-danger" : "btn-primary"}`, { type: "button", text: confirmLabel, onclick: () => finish(true) }),
      ],
      onClose: () => finish(false),
    });
  });
}

/* ---------------- States ---------------- */
export function emptyState({ title, body, action } = {}) {
  return h("div.empty", {},
    h("div.empty-title", { text: title || "Nothing here yet" }),
    body ? h("p.empty-body", { text: body }) : null,
    action || null,
  );
}

export function errorState(message, onRetry) {
  return h("div.empty", {},
    h("div.empty-title", { text: "That didn't load" }),
    h("p.empty-body", { text: message }),
    onRetry ? h("button.btn.btn-outline", { type: "button", text: "Try again", onclick: onRetry }) : null,
  );
}

export function inlineAlert(message, type = "error") {
  return h(`div.alert.alert-${type}`, { role: type === "error" ? "alert" : "status" },
    h("div", { text: message }));
}

/* ---------------- Fields ---------------- */
export function field({ label, id, hint, error, control }) {
  return h("div.field", {},
    label ? h("label", { for: id, text: label }) : null,
    control,
    hint ? h("div.field-hint", { text: hint }) : null,
    error ? h("div.field-error", { text: error }) : null,
  );
}

/** Password input with a show/hide toggle (rule 32). */
export function passwordField({ label, id, autocomplete = "current-password", hint, required = true }) {
  const input = h("input.input", { id, type: "password", autocomplete, required, minlength: "8" });
  const toggle = h("button.pw-toggle", {
    type: "button", "aria-label": "Show password", text: "Show",
    onclick: () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      toggle.textContent = showing ? "Show" : "Hide";
      toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
      input.focus();
    },
  });
  return { input, node: field({ label, id, hint, control: h("div.pw-wrap", {}, input, toggle) }) };
}

export function footerNote() {
  return h("footer.app-footer.no-print", {},
    h("div", { text: "Copyright © AMAEdu 2026 All Rights Reserved!" }));
}

export { mount };
