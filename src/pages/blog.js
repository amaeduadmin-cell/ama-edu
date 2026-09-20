/* ===============================================================
   Public blog — list and single post.

   Post bodies are rendered as TEXT nodes, never as HTML. The CMS
   accepts plain text for exactly this reason: a stored post cannot
   inject a script into the public site.
   =============================================================== */

import "../styles/marketing.css";
import { h, mount, safeUrl } from "../lib/dom.js";
import { supabase } from "../lib/supabase.js";
import { logError } from "../lib/errors.js";
import { setSeo, jsonLd } from "../lib/seo.js";

export default async function render({ outlet, params }) {
  return params?.slug ? renderPost(outlet, params.slug) : renderList(outlet);
}

async function renderList(outlet) {
  setSeo({
    title: "News & guides — AMA EDU",
    description: "Updates and practical guides for schools using AMA EDU.",
    canonical: `${window.location.origin}/blog`,
  });

  let posts = [];
  try {
    const { data, error } = await supabase.rpc("public_posts", { p_limit: 30 });
    if (error) throw error;
    posts = data || [];
  } catch (err) { logError("blog list", err); }

  mount(outlet, h("div.marketing", {},
    h("header.mk-hero", {},
      h("h1.mk-title", { text: "News & guides" }),
      h("p.mk-sub", { text: "Updates and practical advice for schools on AMA EDU." })),
    posts.length
      ? h("section.mk-section", {}, posts.map((p) => h("article.card", { style: { marginBottom: "12px" } },
          h("a", { href: `/blog/${p.slug}`, style: { textDecoration: "none" } },
            h("h2", { style: { margin: "0 0 4px" }, text: p.title })),
          h("div.u-xs.u-muted", { text: [p.author_name, p.published_at ? new Date(p.published_at).toLocaleDateString() : null].filter(Boolean).join(" · ") }),
          p.excerpt ? h("p", { text: p.excerpt }) : null,
          h("a.btn.btn-outline.btn-sm", { href: `/blog/${p.slug}`, text: "Read" }),
        )))
      : h("section.mk-section", {}, h("p", { text: "No posts yet." })),
    h("footer.mk-foot", {}, h("a", { href: "/", text: "Back to AMA EDU" })),
  ));
}

async function renderPost(outlet, slug) {
  let post = null;
  try {
    const { data, error } = await supabase.rpc("public_post_by_slug", { p_slug: slug });
    if (error) throw error;
    post = Array.isArray(data) ? data[0] : data;
  } catch (err) { logError("blog post", err); }

  if (!post) {
    setSeo({ title: "Post not found — AMA EDU", description: "", noindex: true });
    return mount(outlet, h("div.panel-page", {}, h("div.panel", {},
      h("h1.panel-title", { text: "Post not found" }),
      h("a.btn.btn-outline", { href: "/blog", text: "All posts" }))));
  }

  const canonical = `${window.location.origin}/blog/${post.slug}`;
  setSeo({
    title: post.seo_title || `${post.title} — AMA EDU`,
    description: post.seo_description || post.excerpt || "",
    canonical, type: "article",
    image: safeUrl(post.featured_image_url),
  });
  jsonLd("post", {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt || undefined,
    image: safeUrl(post.featured_image_url) || undefined,
    datePublished: post.published_at || undefined,
    author: post.author_name ? { "@type": "Organization", name: post.author_name } : undefined,
    publisher: { "@type": "Organization", name: "AMA EDU" },
    mainEntityOfPage: canonical,
  });

  const image = safeUrl(post.featured_image_url);

  mount(outlet, h("div.marketing", {},
    h("article.mk-section", { style: { maxWidth: "720px", margin: "0 auto" } },
      h("h1.mk-title", { style: { textAlign: "left" }, text: post.title }),
      h("div.u-xs.u-muted", { text: [post.author_name, post.published_at ? new Date(post.published_at).toLocaleDateString() : null].filter(Boolean).join(" · ") }),
      image ? h("img", { src: image, alt: "", style: { width: "100%", borderRadius: "12px", margin: "16px 0" } }) : null,
      // Split on blank lines and emit paragraphs as TEXT — no innerHTML.
      ...post.body.split(/\n{2,}/).map((para) => h("p", { style: { whiteSpace: "pre-wrap" }, text: para })),
    ),
    h("footer.mk-foot", {}, h("a", { href: "/blog", text: "All posts" })),
  ));
}
