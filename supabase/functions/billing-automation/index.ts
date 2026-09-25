// AMA EDU — billing-automation
// Invoke this function from a Supabase scheduled job or trusted scheduler.
// The runner secret and service-role key are Edge Function secrets only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

function equal(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const expected = Deno.env.get("AUTOMATION_RUNNER_SECRET") ?? "";
  const received = req.headers.get("x-ama-automation-secret") ?? "";
  if (!equal(expected, received)) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const runKey = typeof body?.run_key === "string" && body.run_key.trim()
    ? body.run_key.trim()
    : `billing:${new Date().toISOString().slice(0, 10)}`;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("run_billing_automation", { p_run_key: runKey });
  if (error) {
    console.error("billing automation failed", error.code);
    return json({ error: "Billing automation failed" }, 500);
  }
  return json({ ok: true, run: Array.isArray(data) ? data[0] : data });
});
