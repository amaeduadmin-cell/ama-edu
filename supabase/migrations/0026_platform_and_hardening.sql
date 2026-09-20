-- ===============================================================
-- AMA EDU 0026 — platform CMS, payments, public profiles, director
-- permissions, and three security fixes carried over from the audit.
-- ===============================================================

-- ---------------- 1. SECURITY FIX: school admins escalating ----------------
-- schools_update_own let a school admin write ANY column on their own
-- school, including status ('suspended' -> 'active'), subscription_plan
-- and slug (stealing another school's subdomain on rename). RLS cannot
-- express "these columns only", so a trigger enforces it.
create or replace function app.guard_school_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.is_platform_admin() or auth.uid() is null then return new; end if;
  if new.slug              is distinct from old.slug
  or new.status            is distinct from old.status
  or new.subscription_plan is distinct from old.subscription_plan
  or new.declared_student_count is distinct from old.declared_student_count then
    raise exception 'Only AMA EDU can change a school''s web address, status or plan.'
      using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists schools_guard on public.schools;
create trigger schools_guard before update on public.schools
  for each row execute function app.guard_school_change();

-- ---------------- 2. SECURITY FIX: teacher score scope ----------------
-- scores_staff_read let any teacher read every student's scores in the
-- school. A teacher should see the classes and subjects they teach (or
-- are form teacher of); heads, admins, bursars and the director keep
-- school-wide sight.
create or replace function app.may_see_scores(p_class_id uuid, p_subject_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when app.is_school_admin() or app.has_role('director','headmaster','principal') then true
    when app.has_role('teacher') then
      app.can_mark(p_class_id, p_subject_id) or app.is_form_teacher(p_class_id)
    when app.is_staff() then true
    else false
  end;
$$;
grant execute on function app.may_see_scores(uuid, uuid) to authenticated;

drop policy if exists scores_staff_read on public.student_scores;
create policy scores_staff_read on public.student_scores
  for select to authenticated
  using (app.owns(school_id) and app.is_reader() and app.may_see_scores(class_id, subject_id));

drop policy if exists summary_staff_read on public.student_term_summary;
create policy summary_staff_read on public.student_term_summary
  for select to authenticated
  using (app.owns(school_id) and app.is_reader()
         and (app.is_school_admin() or app.has_role('director','headmaster','principal')
              or app.is_form_teacher(class_id)));

-- ---------------- 3. SECURITY FIX: registration bootstrap ----------------
-- register-school calls rpc('bootstrap_school_defaults'), but that
-- function lives in the app schema, which PostgREST does not expose --
-- so the call 404s and every self-registered school would be created
-- with no session, terms, classes or grading scale. A public wrapper,
-- reachable only by the service role, calls both bootstrap steps.
create or replace function public.bootstrap_new_school(p_school_id uuid, p_sections text[] default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.bootstrap_school_defaults(p_school_id);
  perform app.bootstrap_school_config(p_school_id, p_sections);

  -- Only keep the classes for the sections the school actually chose.
  if p_sections is not null then
    update public.classes c set is_active = false
    where c.school_id = p_school_id
      and c.category::text <> all (p_sections);
  end if;
end $$;
revoke all on function public.bootstrap_new_school(uuid, text[]) from public, anon, authenticated;
grant execute on function public.bootstrap_new_school(uuid, text[]) to service_role;

-- ---------------- 4. platform content (public website CMS) ----------------
create table if not exists public.platform_settings (
  id                 boolean primary key default true check (id),
  site_name          text not null default 'AMA EDU',
  tagline            text default 'School management for Nigerian schools',
  about_text         text,
  contact_email      text,
  contact_phone      text,
  contact_address    text,
  logo_url           text,
  favicon_url        text,
  og_image_url       text,
  seo_title          text,
  seo_description    text,
  social_links       jsonb not null default '{}'::jsonb,
  features           jsonb not null default '[]'::jsonb,
  faqs               jsonb not null default '[]'::jsonb,
  plans              jsonb not null default '[]'::jsonb,
  announcement       text,
  updated_at         timestamptz not null default now()
);
insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.platform_posts (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,80}[a-z0-9]$'),
  title           text not null check (length(btrim(title)) between 2 and 200),
  excerpt         text,
  body            text not null,
  featured_image_url text,
  seo_title       text,
  seo_description text,
  is_published    boolean not null default false,
  published_at    timestamptz,
  author_name     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists platform_posts_pub_idx
  on public.platform_posts (is_published, published_at desc);
drop trigger if exists platform_posts_touch on public.platform_posts;
create trigger platform_posts_touch before update on public.platform_posts
  for each row execute function app.touch_updated_at();

create table if not exists public.platform_payment_settings (
  id              boolean primary key default true check (id),
  method          text not null default 'bank_transfer'
                    check (method in ('bank_transfer','gateway','both')),
  bank_name       text,
  account_name    text,
  account_number  text,
  payment_instructions text,
  gateway_name    text,
  gateway_public_key text,           -- publishable key only; secrets live in Edge Function env
  currency        text not null default 'NGN',
  price_per_student numeric(10,2),
  billing_period  text not null default 'termly'
                    check (billing_period in ('monthly','termly','annually')),
  updated_at      timestamptz not null default now()
);
insert into public.platform_payment_settings (id) values (true) on conflict (id) do nothing;

-- ---------------- 5. public read RPCs (no login required) ----------------
-- Columns the public profile needs must exist before the functions that
-- select them are created.
alter table public.schools add column if not exists public_about text;
alter table public.schools add column if not exists is_listed boolean not null default true;

create or replace function public.public_platform_content()
returns table (site_name text, tagline text, about_text text, contact_email text,
               contact_phone text, contact_address text, logo_url text, favicon_url text,
               og_image_url text, seo_title text, seo_description text,
               social_links jsonb, features jsonb, faqs jsonb, plans jsonb, announcement text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.site_name, s.tagline, s.about_text, s.contact_email, s.contact_phone,
         s.contact_address, s.logo_url, s.favicon_url, s.og_image_url,
         s.seo_title, s.seo_description, s.social_links, s.features, s.faqs, s.plans, s.announcement
  from public.platform_settings s where s.id;
$$;

create or replace function public.public_posts(p_limit int default 20)
returns table (slug text, title text, excerpt text, featured_image_url text,
               published_at timestamptz, author_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.slug, p.title, p.excerpt, p.featured_image_url, p.published_at, p.author_name
  from public.platform_posts p
  where p.is_published and coalesce(p.published_at, now()) <= now()
  order by p.published_at desc nulls last
  limit least(coalesce(p_limit, 20), 50);
$$;

create or replace function public.public_post_by_slug(p_slug text)
returns table (slug text, title text, excerpt text, body text, featured_image_url text,
               seo_title text, seo_description text, published_at timestamptz, author_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.slug, p.title, p.excerpt, p.body, p.featured_image_url,
         p.seo_title, p.seo_description, p.published_at, p.author_name
  from public.platform_posts p
  where p.slug = lower(btrim(p_slug)) and p.is_published
    and coalesce(p.published_at, now()) <= now();
$$;

-- A school's public face. Deliberately narrow: nothing about students,
-- staff, fees or results appears here.
create or replace function public.public_school_profile(p_slug text)
returns table (name text, slug text, short_name text, motto text, about text,
               school_type text, logo_url text, favicon_url text,
               primary_color text, secondary_color text,
               address text, phone text, email text, website text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.name, s.slug, s.short_name, s.motto, s.public_about,
         s.school_type::text, s.logo_url, s.favicon_url,
         s.primary_color, s.secondary_color,
         s.address, s.phone, s.email, s.website
  from public.schools s
  where s.slug = lower(btrim(p_slug)) and s.status = 'active' and s.is_listed;
$$;

create or replace function public.public_school_directory(p_limit int default 100)
returns table (name text, slug text, short_name text, logo_url text,
               school_type text, address text, motto text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.name, s.slug, s.short_name, s.logo_url, s.school_type::text, s.address, s.motto
  from public.schools s
  where s.status = 'active' and s.is_listed
  order by s.name
  limit least(coalesce(p_limit, 100), 500);
$$;

grant execute on function
  public.public_platform_content(), public.public_posts(int),
  public.public_post_by_slug(text), public.public_school_profile(text),
  public.public_school_directory(int)
to anon, authenticated;

-- ---------------- 6. director dashboard ----------------
create or replace function public.director_overview()
returns table (
  students_total bigint, students_active bigint, staff_total bigint, staff_active bigint,
  classes_total bigint, subjects_total bigint,
  attendance_today_present bigint, attendance_today_absent bigint, attendance_rate_term numeric,
  fees_expected numeric, fees_collected numeric, fees_outstanding numeric,
  classes_published bigint, classes_total_for_term bigint,
  assessments_total bigint, assignments_total bigint, announcements_recent bigint
)
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (select app.current_school_id() as id),
       t as (select id from public.terms where school_id = (select id from s) and is_active limit 1)
  select
    (select count(*) from public.students where school_id = (select id from s)),
    (select count(*) from public.students where school_id = (select id from s) and is_active),
    (select count(*) from public.staff where school_id = (select id from s)),
    (select count(*) from public.staff where school_id = (select id from s) and is_active),
    (select count(*) from public.classes where school_id = (select id from s) and is_active),
    (select count(*) from public.subjects where school_id = (select id from s) and is_active),
    (select count(*) from public.attendance_records r join public.attendance_sessions ss on ss.id = r.attendance_id
      where r.school_id = (select id from s) and ss.taken_on = current_date and r.status <> 'absent'),
    (select count(*) from public.attendance_records r join public.attendance_sessions ss on ss.id = r.attendance_id
      where r.school_id = (select id from s) and ss.taken_on = current_date and r.status = 'absent'),
    (select case when count(*) > 0 then round(100.0 * count(*) filter (where r.status <> 'absent') / count(*), 1) end
       from public.attendance_records r join public.attendance_sessions ss on ss.id = r.attendance_id
      where r.school_id = (select id from s) and ss.term_id = (select id from t)),
    (select coalesce(sum(fs.amount), 0) from public.fee_structure fs
       join public.students st on st.class_id = fs.class_id and st.is_active
      where fs.school_id = (select id from s) and fs.term_id = (select id from t)),
    (select coalesce(sum(fp.amount_paid), 0) from public.fee_payments fp
      where fp.school_id = (select id from s) and fp.term_id = (select id from t)),
    greatest(
      (select coalesce(sum(fs.amount), 0) from public.fee_structure fs
         join public.students st on st.class_id = fs.class_id and st.is_active
        where fs.school_id = (select id from s) and fs.term_id = (select id from t))
      - (select coalesce(sum(fp.amount_paid), 0) from public.fee_payments fp
          where fp.school_id = (select id from s) and fp.term_id = (select id from t)), 0),
    (select count(*) from public.result_publications rp
      where rp.school_id = (select id from s) and rp.term_id = (select id from t) and rp.status = 'published'),
    (select count(*) from public.classes where school_id = (select id from s) and is_active),
    (select count(*) from public.assessments where school_id = (select id from s) and term_id = (select id from t)),
    (select count(*) from public.assignments where school_id = (select id from s) and term_id = (select id from t)),
    (select count(*) from public.announcements where school_id = (select id from s) and published_at > now() - interval '30 days')
  where app.is_reader();
$$;
grant execute on function public.director_overview() to authenticated;

create or replace function public.recent_school_activity(p_limit int default 20)
returns table (action text, entity text, detail jsonb, created_at timestamptz, actor text)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.action, a.entity, a.detail, a.created_at,
         coalesce((select st.full_name from public.staff st where st.user_id = a.user_id), 'System')
  from public.audit_log a
  where a.school_id = app.current_school_id()
    and (app.is_school_admin() or app.has_role('director'))
  order by a.created_at desc
  limit least(coalesce(p_limit, 20), 100);
$$;
grant execute on function public.recent_school_activity(int) to authenticated;

-- The director reads school-wide data, so give them the same read
-- reach as other staff on the tenant-uniform tables.
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated
  using (app.owns(school_id) and (app.is_school_admin() or app.has_role('director')));

-- ---------------- 7. parent overview ----------------
create or replace function public.my_children_overview()
returns table (student_id uuid, full_name text, admission_no text, class_name text,
               photo_url text, attendance_rate numeric, days_present bigint, days_absent bigint,
               result_available boolean, result_message text,
               homework_pending bigint, fees_settled boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  with t as (select id from public.terms where school_id = app.current_school_id() and is_active limit 1)
  select st.id, st.full_name, st.admission_no, c.name, st.photo_url,
         (select percentage   from public.attendance_summary(st.id, (select id from t))),
         (select days_present from public.attendance_summary(st.id, (select id from t))),
         (select days_absent  from public.attendance_summary(st.id, (select id from t))),
         (select available from public.my_result_availability(st.id, (select id from t))),
         (select message   from public.my_result_availability(st.id, (select id from t))),
         (select count(*) from public.my_assignments(st.id, (select id from t)) m
           where m.my_status in ('pending','overdue')),
         app.student_fees_settled(st.id, (select id from t))
  from public.students st
  left join public.classes c on c.id = st.class_id
  where st.id in (select app.my_children())
  order by st.full_name;
$$;
grant execute on function public.my_children_overview() to authenticated;

-- ---------------- 8. RLS for the platform tables ----------------
do $$
declare t text;
begin
  foreach t in array array['platform_settings','platform_posts','platform_payment_settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Only AMA EDU platform admins touch these. Schools read the payment
-- settings so they know where to pay, but cannot change them -- that is
-- the "schools must not change AMA EDU's payment destination" rule.
create policy platform_settings_admin on public.platform_settings
  for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

create policy platform_posts_admin on public.platform_posts
  for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

create policy platform_payments_read on public.platform_payment_settings
  for select to authenticated using (true);
create policy platform_payments_admin on public.platform_payment_settings
  for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

grant select, insert, update, delete on
  public.platform_settings, public.platform_posts, public.platform_payment_settings
  to authenticated;
