# AMA EDU reliability and disaster recovery

## What is automated

Supabase PostgreSQL runs `run_reliability_checks` every 15 minutes through the `amaedu-reliability-checks` pg_cron job. Each run is idempotent through `platform_reliability_runs`, records database and billing-automation health, and writes the latest service state to the existing public status model. Platform administrators can inspect recent checks, failures, open incidents, backup records, and restore-drill evidence in Operations.

The reliability runner is intentionally deterministic. It does not silently mutate school records, attempt a live restore, or claim that a backup exists. Failed checks are recorded and should be connected to the existing alert/incident process.

## Backups and retention

Supabase documents daily database backups for Pro, Team, and Enterprise projects, with plan-dependent retention. Free-tier projects should regularly export data with `supabase db dump` and keep an off-site copy. Database backups do not include objects stored through the Storage API, so storage assets require a separate backup plan. AMA EDU therefore keeps backup verification metadata in `platform_backup_runs` and restore evidence in `platform_restore_drills`, but the actual provider backup remains a Supabase Dashboard/CLI or approved external backup-provider operation.

Point-in-Time Recovery (PITR) is the preferred production recovery control where the project plan and budget support it. Supabase states that PITR can restore to a selected point within the configured recovery period, but restoration makes the project temporarily inaccessible and requires downtime planning. Enabling PITR changes the backup model, so the platform owner should record the selected recovery-retention period and review it against the school's recovery objective.

## Recovery objectives

The default operating targets are: **RPO** of one day when relying on daily backups, or the selected PITR window when PITR is enabled; and **RTO** determined by the Supabase restore duration plus DNS/edge validation. These are targets, not guarantees. A platform administrator must record the real restore duration after each drill.

## Restore drill procedure

1. Select a recent verified backup or a PITR recovery point before the incident.
2. Restore into a separate project or approved isolated target whenever possible; do not experiment against the live tenant project.
3. Verify migrations, RLS policies, Auth configuration, Edge Function configuration, Storage buckets, Realtime publications, and the public status/maintenance routes.
4. Run tenant-isolation checks and a representative school login/result/export flow.
5. Record the target, backup reference, timestamps, verification notes, and pass/fail result in `platform_restore_drills`.
6. Only after approval, update DNS/Cloudflare routes and rotate any credentials that were exposed or changed during the incident.

## Incident handling

Use `platform_incidents` for public-facing incident state. Keep messages factual and avoid including student, parent, staff, payment, or credential data. Resolve an incident only after the affected service check is operational and the recovery notes are recorded.

## Sources

Supabase Database Backups: https://supabase.com/docs/guides/platform/backups

Supabase Backup and Restore using the CLI: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
