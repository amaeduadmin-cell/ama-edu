/* ===============================================================
   TENANT RESOLUTION — the single source of truth for "which school
   am I?". Hostname parsing lives here and nowhere else.

   Resolution order:
     pas.amaedu.com.ng       -> "pas"        (production)
     amaedu.com.ng / www.    -> null         (platform site)
     pas.localhost:5173      -> "pas"        (local dev, no DNS needed)
     localhost?tenant=pas    -> "pas"        (fallback dev, sticky per tab)
     pas--amaedu.pages.dev   -> "pas"        (Cloudflare Pages previews)

   SECURITY: the slug returned here only decides what to FETCH and
   what to PAINT. It is never sent as a filter the database trusts.
   Every query is constrained by RLS using the school_id baked into
   the caller's JWT, so editing the hostname, localStorage, or a
   request body cannot reach another school's rows.
   =============================================================== */

import { supabase } from "./supabase.js";

const ROOT_DOMAIN = (import.meta.env.VITE_ROOT_DOMAIN || "amaedu.com.ng").toLowerCase();

/** Never available as a school slug — collides with platform routes,
 *  mail/infrastructure conventions, or is reserved for future use. */
export const RESERVED_SLUGS = new Set([
  "www", "admin", "api", "app", "apps", "mail", "email", "smtp", "imap", "pop",
  "support", "help", "helpdesk", "docs", "doc", "blog", "news", "status",
  "login", "signin", "signup", "register", "auth", "account", "accounts",
  "dashboard", "portal", "platform", "console", "billing", "pay", "payments",
  "cdn", "static", "assets", "img", "images", "media", "files", "storage",
  "dev", "test", "staging", "stage", "demo", "sandbox", "preview", "beta",
  "ns", "ns1", "ns2", "dns", "mx", "ftp", "ssh", "vpn", "proxy", "gateway",
  "amaedu", "ama", "edu", "school", "schools", "security", "abuse", "postmaster",
  "webmaster", "hostmaster", "root", "system", "internal", "private", "public",
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

/** Normalise free text into a candidate subdomain label. */
export function toSlug(input) {
  return String(input || "")
    .toLowerCase().trim()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/** Returns { ok: true } or { ok: false, reason } — used by registration. */
export function validateSlug(slug) {
  if (!slug)                  return { ok: false, reason: "Choose a web address for your school." };
  if (slug.length < 3)        return { ok: false, reason: "Use at least 3 characters." };
  if (slug.length > 32)       return { ok: false, reason: "Keep it to 32 characters or fewer." };
  if (!SLUG_RE.test(slug))    return { ok: false, reason: "Use letters, numbers and hyphens only, starting and ending with a letter or number." };
  if (slug.startsWith("xn--"))return { ok: false, reason: "That prefix is reserved." };
  if (RESERVED_SLUGS.has(slug))return { ok: false, reason: `"${slug}" is reserved by the platform.` };
  return { ok: true };
}

/** The tenant slug for the current hostname, or null on the platform site. */
export function getCurrentTenantSlug() {
  const host = window.location.hostname.toLowerCase().replace(/\.$/, "");

  // Production: <slug>.amaedu.com.ng
  if (host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}`) return null;
  if (host.endsWith(`.${ROOT_DOMAIN}`)) {
    const label = host.slice(0, -(ROOT_DOMAIN.length + 1));
    // Only a single label is a tenant; deeper nesting is not ours.
    return label.includes(".") ? null : normaliseCandidate(label);
  }

  // Local dev: <slug>.localhost
  if (host.endsWith(".localhost")) return normaliseCandidate(host.slice(0, -".localhost".length));

  // Cloudflare Pages previews: <slug>--<project>.pages.dev
  if (host.endsWith(".pages.dev")) {
    const first = host.split(".")[0];
    const split = first.indexOf("--");
    return split > 0 ? normaliseCandidate(first.slice(0, split)) : null;
  }

  // Bare localhost / 127.0.0.1 — allow ?tenant=pas, sticky for the tab so
  // in-app navigation keeps the tenant without rewriting every link.
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
    const param = new URLSearchParams(window.location.search).get("tenant");
    if (param != null) {
      const slug = normaliseCandidate(param);
      try { slug ? sessionStorage.setItem("ama.devTenant", slug) : sessionStorage.removeItem("ama.devTenant"); } catch {}
      return slug;
    }
    try { return sessionStorage.getItem("ama.devTenant") || null; } catch { return null; }
  }

  return null;
}

function normaliseCandidate(label) {
  const slug = toSlug(label);
  if (!slug || RESERVED_SLUGS.has(slug) || !SLUG_RE.test(slug)) return null;
  return slug;
}

/** Absolute URL for a school portal — used by registration and by the
 *  platform console's "open portal" links. */
export function tenantUrl(slug, path = "/") {
  const { protocol, port, hostname } = window.location;
  const suffix = port ? `:${port}` : "";
  if (hostname.endsWith("localhost") || hostname === "127.0.0.1") {
    return `${protocol}//${slug}.localhost${suffix}${path}`;
  }
  return `${protocol}//${slug}.${ROOT_DOMAIN}${path}`;
}

export function platformUrl(path = "/") {
  const { protocol, port, hostname } = window.location;
  const suffix = port ? `:${port}` : "";
  if (hostname.endsWith("localhost") || hostname === "127.0.0.1") {
    return `${protocol}//localhost${suffix}${path}`;
  }
  return `${protocol}//${ROOT_DOMAIN}${path}`;
}

export const ROOT = ROOT_DOMAIN;

/* --------------------------------------------------------------
   Tenant configuration
   -------------------------------------------------------------- */

/** Public, unauthenticated school profile. Backed by a SECURITY
 *  DEFINER RPC that exposes only presentation fields (name, crest,
 *  colours, motto) for ACTIVE schools — never roster or result data. */
export async function fetchTenantConfig(slug) {
  const { data, error } = await supabase.rpc("public_school_by_slug", { p_slug: slug });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

/** Paint the school's identity onto the document. Colour values are
 *  validated as hex before they reach the DOM, so a malicious value
 *  in the database cannot break out of the style property. */
export function applyTenantBranding(school) {
  const root = document.documentElement;
  const hex = (value, fallback) => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value || "")) ? value : fallback);

  const primary = hex(school?.primary_color, null);
  const accent  = hex(school?.secondary_color, null);

  if (primary) {
    root.style.setProperty("--brand-primary", primary);
    root.style.setProperty("--brand-primary-deep", shade(primary, -0.18));
    root.style.setProperty("--brand-primary-soft", tint(primary, 0.9));
    root.style.setProperty("--brand-on-primary", readableOn(primary));
  }
  if (accent) root.style.setProperty("--brand-accent", accent);

  document.title = school?.name ? `${school.name} — AMA EDU` : "AMA EDU";

  const favicon = document.querySelector("link[rel='icon']");
  if (favicon && school?.favicon_url) {
    try {
      const url = new URL(school.favicon_url, window.location.origin);
      if (url.protocol === "https:") favicon.href = url.href;
    } catch {}
  }
}

/* Small colour helpers — keeps a school's chosen colour usable for
   hovers, tints and text contrast without shipping a colour library. */
function parseHex(hex) {
  let value = hex.replace("#", "");
  if (value.length === 3) value = value.split("").map(c => c + c).join("");
  return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16));
}
function toHex(rgb) {
  return "#" + rgb.map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("");
}
function shade(hex, amount) {
  return toHex(parseHex(hex).map(c => c + (amount < 0 ? c * amount : (255 - c) * amount)));
}
function tint(hex, amount) {
  return toHex(parseHex(hex).map(c => c + (255 - c) * amount));
}
function readableOn(hex) {
  const [r, g, b] = parseHex(hex).map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? "#12211b" : "#ffffff";
}
