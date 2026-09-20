-- ===============================================================
-- AMA EDU 0021 — online attendance
--
-- One session per class+date, holding one record per student. The
-- two marking modes the spec asks for are a property of the SESSION,
-- not of the records: the teacher ticks either the present or the
-- absent students, and save_attendance() fills in everyone else.
-- That inversion happens server-side, so a phone that loses signal
-- halfway cannot leave a class half-marked.
--
-- Duplicate attendance is impossible: unique (class_id, date).
-- Corrections are allowed, recorded, and audited.
-- ===============================================================

create table if not exists public.attendance_sessions (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade
                default app.current_school_id(),
  class_id    uuid not null references public.classes(id) on delete cascade,
  term_id     uuid not null references public.terms(id)   on delete cascade,
  session_id  uuid references public.sessions(id) on delete set null,
  taken_on    date not null default current_date,
  mode        text not null default 'present_only'
                check (mode in ('present_only','absent_only')),
  present_count smallint not null default 0,
  absent_count  smallint not null default 0,
  taken_by    uuid references public.staff(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (class_id, taken_on)
);
create index if not exists attendance_sessions_lookup_idx
  on public.attendance_sessions (school_id, term_id, taken_on desc);

create table if not exists public.attendance_records (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id) on delete cascade
                   default app.current_school_id(),
  attendance_id  uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id     uuid not null references public.students(id) on delete cascade,
  status         text not null default 'present'
                   check (status in ('present','absent','late','excused')),
  note           text,
  updated_at     timestamptz not null default now(),
  unique (attendance_id, student_id)
);
create index if not exists attendance_records_student_idx
  on public.attendance_records (student_id, status);
create index if not exists attendance_records_session_idx
  on public.attendance_records (attendance_id);

-- Who may mark this class: an admin, the head for their section, or
-- the class's own form teacher. A subject teacher cannot mark a
-- register for a class they merely teach one subject in.
create or replace function app.can_mark_attendance(p_class_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when app.is_school_admin() then true
    when app.has_role('headmaster') then exists (
      select 1 from public.classes c where c.id = p_class_id
        and c.school_id = app.current_school_id() and c.category in ('nursery','primary','islamiyya'))
    when app.has_role('principal') then exists (
      select 1 from public.classes c where c.id = p_class_id
        and c.school_id = app.current_school_id() and c.category in ('jss','ss'))
    when app.has_role('teacher') then app.is_form_teacher(p_class_id)
    else false
  end;
$$;
grant execute on function app.can_mark_attendance(uuid) to authenticated;

-- ---------------- save (and correct) a register ----------------
-- p_ticked is whatever the teacher ticked; p_mode says what a tick
-- MEANS. Everyone in the class who was not ticked gets the opposite.
create or replace function public.save_attendance(
  p_class_id uuid, p_term_id uuid, p_date date, p_mode text,
  p_ticked uuid[], p_note text default null
) returns table (attendance_id uuid, present_count int, absent_count int, was_correction boolean)
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

  -- Every ticked student must actually be in this class.
  if exists (select 1 from unnest(coalesce(p_ticked, '{}'::uuid[])) x
             where not exists (select 1 from public.students st
                               where st.id = x and st.class_id = p_class_id and st.is_active)) then
    raise exception 'One of those students is not in this class.' using errcode = '23503';
  end if;

  select id into v_id from public.attendance_sessions
  where class_id = p_class_id and taken_on = p_date;
  v_existing := v_id is not null;

  if v_existing then
    select jsonb_object_agg(r.student_id, r.status) into v_before
    from public.attendance_records r where r.attendance_id = v_id;
    update public.attendance_sessions
      set mode = p_mode, note = coalesce(p_note, note), taken_by = coalesce(v_staff, taken_by), updated_at = now()
      where id = v_id;
  else
    insert into public.attendance_sessions (school_id, class_id, term_id, session_id, taken_on, mode, taken_by, note)
    values (v_school, p_class_id, p_term_id, v_session, p_date, p_mode, v_staff, p_note)
    returning id into v_id;
  end if;

  -- The inversion. One statement covers the whole class, so no student
  -- is ever left without a record for a day that was marked.
  insert into public.attendance_records (school_id, attendance_id, student_id, status)
  select v_school, v_id, st.id,
         case when st.id = any (coalesce(p_ticked, '{}'::uuid[]))
              then case when p_mode = 'present_only' then 'present' else 'absent' end
              else case when p_mode = 'present_only' then 'absent'  else 'present' end
         end
  from public.students st
  where st.class_id = p_class_id and st.is_active
  on conflict (attendance_id, student_id) do update
    set status = excluded.status, updated_at = now();

  -- Students who have left the class since the register was taken.
  delete from public.attendance_records r
  where r.attendance_id = v_id
    and not exists (select 1 from public.students st
                    where st.id = r.student_id and st.class_id = p_class_id and st.is_active);

  select count(*) filter (where status = 'present'), count(*) filter (where status = 'absent')
    into v_present, v_absent
  from public.attendance_records where attendance_id = v_id;

  update public.attendance_sessions
    set present_count = v_present, absent_count = v_absent, updated_at = now()
    where id = v_id;

  perform app.write_audit(v_school,
    case when v_existing then 'attendance.corrected' else 'attendance.taken' end,
    'attendance_sessions', v_id,
    jsonb_build_object('class_id', p_class_id, 'date', p_date, 'mode', p_mode,
                       'present', v_present, 'absent', v_absent,
                       'previous', case when v_existing then v_before else null end));

  return query select v_id, v_present, v_absent, v_existing;
end $$;
grant execute on function public.save_attendance(uuid, uuid, date, text, uuid[], text) to authenticated;

-- A single student's status can be corrected without redoing the day.
create or replace function public.set_attendance_status(p_record_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_class uuid; v_school uuid; v_att uuid; v_old text; v_p int; v_a int;
begin
  if p_status not in ('present','absent','late','excused') then
    raise exception 'Unknown attendance status "%".', p_status using errcode = '22023';
  end if;
  select r.attendance_id, r.status, s.class_id, s.school_id into v_att, v_old, v_class, v_school
  from public.attendance_records r
  join public.attendance_sessions s on s.id = r.attendance_id
  where r.id = p_record_id;
  if v_class is null or not coalesce(app.owns(v_school), false) then
    raise exception 'That attendance record was not found.' using errcode = '42501';
  end if;
  if not app.can_mark_attendance(v_class) then
    raise exception 'You cannot change attendance for this class.' using errcode = '42501';
  end if;

  update public.attendance_records set status = p_status, note = coalesce(p_note, note), updated_at = now()
  where id = p_record_id;

  select count(*) filter (where status='present'), count(*) filter (where status='absent') into v_p, v_a
  from public.attendance_records where attendance_id = v_att;
  update public.attendance_sessions set present_count = v_p, absent_count = v_a, updated_at = now() where id = v_att;

  perform app.write_audit(v_school, 'attendance.record_changed', 'attendance_records', p_record_id,
    jsonb_build_object('from', v_old, 'to', p_status));
end $$;
grant execute on function public.set_attendance_status(uuid, text, text) to authenticated;

-- ---------------- summaries ----------------
create or replace function public.attendance_summary(p_student_id uuid, p_term_id uuid)
returns table (days_marked bigint, days_present bigint, days_absent bigint, percentage numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with rows as (
    select r.status from public.attendance_records r
    join public.attendance_sessions s on s.id = r.attendance_id
    where r.student_id = p_student_id and s.term_id = p_term_id
      and (p_student_id = app.current_student_id()
           or p_student_id in (select app.my_children())
           or (app.is_reader() and r.school_id = app.current_school_id()))
  )
  select count(*),
         count(*) filter (where status in ('present','late','excused')),
         count(*) filter (where status = 'absent'),
         case when count(*) > 0
              then round(100.0 * count(*) filter (where status in ('present','late','excused')) / count(*), 1)
              else null end
  from rows;
$$;
grant execute on function public.attendance_summary(uuid, uuid) to authenticated;

-- Feed the report card: days present/absent per student for a class+term.
create or replace function public.class_attendance_totals(p_class_id uuid, p_term_id uuid)
returns table (student_id uuid, days_present bigint, days_absent bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  select r.student_id,
         count(*) filter (where r.status in ('present','late','excused')),
         count(*) filter (where r.status = 'absent')
  from public.attendance_records r
  join public.attendance_sessions s on s.id = r.attendance_id
  where s.class_id = p_class_id and s.term_id = p_term_id
  group by r.student_id;
$$;
grant execute on function public.class_attendance_totals(uuid, uuid) to authenticated;

-- recompute_class_term() now also stamps attendance onto the summary,
-- so a published report card carries the right days present/absent.
create or replace function public.recompute_class_term(p_class_id uuid, p_term_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_school uuid; v_size smallint;
begin
  select school_id into v_school from public.classes where id = p_class_id;
  if v_school is null then raise exception 'class not found'; end if;
  if not coalesce(app.owns(v_school), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  with ranked as (
    select s.id, rank() over (partition by s.subject_id order by s.total desc) as pos
    from public.student_scores s
    where s.class_id = p_class_id and s.term_id = p_term_id and s.is_offered
  )
  update public.student_scores s set subject_position = r.pos
  from ranked r where r.id = s.id;

  select count(*) into v_size from public.students st
  where st.class_id = p_class_id and st.is_active;

  with agg as (
    select st.id as student_id,
           count(sc.id) filter (where sc.is_offered)  as subjects_count,
           sum(sc.total) filter (where sc.is_offered) as total_score,
           avg(sc.total) filter (where sc.is_offered) as average_score
    from public.students st
    left join public.student_scores sc on sc.student_id = st.id and sc.term_id = p_term_id
    where st.class_id = p_class_id and st.is_active
    group by st.id
  ), positioned as (
    select a.*, rank() over (order by a.average_score desc nulls last) as class_position from agg a
  ), att as (
    select r.student_id,
           count(*) filter (where r.status in ('present','late','excused')) as present,
           count(*) filter (where r.status = 'absent') as absent
    from public.attendance_records r
    join public.attendance_sessions s on s.id = r.attendance_id
    where s.class_id = p_class_id and s.term_id = p_term_id
    group by r.student_id
  )
  insert into public.student_term_summary
    (school_id, student_id, class_id, term_id, subjects_count, total_score,
     average_score, class_position, class_size, overall_grade,
     days_present, days_absent, computed_at)
  select v_school, p.student_id, p_class_id, p_term_id, p.subjects_count,
         round(p.total_score, 2), round(p.average_score, 2),
         case when p.subjects_count > 0 then p.class_position end,
         v_size, app.grade_for(v_school, round(p.average_score, 2)),
         a.present::smallint, a.absent::smallint, now()
  from positioned p
  left join att a on a.student_id = p.student_id
  on conflict (student_id, term_id) do update set
    subjects_count = excluded.subjects_count,
    total_score    = excluded.total_score,
    average_score  = excluded.average_score,
    class_position = excluded.class_position,
    class_size     = excluded.class_size,
    overall_grade  = excluded.overall_grade,
    days_present   = coalesce(excluded.days_present, public.student_term_summary.days_present),
    days_absent    = coalesce(excluded.days_absent,  public.student_term_summary.days_absent),
    computed_at    = now();
end $$;
grant execute on function public.recompute_class_term(uuid, uuid) to authenticated;

-- ---------------- RLS ----------------
alter table public.attendance_sessions enable row level security;
alter table public.attendance_sessions force row level security;
alter table public.attendance_records  enable row level security;
alter table public.attendance_records  force row level security;

create policy attendance_sessions_staff_read on public.attendance_sessions
  for select to authenticated using (app.owns(school_id) and app.is_reader());

create policy attendance_sessions_own_read on public.attendance_sessions
  for select to authenticated
  using (app.owns(school_id) and class_id in (
    select st.class_id from public.students st
    where st.id = app.current_student_id() or st.id in (select app.my_children())));

create policy attendance_records_staff_read on public.attendance_records
  for select to authenticated using (app.owns(school_id) and app.is_reader());

create policy attendance_records_own_read on public.attendance_records
  for select to authenticated
  using (app.owns(school_id)
         and (student_id = app.current_student_id() or student_id in (select app.my_children())));

-- Writes go through save_attendance() / set_attendance_status() only.
revoke insert, update, delete on public.attendance_sessions from authenticated;
revoke insert, update, delete on public.attendance_records  from authenticated;
grant select on public.attendance_sessions, public.attendance_records to authenticated;
