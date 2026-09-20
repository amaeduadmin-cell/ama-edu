-- ===============================================================
-- AMA EDU 0024 — fix: start_assessment_attempt() failed with
--   42702 column reference "marks" is ambiguous
--
-- Same root cause as 0022: a RETURNS TABLE column named `marks`
-- shadows assessment_questions.marks inside the body, so
-- `coalesce(sum(marks), 0)` is ambiguous. Every OUT parameter on
-- these functions now carries an out_ prefix, which no column uses,
-- so this class of bug cannot recur here.
-- ===============================================================

drop function if exists public.start_assessment_attempt(uuid);

create or replace function public.start_assessment_attempt(p_assessment_id uuid)
returns table (out_attempt_id uuid, out_title text, out_question_ids uuid[],
               out_total_marks numeric, out_started_at timestamptz,
               out_deadline_at timestamptz, out_minutes smallint)
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

  select count(*) into v_n from public.assessment_questions q where q.assessment_id = p_assessment_id;
  if v_n = 0 then
    raise exception 'This assessment has no questions yet. Tell your teacher.' using errcode = '42501';
  end if;

  select array_agg(x.id order by x.ord) into v_ids from (
    select q.id, row_number() over (order by case when a.shuffle_questions then random() else q.order_index end) as ord
    from public.assessment_questions q where q.assessment_id = p_assessment_id
    limit coalesce(a.questions_per_student, v_n)
  ) x;

  select case when a.marking_mode = 'uniform'
              then count(*) * a.uniform_mark_per_question else coalesce(sum(q.marks), 0) end
    into v_marks
  from public.assessment_questions q where q.id = any (v_ids);

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

drop function if exists public.submit_assessment_attempt(uuid, jsonb);

create or replace function public.submit_assessment_attempt(p_attempt_id uuid, p_answers jsonb)
returns table (out_score numeric, out_total_marks numeric, out_percentage numeric, out_was_late boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_at public.assessment_attempts%rowtype; a public.assessments%rowtype;
  v_score numeric := 0; v_late boolean := false; v_pct numeric; v_col text;
begin
  select * into v_at from public.assessment_attempts where id = p_attempt_id;
  if v_at.id is null or v_at.student_id is distinct from app.current_student_id() then
    raise exception 'That attempt was not found.' using errcode = '42501';
  end if;
  if v_at.status <> 'in_progress' then
    raise exception 'This attempt has already been submitted.' using errcode = '42501';
  end if;
  select * into a from public.assessments where id = v_at.assessment_id;

  -- The clock that counts is the server's.
  v_late := v_at.deadline_at is not null and now() > v_at.deadline_at + interval '30 seconds';

  insert into public.assessment_answers (school_id, attempt_id, question_id, selected_option, is_correct, marks_awarded)
  select v_at.school_id, v_at.id, q.id, upper(x.selected_option),
         upper(x.selected_option) = q.correct_option,
         case when upper(x.selected_option) = q.correct_option
              then case when a.marking_mode = 'uniform' then a.uniform_mark_per_question else q.marks end
              else 0 end
  from jsonb_to_recordset(coalesce(p_answers, '[]'::jsonb)) as x(question_id uuid, selected_option text)
  join public.assessment_questions q on q.id = x.question_id
  where q.id = any (v_at.question_ids)
    and upper(coalesce(x.selected_option,'')) in ('A','B','C','D')
  on conflict (attempt_id, question_id) do update
    set selected_option = excluded.selected_option,
        is_correct      = excluded.is_correct,
        marks_awarded   = excluded.marks_awarded;

  select coalesce(sum(ans.marks_awarded), 0) into v_score
  from public.assessment_answers ans where ans.attempt_id = v_at.id;

  v_pct := case when v_at.total_marks > 0 then round(100.0 * v_score / v_at.total_marks, 2) else null end;

  update public.assessment_attempts
    set status = 'submitted', score = v_score, percentage = v_pct,
        submitted_at = now(), was_late = v_late
    where id = v_at.id;

  if a.sync_to_scores and v_pct is not null then
    v_col := a.assessment_type::text;
    insert into public.student_scores as ss (school_id, student_id, class_id, subject_id, term_id, ca1, ca2, ca3, exam)
    values (a.school_id, v_at.student_id, a.class_id, a.subject_id, a.term_id,
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

  return query select v_score, v_at.total_marks, v_pct, v_late;
end $$;
grant execute on function public.submit_assessment_attempt(uuid, jsonb) to authenticated;
