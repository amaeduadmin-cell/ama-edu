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
