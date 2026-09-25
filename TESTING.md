# Testing and release checks

## Automated checks currently run

- `npm run build` — Vite production build.
- `git diff --check` — whitespace and patch validation.
- Supabase migration application through the connected project.
- Live schema verification through `information_schema.columns` and table inspection.

## Required production checks

- RLS cross-school reads and writes using two school accounts.
- Public RPC response minimization for school profiles, report verification, maintenance, and status.
- Billing invoice snapshot preservation for 0, 1, 100, and 1,000 active students.
- Duplicate payment webhook/idempotency behavior.
- Result publication, locking, correction/version audit, and fee-lock separation.
- Reserved subdomain and wildcard DNS routing.
- Mobile keyboard/focus/accessibility pass on registration, score entry, and report pages.

Do not mark usage, revenue, uptime, or payment success as real until an actual provider or scheduled aggregation job has recorded it.

## 2026-09-25 validation run

The production build passed after the operations UI and public status/maintenance routes were added. Every `src/*.js` file passed `node --check`, `git diff --check` passed, the live Supabase probes returned one maintenance row and nine service-status rows, and all ten new operational tables reported both RLS and forced RLS enabled. The public maintenance and status RPCs were confirmed executable by `anon` and `authenticated`.

The built-output credential scan found only the literal names `PAYSTACK_SECRET` and `FLUTTERWAVE_SECRET` in the admin guidance text. No service-role token, JWT, `sk_live_*`, or `sk_test_*` value was present, and no secret-like assignment was found. The existing Python Supabase probe could not run from this shell because `SUPABASE_URL` and `SUPABASE_KEY` are not exported; equivalent live checks were run through the configured Supabase connector.

The next billing slice also passed validation: migration `0050_invoice_generation_snapshot.sql` is live, `create_school_billing_invoice` exists, the `school_invoice_period_unique` index exists, the production build passed, all source JavaScript passed syntax checks, and `git diff --check` passed. No invoice was generated during testing because doing so would create financial records in the live project.

The payment webhook phase was structurally validated: the Edge Function is configured with `verify_jwt = false` for provider callbacks, references only Edge Function secret names, writes through the existing `billing_events` and `school_invoice_payments` schemas, verifies provider signatures before parsing events, confirms successful transactions with the provider API, and handles duplicate provider references idempotently. Deno is not installed in this sandbox, so `deno check` could not run; the frontend build, all source JavaScript syntax checks, SQL schema probes, and repository diff checks passed. Provider webhooks were not sent during testing because no live payment or secret configuration was available.

The automated billing phase was validated live: `run_billing_automation` exists, the `amaedu-billing-automation` cron job is active on `15 2 * * *` (02:15 UTC), and `platform_automation_runs` has forced RLS with an admin policy. The frontend build, every source JavaScript syntax check, `git diff --check`, Edge Function presence/configuration checks, and bounded-query checks passed. The runner was not manually executed against production during validation because it intentionally writes daily usage snapshots and can change overdue invoice/subscription state.
