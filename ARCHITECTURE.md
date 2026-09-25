# AMA EDU architecture

AMA EDU is a Vite single-page application backed by Supabase PostgreSQL, Auth, RLS, and public security-definer RPCs. One codebase serves the apex marketing/admin site and school tenant portals.

## Request flow

1. `src/lib/tenant.js` resolves the hostname to one tenant slug and rejects reserved labels.
2. `src/main.js` loads only a narrow public school profile before registering tenant routes.
3. Auth state is loaded through `src/lib/auth.js`; authenticated data is constrained by the user's school membership and database RLS.
4. Pages use the Supabase browser client. No service-role credential is shipped to the browser.
5. Academic writes that require workflow or audit controls use database RPCs.

## Database boundaries

Every tenant-owned table carries `school_id` and uses `app.current_school_id()`/`app.owns()` in RLS. Platform-only tables use `app.is_platform_admin()`. Public pages use narrow RPCs rather than direct table access.

Migration `0048_platform_operations_and_billing_foundations.sql` adds normalized AMA EDU billing, historical invoice snapshots, usage snapshots, alerts, maintenance state, and service status without mixing them with school fee collection.

## Domain model

Production uses `amaedu.com.ng` for the platform and `<slug>.amaedu.com.ng` for tenants. `RESERVED_SLUGS` is centralized in `src/lib/tenant.js`; hostnames select presentation and lookup only, never authorization.
