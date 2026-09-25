-- AMA EDU 0046 — private school payment instructions and editable founder profile
-- No gateway secrets or API keys are stored. School payment details are visible only
-- to authenticated members of that school; only school administrators can edit them.

create table if not exists public.school_payment_settings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null unique references public.schools(id) on delete cascade,
  method text not null default 'bank_transfer' check (method in ('bank_transfer','both','manual')),
  bank_name text check (bank_name is null or length(btrim(bank_name)) between 2 and 120),
  account_name text check (account_name is null or length(btrim(account_name)) between 2 and 160),
  account_number text check (account_number is null or account_number ~ '^[0-9A-Za-z /-]{6,40}$'),
  payment_instructions text check (payment_instructions is null or length(payment_instructions) <= 2000),
  is_active boolean not null default true,
  updated_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (method <> 'bank_transfer' or bank_name is not null or account_number is not null)
);
create trigger school_payment_settings_touch before update on public.school_payment_settings
  for each row execute function app.touch_updated_at();
alter table public.school_payment_settings enable row level security;
alter table public.school_payment_settings force row level security;
create policy school_payment_settings_read on public.school_payment_settings for select to authenticated
  using (app.current_school_id() = school_id and is_active);
create policy school_payment_settings_admin_write on public.school_payment_settings for all to authenticated
  using (app.owns(school_id) and app.is_school_admin())
  with check (app.owns(school_id) and app.is_school_admin());
revoke all on public.school_payment_settings from anon;
grant select on public.school_payment_settings to authenticated;
grant all on public.school_payment_settings to service_role;

alter table public.platform_settings add column if not exists founder_name text;
alter table public.platform_settings add column if not exists founder_title text;
alter table public.platform_settings add column if not exists founder_history text;
alter table public.platform_settings add column if not exists founder_image_url text;

drop function if exists public.public_platform_content();
create function public.public_platform_content()
returns table (site_name text, tagline text, about_text text, contact_email text,
               contact_phone text, contact_address text, logo_url text, favicon_url text,
               og_image_url text, seo_title text, seo_description text,
               social_links jsonb, features jsonb, faqs jsonb, plans jsonb, announcement text,
               founder_name text, founder_title text, founder_history text, founder_image_url text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.site_name, s.tagline, s.about_text, s.contact_email, s.contact_phone,
         s.contact_address, s.logo_url, s.favicon_url, s.og_image_url,
         s.seo_title, s.seo_description, s.social_links, s.features, s.faqs, s.plans, s.announcement,
         s.founder_name, s.founder_title, s.founder_history, s.founder_image_url
  from public.platform_settings s where s.id;
$$;
grant execute on function public.public_platform_content() to anon, authenticated;
