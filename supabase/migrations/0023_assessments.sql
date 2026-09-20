-- ===============================================================
-- AMA EDU 0023 — exams, tests and the question bank
--
-- Ported from Pariya Central (app-exams.js, app-exams-admin.js) as
-- behaviour, not as code. What is deliberately NOT copied:
--
--  * Pariya trusted the browser's timer. Here the deadline is stored
--    on the attempt and re-checked in submit_assessment_attempt();
--    a late submission is marked as such and cannot gain time.
--  * Pariya let the client read assessment_questions directly, which
--    means correct_option was one API call away. Here RLS forbids a
--    student reading that table at all; questions reach them only
--    through get_attempt_questions(), which omits the answer column.
--  * Scoring is entirely server-side, against the stored questions,
--    not against anything the client submits.
--  * Every assessment is school-scoped; Pariya's were global.
-- ===============================================================

create table if not exists public.assessments (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade
                  default app.current_school_id(),
  class_id      uuid not null references public.classes(id)  on delete cascade,
  subject_id    uuid not null references public.subjects(id) on delete cascade,
  term_id       uuid not null references public.terms(id)    on delete cascade,
  assessment_type app.score_period not null,          -- ca1 | ca2 | ca3 | exam
  title         text not null check (length(btrim(title)) between 2 and 160),
  instructions  text,
  duration_minutes smallint check (duration_minutes is null or duration_minutes between 1 and 600),
  questions_per_student smallint check (questions_per_student is null or questions_per_student >= 1),
  marking_mode  text not null default 'per_question'
                  check (marking_mode in ('per_question','uniform')),
  uniform_mark_per_question numeric(5,2) default 1 check (uniform_mark_per_question > 0),
  shuffle_questions boolean not null default true,
  shuffle_options   boolean not null default false,
  max_attempts  smallint not null default 1 check (max_attempts between 1 and 5),
  status        text not null default 'draft'
                  check (status in ('draft','scheduled','active','closed')),
  start_at      timestamptz,
  end_at        timestamptz,
  sync_to_scores boolean not null default true,
  created_by    uuid references public.staff(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_at is null or start_at is null or end_at > start_at)
);
create index if not exists assessments_lookup_idx
  on public.assessments (school_id, term_id, class_id, subject_id);
create trigger assessments_touch before update on public.assessments
  for each row execute function app.touch_updated_at();

create table if not exists public.assessment_questions (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade
                  default app.current_school_id(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  question_text text not null check (length(btrim(question_text)) > 0),
  option_a      text not null,
  option_b      text not null,
  option_c      text,
  option_d      text,
  correct_option text not null check (correct_option in ('A','B','C','D')),
  marks         numeric(5,2) not null default 1 check (marks > 0),
  order_index   integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists assessment_questions_idx
  on public.assessment_questions (assessment_id, order_index);

-- Same question text twice in one assessment is a data-entry slip.
create unique index if not exists assessment_questions_no_duplicates
  on public.assessment_questions (assessment_id, lower(btrim(question_text)));

create table if not exists public.assessment_attempts (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade
                  default app.current_school_id(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  student_id    uuid not null references public.students(id)    on delete cascade,
  attempt_no    smallint not null default 1,
  question_ids  uuid[] not null default '{}',
  status        text not null default 'in_progress'
                  check (status in ('in_progress','submitted','expired')),
  score         numeric(6,2),
  total_marks   numeric(6,2),
  percentage    numeric(5,2),
  started_at    timestamptz not null default now(),
  deadline_at   timestamptz,
  submitted_at  timestamptz,
  was_late      boolean not null default false,
  unique (assessment_id, student_id, attempt_no)
);
create index if not exists assessment_attempts_idx
  on public.assessment_attempts (assessment_id, status);

create table if not exists public.assessment_answers (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade
                  default app.current_school_id(),
  attempt_id    uuid not null references public.assessment_attempts(id) on delete cascade,
  question_id   uuid not null references public.assessment_questions(id) on delete cascade,
  selected_option text check (selected_option in ('A','B','C','D')),
  is_correct    boolean,
  marks_awarded numeric(5,2) not null default 0,
  unique (attempt_id, question_id)
);
create index if not exists assessment_answers_idx on public.assessment_answers (attempt_id);

-- ---------------- permissions ----------------
create or replace function app.can_manage_assessment(p_class_id uuid, p_subject_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.can_mark(p_class_id, p_subject_id);
$$;
grant execute on function app.can_manage_assessment(uuid, uuid) to authenticated;

-- What a student is actually allowed to be sitting right now.
create or replace function app.assessment_open(p_assessment_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select a.status in ('scheduled','active')
       and (a.start_at is null or a.start_at <= now())
       and (a.end_at  is null or a.end_at  >  now())
    from public.assessments a where a.id = p_assessment_id), false);
$$;
grant execute on function app.assessment_open(uuid) to authenticated;

-- ---------------- student: what can I sit? ----------------
create or replace function public.get_my_available_assessments(p_kind text, p_term_id uuid)
returns table (
  assessment_id uuid, title text, subject_name text, assessment_type text,
  question_count bigint, total_marks numeric, duration_minutes smallint,
  start_at timestamptz, end_at timestamptz, effective_status text,
  my_attempt_status text, my_score numeric, my_total numeric
)
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select st.id, st.class_id from public.students st where st.id = app.current_student_id())
  select a.id, a.title, s.name, a.assessment_type::text,
         (select count(*) from public.assessment_questions q where q.assessment_id = a.id),
         coalesce((select case when a.marking_mode = 'uniform'
                          then count(*) * a.uniform_mark_per_question else sum(q.marks) end
                   from public.assessment_questions q where q.assessment_id = a.id), 0),
         a.duration_minutes, a.start_at, a.end_at,
         case when a.status = 'closed' then 'closed'
              when a.start_at is not null and a.start_at > now() then 'scheduled'
              when a.end_at is not null and a.end_at <= now() then 'closed'
              when a.status in ('scheduled','active') then 'active'
              else 'draft' end,
         (select at.status from public.assessment_attempts at
           where at.assessment_id = a.id and at.student_id = (select id from me)
           order by at.attempt_no desc limit 1),
         (select at.score from public.assessment_attempts at
           where at.assessment_id = a.id and at.student_id = (select id from me)
             and at.status = 'submitted' order by at.attempt_no desc limit 1),
         (select at.total_marks from public.assessment_attempts at
           where at.assessment_id = a.id and at.student_id = (select id from me)
             and at.status = 'submitted' order by at.attempt_no desc limit 1)
  from public.assessments a
  join public.subjects s on s.id = a.subject_id
  where a.class_id = (select class_id from me)
    and a.term_id = p_term_id
    and a.status <> 'draft'
    and ((p_kind = 'exam' and a.assessment_type = 'exam')
      or (p_kind = 'test' and a.assessment_type in ('ca1','ca2','ca3')))
  order by a.assessment_type, s.name;
$$;
grant execute on function public.get_my_available_assessments(text, uuid) to authenticated;

-- ---------------- start an attempt ----------------
create or replace function public.start_assessment_attempt(p_assessment_id uuid)
returns table (attempt uuid, title text, total uuid[], marks numeric,
               began_at timestamptz, ends_at timestamptz, minutes smallint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.assessments%rowtype; v_student uuid := app.current_student_id();
  v_class uuid; v_ids uuid[]; v_n int; v_existing public.assessment_attempts%rowtype;
  v_attempt uuid; v_marks numeric; v_deadline timestamptz; v_no smallint;
begin
  if v_student is null then raise exception 'Only a student can start an assessment.' using errcode = '42501'; end if;
  select * into a from public.assessments where id = p_assessment_id;
  if a.id is null or not coalesce(app.owns(a.school_id), false) then
    raise exception 'That assessment was not found.' using errcode = '42501';
  end if;

  select st.class_id into v_class from public.students st where st.id = v_student;
  if v_class is distinct from a.class_id then
    raise exception 'That assessment is not for your class.' using errcode = '42501';
  end if;
  if not app.assessment_open(p_assessment_id) then
    raise exception 'This assessment is not open at the moment.' using errcode = '42501';
  end if;

  -- Resume rather than restart: refreshing the page must not cost a
  -- student a fresh set of questions or a fresh clock.
  select * into v_existing from public.assessment_attempts
  where assessment_id = p_assessment_id and student_id = v_student
  order by attempt_no desc limit 1;

  if v_existing.id is not null and v_existing.status = 'in_progress' then
    return query select v_existing.id, a.title, v_existing.question_ids, v_existing.total_marks,
                        v_existing.started_at, v_existing.deadline_at, a.duration_minutes;
    return;
  end if;

  if v_existing.id is not null and v_existing.attempt_no >= a.max_attempts then
    raise exception 'You have already used all % attempt(s) for this assessment.', a.max_attempts
      using errcode = '42501';
  end if;
  v_no := coalesce(v_existing.attempt_no, 0) + 1;

  select count(*) into v_n from public.assessment_questions where assessment_id = p_assessment_id;
  if v_n = 0 then
    raise exception 'This assessment has no questions yet. Tell your teacher.' using errcode = '42501';
  end if;

  -- Random selection happens here, server-side, at the moment of
  -- starting -- so no two students can compare a predictable set.
  select array_agg(q.id order by q.ord) into v_ids from (
    select id, row_number() over (order by case when a.shuffle_questions then random() else order_index end) as ord
    from public.assessment_questions where assessment_id = p_assessment_id
    limit coalesce(a.questions_per_student, v_n)
  ) q;

  select case when a.marking_mode = 'uniform'
              then count(*) * a.uniform_mark_per_question else coalesce(sum(marks), 0) end
    into v_marks
  from public.assessment_questions where id = any (v_ids);

  v_deadline := case when a.duration_minutes is not null
                     then least(now() + make_interval(mins => a.duration_minutes), coalesce(a.end_at, 'infinity'::timestamptz))
                     else a.end_at end;

  insert into public.assessment_attempts
    (school_id, assessment_id, student_id, attempt_no, question_ids, total_marks, deadline_at)
  values (a.school_id, p_assessment_id, v_student, v_no, v_ids, v_marks, v_deadline)
  returning id into v_attempt;

  return query select v_attempt, a.title, v_ids, v_marks, now()::timestamptz, v_deadline, a.duration_minutes;
end $$;
grant execute on function public.start_assessment_attempt(uuid) to authenticated;

-- ---------------- the questions, WITHOUT the answers ----------------
create or replace function public.get_attempt_questions(p_attempt_id uuid)
returns table (question_id uuid, question_text text, option_a text, option_b text,
               option_c text, option_d text, marks numeric, q_position int)
-- NOTE: the last column is q_position, not position -- POSITION is a reserved
-- word in Postgres and RETURNS TABLE rejects it with a bare syntax error.
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare at public.assessment_attempts%rowtype; a public.assessments%rowtype;
begin
  select * into at from public.assessment_attempts where id = p_attempt_id;
  if at.id is null or at.student_id is distinct from app.current_student_id() then
    raise exception 'That attempt was not found.' using errcode = '42501';
  end if;
  select * into a from public.assessments where id = at.assessment_id;

  -- correct_option is deliberately absent from this result.
  return query
    select q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
           case when a.marking_mode = 'uniform' then a.uniform_mark_per_question else q.marks end,
           ord.n::int
    from unnest(at.question_ids) with ordinality as ord(qid, n)
    join public.assessment_questions q on q.id = ord.qid
    order by ord.n;
end $$;
grant execute on function public.get_attempt_questions(uuid) to authenticated;

-- ---------------- submit and mark, server-side ----------------
create or replace function public.submit_assessment_attempt(p_attempt_id uuid, p_answers jsonb)
returns table (score numeric, total_marks numeric, percentage numeric, was_late boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  at public.assessment_attempts%rowtype; a public.assessments%rowtype;
  v_score numeric := 0; v_late boolean := false; v_pct numeric; v_col text;
begin
  select * into at from public.assessment_attempts where id = p_attempt_id;
  if at.id is null or at.student_id is distinct from app.current_student_id() then
    raise exception 'That attempt was not found.' using errcode = '42501';
  end if;
  if at.status <> 'in_progress' then
    raise exception 'This attempt has already been submitted.' using errcode = '42501';
  end if;
  select * into a from public.assessments where id = at.assessment_id;

  -- The deadline is the server's, not the browser's.
  v_late := at.deadline_at is not null and now() > at.deadline_at + interval '30 seconds';

  -- Only answers to questions actually issued to THIS attempt count.
  insert into public.assessment_answers (school_id, attempt_id, question_id, selected_option, is_correct, marks_awarded)
  select at.school_id, at.id, q.id, upper(x.selected_option),
         upper(x.selected_option) = q.correct_option,
         case when upper(x.selected_option) = q.correct_option
              then case when a.marking_mode = 'uniform' then a.uniform_mark_per_question else q.marks end
              else 0 end
  from jsonb_to_recordset(coalesce(p_answers, '[]'::jsonb)) as x(question_id uuid, selected_option text)
  join public.assessment_questions q on q.id = x.question_id
  where q.id = any (at.question_ids)
    and upper(coalesce(x.selected_option,'')) in ('A','B','C','D')
  on conflict (attempt_id, question_id) do update
    set selected_option = excluded.selected_option,
        is_correct      = excluded.is_correct,
        marks_awarded   = excluded.marks_awarded;

  select coalesce(sum(marks_awarded), 0) into v_score
  from public.assessment_answers where attempt_id = at.id;

  v_pct := case when at.total_marks > 0 then round(100.0 * v_score / at.total_marks, 2) else null end;

  update public.assessment_attempts
    set status = 'submitted', score = v_score, percentage = v_pct,
        submitted_at = now(), was_late = v_late
    where id = at.id;

  -- Feed the report card, if the school asked for that. Never
  -- overwrite a score a teacher has already entered by hand.
  if a.sync_to_scores and v_pct is not null then
    v_col := a.assessment_type::text;
    insert into public.student_scores as ss (school_id, student_id, class_id, subject_id, term_id, ca1, ca2, ca3, exam)
    values (a.school_id, at.student_id, a.class_id, a.subject_id, a.term_id,
            case when v_col='ca1'  then round(v_pct * app.component_max(a.school_id,'ca1')  / 100, 2) end,
            case when v_col='ca2'  then round(v_pct * app.component_max(a.school_id,'ca2')  / 100, 2) end,
            case when v_col='ca3'  then round(v_pct * app.component_max(a.school_id,'ca3')  / 100, 2) end,
            case when v_col='exam' then round(v_pct * app.component_max(a.school_id,'exam') / 100, 2) end)
    on conflict (student_id, subject_id, term_id) do update set
      ca1  = case when v_col='ca1'  and ss.ca1  is null then excluded.ca1  else ss.ca1  end,
      ca2  = case when v_col='ca2'  and ss.ca2  is null then excluded.ca2  else ss.ca2  end,
      ca3  = case when v_col='ca3'  and ss.ca3  is null then excluded.ca3  else ss.ca3  end,
      exam = case when v_col='exam' and ss.exam is null then excluded.exam else ss.exam end;
  end if;

  return query select v_score, at.total_marks, v_pct, v_late;
end $$;
grant execute on function public.submit_assessment_attempt(uuid, jsonb) to authenticated;

-- An attempt abandoned past its deadline stops counting as live.
create or replace function public.expire_stale_attempts()
returns integer language sql security definer set search_path = public, pg_temp as $$
  with done as (
    update public.assessment_attempts
      set status = 'expired', submitted_at = now(), score = coalesce(score, 0), percentage = coalesce(percentage, 0)
      where status = 'in_progress' and deadline_at is not null and deadline_at < now() - interval '5 minutes'
      returning 1)
  select count(*)::int from done;
$$;
grant execute on function public.expire_stale_attempts() to service_role;

-- ---------------- teacher: results for one assessment ----------------
create or replace function public.assessment_results(p_assessment_id uuid)
returns table (student_id uuid, full_name text, admission_no text, status text,
               score numeric, total_marks numeric, percentage numeric,
               submitted_at timestamptz, was_late boolean, rank_no bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  select st.id, st.full_name, st.admission_no,
         coalesce(at.status, 'not_started'), at.score, at.total_marks, at.percentage,
         at.submitted_at, coalesce(at.was_late, false),
         rank() over (order by at.percentage desc nulls last)
  from public.assessments a
  join public.students st on st.class_id = a.class_id and st.is_active
  left join public.assessment_attempts at
    on at.assessment_id = a.id and at.student_id = st.id
  where a.id = p_assessment_id
  order by at.percentage desc nulls last, st.full_name;
$$;
grant execute on function public.assessment_results(uuid) to authenticated;

-- Preview how the random distribution will behave before going live.
create or replace function public.preview_assessment_distribution(p_assessment_id uuid)
returns table (bank_count bigint, eligible_students bigint, per_student int,
               distinct_combinations text, shuffle_questions boolean)
language sql stable security invoker set search_path = public, pg_temp as $$
  select (select count(*) from public.assessment_questions q where q.assessment_id = a.id),
         (select count(*) from public.students st where st.class_id = a.class_id and st.is_active),
         coalesce(a.questions_per_student,
                  (select count(*)::int from public.assessment_questions q where q.assessment_id = a.id)),
         case when a.questions_per_student is null then 'Every student receives the whole bank'
              else 'Each student receives a different random selection' end,
         a.shuffle_questions
  from public.assessments a where a.id = p_assessment_id;
$$;
grant execute on function public.preview_assessment_distribution(uuid) to authenticated;

-- ---------------- RLS ----------------
do $$
declare t text;
begin
  foreach t in array array['assessments','assessment_questions','assessment_attempts','assessment_answers']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Assessments: staff of the school read; only someone who may mark
-- that class+subject may create or change one. A student sees the
-- list through get_my_available_assessments(), not this table.
create policy assessments_staff_read on public.assessments
  for select to authenticated using (app.owns(school_id) and app.is_reader());
create policy assessments_write on public.assessments
  for all to authenticated
  using (app.owns(school_id) and app.can_manage_assessment(class_id, subject_id))
  with check (app.owns(school_id) and app.can_manage_assessment(class_id, subject_id));

-- THE IMPORTANT ONE: this table holds correct_option. No student or
-- parent policy exists, so it is unreadable to them at any price.
create policy questions_staff_read on public.assessment_questions
  for select to authenticated
  using (app.owns(school_id) and app.is_staff()
         and exists (select 1 from public.assessments a
                     where a.id = assessment_id and app.can_manage_assessment(a.class_id, a.subject_id)));
create policy questions_write on public.assessment_questions
  for all to authenticated
  using (app.owns(school_id) and exists (select 1 from public.assessments a
          where a.id = assessment_id and app.can_manage_assessment(a.class_id, a.subject_id)))
  with check (app.owns(school_id) and exists (select 1 from public.assessments a
          where a.id = assessment_id and app.can_manage_assessment(a.class_id, a.subject_id)));

create policy attempts_staff_read on public.assessment_attempts
  for select to authenticated using (app.owns(school_id) and app.is_reader());
create policy attempts_own_read on public.assessment_attempts
  for select to authenticated
  using (app.owns(school_id)
         and (student_id = app.current_student_id() or student_id in (select app.my_children())));

create policy answers_own_read on public.assessment_answers
  for select to authenticated
  using (app.owns(school_id) and exists (
    select 1 from public.assessment_attempts at where at.id = attempt_id
      and (at.student_id = app.current_student_id() or app.is_reader())));

-- Attempts and answers are written only by the RPCs above.
revoke insert, update, delete on public.assessment_attempts from authenticated;
revoke insert, update, delete on public.assessment_answers  from authenticated;
grant select on public.assessment_attempts, public.assessment_answers to authenticated;
grant select, insert, update, delete on public.assessments, public.assessment_questions to authenticated;
