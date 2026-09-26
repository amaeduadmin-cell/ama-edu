const BYPASS_PATHS = new Set(["/maintenance", "/status", "/admin", "/assets", "/favicon.ico", "/robots.txt", "/sitemap.xml", "/sw.js"]);
function bypass(pathname) { return BYPASS_PATHS.has(pathname) || pathname.startsWith("/admin/") || pathname.startsWith("/assets/"); }
async function isMaintenanceActive(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/public_platform_maintenance`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
      body: "{}", signal: controller.signal, cf: { cacheTtl: 10, cacheEverything: false },
    });
    if (!response.ok) return false;
    const payload = await response.json();
    const row = Array.isArray(payload) ? payload[0] : payload;
    if (!row || row.enabled !== true || !["global", "public"].includes(row.scope)) return false;
    const now = Date.now();
    if (row.starts_at !== null && row.starts_at !== undefined) { const starts = Date.parse(row.starts_at); if (!Number.isFinite(starts) || starts > now) return false; }
    if (row.ends_at !== null && row.ends_at !== undefined) { const ends = Date.parse(row.ends_at); if (!Number.isFinite(ends) || ends < now) return false; }
    return true;
  } catch { return false; } finally { clearTimeout(timer); }
}
addEventListener("fetch", event => {
  event.respondWith((async () => {
    const request = event.request;
    if (request.method !== "GET" && request.method !== "HEAD") return fetch(request);
    const url = new URL(request.url);
    if (url.hostname !== "amaedu.com.ng" || bypass(url.pathname)) return fetch(request);
    if (!(await isMaintenanceActive({ SUPABASE_URL, SUPABASE_ANON_KEY }))) return fetch(request);
    return new Response(null, { status: 302, headers: { Location: "https://amaedu.com.ng/maintenance", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  })());
});
