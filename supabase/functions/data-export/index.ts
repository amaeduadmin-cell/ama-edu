// AMA EDU — data-export
// The browser requests a job; this function performs the export with the
// service role and returns a short-lived private Storage URL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Not signed in" }, 401);
  const body = await req.json().catch(() => ({}));
  const jobId = typeof body?.job_id === "string" ? body.job_id : "";
  if (!jobId) return json({ error: "job_id is required" }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: me, error: meError } = await caller.rpc("current_app_user");
  if (meError) return json({ error: "Could not validate session" }, 401);
  const who = Array.isArray(me) ? me[0] : me;
  const { data: job, error: jobError } = await admin.from("data_export_jobs").select("id,school_id,requested_by,scope,format,status").eq("id", jobId).limit(1).maybeSingle();
  if (jobError || !job) return json({ error: "Export job not found" }, 404);
  const allowed = Boolean(who?.is_platform_admin || (who?.school_id === job.school_id && (who?.roles || []).some((role: string) => role === "admin")));
  if (!allowed) return json({ error: "You cannot access this export" }, 403);
  if (job.status === "ready") return json({ error: "Export already completed; request a new export" }, 409);
  await admin.from("data_export_jobs").update({ status: "running", error_message: null }).eq("id", job.id);

  try {
    const payload: Record<string, unknown> = { exported_at: new Date().toISOString(), school_id: job.school_id, scope: job.scope };
    const tables: Record<string, string[]> = {
      school: ["schools", "staff", "students", "parents", "classes", "subjects", "terms"],
      students: ["students", "parents", "parent_students", "classes"],
      academic: ["students", "classes", "subjects", "terms", "student_term_summary"],
      billing: ["school_subscriptions", "school_billing_invoices", "school_invoice_items", "school_invoice_payments"],
    };
    for (const table of tables[job.scope] || tables.school) {
      const query = admin.from(table).select("*");
      const scoped = table === "schools" ? query.eq("id", job.school_id) : query.eq("school_id", job.school_id);
      const { data, error } = await scoped.limit(10000);
      if (error) throw new Error(`Could not export ${table}`);
      payload[table] = data || [];
    }
    const content = job.format === "csv" ? jsonToCsv(payload) : JSON.stringify(payload, null, 2);
    const path = `${job.school_id}/${job.id}.${job.format}`;
    const upload = await admin.storage.from("data-exports").upload(path, new Blob([content], { type: job.format === "csv" ? "text/csv" : "application/json" }), { upsert: true, contentType: job.format === "csv" ? "text/csv" : "application/json" });
    if (upload.error) throw upload.error;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const signed = await admin.storage.from("data-exports").createSignedUrl(path, 3600);
    if (signed.error) throw signed.error;
    await admin.from("data_export_jobs").update({ status: "ready", storage_path: path, completed_at: new Date().toISOString(), expires_at: expiresAt }).eq("id", job.id);
    return json({ ok: true, job_id: job.id, signed_url: signed.data.signedUrl, expires_at: expiresAt });
  } catch (error) {
    console.error("data export failed", error instanceof Error ? error.message : "unknown");
    await admin.from("data_export_jobs").update({ status: "failed", error_message: "Export could not be completed" }).eq("id", job.id);
    return json({ error: "Export could not be completed" }, 500);
  }
});

function jsonToCsv(payload: Record<string, unknown>) {
  const lines: string[] = [];
  for (const [table, rows] of Object.entries(payload)) {
    if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== "object") continue;
    lines.push(`# ${table}`);
    const keys = Object.keys(rows[0] as Record<string, unknown>);
    lines.push(keys.join(","));
    for (const row of rows as Record<string, unknown>[]) lines.push(keys.map((key) => csv(String(row[key] ?? ""))).join(","));
    lines.push("");
  }
  return lines.join("\n");
}

function csv(value: string) { return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value; }
