# Deployment

## Browser environment

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_ROOT_DOMAIN` (defaults to `amaedu.com.ng`)

Never place a Supabase service-role key or payment secret in `VITE_*` variables.

## Domains

- `amaedu.com.ng` and `www.amaedu.com.ng` — public platform
- `admin.amaedu.com.ng` — platform admin entry point (route-compatible today)
- `status.amaedu.com.ng` — status page (route-compatible today)
- `maintenance.amaedu.com.ng` — maintenance page (route-compatible today)
- `*.amaedu.com.ng` — school tenants

Configure wildcard DNS and TLS at Cloudflare, then route all hosts to the same static application. An edge worker should eventually intercept active maintenance windows while preserving `/status` and platform-admin bypass.

## Secrets

Configure gateway secret keys, webhook signing secrets, email/SMS credentials, and any monitoring provider tokens in Supabase Edge Function or Cloudflare secret storage. Do not commit them.
