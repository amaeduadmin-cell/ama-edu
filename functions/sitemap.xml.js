/* ===============================================================
   /sitemap.xml — generated on request by a Cloudflare Pages Function.

   The list of schools and blog posts is user-created and changes daily,
   so a file committed to the repo would always be out of date. This
   asks Supabase for the public directory and the published posts (the
   same two public functions the site itself uses, which expose no
   private data) and returns them as XML.

   Environment variables (Cloudflare Pages → Settings → Environment
   variables). The two VITE_ ones already exist for the build; Pages
   makes them available here too:
     VITE_SUPABASE_URL        https://<project-ref>.supabase.co
     VITE_SUPABASE_ANON_KEY   the anon / publishable key
     VITE_ROOT_DOMAIN         amaedu.com.ng   (optional; this is the default)
   =============================================================== */

const STATIC = [
  ["/", "weekly", "1.0"],
  ["/register", "monthly", "0.8"],
  ["/find-school", "daily", "0.7"],
  ["/blog", "weekly", "0.6"],
];

const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function rpc(env, name, body) {
  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${name} responded ${res.status}`);
  return res.json();
}

export async function onRequestGet({ env }) {
  const root = env.VITE_ROOT_DOMAIN || "amaedu.com.ng";
  const origin = `https://${root}`;
  const urls = STATIC.map(([path, freq, priority]) => ({ loc: `${origin}${path}`, freq, priority }));

  // If Supabase is unreachable, still return the static entries. A sitemap
  // that lists fewer URLs is far better than one that errors.
  try {
    const [schools, posts] = await Promise.all([
      rpc(env, "public_school_directory", { p_limit: 500 }),
      rpc(env, "public_posts", { p_limit: 50 }),
    ]);
    for (const s of schools || []) {
      if (s.slug) urls.push({ loc: `${origin}/schools/${encodeURIComponent(s.slug)}`, freq: "monthly", priority: "0.5" });
    }
    for (const p of posts || []) {
      if (p.slug) {
        urls.push({
          loc: `${origin}/blog/${encodeURIComponent(p.slug)}`, freq: "monthly", priority: "0.6",
          lastmod: p.published_at ? new Date(p.published_at).toISOString().slice(0, 10) : null,
        });
      }
    }
  } catch (err) {
    console.error("sitemap: could not read Supabase", err);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url>\n    <loc>${esc(u.loc)}</loc>\n${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ""}    <changefreq>${u.freq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`).join("\n") +
    `\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Crawlers do not need minute-fresh data; this also protects the database.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
