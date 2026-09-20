-- ===============================================================
-- AMA EDU 0022 — fix: save_attendance() failed with
--   42702 column reference "attendance_id" is ambiguous
--
-- The function's OUT parameters were named attendance_id /
-- present_count / absent_count, which are also column names on
-- attendance_records and attendance_sessions. Inside the body, the
-- ON CONFLICT target and the UPDATE ... SET list could refer to
-- either, and PL/pgSQL refuses to guess. Renaming the OUT parameters
-- so they cannot collide is the fix; the column names stay as they
-- are, because those are what every query reads.
--
-- Caught by the attendance test run, before any UI was built on it.
-- ===============================================================

drop function if exists public.save_attendance(uuid, uuid, date, text, uuid[], text);

create or replace function public.save_attendance(
  p_class_id uuid, p_term_id uuid, p_date date, p_mode text,
  p_ticked uuid[], p_note text default null
) returns table (saved_session uuid, marked_present int, marked_absent int, was_correction boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_school uuid; v_session uuid; v_id uuid; v_existing boolean := false;
  v_present int; v_absent int; v_staff uuid := app.current_staff_id();
  v_before jsonb;
begin
  if p_mode not in ('present_only','absent_only') then
    raise exception 'Unknown attendance mode "%".', p_mode using errcode = '22023';
  end if;

  select c.school_id into v_school from public.classes c where c.id = p_class_id;
  if v_school is null or not coalesce(app.owns(v_school), false) then
    raise exception 'That class was not found.' using errcode = '42501';
  end if;
  if not app.can_mark_attendance(p_class_id) then
    raise exception 'You can only take attendance for your own class.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.terms t where t.id = p_term_id and t.school_id = v_school) then
    raise exception 'That term does not belong to this school.' using errcode = '42501';
  end if;
  if p_date > current_date then
    raise exception 'Attendance cannot be taken for a future date.' using errcode = '22023';
  end if;

  select t.session_id into v_session from public.terms t where t.id = p_term_id;

  if exists (select 1 from unnest(coalesce(p_ticked, '{}'::uuid[])) x
             where not exists (select 1 from public.students st
                               where st.id = x and st.class_id = p_class_id and st.is_active)) then
    raise exception 'One of those students is not in this class.' using errcode = '23503';
  end if;

  select s.id into v_id from public.attendance_sessions s
  where s.class_id = p_class_id and s.taken_on = p_date;
  v_existing := v_id is not null;

  if v_existing then
    select jsonb_object_agg(r.student_id, r.status) into v_before
    from public.attendance_records r where r.attendance_id = v_id;
    update public.attendance_sessions s
      set mode = p_mode, note = coalesce(p_note, s.note),
          taken_by = coalesce(v_staff, s.taken_by), updated_at = now()
      where s.id = v_id;
  else
    insert into public.attendance_sessions (school_id, class_id, term_id, session_id, taken_on, mode, taken_by, note)
    values (v_school, p_class_id, p_term_id, v_session, p_date, p_mode, v_staff, p_note)
    returning id into v_id;
  end if;

  insert into public.attendance_records as ar (school_id, attendance_id, student_id, status)
  select v_school, v_id, st.id,
         case when st.id = any (coalesce(p_ticked, '{}'::uuid[]))
              then case when p_mode = 'present_only' then 'present' else 'absent' end
              else case when p_mode = 'present_only' then 'absent'  else 'present' end
         end
  from public.students st
  where st.class_id = p_class_id and st.is_active
  on conflict (attendance_id, student_id) do update
    set status = excluded.status, updated_at = now();

  delete from public.attendance_records r
  where r.attendance_id = v_id
    and not exists (select 1 from public.students st
                    where st.id = r.student_id and st.class_id = p_class_id and st.is_active);

  select count(*) filter (where r.status = 'present'), count(*) filter (where r.status = 'absent')
    into v_present, v_absent
  from public.attendance_records r where r.attendance_id = v_id;

  update public.attendance_sessions s
    set present_count = v_present, absent_count = v_absent, updated_at = now()
    where s.id = v_id;

  perform app.write_audit(v_school,
    case when v_existing then 'attendance.corrected' else 'attendance.taken' end,
    'attendance_sessions', v_id,
    jsonb_build_object('class_id', p_class_id, 'date', p_date, 'mode', p_mode,
                       'present', v_present, 'absent', v_absent,
                       'previous', case when v_existing then v_before else null end));

  return query select v_id, v_present, v_absent, v_existing;
end $$;
grant execute on function public.save_attendance(uuid, uuid, date, text, uuid[], text) to authenticated;

-- The register a teacher opens: every active student in the class with
-- whatever was already recorded for that date.
create or replace function public.attendance_register(p_class_id uuid, p_date date)
returns table (student_id uuid, full_name text, admission_no text, record_id uuid, status text)
language sql stable security invoker set search_path = public, pg_temp as $$
  select st.id, st.full_name, st.admission_no, r.id, r.status
  from public.students st
  left join public.attendance_sessions s
    on s.class_id = st.class_id and s.taken_on = p_date
  left join public.attendance_records r
    on r.attendance_id = s.id and r.student_id = st.id
  where st.class_id = p_class_id and st.is_active
  order by st.full_name;
$$;
grant execute on function public.attendance_register(uuid, date) to authenticated;
