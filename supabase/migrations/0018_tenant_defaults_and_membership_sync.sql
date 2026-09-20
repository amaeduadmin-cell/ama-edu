-- ===============================================================
-- AMA EDU 0018 — fixes "Add staff / Add student does nothing"
--
-- ROOT CAUSE (reproduced against the live project as the school admin):
--   staff.js, students.js and curriculum.js insert rows WITHOUT
--   school_id. school_id has no default, so app.owns(NULL) is false and
--   the RLS WITH CHECK rejects the row with SQLSTATE 42501
--   ("new row violates row-level security policy"). The UI then mapped
--   42501 to "You do not have permission", which is misleading for an
--   admin.
--
-- FIX (database layer): school_id now defaults to the caller's own
-- tenant, derived server-side from auth.uid(). The RLS WITH CHECK still
-- runs on the defaulted value, so a client still cannot write into
-- another school.
--
-- Also here:
--   * staff.roles  - a role can now be assigned when the staff record is
--     created, before any login exists. A trigger materialises it into
--     school_members once a login exists.
--   * deactivation is now enforced: staff/student/parent is_active is
--     mirrored onto school_members.is_active (previously a deactivated
--     person with a valid password kept full access).
--   * client writes to school_members are removed; roles are managed only
--     through staff.roles.
-- ===============================================================

-- ---------- 1. tenant default on every school-scoped table ----------
do $$
declare t record;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'school_id'
      and c.table_name <> 'schools' and c.column_default is null
  loop
    execute format('alter table public.%I alter column school_id set default app.current_school_id()', t.table_name);
  end loop;
end $$;

-- ---------- 2. helpers ----------
create or replace function app.is_internal()
returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce(current_setting('app.internal', true), '') = '1';
$$;

create or replace function app.is_reader()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_staff() or app.has_role('director');
$$;

create or replace function app.is_form_teacher(p_class_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.classes c
                 where c.id = p_class_id and c.school_id = app.current_school_id()
                   and c.form_teacher_id is not null and c.form_teacher_id = app.current_staff_id());
$$;

create or replace function app.write_audit(p_school uuid, p_action text, p_entity text, p_entity_id uuid, p_detail jsonb default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_log (school_id, user_id, action, entity, entity_id, detail)
  values (p_school, auth.uid(), p_action, p_entity, p_entity_id, p_detail);
$$;

grant execute on function app.is_internal(), app.is_reader(), app.is_form_teacher(uuid) to authenticated;

-- ---------- 3. staff.roles ----------
alter table public.staff add column if not exists roles app.user_role[] not null default '{}';
alter table public.staff drop constraint if exists staff_roles_no_portal_roles;
alter table public.staff add constraint staff_roles_no_portal_roles
  check (not (roles && array['student','parent']::app.user_role[]));

update public.staff s
set roles = coalesce((select array_agg(distinct m.role) from public.school_members m
                      where m.staff_id = s.id and m.role not in ('student','parent')), '{}')
where s.roles = '{}';

-- Sensitive columns may only be changed by an administrator (or by a
-- server-side function that flags itself internal). Without this, the
-- staff_self_update policy would let any teacher write roles = '{admin}'.
create or replace function app.guard_staff_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if new.school_id is distinct from old.school_id then
      raise exception 'A staff record cannot move between schools.' using errcode = '42501';
    end if;
    if old.is_active and not new.is_active and 'admin' = any(new.roles)
       and not exists (select 1 from public.staff o
                       where o.school_id = new.school_id and o.id <> new.id
                         and o.is_active and 'admin' = any(o.roles)) then
      raise exception 'A school must keep at least one active administrator.' using errcode = 'P0001';
    end if;
    if auth.uid() is not null and not app.is_school_admin() and not app.is_internal() and (
         new.roles is distinct from old.roles or new.salary_amount is distinct from old.salary_amount
         or new.is_active is distinct from old.is_active or new.user_id is distinct from old.user_id
         or new.staff_code is distinct from old.staff_code) then
      raise exception 'Only an administrator can change roles, status, pay or Staff ID.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists staff_guard on public.staff;
create trigger staff_guard before update on public.staff
  for each row execute function app.guard_staff_change();

-- roles[] -> school_members, once a login exists
create or replace function app.sync_staff_memberships()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare removed app.user_role[];
begin
  if new.user_id is null then return new; end if;

  insert into public.school_members (school_id, user_id, role, staff_id, is_active)
  select new.school_id, new.user_id, x, new.id, new.is_active from unnest(new.roles) x
  on conflict (user_id, school_id, role)
  do update set staff_id = excluded.staff_id, is_active = excluded.is_active;

  if tg_op = 'UPDATE' then
    removed := array(select x from unnest(old.roles) x where x <> all (new.roles));
    if coalesce(array_length(removed, 1), 0) > 0 then
      delete from public.school_members where staff_id = new.id and role = any (removed);
    end if;
  end if;

  update public.school_members set is_active = new.is_active
  where staff_id = new.id and is_active is distinct from new.is_active;
  return new;
end $$;

drop trigger if exists staff_sync_memberships on public.staff;
create trigger staff_sync_memberships after insert or update of roles, user_id, is_active on public.staff
  for each row execute function app.sync_staff_memberships();

-- students / parents: deactivation must cut access
create or replace function app.sync_student_membership()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.school_members set is_active = new.is_active
  where student_id = new.id and is_active is distinct from new.is_active;
  return new;
end $$;
drop trigger if exists students_sync_membership on public.students;
create trigger students_sync_membership after update of is_active on public.students
  for each row execute function app.sync_student_membership();

create or replace function app.sync_parent_membership()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.user_id is not null then
    update public.school_members set is_active = new.is_active
    where user_id = new.user_id and school_id = new.school_id and role = 'parent'
      and is_active is distinct from new.is_active;
  end if;
  return new;
end $$;
drop trigger if exists parents_sync_membership on public.parents;
create trigger parents_sync_membership after update of is_active on public.parents
  for each row execute function app.sync_parent_membership();

-- backfill: existing inactive people
update public.school_members m set is_active = false
from public.staff s where m.staff_id = s.id and not s.is_active and m.is_active;
update public.school_members m set is_active = false
from public.students s where m.student_id = s.id and not s.is_active and m.is_active;

-- roles are managed only via staff.roles now
drop policy if exists members_admin_write on public.school_members;
revoke insert, update, delete on public.school_members from authenticated;

-- ---------- 4. audit trigger for staff status ----------
create or replace function app.audit_staff_status()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_active is distinct from old.is_active then
    perform app.write_audit(new.school_id, case when new.is_active then 'staff.reactivated' else 'staff.deactivated' end,
                            'staff', new.id, jsonb_build_object('name', new.full_name, 'staff_code', new.staff_code));
  end if;
  if new.roles is distinct from old.roles then
    perform app.write_audit(new.school_id, 'staff.roles_changed', 'staff', new.id,
                            jsonb_build_object('from', old.roles, 'to', new.roles));
  end if;
  return new;
end $$;
drop trigger if exists staff_audit_status on public.staff;
create trigger staff_audit_status after update on public.staff
  for each row execute function app.audit_staff_status();

-- ---------- 5. director / admin: deactivate or reactivate a teacher ----------
create or replace function public.set_staff_active(p_staff_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.staff%rowtype;
begin
  select * into s from public.staff where id = p_staff_id;
  if not found or not coalesce(app.owns(s.school_id), false) then
    raise exception 'That staff record was not found.' using errcode = '42501';
  end if;
  if not (app.is_school_admin() or app.has_role('director')) then
    raise exception 'You do not have permission to change staff status.' using errcode = '42501';
  end if;
  if s.user_id is not null and s.user_id = auth.uid() then
    raise exception 'You cannot change your own account status.' using errcode = '42501';
  end if;
  if 'admin' = any (s.roles) and not app.is_school_admin() then
    raise exception 'Only a school administrator can change another administrator.' using errcode = '42501';
  end if;
  perform set_config('app.internal', '1', true);
  update public.staff set is_active = p_active where id = p_staff_id;
end $$;
grant execute on function public.set_staff_active(uuid, boolean) to authenticated;

-- ---------- 6. lookups for the provisioning Edge Function ----------
create or replace function public.admin_find_auth_user(p_email text)
returns uuid language sql security definer set search_path = public, auth, pg_temp as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
revoke all on function public.admin_find_auth_user(text) from public, anon, authenticated;
grant execute on function public.admin_find_auth_user(text) to service_role;

-- ---------- 7. current_app_user: director ranks after admin ----------
create or replace function public.current_app_user()
returns table (school_id uuid, school_slug text, roles text[], role text,
               staff_id uuid, student_id uuid, full_name text, is_platform_admin boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    app.current_school_id(),
    (select s.slug from public.schools s where s.id = app.current_school_id()),
    (select coalesce(array_agg(distinct m.role::text), '{}')
       from public.school_members m where m.user_id = auth.uid() and m.is_active),
    (select m.role::text from public.school_members m
      where m.user_id = auth.uid() and m.is_active
      order by array_position(
        array['admin','director','headmaster','principal','bursar','registrar_primary',
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
