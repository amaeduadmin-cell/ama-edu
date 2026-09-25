# Maintenance and status

Migration `0048_platform_operations_and_billing_foundations.sql` provides `platform_maintenance` and `platform_service_status` with platform-admin-only writes and public read RPCs:

- `/maintenance` renders the current maintenance message and end time.
- `/status` renders service-by-service status and last-checked timestamps.

The database state is suitable for an edge-level maintenance interceptor, but Cloudflare interception still needs to be configured in the production account. Application routes should remain available for platform-admin bypass and status visibility.

## Monitoring and disaster recovery

Migration `0057_reliability_backup_dr_foundations.sql` adds forced-RLS health checks, incident records, backup verification metadata, restore-drill evidence, and a reliability run ledger. The `amaedu-reliability-checks` pg_cron job runs every 15 minutes and records database and billing-automation health. Migrations `0058` and `0059` harden the runner after live validation of PostgreSQL output-column name collisions.

The platform records whether a backup artifact was completed or verified; it does not pretend to create a provider backup from inside the application. Supabase backup/PITR settings, off-site exports, Storage-object backup, and restore-to-isolated-project drills remain production operations and are documented in `RELIABILITY.md`.

## Recovery baseline

- Supabase database backups and point-in-time recovery should be enabled in the project plan.
- Keep migration files and deployment configuration in GitHub.
- Store gateway, email, and provider secrets in Supabase/Cloudflare secret stores, never in Git.
- Test restoring a non-production project from a recent backup before changing production schema.
- Record DNS, wildcard TLS, Cloudflare routes, Supabase project ID, and required environment variables in the deployment runbook.

## Automated billing and usage runner

Migration `0051_billing_automation_runner.sql` adds a forced-RLS run ledger and a security-definer runner. Migration `0052_schedule_billing_automation.sql` enables the daily `pg_cron` job `amaedu-billing-automation` at **02:15 UTC**. Each run captures active students and staff into `school_usage_snapshots`, changes expired active/trial subscriptions to grace, marks overdue invoices, and creates deduplicated usage/billing alerts. The `billing-automation` Edge Function is also available for a trusted external scheduler using the `AUTOMATION_RUNNER_SECRET` header; it does not accept browser credentials.
