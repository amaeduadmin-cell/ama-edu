-- ===============================================================
-- AMA EDU 0027 — carry the report-card template in the tenant config
--
-- fetchTenantConfig() in src/lib/tenant.js calls public_school_by_slug()
-- at boot and that result becomes context.school, which the report-card
-- renderer reads to decide which template to draw. Without the column
-- here every school would silently fall back to the classic layout no
-- matter what it had chosen in Settings.
--
-- Still deliberately narrow: presentation fields only, active schools
-- only, no roster or result data.
-- ===============================================================

create or replace function public.public_school_by_slug(p_slug text)
returns table (
  id uuid, name text, slug text, motto text,
  logo_url text, favicon_url text,
  primary_color text, secondary_color text,
  school_type text, status text,
  address text, current_term_label text,
  report_card_template text, short_name text, public_about text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.name, s.slug, s.motto,
         s.logo_url, s.favicon_url,
         s.primary_color, s.secondary_color,
         s.school_type::text, s.status::text,
         s.address,
         (select t.label || ' Term, ' || se.label
            from public.terms t join public.sessions se on se.id = t.session_id
           where t.school_id = s.id and t.is_active limit 1),
         s.report_card_template, s.short_name, s.public_about
  from public.schools s
  where s.slug = lower(btrim(p_slug))
    and s.status in ('active','suspended');
$$;
grant execute on function public.public_school_by_slug(text) to anon, authenticated;
