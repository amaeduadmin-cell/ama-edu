-- ===============================================================
-- AMA EDU 0025 — homework / assignments
--
-- Ported from Pariya Central app-assignments.js. Differences that
-- matter:
--  * Pariya computed "late" in the browser from the client clock.
--    Here the status is derived server-side from the stored due_at,
--    so a student cannot submit late and have it recorded as on time.
--  * Pariya let a student insert a submission row directly, which
--    also let them write their own grade. Here submissions go through
--    submit_assignment(), and the grade columns are writable only by
--    a teacher who may mark that class+subject.
--  * Parents can see their own children's homework status.
-- ===============================================================

create table if not exists public.assignments (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade
                 default app.current_school_id(),
  class_id     uuid not null references public.classes(id)  on delete cascade,
  subject_id   uuid not null references public.subjects(id) on delete cascade,
  term_id      uuid not null references public.terms(id)    on delete cascade,
  title        text not null check (length(btrim(title)) between 2 and 200),
  instructions text,
  due_at       timestamptz,
  requires_portal_submission boolean not null default true,
  max_score    numeric(5,2) check (max_score is null or max_score > 0),
  is_published boolean not null default true,
  created_by   uuid references public.staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists assignments_lookup_idx
  on public.assignments (school_id, term_id, class_id);
drop trigger if exists assignments_touch on public.assignments;
create trigger assignments_touch before update on public.assignments
  for each row execute function app.touch_updated_at();

create table if not exists public.assignment_submissions (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade
                  default app.current_school_id(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id    uuid not null references public.students(id)    on delete cascade,
  answer_text   text,
  status        text not null default 'submitted'
                  check (status in ('submitted','late','graded')),
  grade         numeric(5,2) check (grade is null or grade >= 0),
  feedback      text,
  graded_by     uuid references public.staff(id) on delete set null,
  graded_at     timestamptz,
  is_released   boolean not null default false,
  submitted_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (assignment_id, student_id)
);
create index if not exists assignment_submissions_idx
  on public.assignment_submissions (assignment_id, status);

-- ---------------- student submits ----------------
create or replace function public.submit_assignment(p_assignment_id uuid, p_answer text)
returns table (out_status text, out_submitted_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.assignments%rowtype; v_student uuid := app.current_student_id();
        v_class uuid; v_status text; v_when timestamptz := now();
begin
  if v_student is null then
    raise exception 'Only a student can submit homework.' using errcode = '42501';
  end if;
  select * into a from public.assignments where id = p_assignment_id;
  if a.id is null or not coalesce(app.owns(a.school_id), false) or not a.is_published then
    raise exception 'That assignment was not found.' using errcode = '42501';
  end if;
  select st.class_id into v_class from public.students st where st.id = v_student;
  if v_class is distinct from a.class_id then
    raise exception 'That assignment is not for your class.' using errcode = '42501';
  end if;
  if not a.requires_portal_submission then
    raise exception 'This assignment is not submitted through the portal.' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_answer)), 0) = 0 then
    raise exception 'Write your answer before submitting.' using errcode = '23514';
  end if;

  -- Late is decided here, from the stored due date.
  v_status := case when a.due_at is not null and v_when > a.due_at then 'late' else 'submitted' end;

  insert into public.assignment_submissions as s
    (school_id, assignment_id, student_id, answer_text, status, submitted_at)
  values (a.school_id, p_assignment_id, v_student, p_answer, v_status, v_when)
  on conflict (assignment_id, student_id) do update
    set answer_text  = excluded.answer_text,
        status       = case when s.status = 'graded' then s.status else excluded.status end,
        submitted_at = excluded.submitted_at,
        updated_at   = now()
    where s.status <> 'graded';

  if not found then
    raise exception 'This assignment has already been graded and can no longer be changed.' using errcode = '42501';
  end if;

  return query select v_status, v_when;
end $$;
grant execute on function public.submit_assignment(uuid, text) to authenticated;

-- ---------------- teacher grades ----------------
create or replace function public.grade_assignment(
  p_submission_id uuid, p_grade numeric, p_feedback text default null, p_release boolean default true)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.assignments%rowtype; s public.assignment_submissions%rowtype;
begin
  select * into s from public.assignment_submissions where id = p_submission_id;
  if s.id is null or not coalesce(app.owns(s.school_id), false) then
    raise exception 'That submission was not found.' using errcode = '42501';
  end if;
  select * into a from public.assignments where id = s.assignment_id;
  if not app.can_mark(a.class_id, a.subject_id) then
    raise exception 'You cannot grade homework for this class and subject.' using errcode = '42501';
  end if;
  if p_grade is not null and a.max_score is not null and p_grade > a.max_score then
    raise exception 'The grade cannot be more than % for this assignment.', a.max_score using errcode = '23514';
  end if;
  if p_grade is not null and p_grade < 0 then
    raise exception 'The grade cannot be negative.' using errcode = '23514';
  end if;

  update public.assignment_submissions
    set grade = p_grade, feedback = p_feedback,
        status = case when p_grade is null then status else 'graded' end,
        graded_by = app.current_staff_id(), graded_at = now(),
        is_released = p_release, updated_at = now()
    where id = p_submission_id;

  perform app.write_audit(s.school_id, 'assignment.graded', 'assignment_submissions', p_submission_id,
    jsonb_build_object('grade', p_grade, 'released', p_release));
end $$;
grant execute on function public.grade_assignment(uuid, numeric, text, boolean) to authenticated;

-- ---------------- what a student / parent sees ----------------
create or replace function public.my_assignments(p_student_id uuid, p_term_id uuid)
returns table (assignment_id uuid, title text, subject_name text, instructions text,
               due_at timestamptz, requires_submission boolean, max_score numeric,
               my_status text, my_grade numeric, my_feedback text, submitted_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.title, s.name, a.instructions, a.due_at, a.requires_portal_submission, a.max_score,
         case when sub.id is null and a.due_at is not null and now() > a.due_at then 'overdue'
              when sub.id is null then 'pending'
              else sub.status end,
         case when sub.is_released then sub.grade end,
         case when sub.is_released then sub.feedback end,
         sub.submitted_at
  from public.assignments a
  join public.subjects s on s.id = a.subject_id
  join public.students st on st.id = p_student_id and st.class_id = a.class_id
  left join public.assignment_submissions sub
    on sub.assignment_id = a.id and sub.student_id = p_student_id
  where a.term_id = p_term_id and a.is_published
    and (p_student_id = app.current_student_id()
         or p_student_id in (select app.my_children())
         or app.is_reader())
  order by a.due_at nulls last, a.created_at desc;
$$;
grant execute on function public.my_assignments(uuid, uuid) to authenticated;

create or replace function public.assignment_submission_overview(p_assignment_id uuid)
returns table (student_id uuid, full_name text, admission_no text, submission_id uuid,
               status text, grade numeric, submitted_at timestamptz, is_released boolean)
language sql stable security invoker set search_path = public, pg_temp as $$
  select st.id, st.full_name, st.admission_no, sub.id,
         case when sub.id is null and a.due_at is not null and now() > a.due_at then 'overdue'
              when sub.id is null then 'pending' else sub.status end,
         sub.grade, sub.submitted_at, coalesce(sub.is_released, false)
  from public.assignments a
  join public.students st on st.class_id = a.class_id and st.is_active
  left join public.assignment_submissions sub
    on sub.assignment_id = a.id and sub.student_id = st.id
  where a.id = p_assignment_id
  order by st.full_name;
$$;
grant execute on function public.assignment_submission_overview(uuid) to authenticated;

-- ---------------- RLS ----------------
alter table public.assignments enable row level security;
alter table public.assignments force row level security;
alter table public.assignment_submissions enable row level security;
alter table public.assignment_submissions force row level security;

create policy assignments_staff_read on public.assignments
  for select to authenticated using (app.owns(school_id) and app.is_reader());
create policy assignments_own_read on public.assignments
  for select to authenticated
  using (app.owns(school_id) and is_published and class_id in (
    select st.class_id from public.students st
    where st.id = app.current_student_id() or st.id in (select app.my_children())));
create policy assignments_write on public.assignments
  for all to authenticated
  using (app.owns(school_id) and app.can_mark(class_id, subject_id))
  with check (app.owns(school_id) and app.can_mark(class_id, subject_id));

create policy submissions_staff_read on public.assignment_submissions
  for select to authenticated using (app.owns(school_id) and app.is_reader());
create policy submissions_own_read on public.assignment_submissions
  for select to authenticated
  using (app.owns(school_id)
         and (student_id = app.current_student_id() or student_id in (select app.my_children())));

-- Writes only through submit_assignment() / grade_assignment(), so a
-- student cannot write their own grade.
revoke insert, update, delete on public.assignment_submissions from authenticated;
grant select on public.assignment_submissions to authenticated;
grant select, insert, update, delete on public.assignments to authenticated;
