-- AMA EDU 0062 — explicit admin-only people deletion
-- Deletion is intentionally exposed through security-definer RPCs rather than
-- widening the existing staff/registrar write policies to permit destructive UI actions.

create or replace function public.delete_students(p_student_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_school uuid := app.current_school_id();
  v_deleted integer := 0;
begin
  if not app.is_school_admin() then
    raise exception 'Only a school administrator can delete students.' using errcode = '42501';
  end if;
  if v_school is null or coalesce(array_length(p_student_ids, 1), 0) = 0 then
    return 0;
  end if;
  delete from public.students
   where school_id = v_school
     and id = any(p_student_ids);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.delete_staff(p_staff_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_school uuid := app.current_school_id();
  v_deleted integer := 0;
begin
  if not app.is_school_admin() then
    raise exception 'Only a school administrator can delete staff.' using errcode = '42501';
  end if;
  if v_school is null or coalesce(array_length(p_staff_ids, 1), 0) = 0 then
    return 0;
  end if;
  if exists (select 1 from public.staff where school_id = v_school and id = any(p_staff_ids) and user_id = auth.uid()) then
    raise exception 'You cannot delete your own staff account.' using errcode = '42501';
  end if;
  delete from public.staff
   where school_id = v_school
     and id = any(p_staff_ids);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.delete_students(uuid[]) from public, anon;
revoke all on function public.delete_staff(uuid[]) from public, anon;
grant execute on function public.delete_students(uuid[]) to authenticated;
grant execute on function public.delete_staff(uuid[]) to authenticated;
