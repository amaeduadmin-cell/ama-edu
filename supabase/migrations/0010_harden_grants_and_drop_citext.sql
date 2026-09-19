-- ===============================================================
-- AMA EDU 0010 — hardening
--
-- 1. Postgres grants EXECUTE on every new function to PUBLIC by
--    default, so my explicit GRANTs were not the whole story: anon
--    could reach current_app_user and recompute_class_term. Revoke
--    from PUBLIC first, then grant deliberately.
-- 2. Drop the citext dependency instead of leaving an extension in
--    the public schema. Case-insensitivity is kept with lower().
-- ===============================================================

-- ---------- 1. citext -> text ----------
-- Both the slug trigger and the slug CHECK constraint bind to the
-- column's type, so they come off first and go back on after.
drop trigger if exists schools_slug_guard on public.schools;
alter table public.schools drop constraint if exists schools_slug_check;
alter table public.parents drop constraint if exists parents_school_id_email_key;

alter table public.reserved_slugs alter column slug type text using slug::text;
alter table public.schools  alter column slug  type text using slug::text;
alter table public.schools  alter column email type text using email::text;
alter table public.staff    alter column email type text using email::text;
alter table public.students alter column guardian_email type text using guardian_email::text;
alter table public.parents  alter column email type text using email::text;

update public.schools        set slug = lower(slug);
update public.reserved_slugs set slug = lower(slug);

alter table public.schools add constraint schools_slug_check
  check (slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$');

create unique index if not exists parents_school_email_lower_idx
  on public.parents (school_id, lower(email)) where email is not null;

create or replace function app.slug_not_reserved()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.slug := lower(btrim(new.slug));
  if exists (select 1 from public.reserved_slugs r where r.slug = new.slug) then
    raise exception 'slug % is reserved', new.slug using errcode = '23514';
  end if;
  return new;
end $$;

create trigger schools_slug_guard before insert or update of slug on public.schools
  for each row execute function app.slug_not_reserved();

-- Functions that cast to citext must stop doing so.
create or replace function public.public_school_by_slug(p_slug text)
returns table (
  id uuid, name text, slug text, motto text,
  logo_url text, favicon_url text,
  primary_color text, secondary_color text,
  school_type text, status text,
  address text, current_term_label text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.name, s.slug, s.motto,
         s.logo_url, s.favicon_url,
         s.primary_color, s.secondary_color,
         s.school_type::text, s.status::text,
         s.address,
         (select t.label || ' Term, ' || se.label
            from public.terms t join public.sessions se on se.id = t.session_id
           where t.school_id = s.id and t.is_active limit 1)
  from public.schools s
  where s.slug = lower(btrim(p_slug))
    and s.status in ('active','suspended');
$$;

create or replace function public.is_slug_available(p_slug text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select lower(btrim(p_slug)) ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'
     and not exists (select 1 from public.reserved_slugs r where r.slug = lower(btrim(p_slug)))
     and not exists (select 1 from public.schools   s where s.slug = lower(btrim(p_slug)));
$$;

create or replace function public.resolve_login_identity(
  p_school_id uuid, p_kind text, p_identifier text, p_class_id uuid default null
)
returns table (shadow_email text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_slug text;
begin
  select s.slug into v_slug
  from public.schools s where s.id = p_school_id and s.status = 'active';
  if v_slug is null then return; end if;

  if p_kind = 'staff' then
    return query
      select app.shadow_email('staff', st.staff_code, v_slug)
      from public.staff st
      where st.school_id = p_school_id
        and lower(st.staff_code) = lower(btrim(p_identifier))
        and st.is_active and st.user_id is not null;
  elsif p_kind = 'student' then
    return query
      select app.shadow_email('student', s.admission_no, v_slug)
      from public.students s
      where s.school_id = p_school_id
        and lower(s.admission_no) = lower(btrim(p_identifier))
        and (p_class_id is null or s.class_id = p_class_id)
        and s.is_active and s.user_id is not null;
  end if;
end $$;

drop extension if exists citext;

-- ---------- 2. fixed search_path on the remaining functions ----------
alter function app.touch_updated_at() set search_path = public, pg_temp;
alter function app.shadow_email(text, text, text) set search_path = public, pg_temp;

-- ---------- 3. revoke the implicit PUBLIC grant, then be explicit ----------
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app    from public, anon, authenticated;
revoke all on schema app from public;

grant execute on function
  public.public_school_by_slug(text),
  public.is_slug_available(text),
  public.search_public_schools(text),
  public.public_school_classes(uuid),
  public.resolve_login_identity(uuid, text, text, uuid)
to anon, authenticated;

grant execute on function
  public.current_app_user(),
  public.dashboard_summary(),
  public.recompute_class_term(uuid, uuid)
to authenticated;

-- Helpers the RLS policies call. A policy expression runs as the
-- invoking role, so authenticated needs EXECUTE or every policy fails
-- closed and the app shows empty tables everywhere.
grant execute on function
  app.owns(uuid), app.is_platform_admin(), app.is_school_admin(), app.is_staff(),
  app.has_role(app.user_role[]), app.current_school_id(), app.current_roles(),
  app.current_staff_id(), app.current_student_id(), app.my_children(),
  app.report_visible(uuid, uuid), app.can_mark(uuid, uuid),
  app.student_fees_settled(uuid, uuid)
to authenticated;

grant execute on function app.bootstrap_school_defaults(uuid) to service_role;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema app    revoke execute on functions from public;
