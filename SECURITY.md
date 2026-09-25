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

## Required test cases

1. A user from School A cannot select School B rows by changing IDs or hostnames.
2. A parent cannot read another parent's children.
3. A teacher cannot write outside assigned score windows/classes.
4. A school administrator cannot read or mutate platform billing, maintenance, alerts, or status tables.
5. Anonymous users can call only intentionally public RPCs.
