-- ===============================================================
-- AMA EDU 0007 — the RPCs the frontend actually calls
--
-- Three of these are reachable before sign-in. Each is SECURITY
-- DEFINER and returns a deliberately narrow column list: presentation
-- fields for active schools only. None of them exposes a roster, a
-- result, a contact detail or a count.
--
-- (The citext casts and grant shape here are superseded by migration
-- 0010's hardening pass -- kept as originally written to preserve the
-- exact deployed history.)
-- ===============================================================

-- Table privileges: RLS decides rows, these decide reachability.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on public.platform_admins from authenticated;
grant select on public.platform_admins to authenticated;
revoke all on public.school_members from authenticated;
grant select on public.school_members to authenticated;
revoke all on public.reserved_slugs from authenticated;
grant select on public.reserved_slugs to authenticated;
revoke insert, update, delete on public.audit_log from authenticated;
revoke insert, delete on public.schools from authenticated;

-- ---------------------------------------------------------------
-- Pre-login: resolve a subdomain to a school's public identity.
-- ---------------------------------------------------------------
create or replace function public.public_school_by_slug(p_slug text)
returns table (
  id uuid, name text, slug text, motto text,
  logo_url text, favicon_url text,
  primary_color text, secondary_color text,
  school_type text, status text,
  address text, current_term_label text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.name, s.slug::text, s.motto,
         s.logo_url, s.favicon_url,
         s.primary_color, s.secondary_color,
         s.school_type::text, s.status::text,
         s.address,
         (select t.label || ' Term, ' || se.label
            from public.terms t join public.sessions se on se.id = t.session_id
           where t.school_id = s.id and t.is_active limit 1)
  from public.schools s
  where s.slug = p_slug::citext
    and s.status in ('active','suspended');
$$;

create or replace function public.is_slug_available(p_slug text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'
     and not exists (select 1 from public.reserved_slugs r where r.slug = p_slug::citext)
     and not exists (select 1 from public.schools   s where s.slug = p_slug::citext);
$$;

create or replace function public.search_public_schools(p_term text)
returns table (name text, slug text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.name, s.slug::text
  from public.schools s
  where s.status = 'active'
    and length(btrim(p_term)) >= 2
    and s.name ilike '%' || btrim(p_term) || '%'
  order by s.name
  limit 10;
$$;

-- Class names for the student login dropdown. Names only, one school.
create or replace function public.public_school_classes(p_school_id uuid)
returns table (id uuid, name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.name
  from public.classes c
  join public.schools s on s.id = c.school_id
  where c.school_id = p_school_id and c.is_active and s.status = 'active'
  order by c.sort_order, c.name;
$$;

-- ---------------------------------------------------------------
-- Shadow auth identity.
--
-- MyPAS1 looked people up by staff code alone. Those codes are unique
-- only within a school, so on a platform the lookup was ambiguous --
-- and it handed out real sessions. Every shadow address is now
-- namespaced by school slug, and the lookup is keyed on school_id.
--
-- This verifies NO password. It maps (school, identifier) to an
-- address; Supabase Auth then checks the credential. The frontend
-- returns one identical message for "unknown" and "wrong password",
-- so this cannot be used to enumerate a roster.
-- ---------------------------------------------------------------
create or replace function app.shadow_email(p_kind text, p_identifier text, p_slug text)
returns text
language sql immutable as $$
  select p_kind || '.' ||
         regexp_replace(lower(p_identifier), '[^a-z0-9._-]', '-', 'g') ||
         '@' || lower(p_slug) || '.tenant.amaedu.internal';
$$;

create or replace function public.resolve_login_identity(
  p_school_id uuid, p_kind text, p_identifier text, p_class_id uuid default null
)
returns table (shadow_email text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_slug text;
begin
  select s.slug::text into v_slug
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

-- ---------------------------------------------------------------
-- Who am I? Read entirely from auth.uid(); the client passes nothing.
-- ---------------------------------------------------------------
create or replace function public.current_app_user()
returns table (
  school_id uuid, school_slug text, roles text[], role text,
  staff_id uuid, student_id uuid, full_name text, is_platform_admin boolean
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    app.current_school_id(),
    (select s.slug::text from public.schools s where s.id = app.current_school_id()),
    (select coalesce(array_agg(distinct m.role::text), '{}')
       from public.school_members m where m.user_id = auth.uid() and m.is_active),
    (select m.role::text from public.school_members m
      where m.user_id = auth.uid() and m.is_active
      order by array_position(
        array['admin','headmaster','principal','bursar','registrar_primary',
              'registrar_secondary','teacher','parent','student']::text[], m.role::text)
      limit 1),
    app.current_staff_id(),
    app.current_student_id(),
    coalesce(
      (select st.full_name from public.staff    st where st.id = app.current_staff_id()),
      (select sd.full_name from public.students sd where sd.id = app.current_student_id()),
      (select p.full_name  from public.parents  p  where p.user_id = auth.uid() limit 1),
      (select pa.full_name from public.platform_admins pa where pa.user_id = auth.uid())
    ),
    app.is_platform_admin();
$$;

-- ---------------------------------------------------------------
-- Dashboard. SECURITY INVOKER on purpose: the counts pass through RLS,
-- so a teacher's numbers are their own school and nobody else's.
-- ---------------------------------------------------------------
create or replace function public.dashboard_summary()
returns table (
  student_count bigint, staff_count bigint, class_count bigint, subject_count bigint,
  pending_score_entries bigint, score_completion_pct numeric,
  fees_collected numeric, fees_expected numeric,
  recent_announcements jsonb
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with term as (select id from public.terms where is_active limit 1),
  expected as (
    select count(*)::bigint as need
    from public.class_subjects cs
    where exists (select 1 from public.students st where st.class_id = cs.class_id and st.is_active)
  ),
  done as (
    select count(distinct (sc.class_id, sc.subject_id))::bigint as got
    from public.student_scores sc where sc.term_id = (select id from term)
  )
  select
    (select count(*) from public.students where is_active),
    (select count(*) from public.staff    where is_active),
    (select count(*) from public.classes  where is_active),
    (select count(*) from public.subjects where is_active),
    greatest((select need from expected) - (select got from done), 0),
    case when (select need from expected) > 0
         then round(100.0 * (select got from done) / (select need from expected), 1)
         else 0 end,
    (select coalesce(sum(amount_paid), 0) from public.fee_payments where term_id = (select id from term)),
    (select coalesce(sum(fs.amount), 0)
       from public.fee_structure fs
       join public.students st on st.class_id = fs.class_id and st.is_active
      where fs.term_id = (select id from term)),
    (select coalesce(jsonb_agg(jsonb_build_object('title', a.title, 'created_at', a.published_at)
              order by a.published_at desc), '[]'::jsonb)
       from (select title, published_at from public.announcements
             order by published_at desc limit 5) a);
$$;

grant execute on function
  public.public_school_by_slug(text), public.is_slug_available(text),
  public.search_public_schools(text), public.public_school_classes(uuid),
  public.resolve_login_identity(uuid, text, text, uuid)
to anon, authenticated;

grant execute on function public.current_app_user(), public.dashboard_summary() to authenticated;
grant execute on function app.shadow_email(text, text, text) to authenticated, anon;

-- New tables created later inherit the same grants.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
