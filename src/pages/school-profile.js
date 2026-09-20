/* ===============================================================
   A school's public page — the front door for search engines.

   Backed by public_school_profile(), which returns presentation
   fields only for ACTIVE, listed schools. No student, staff, fee or
   result data is reachable from here, signed in or not.
   =============================================================== */

import "../styles/marketing.css";
import { h, mount, safeUrl } from "../lib/dom.js";
import { supabase } from "../lib/supabase.js";
import { logError } from "../lib/errors.js";
import { setSeo, jsonLd } from "../lib/seo.js";
import { tenantUrl } from "../lib/tenant.js";

const TYPE_LABEL = {
  nursery_primary: "Nursery & Primary school",
  secondary: "Secondary school",
  combined: "Nursery, Primary & Secondary school",
  islamiyya: "Islamiyya school",
  other: "School",
};

export default async function render({ outlet, params }) {
  const slug = params?.slug || "";
  let school = null;
  try {
    const { data, error } = await supabase.rpc("public_school_profile", { p_slug: slug });
    if (error) throw error;
    school = Array.isArray(data) ? data[0] : data;
  } catch (err) {
    logError("school profile", err);
  }

  if (!school) {
    setSeo({ title: "School not found — AMA EDU", description: "This school profile is not available.", noindex: true });
    return mount(outlet, h("div.panel-page", {}, h("div.panel", {},
      h("h1.panel-title", { text: "School not found" }),
      h("p.panel-sub", { text: "This school is not listed publicly, or the address is wrong." }),
      h("a.btn.btn-outline", { href: "/find-school", text: "Browse schools" }),
    )));
  }

  const portal = tenantUrl(school.slug, "/login");
  const canonical = `${window.location.origin}/schools/${school.slug}`;
  const typeLabel = TYPE_LABEL[school.school_type] || "School";

  setSeo({
    title: `${school.name} — ${typeLabel}`,
    description: school.public_about || school.about || `${school.name}${school.address ? ` in ${school.address}` : ""}. ${typeLabel} on AMA EDU.`,
    canonical,
    image: safeUrl(school.logo_url),
  });

  jsonLd("school-profile", {
    "@context": "https://schema.org",
    "@type": "School",
    name: school.name,
    alternateName: school.short_name || undefined,
    slogan: school.motto || undefined,
    description: school.about || undefined,
    url: canonical,
    logo: safeUrl(school.logo_url) || undefined,
    telephone: school.phone || undefined,
    email: school.email || undefined,
    address: school.address ? { "@type": "PostalAddress", streetAddress: school.address, addressCountry: "NG" } : undefined,
  });

  const logo = safeUrl(school.logo_url);

  mount(outlet,
    h("div.marketing", {},
      h("header.mk-hero", {},
        logo ? h("img", { src: logo, alt: "", style: { width: "72px", height: "72px", objectFit: "contain", borderRadius: "12px" } }) : null,
        h("h1.mk-title", { text: school.name }),
        school.motto ? h("p.mk-sub", { text: school.motto }) : null,
        h("p.mk-sub", { text: typeLabel }),
        h("div.u-row", { style: { gap: "8px", justifyContent: "center", flexWrap: "wrap", marginTop: "14px" } },
          h("a.btn.btn-primary", { href: portal, text: "School portal" }),
          h("a.btn.btn-outline", { href: "/find-school", text: "Other schools" }),
        ),
      ),
      school.about ? h("section.mk-section", {},
        h("h2", { text: "About the school" }),
        h("p", { text: school.about })) : null,
      h("section.mk-section", {},
        h("h2", { text: "Contact" }),
        h("ul", { style: { listStyle: "none", padding: 0 } },
          school.address ? h("li", { text: school.address }) : null,
          school.phone ? h("li", {}, h("a", { href: `tel:${school.phone}`, text: school.phone })) : null,
          school.email ? h("li", {}, h("a", { href: `mailto:${school.email}`, text: school.email })) : null,
          school.website ? h("li", {}, h("a", { href: safeUrl(school.website) || "#", rel: "noopener", text: school.website })) : null,
        ),
      ),
      h("footer.mk-foot", {}, h("p.u-xs.u-muted", { text: "Powered by AMA EDU" })),
    ),
  );
}
