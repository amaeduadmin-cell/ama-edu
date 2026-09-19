-- ===============================================================
-- AMA EDU 0001 — tenancy foundation
--
-- school_id IS the tenant key. Every school-scoped table carries it,
-- every RLS policy compares against it, and it is derived server-side
-- from the caller's auth.uid() -- never from anything the browser sends.
-- ===============================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

create schema if not exists app;
revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated, anon;

-- ---------------- enums ----------------
create type app.user_role as enum (
  'admin', 'headmaster', 'principal', 'bursar', 'teacher',
  'registrar_primary', 'registrar_secondary', 'student', 'parent'
);

create type app.school_status as enum ('pending', 'active', 'suspended', 'closed');

create type app.school_type as enum (
  'nursery_primary', 'secondary', 'combined', 'islamiyya', 'other'
);

create type app.class_category as enum ('nursery', 'primary', 'jss', 'ss');

create type app.score_period as enum ('ca1', 'ca2', 'ca3', 'exam');

-- ---------------- shared trigger ----------------
create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------- schools (the tenant table) ----------------
create table public.schools (
  id                uuid primary key default gen_random_uuid(),
  name              text        not null check (length(btrim(name)) between 2 and 160),
  slug              citext      not null unique
                      check (slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),
  short_name        text,
  motto             text,
  school_type       app.school_type not null default 'combined',
  status            app.school_status not null default 'active',

  -- branding: drives the --brand-* CSS tokens at runtime
  logo_url          text,
  favicon_url       text,
  primary_color     text default '#0f6b3f' check (primary_color ~* '^#[0-9a-f]{6}$'),
  secondary_color   text default '#b8862b' check (secondary_color ~* '^#[0-9a-f]{6}$'),

  -- contact / printed on report cards
  email             citext,
  phone             text,
  address           text,
  website           text,
  principal_name    text,
  headmaster_name   text,

  -- per-school policy
  subscription_plan text not null default 'free',
  block_report_on_unpaid_fees boolean not null default true,
  admission_prefix  text default 'ADM',
  admission_next_no integer not null default 1 check (admission_next_no > 0),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.schools is
  'One row per tenant. schools.id is the tenant key referenced as school_id everywhere else.';

create index schools_status_idx on public.schools (status);
create trigger schools_touch before update on public.schools
  for each row execute function app.touch_updated_at();

-- Reserved subdomains, enforced in the database as well as the UI so a
-- direct API call cannot grab one.
create table public.reserved_slugs (slug citext primary key);

insert into public.reserved_slugs (slug) values
  ('www'),('admin'),('api'),('app'),('apps'),('mail'),('email'),('smtp'),('imap'),('pop'),
  ('support'),('help'),('helpdesk'),('docs'),('doc'),('blog'),('news'),('status'),
  ('login'),('signin'),('signup'),('register'),('auth'),('account'),('accounts'),
  ('dashboard'),('portal'),('platform'),('console'),('billing'),('pay'),('payments'),
  ('cdn'),('static'),('assets'),('img'),('images'),('media'),('files'),('storage'),
  ('dev'),('test'),('staging'),('stage'),('demo'),('sandbox'),('preview'),('beta'),
  ('ns'),('ns1'),('ns2'),('dns'),('mx'),('ftp'),('ssh'),('vpn'),('proxy'),('gateway'),
  ('amaedu'),('ama'),('edu'),('school'),('schools'),('security'),('abuse'),('postmaster'),
  ('webmaster'),('hostmaster'),('root'),('system'),('internal'),('private'),('public');

create or replace function app.slug_not_reserved()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.reserved_slugs r where r.slug = new.slug) then
    raise exception 'slug % is reserved', new.slug using errcode = '23514';
  end if;
  return new;
end $$;

create trigger schools_slug_guard before insert or update of slug on public.schools
  for each row execute function app.slug_not_reserved();

-- ---------------- platform administrators ----------------
create table public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'AMA EDU staff. Membership is granted only by the service role, never by any client.';

-- ---------------- membership: user -> school -> role ----------------
create table public.school_members (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       app.user_role not null,
  staff_id   uuid,
  student_id uuid,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, school_id, role)
);

comment on table public.school_members is
  'The only place a user is bound to a tenant. app.current_school_id() reads this.';

create index school_members_user_idx   on public.school_members (user_id) where is_active;
create index school_members_school_idx on public.school_members (school_id, role) where is_active;

-- ===============================================================
-- Tenant context helpers.
--
-- SECURITY DEFINER on purpose: these are read BY the RLS policies on
-- school_members itself, so a policy calling a function that reads the
-- same table under RLS would recurse. Definer rights break that cycle.
-- They take no arguments -- there is nothing a caller can pass to make
-- them return a different school.
-- ===============================================================

create or replace function app.is_platform_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.platform_admins p where p.user_id = auth.uid());
$$;

create or replace function app.current_school_id()
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select m.school_id
  from public.school_members m
  join public.schools s on s.id = m.school_id
  where m.user_id = auth.uid()
    and m.is_active
    and s.status = 'active'
  limit 1;
$$;

create or replace function app.current_roles()
returns app.user_role[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct m.role), '{}'::app.user_role[])
  from public.school_members m
  where m.user_id = auth.uid() and m.is_active;
$$;

create or replace function app.has_role(variadic p_roles app.user_role[])
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.current_roles() && p_roles;
$$;

-- "Can administer this school": school admin, or an AMA EDU platform admin.
create or replace function app.is_school_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_platform_admin() or app.has_role('admin');
$$;

-- Any staff role (excludes student and parent).
create or replace function app.is_staff()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_role('admin','headmaster','principal','bursar','teacher',
                      'registrar_primary','registrar_secondary');
$$;

create or replace function app.current_staff_id()
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select m.staff_id from public.school_members m
  where m.user_id = auth.uid() and m.is_active and m.staff_id is not null limit 1;
$$;

create or replace function app.current_student_id()
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select m.student_id from public.school_members m
  where m.user_id = auth.uid() and m.is_active and m.student_id is not null limit 1;
$$;

-- The single predicate every tenant-scoped policy is built from.
create or replace function app.owns(p_school_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_school_id is not null
     and (app.is_platform_admin() or p_school_id = app.current_school_id());
$$;

grant execute on function
  app.is_platform_admin(), app.current_school_id(), app.current_roles(),
  app.has_role(app.user_role[]), app.is_school_admin(), app.is_staff(),
  app.current_staff_id(), app.current_student_id(), app.owns(uuid)
to authenticated, anon;
