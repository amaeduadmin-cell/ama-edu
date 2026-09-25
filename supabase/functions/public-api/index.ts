import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "x-ama-api-key, content-type", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...CORS, ...extra, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const hash = async (value: string) => { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join(""); };
const hasScope = (scopes: string[], required: string) => scopes.includes(required);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const token = req.headers.get("x-ama-api-key")?.trim() || "";
  const separator = token.indexOf(".");
  if (!token.startsWith("ama_") || separator < 5) return json({ error: "Missing or invalid API key" }, 401);
  const keyId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (secret.length < 32) return json({ error: "Missing or invalid API key" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await admin.rpc("authenticate_api_key", { p_key_id: keyId, p_secret_hash: await hash(secret) });
  const identity = Array.isArray(auth) ? auth[0] : auth;
  if (authError || !identity?.school_id) return json({ error: "Invalid or expired API key" }, 401);
  if (!identity.allowed) return json({ error: "Rate limit exceeded" }, 429, { "Retry-After": "60" });
  const scopes = identity.scopes || [];
  const rawParts = new URL(req.url).pathname.split("/").filter(Boolean);
  const schoolIndex = rawParts.indexOf("schools");
  const parts = schoolIndex >= 0 ? rawParts.slice(schoolIndex) : [];
  if (parts[0] !== "schools" || !parts[1]) return json({ error: "Unknown endpoint" }, 404);
  const slug = decodeURIComponent(parts[1]).toLowerCase();

  const { data: school, error: schoolError } = await admin.rpc("list_public_school", { p_slug: slug });
  const schoolRow = Array.isArray(school) ? school[0] : school;
  if (schoolError || !schoolRow || schoolRow.id !== identity.school_id) return json({ error: "School not found" }, 404);
  if (parts.length === 2) return json({ data: schoolRow });
  if (parts[2] === "students") {
    if (!hasScope(scopes, "students:read")) return json({ error: "API key scope required: students:read" }, 403);
    const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit") || 50), 1), 100);
    const { data, error } = await admin.from("students").select("id,admission_no,full_name,gender,class_id,is_active").eq("school_id", identity.school_id).order("full_name").limit(limit);
    if (error) return json({ error: "Unable to load students" }, 500);
    return json({ data: data || [], meta: { limit, count: data?.length || 0 } });
  }
  if (parts[2] === "notifications") {
    if (!hasScope(scopes, "notifications:read")) return json({ error: "API key scope required: notifications:read" }, 403);
    const { data, error } = await admin.from("notifications").select("id,kind,title,body,entity,entity_id,created_at").eq("school_id", identity.school_id).order("created_at", { ascending: false }).limit(100);
    if (error) return json({ error: "Unable to load notifications" }, 500);
    return json({ data: data || [] });
  }
  return json({ error: "Unknown endpoint" }, 404);
});
