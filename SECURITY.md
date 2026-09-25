# Security and tenant isolation

- Tenant authorization is database-enforced by membership-backed RLS; a hostname or URL parameter is not trusted.
- Platform administrators are recognized through `app.is_platform_admin()` and have explicit policies on platform tables.
- Public school profiles, posts, report verification, maintenance, and status use narrow read-only RPCs.
- Security-definer functions set `search_path = public, pg_temp`.
- Browser code uses the Supabase anon key only. Service-role credentials belong in server/Edge Function secrets.
- DOM rendering uses text content and safe URL validation to reduce stored-XSS risk.
- Payment gateway secret keys are never stored in Postgres or exposed to the browser; only publishable keys may be configured in platform settings.
- Academic operations and configuration changes write audit records through the existing audit layer.
- Account Settings supports Supabase TOTP MFA enrollment, challenge verification, assurance display, and factor removal. TOTP secrets remain with Supabase Auth and are not stored by AMA EDU.
- Data exports are admin-only and tenant-scoped, use forced RLS on export jobs, private Storage, and one-hour signed URLs. The export Edge Function re-checks the caller's school and role before reading any records.
- Public `/privacy`, `/terms`, and `/acceptable-use` pages document platform, school, and user responsibilities without exposing tenant data.
- Score revisions are database-created after score inserts/updates and cannot be edited by authenticated clients. Correction requests are tenant-scoped, require a staff requester, and administrator approval writes the replacement through a SECURITY DEFINER RPC plus audit event.
- Offline score entry stores only bounded pending score batches in browser local storage, never service-role credentials or private API responses. Queued batches are retried after connectivity returns and remain subject to the same RLS, score validation, lock, and period-window rules when synced.
- Public API keys are stored only as SHA-256 hashes, carry explicit scopes, are revocable, and are rate-limited through a forced-RLS request window. The public API Edge Function resolves the school from the key and never trusts a caller-supplied school ID.
- Webhook integrations require HTTPS, queue notification deliveries through a forced-RLS table, and use signed outbound requests from a trusted dispatcher. Cloudflare remains the outer WAF/rate-limit layer; service-role and webhook-signing secrets are never sent to browsers.

## Required test cases

1. A user from School A cannot select School B rows by changing IDs or hostnames.
2. A parent cannot read another parent's children.
3. A teacher cannot write outside assigned score windows/classes.
4. A school administrator cannot read or mutate platform billing, maintenance, alerts, or status tables.
5. Anonymous users can call only intentionally public RPCs.
