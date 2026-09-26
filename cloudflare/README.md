# AMA EDU maintenance gate

Deployed Worker: `amaedu-maintenance-gate`

Route: `amaedu.com.ng/*`

The Worker calls the existing Supabase RPC `public_platform_maintenance` with the anonymous key and fails open on timeout, invalid responses, RPC errors, or missing secrets. It only evaluates GET and HEAD requests. Maintenance, status, admin, assets, favicon, robots, sitemap, and service-worker paths bypass the gate.

## Cloudflare secrets

Configure these as Worker secrets only; never commit values:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Do not use a Supabase service-role key.

## Operational behavior

When the RPC returns `enabled: true`, scope `global` or `public`, and the optional schedule is active, the Worker returns a query-free `302` to `https://amaedu.com.ng/maintenance` with `Cache-Control: no-store` and `X-Robots-Tag: noindex`. Disabling the maintenance switch in AMA EDU causes normal public requests to pass through on the next RPC check.

The Worker is attached only to the existing `amaedu.com.ng` zone route. It does not replace the Cloudflare Pages project or modify DNS records.
