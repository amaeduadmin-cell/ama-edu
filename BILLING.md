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

Migration `0050_invoice_generation_snapshot.sql` adds the first server-side invoice-generation operation. A platform administrator supplies a school, active plan, and billing period; the function snapshots the current active-student count, calculates the configured base/per-student total, writes immutable invoice line items, and prevents duplicate invoices for the same school and period with a unique index. It does not process a payment or claim that an invoice is paid.

The `payment-webhook` Edge Function is prepared for Paystack and Flutterwave callbacks. Paystack signatures are verified with `PAYSTACK_SECRET_KEY`; Flutterwave callbacks use `FLUTTERWAVE_SECRET_HASH`; successful events are confirmed against the provider API before an invoice payment is recorded. Each provider reference is stored in `billing_events` before payment mutation, so retries return a duplicate success response instead of double-counting. The function is deliberately not deployed until the corresponding Supabase Edge Function secrets are configured.
