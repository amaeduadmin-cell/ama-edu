# API and edge security references

- Cloudflare API Shield overview: https://developers.cloudflare.com/api-shield/get-started/
- Cloudflare API Shield JWT validation: https://developers.cloudflare.com/api-shield/security/jwt-validation/
- Cloudflare WAF token authentication: https://developers.cloudflare.com/waf/custom-rules/use-cases/configure-token-authentication/
- Supabase Edge Function authentication: https://supabase.com/docs/guides/functions/auth
- Supabase API keys overview: https://supabase.com/docs/guides/getting-started/api-keys

Design implications used in this phase: validate credentials at the Edge Function and again at the data layer; use Cloudflare rate limiting/API Shield for public routes; do not expose service-role keys; treat public API credentials as scoped, revocable secrets.
