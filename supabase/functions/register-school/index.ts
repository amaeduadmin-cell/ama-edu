// ===============================================================
// AMA EDU — register-school (RETIRED)
//
// Schools no longer create themselves. They submit an application through
// the database function public.submit_school_application(), a platform admin
// approves it in the dashboard, and the school is then built by hand with
// public.provision_school_application() (see migration 0042).
//
// This endpoint is deployed with verify_jwt = false, so leaving the old
// implementation in place would let anyone skip the approval step by calling
// it directly. It now answers 410 Gone to everything.
//
// Deploy this TOGETHER with the front-end change that replaces the
// registration form with the application form; until the new form ships,
// the old page will show this message instead of creating a school.
// ===============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  // x-ama-client is sent on EVERY request by src/lib/supabase.js; without it in this
  // list the browser blocks the call after a successful preflight.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ama-client, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  return new Response(
    JSON.stringify({
      error: "Schools no longer register instantly. Please submit a school application and the AMA EDU team will review it.",
    }),
    { status: 410, headers: { ...CORS, "Content-Type": "application/json" } },
  );
});
