import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sign = async (secret: string, body: string) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const expected = Deno.env.get("AMA_AUTOMATION_SECRET") || "";
  if (!expected || req.headers.get("x-ama-automation-secret") !== expected) return json({ error: "Unauthorized" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const signingSecret = Deno.env.get("WEBHOOK_SIGNING_SECRET") || "";
  if (!signingSecret) return json({ error: "WEBHOOK_SIGNING_SECRET is not configured" }, 503);
  const { data: jobs, error } = await admin.from("notification_deliveries").select("id,school_id,subscription_id,event_name,payload,attempts").eq("status", "pending").lte("next_attempt_at", new Date().toISOString()).order("created_at").limit(50);
  if (error) return json({ error: "Unable to load delivery queue" }, 500);
  let sent = 0; let failed = 0;
  for (const job of jobs || []) {
    const { data: subscription } = await admin.from("webhook_subscriptions").select("endpoint_url,is_active").eq("id", job.subscription_id).single();
    if (!subscription?.is_active) { await admin.from("notification_deliveries").update({ status: "failed", last_error: "Subscription inactive", attempts: job.attempts + 1 }).eq("id", job.id); failed++; continue; }
    const body = JSON.stringify({ event: job.event_name, delivery_id: job.id, data: job.payload });
    try {
      const response = await fetch(subscription.endpoint_url, { method: "POST", headers: { "Content-Type": "application/json", "X-AMA-Event": job.event_name, "X-AMA-Delivery": job.id, "X-AMA-Signature": `sha256=${await sign(signingSecret, body)}` }, body });
      if (!response.ok) throw new Error(`Endpoint returned ${response.status}`);
      await admin.from("notification_deliveries").update({ status: "sent", attempts: job.attempts + 1, delivered_at: new Date().toISOString(), last_error: null }).eq("id", job.id);
      sent++;
    } catch (err) {
      const attempts = job.attempts + 1;
      await admin.from("notification_deliveries").update({ status: attempts >= 6 ? "failed" : "pending", attempts, last_error: String(err).slice(0, 500), next_attempt_at: new Date(Date.now() + Math.min(60 * 60 * 1000, 2 ** attempts * 1000)).toISOString() }).eq("id", job.id);
      failed++;
    }
  }
  return json({ processed: (jobs || []).length, sent, failed });
});
