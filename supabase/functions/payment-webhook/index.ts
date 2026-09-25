// AMA EDU — payment-webhook
// Public callback endpoint for provider webhooks. Secrets are Edge Function
// secrets only; no provider secret is accepted from the request or browser.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

const encoder = new TextEncoder();

async function hmacSha512(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equal(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function verifyPaystack(raw: string, signature: string) {
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  return Boolean(secret && equal(await hmacSha512(secret, raw), signature));
}

function verifyFlutterwave(signature: string) {
  const secretHash = Deno.env.get("FLUTTERWAVE_SECRET_HASH");
  return Boolean(secretHash && equal(secretHash, signature));
}

async function verifyTransaction(provider: string, data: Record<string, unknown>) {
  const secret = provider === "paystack" ? Deno.env.get("PAYSTACK_SECRET_KEY") : Deno.env.get("FLUTTERWAVE_SECRET_KEY");
  if (!secret) return null;
  if (provider === "paystack") {
    const reference = String(data.reference ?? "");
    if (!reference) return null;
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!response.ok) return null;
    const result = await response.json();
    return result?.status === true && result?.data?.status === "success" ? result.data : null;
  }
  const transactionId = String(data.id ?? "");
  if (!transactionId) return null;
  const response = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!response.ok) return null;
  const result = await response.json();
  return result?.status === "success" && result?.data?.status === "successful" ? result.data : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const provider = new URL(req.url).searchParams.get("provider")?.toLowerCase();
  if (provider !== "paystack" && provider !== "flutterwave") return json({ error: "Unknown payment provider" }, 400);

  const raw = await req.text();
  const signature = provider === "paystack"
    ? req.headers.get("x-paystack-signature") ?? ""
    : req.headers.get("verif-hash") ?? "";
  const valid = provider === "paystack" ? await verifyPaystack(raw, signature) : verifyFlutterwave(signature);
  if (!valid) return json({ error: "Invalid webhook signature" }, 401);

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw); } catch { return json({ error: "Invalid JSON" }, 400); }
  const eventType = String(payload.event ?? payload.event_type ?? "unknown");
  const data = (payload.data && typeof payload.data === "object" ? payload.data : {}) as Record<string, unknown>;
  const reference = String(data.reference ?? data.tx_ref ?? data.id ?? "");
  if (!reference) return json({ error: "Missing provider reference" }, 400);

  // Confirm the transaction with the provider before recording money as paid.
  const verified = eventType === "charge.success" || eventType === "charge.completed"
    ? await verifyTransaction(provider, data)
    : null;
  if ((eventType === "charge.success" || eventType === "charge.completed") && !verified) {
    return json({ error: "Provider transaction verification failed" }, 502);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const eventKey = `${provider}:${reference}`;
  const { data: event, error: eventError } = await admin.from("billing_events").insert({
    event_type: `${provider}.${eventType}`,
    provider_reference: eventKey,
    payload,
  }).select("id").single();
  if (eventError) {
    if (eventError.code === "23505") return json({ ok: true, duplicate: true });
    console.error("payment webhook event insert failed", eventError.code);
    return json({ error: "Could not record payment event" }, 500);
  }

  if (verified) {
    const metadata = (data.metadata && typeof data.metadata === "object" ? data.metadata : {}) as Record<string, unknown>;
    const invoiceId = String(metadata.invoice_id ?? "");
    let invoiceQuery = admin.from("school_billing_invoices").select("id,school_id,currency").limit(1);
    if (invoiceId) invoiceQuery = invoiceQuery.eq("id", invoiceId);
    else invoiceQuery = invoiceQuery.eq("invoice_number", String(metadata.invoice_number ?? data.reference ?? data.tx_ref ?? ""));
    const { data: invoices } = await invoiceQuery;
    const invoice = invoices?.[0];
    if (invoice) {
      const amount = Number(verified.amount ?? data.amount ?? 0);
      const currency = String(verified.currency ?? data.currency ?? invoice.currency);
      await admin.from("school_invoice_payments").upsert({
        invoice_id: invoice.id, amount, currency, provider, provider_reference: reference,
        status: "confirmed", paid_at: new Date().toISOString(),
      }, { onConflict: "provider,provider_reference" });
      await admin.from("school_billing_invoices").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", invoice.id);
    }
  }
  return json({ ok: true, event_id: event.id });
});
