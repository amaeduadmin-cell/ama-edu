# AMA EDU billing

AMA EDU billing is separate from school fee collection. School fees remain in `school_payment_settings`, `fee_payments`, and related school-scoped tables. AMA EDU subscription billing uses:

- `billing_plans` — configurable plan, school type, base price, per-student price, period, grace days, and effective date.
- `school_subscriptions` — one current subscription per school with grace/read-only/suspension states and a student snapshot.
- `school_billing_invoices` — immutable historical period and student snapshot with lifecycle states.
- `school_invoice_items` — preserved invoice line items.
- `school_invoice_payments` — provider-neutral payment records with duplicate provider-reference protection.
- `billing_events` — idempotent provider event ledger.

Pricing is data-driven. Old invoices must never be recalculated from today's student count. Payment gateway secrets must be configured as Edge Function secrets; the admin UI can disable the gateway connection without exposing or deleting a secret.

Automated invoice generation, provider webhooks, and scheduled usage aggregation should run as authenticated Edge Functions or scheduled jobs, not in the browser.
