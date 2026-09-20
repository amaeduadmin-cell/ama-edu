/* ===============================================================
   SEO helpers.

   This is a single-page app, so the crawler-visible <title>, meta
   description, canonical link, Open Graph and JSON-LD have to be
   written at runtime as each route renders. index.html carries sane
   defaults so a crawler that executes no JavaScript still sees
   something truthful.

   Private portal routes call setSeo({ noindex: true }), which emits
   <meta name="robots" content="noindex, nofollow"> — dashboards must
   never appear in search results.
   =============================================================== */

function upsertMeta(selector, attrs) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement("meta");
    document.head.appendChild(el);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) el.removeAttribute(k); else el.setAttribute(k, v);
  }
  return el;
}

function upsertLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!href) { el?.remove(); return; }
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export function setSeo({ title, description, canonical, image, noindex = false, type = "website" } = {}) {
  if (title) document.title = title;

  upsertMeta('meta[name="description"]', { name: "description", content: description || "" });
  upsertMeta('meta[name="robots"]', {
    name: "robots",
    content: noindex ? "noindex, nofollow" : "index, follow",
  });

  upsertMeta('meta[property="og:title"]', { property: "og:title", content: title || "" });
  upsertMeta('meta[property="og:description"]', { property: "og:description", content: description || "" });
  upsertMeta('meta[property="og:type"]', { property: "og:type", content: type });
  upsertMeta('meta[property="og:url"]', { property: "og:url", content: canonical || window.location.href });
  if (image) upsertMeta('meta[property="og:image"]', { property: "og:image", content: image });

  upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: image ? "summary_large_image" : "summary" });
  upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: title || "" });
  upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: description || "" });
  if (image) upsertMeta('meta[name="twitter:image"]', { name: "twitter:image", content: image });

  upsertLink("canonical", canonical || null);
}

/** Write (or replace) a JSON-LD block. Serialised with JSON.stringify,
 *  never by string concatenation, so school and post content cannot
 *  break out of the script element. */
export function jsonLd(id, data) {
  const elementId = `ld-${id}`;
  document.getElementById(elementId)?.remove();
  if (!data) return;
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.id = elementId;
  script.textContent = JSON.stringify(data, (_k, v) => (v === undefined ? undefined : v));
  document.head.appendChild(script);
}

/** Mark every authenticated portal page as noindex. */
export function setPrivatePage(title) {
  setSeo({ title, description: "", noindex: true });
}
