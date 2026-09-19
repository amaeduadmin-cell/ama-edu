-- ===============================================================
-- AMA EDU 0011 — let a school admin manage staff roles
--
-- Gap found while building the Staff page: school_members had a
-- read policy only. An admin could see roles but never grant one,
-- so Staff had nowhere to assign "teacher" or "headmaster". This
-- adds write access, scoped tightly:
--   - staff roles only (student/parent membership rows are still
--     service-role-only, created by provision-user or, later, a
--     parent-linking flow — not by this policy)
--   - the target staff row must belong to the same school as the
--     membership row being created, so an admin cannot attach a
--     role to a staff member from a school they don't administer
--   - student_id must be null on every row this policy touches
-- ===============================================================

create or replace function app.staff_role_row_valid(p_school_id uuid, p_staff_id uuid, p_student_id uuid, p_role app.user_role)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_role not in ('student','parent')
     and p_staff_id is not null
     and p_student_id is null
     and exists (select 1 from public.staff st where st.id = p_staff_id and st.school_id = p_school_id);
$$;
grant execute on function app.staff_role_row_valid(uuid, uuid, uuid, app.user_role) to authenticated;

create policy members_admin_write on public.school_members
  for all to authenticated
  using (app.owns(school_id) and app.is_school_admin())
  with check (
    app.owns(school_id) and app.is_school_admin()
    and app.staff_role_row_valid(school_id, staff_id, student_id, role)
  );
