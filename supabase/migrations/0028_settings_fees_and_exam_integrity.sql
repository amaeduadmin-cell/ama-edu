-- ===============================================================
-- AMA EDU 0028 — settings RPCs, fee statuses, exam integrity
--
-- 1. Fees: a WAIVED state, and fee_status_detail() so screens can say
--    unpaid / partial / paid / waived instead of just paid / unpaid.
-- 2. Atomic setting changes. Assessment weights and grading bands each
--    have a rule that only holds for the WHOLE set (total = 100, no
--    overlaps), so editing one row at a time from the browser would be
--    rejected halfway. These RPCs replace the set in one transaction.
-- 3. Existing scores are protected: a weight cannot be lowered below a
--    mark already entered, and a component with marks cannot be turned
--    off. Changing the grading scale re-grades existing scores.
-- 4. Exam integrity: answers are saved as the student goes (previously
--    they lived only in the browser), a submission after the deadline
--    ignores unsaved answers, and abandoned attempts are closed.
-- 5. Bulk question import, section re-enable, settings audit trail.
-- ===============================================================

-- ---------------- 1. fees ----------------
alter table public.fee_payments add column if not exists waived boolean not null default false;
alter table public.fee_payments add column if not exists waived_reason text;

create or replace function app.student_fees_settled(p_student_id uuid, p_term_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case
      when fp.waived then true
      when fp.is_paid_override is not null then fp.is_paid_override
      else fp.amount_paid >= coalesce((
        select fs.amount from public.fee_structure fs
        join public.students st on st.id = p_student_id
        where fs.class_id = st.class_id and fs.term_id = p_term_id), 0)
      end
    from public.fee_payments fp
    where fp.student_id = p_student_id and fp.term_id = p_term_id
  ), false);
$$;

create or replace function public.fee_status_detail(p_student_id uuid, p_term_id uuid)
returns table (out_status text, out_expected numeric, out_paid numeric, out_balance numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_school uuid; v_class uuid; v_expected numeric; fp public.fee_payments%rowtype;
begin
  select st.school_id, st.class_id into v_school, v_class from public.students st where st.id = p_student_id;
  if v_school is null then return; end if;
  if not (p_student_id = app.current_student_id()
          or p_student_id in (select app.my_children())
          or (coalesce(app.owns(v_school), false) and (app.is_school_admin() or app.has_role('bursar','director')))) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select coalesce(fs.amount, 0) into v_expected
  from public.fee_structure fs where fs.class_id = v_class and fs.term_id = p_term_id;
  v_expected := coalesce(v_expected, 0);

  select * into fp from public.fee_payments f where f.student_id = p_student_id and f.term_id = p_term_id;

  return query select
    case when fp.id is null then 'unpaid'
         when fp.waived then 'waived'
         when fp.is_paid_override is true then 'paid'
         when fp.is_paid_override is false then case when fp.amount_paid > 0 then 'partial' else 'unpaid' end
         when fp.amount_paid >= v_expected then 'paid'
         when fp.amount_paid > 0 then 'partial'
         else 'unpaid' end,
    v_expected, coalesce(fp.amount_paid, 0), greatest(v_expected - coalesce(fp.amount_paid, 0), 0);
end $$;
grant execute on function public.fee_status_detail(uuid, uuid) to authenticated;

create or replace function app.audit_fee_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_changed boolean; v_waived_now boolean;
begin
  if tg_op = 'INSERT' then
    v_changed := true; v_waived_now := new.waived;
  else
    v_changed := new.amount_paid is distinct from old.amount_paid
              or new.is_paid_override is distinct from old.is_paid_override
              or new.waived is distinct from old.waived;
    v_waived_now := new.waived and not old.waived;
  end if;
  if v_changed then
    perform app.write_audit(new.school_id,
      case when v_waived_now then 'fees.waived' else 'fees.updated' end,
      'fee_payments', new.id,
      jsonb_build_object('student_id', new.student_id, 'term_id', new.term_id,
                         'amount_paid', new.amount_paid, 'override', new.is_paid_override,
                         'waived', new.waived, 'reason', new.waived_reason));
  end if;
  return null;
end $$;
drop trigger if exists fee_payments_audit on public.fee_payments;
create trigger fee_payments_audit after insert or update on public.fee_payments
  for each row execute function app.audit_fee_change();

-- ---------------- 2. assessment system, atomically ----------------
create or replace function public.save_assessment_components(p_components jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_school uuid := app.current_school_id(); c record; v_count int; v_before jsonb;
begin
  if not app.is_school_admin() or v_school is null then
    raise exception 'Only a school administrator can change the assessment system.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_components) <> 'array' or jsonb_array_length(p_components) = 0 then
    raise exception 'Send the list of assessment components.' using errcode = '22023';
  end if;

  select jsonb_agg(jsonb_build_object('code', x.code, 'label', x.label, 'max', x.max_score, 'active', x.is_active) order by x.sort_order)
    into v_before from public.assessment_components x where x.school_id = v_school;

  for c in select * from jsonb_to_recordset(p_components)
           as x(code text, label text, max_score numeric, is_active boolean, sort_order int)
  loop
    if c.code not in ('ca1','ca2','ca3','exam') then
      raise exception 'Unknown assessment component "%".', c.code using errcode = '22023';
    end if;
    if btrim(coalesce(c.label, '')) = '' then
      raise exception 'Every assessment component needs a name.' using errcode = '23514';
    end if;
    if coalesce(c.is_active, true) then
      if c.max_score is null or c.max_score <= 0 or c.max_score > 100 then
        raise exception '% must have a maximum mark between 1 and 100.', c.label using errcode = '23514';
      end if;
      -- never strand a mark that is already entered above the new maximum
      execute format('select count(*) from public.student_scores where school_id = $1 and %I > $2', c.code)
        into v_count using v_school, c.max_score;
      if v_count > 0 then
        raise exception '% cannot be lowered to %: % student(s) already have a higher mark.', c.label, c.max_score, v_count
          using errcode = '23514';
      end if;
    else
      if c.code = 'exam' then
        raise exception 'The examination component must stay switched on.' using errcode = '23514';
      end if;
      execute format('select count(*) from public.student_scores where school_id = $1 and %I is not null', c.code)
        into v_count using v_school;
      if v_count > 0 then
        raise exception '% already has marks for % student(s), so it cannot be switched off.', c.label, v_count
          using errcode = '23514';
      end if;
    end if;

    insert into public.assessment_components (school_id, code, label, max_score, is_active, sort_order)
    values (v_school, c.code::app.score_period, btrim(c.label),
            case when coalesce(c.max_score, 0) > 0 then c.max_score else 1 end,
            coalesce(c.is_active, true), coalesce(c.sort_order, 0))
    on conflict (school_id, code) do update
      set label = excluded.label, max_score = excluded.max_score,
          is_active = excluded.is_active, sort_order = excluded.sort_order;
  end loop;

  -- surface the "must total 100" rule as an ordinary error, here
  set constraints assessment_components_validate immediate;

  perform app.write_audit(v_school, 'settings.assessment_system_changed', 'assessment_components', null,
    jsonb_build_object('before', v_before, 'after', p_components));
end $$;
grant execute on function public.save_assessment_components(jsonb) to authenticated;

-- ---------------- 3. grading scale, atomically ----------------
create or replace function public.save_grading_bands(p_bands jsonb)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_school uuid := app.current_school_id(); b record; v_prev_max numeric; v_first boolean := true;
        v_before jsonb; r record; v_regraded int := 0;
begin
  if not app.is_school_admin() or v_school is null then
    raise exception 'Only a school administrator can change the grading scale.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_bands) <> 'array' or jsonb_array_length(p_bands) = 0 then
    raise exception 'Add at least one grade.' using errcode = '22023';
  end if;

  -- validate as a whole, in score order
  for b in select * from jsonb_to_recordset(p_bands)
           as x(grade text, min_score numeric, max_score numeric, remark text, is_pass boolean, sort_order int)
           order by x.min_score
  loop
    if btrim(coalesce(b.grade, '')) = '' then
      raise exception 'Every grade needs a name (for example A or B2).' using errcode = '23514';
    end if;
    if b.min_score is null or b.max_score is null or b.min_score < 0 or b.max_score > 100 or b.min_score > b.max_score then
      raise exception 'Grade % has an invalid range. Use 0 to 100, with the minimum not above the maximum.', b.grade
        using errcode = '23514';
    end if;
    if v_first then
      if b.min_score <> 0 then
        raise exception 'The lowest grade must start at 0. Right now it starts at %.', b.min_score using errcode = '23514';
      end if;
      v_first := false;
    else
      if b.min_score <= v_prev_max then
        raise exception 'Grade ranges overlap around %. Check the minimum and maximum of each grade.', b.min_score
          using errcode = '23514';
      end if;
      if b.min_score - v_prev_max > 0.011 then
        raise exception 'There is a gap in the grading scale between % and %. Every score from 0 to 100 needs a grade.',
          v_prev_max, b.min_score using errcode = '23514';
      end if;
    end if;
    v_prev_max := b.max_score;
  end loop;
  if v_prev_max < 100 then
    raise exception 'The highest grade must reach 100. Right now it stops at %.', v_prev_max using errcode = '23514';
  end if;
  if (select count(distinct upper(btrim(x.grade))) from jsonb_to_recordset(p_bands) as x(grade text))
     <> jsonb_array_length(p_bands) then
    raise exception 'Two grades have the same name.' using errcode = '23514';
  end if;

  select jsonb_agg(jsonb_build_object('grade', g.grade, 'min', g.min_score, 'max', g.max_score) order by g.sort_order)
    into v_before from public.grading_bands g where g.school_id = v_school;

  delete from public.grading_bands where school_id = v_school;
  insert into public.grading_bands (school_id, grade, min_score, max_score, remark, is_pass, sort_order)
  select v_school, btrim(x.grade), x.min_score, x.max_score, nullif(btrim(x.remark), ''),
         coalesce(x.is_pass, x.min_score >= 40),
         row_number() over (order by x.max_score desc)
  from jsonb_to_recordset(p_bands) as x(grade text, min_score numeric, max_score numeric, remark text, is_pass boolean, sort_order int);

  -- Existing marks keep their numbers but must carry the NEW grade, or a
  -- report card would show a grade the current scale does not produce.
  update public.student_scores set ca1 = ca1 where school_id = v_school;
  get diagnostics v_regraded = row_count;
  for r in select distinct class_id, term_id from public.student_scores where school_id = v_school loop
    perform public.recompute_class_term(r.class_id, r.term_id);
  end loop;

  perform app.write_audit(v_school, 'settings.grading_changed', 'grading_bands', null,
    jsonb_build_object('before', v_before, 'after', p_bands, 'scores_regraded', v_regraded));
  return v_regraded;
end $$;
grant execute on function public.save_grading_bands(jsonb) to authenticated;

create or replace function public.save_grade_remarks(p_remarks jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_school uuid := app.current_school_id(); b record; v_prev_max numeric; v_first boolean := true; v_before jsonb;
begin
  if not app.is_school_admin() or v_school is null then
    raise exception 'Only a school administrator can change grade remarks.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_remarks) <> 'array' then
    raise exception 'Send the list of remarks.' using errcode = '22023';
  end if;

  for b in select * from jsonb_to_recordset(p_remarks) as x(min_score numeric, max_score numeric, remark text, sort_order int)
           order by x.min_score
  loop
    if btrim(coalesce(b.remark, '')) = '' then
      raise exception 'Every score range needs a remark.' using errcode = '23514';
    end if;
    if b.min_score is null or b.max_score is null or b.min_score < 0 or b.max_score > 100 or b.min_score > b.max_score then
      raise exception 'The range % to % is not valid. Use 0 to 100.', b.min_score, b.max_score using errcode = '23514';
    end if;
    if not v_first and b.min_score <= v_prev_max then
      raise exception 'Remark ranges overlap around %.', b.min_score using errcode = '23514';
    end if;
    v_first := false;
    v_prev_max := b.max_score;
  end loop;

  select jsonb_agg(jsonb_build_object('min', g.min_score, 'max', g.max_score, 'remark', g.remark) order by g.sort_order)
    into v_before from public.grade_remarks g where g.school_id = v_school;

  delete from public.grade_remarks where school_id = v_school;
  insert into public.grade_remarks (school_id, min_score, max_score, remark, sort_order)
  select v_school, x.min_score, x.max_score, btrim(x.remark), row_number() over (order by x.max_score desc)
  from jsonb_to_recordset(p_remarks) as x(min_score numeric, max_score numeric, remark text, sort_order int);

  perform app.write_audit(v_school, 'settings.remarks_changed', 'grade_remarks', null,
    jsonb_build_object('before', v_before, 'after', p_remarks));
end $$;
grant execute on function public.save_grade_remarks(jsonb) to authenticated;

-- ---------------- 4. sections: re-enabling must reactivate ----------------
-- Registration hides the classes of sections a school did not choose by
-- marking them inactive. Enabling one later has to bring those classes
-- back; the 0019 version only inserted missing rows and left an inactive
-- class inactive.
create or replace function public.enable_school_section(p_section text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_school uuid := app.current_school_id(); v_added int := 0; v_woken int := 0; r record;
begin
  if not app.is_school_admin() or v_school is null then
    raise exception 'Only a school administrator can change school sections.' using errcode = '42501';
  end if;

  insert into public.school_sections (school_id, section, is_enabled)
  values (v_school, p_section::app.class_category, true)
  on conflict (school_id, section) do update set is_enabled = true, enabled_at = now();

  update public.classes set is_active = true
  where school_id = v_school and category = p_section::app.class_category and not is_active;
  get diagnostics v_woken = row_count;

  for r in
    select * from (values
      ('nursery','Nursery 1',10),('nursery','Nursery 2',20),('nursery','Nursery 3',30),
      ('primary','Primary 1',40),('primary','Primary 2',50),('primary','Primary 3',60),
      ('primary','Primary 4',70),('primary','Primary 5',80),('primary','Primary 6',90),
      ('jss','JSS 1',100),('jss','JSS 2',110),('jss','JSS 3',120),
      ('ss','SS 1',130),('ss','SS 2',140),('ss','SS 3',150),
      ('islamiyya','Islamiyya 1',160),('islamiyya','Islamiyya 2',170),('islamiyya','Islamiyya 3',180)
    ) as c(category, name, sort_order)
    where c.category = p_section
  loop
    insert into public.classes (school_id, name, category, sort_order, is_graduating)
    values (v_school, r.name, r.category::app.class_category, r.sort_order, r.name in ('Primary 6','JSS 3','SS 3'))
    on conflict (school_id, name) do nothing;
    if found then v_added := v_added + 1; end if;
  end loop;

  perform app.write_audit(v_school, 'school.section_enabled', 'school_sections', null,
    jsonb_build_object('section', p_section, 'classes_added', v_added, 'classes_reactivated', v_woken));
  return v_added + v_woken;
end $$;
grant execute on function public.enable_school_section(text) to authenticated;

-- ---------------- 5. audit trail for settings ----------------
create or replace function app.audit_school_settings()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.result_fee_policy is distinct from old.result_fee_policy then
    perform app.write_audit(new.id, 'settings.fee_policy_changed', 'schools', new.id,
      jsonb_build_object('from', old.result_fee_policy, 'to', new.result_fee_policy));
  end if;
  if new.report_card_template is distinct from old.report_card_template then
    perform app.write_audit(new.id, 'settings.report_card_template_changed', 'schools', new.id,
      jsonb_build_object('from', old.report_card_template, 'to', new.report_card_template));
  end if;
  if new.teachers_may_publish is distinct from old.teachers_may_publish then
    perform app.write_audit(new.id, 'settings.teacher_publish_changed', 'schools', new.id,
      jsonb_build_object('from', old.teachers_may_publish, 'to', new.teachers_may_publish));
  end if;
  return null;
end $$;
drop trigger if exists schools_audit_settings on public.schools;
create trigger schools_audit_settings after update on public.schools
  for each row execute function app.audit_school_settings();

create or replace function app.audit_report_card_options()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.write_audit(new.school_id, 'settings.report_card_options_changed', 'school_report_card_settings', null,
    jsonb_build_object('show_photo', new.show_photo, 'show_attendance', new.show_attendance,
                       'show_positions', new.show_positions, 'title', new.head_title));
  return null;
end $$;
drop trigger if exists rc_settings_audit on public.school_report_card_settings;
create trigger rc_settings_audit after update on public.school_report_card_settings
  for each row execute function app.audit_report_card_options();

-- ---------------- 6. platform default fee policy ----------------
alter table public.platform_settings add column if not exists default_result_fee_policy text
  not null default 'block_unpaid' check (default_result_fee_policy in ('always_visible','block_unpaid'));

create or replace function public.bootstrap_new_school(p_school_id uuid, p_sections text[] default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.bootstrap_school_defaults(p_school_id);
  perform app.bootstrap_school_config(p_school_id, p_sections);

  if p_sections is not null then
    update public.classes c set is_active = false
    where c.school_id = p_school_id and c.category::text <> all (p_sections);
  end if;

  -- a new school starts on the policy AMA EDU has chosen as the default
  update public.schools s
  set result_fee_policy = coalesce((select ps.default_result_fee_policy from public.platform_settings ps where ps.id), 'block_unpaid')
  where s.id = p_school_id;
end $$;

-- ---------------- 7. bulk question import ----------------
create or replace function public.bulk_add_questions(p_assessment_id uuid, p_questions jsonb)
returns table (out_added int, out_skipped int)
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.assessments%rowtype; v_added int := 0; v_total int; v_base int;
begin
  select * into a from public.assessments where id = p_assessment_id;
  if a.id is null or not coalesce(app.owns(a.school_id), false) or not app.can_manage_assessment(a.class_id, a.subject_id) then
    raise exception 'You cannot add questions to this assessment.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_questions) <> 'array' then
    raise exception 'Send the questions as a list.' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_questions);
  if v_total = 0 then raise exception 'There are no questions to add.' using errcode = '22023'; end if;
  if v_total > 500 then raise exception 'Add at most 500 questions at a time.' using errcode = '22023'; end if;

  select coalesce(max(q.order_index), 0) into v_base from public.assessment_questions q where q.assessment_id = p_assessment_id;

  -- jsonb_array_elements ... WITH ORDINALITY (not jsonb_to_recordset, which
  -- cannot be combined with a column definition list) keeps the pasted order.
  with src as (
    select e.rn,
           btrim(e.obj->>'question_text') as qt, btrim(e.obj->>'option_a') as oa, btrim(e.obj->>'option_b') as ob,
           nullif(btrim(e.obj->>'option_c'), '') as oc, nullif(btrim(e.obj->>'option_d'), '') as od,
           upper(btrim(e.obj->>'correct_option')) as co,
           case when coalesce(e.obj->>'marks', '1') ~ '^[0-9]+(\.[0-9]+)?$'
                 and coalesce(e.obj->>'marks', '1')::numeric > 0 and coalesce(e.obj->>'marks', '1')::numeric <= 100
                then coalesce(e.obj->>'marks', '1')::numeric end as mk
    from jsonb_array_elements(p_questions) with ordinality as e(obj, rn)
  ), ins as (
    insert into public.assessment_questions
      (school_id, assessment_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks, order_index)
    select a.school_id, p_assessment_id, s.qt, s.oa, s.ob, s.oc, s.od, s.co, s.mk, v_base + s.rn::int
    from src s
    where s.qt <> '' and s.oa <> '' and s.ob <> '' and s.mk is not null and s.co in ('A','B','C','D')
      and (s.co <> 'C' or s.oc is not null) and (s.co <> 'D' or s.od is not null)
    on conflict do nothing
    returning 1)
  select count(*) into v_added from ins;

  return query select v_added, v_total - v_added;
end $$;
grant execute on function public.bulk_add_questions(uuid, jsonb) to authenticated;

-- ---------------- 8. exam integrity ----------------
-- One place that marks an attempt and feeds the report card, used by
-- submit, by expiry, and by the staff "close overdue" action.
create or replace function app.finalize_attempt(p_attempt_id uuid, p_status text, p_late boolean)
returns table (out_score numeric, out_total numeric, out_pct numeric)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_at public.assessment_attempts%rowtype; a public.assessments%rowtype;
        v_score numeric; v_pct numeric; v_col text; v_max numeric;
begin
  select * into v_at from public.assessment_attempts where id = p_attempt_id for update;
  if v_at.id is null or v_at.status <> 'in_progress' then return; end if;
  select * into a from public.assessments where id = v_at.assessment_id;

  update public.assessment_answers ans
  set is_correct = (ans.selected_option = q.correct_option),
      marks_awarded = case when ans.selected_option = q.correct_option
                           then case when a.marking_mode = 'uniform' then a.uniform_mark_per_question else q.marks end
                           else 0 end
  from public.assessment_questions q
  where ans.attempt_id = v_at.id and q.id = ans.question_id;

  select coalesce(sum(ans.marks_awarded), 0) into v_score
  from public.assessment_answers ans where ans.attempt_id = v_at.id;
  v_pct := case when v_at.total_marks > 0 then round(100.0 * v_score / v_at.total_marks, 2) end;

  update public.assessment_attempts
  set status = p_status, score = v_score, percentage = v_pct, submitted_at = now(), was_late = p_late
  where id = v_at.id;

  -- Feed the report card, but never rewrite a class whose results are
  -- already published, and never overwrite a mark a teacher entered.
  v_col := a.assessment_type::text;
  v_max := app.component_max(a.school_id, a.assessment_type);
  if a.sync_to_scores and v_pct is not null and v_max is not null
     and not app.results_published(a.class_id, a.term_id) then
    insert into public.student_scores as ss (school_id, student_id, class_id, subject_id, term_id, ca1, ca2, ca3, exam)
    values (a.school_id, v_at.student_id, a.class_id, a.subject_id, a.term_id,
            case when v_col = 'ca1'  then round(v_pct * v_max / 100, 2) end,
            case when v_col = 'ca2'  then round(v_pct * v_max / 100, 2) end,
            case when v_col = 'ca3'  then round(v_pct * v_max / 100, 2) end,
            case when v_col = 'exam' then round(v_pct * v_max / 100, 2) end)
    on conflict (student_id, subject_id, term_id) do update set
      ca1  = case when v_col = 'ca1'  and ss.ca1  is null then excluded.ca1  else ss.ca1  end,
      ca2  = case when v_col = 'ca2'  and ss.ca2  is null then excluded.ca2  else ss.ca2  end,
      ca3  = case when v_col = 'ca3'  and ss.ca3  is null then excluded.ca3  else ss.ca3  end,
      exam = case when v_col = 'exam' and ss.exam is null then excluded.exam else ss.exam end;
  end if;

  return query select v_score, v_at.total_marks, v_pct;
end $$;
revoke all on function app.finalize_attempt(uuid, text, boolean) from public, anon, authenticated;

create or replace function public.save_attempt_answer(p_attempt_id uuid, p_question_id uuid, p_selected text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_at public.assessment_attempts%rowtype;
begin
  select * into v_at from public.assessment_attempts where id = p_attempt_id;
  if v_at.id is null or v_at.student_id is distinct from app.current_student_id() then
    raise exception 'That attempt was not found.' using errcode = '42501';
  end if;
  if v_at.status <> 'in_progress' then
    raise exception 'This attempt has already been submitted.' using errcode = '42501';
  end if;
  if v_at.deadline_at is not null and now() > v_at.deadline_at + interval '30 seconds' then
    raise exception 'Time is up for this assessment.' using errcode = '42501';
  end if;
  if not (p_question_id = any (v_at.question_ids)) then
    raise exception 'That question is not part of your attempt.' using errcode = '42501';
  end if;
  if upper(coalesce(p_selected, '')) not in ('A','B','C','D') then
    raise exception 'Choose one of the options.' using errcode = '22023';
  end if;

  insert into public.assessment_answers (school_id, attempt_id, question_id, selected_option)
  values (v_at.school_id, p_attempt_id, p_question_id, upper(p_selected))
  on conflict (attempt_id, question_id) do update set selected_option = excluded.selected_option;
end $$;
grant execute on function public.save_attempt_answer(uuid, uuid, text) to authenticated;

drop function if exists public.get_attempt_questions(uuid);
create or replace function public.get_attempt_questions(p_attempt_id uuid)
returns table (question_id uuid, question_text text, option_a text, option_b text,
               option_c text, option_d text, marks numeric, q_position int, saved_option text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_at public.assessment_attempts%rowtype; a public.assessments%rowtype;
begin
  select * into v_at from public.assessment_attempts where id = p_attempt_id;
  if v_at.id is null or v_at.student_id is distinct from app.current_student_id() then
    raise exception 'That attempt was not found.' using errcode = '42501';
  end if;
  select * into a from public.assessments where id = v_at.assessment_id;

  -- correct_option is deliberately absent from this result.
  return query
    select q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
           case when a.marking_mode = 'uniform' then a.uniform_mark_per_question else q.marks end,
           ord.n::int, ans.selected_option
    from unnest(v_at.question_ids) with ordinality as ord(qid, n)
    join public.assessment_questions q on q.id = ord.qid
    left join public.assessment_answers ans on ans.attempt_id = v_at.id and ans.question_id = q.id
    order by ord.n;
end $$;
grant execute on function public.get_attempt_questions(uuid) to authenticated;

create or replace function public.submit_assessment_attempt(p_attempt_id uuid, p_answers jsonb)
returns table (out_score numeric, out_total_marks numeric, out_percentage numeric, out_was_late boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_at public.assessment_attempts%rowtype; v_late boolean; r record;
begin
  select * into v_at from public.assessment_attempts where id = p_attempt_id;
  if v_at.id is null or v_at.student_id is distinct from app.current_student_id() then
    raise exception 'That attempt was not found.' using errcode = '42501';
  end if;
  if v_at.status <> 'in_progress' then
    raise exception 'This attempt has already been submitted.' using errcode = '42501';
  end if;

  v_late := v_at.deadline_at is not null and now() > v_at.deadline_at + interval '30 seconds';

  -- After the deadline, only answers ALREADY saved on the server count.
  -- A late request cannot add new ones, so beating the browser timer
  -- gains nothing.
  if not v_late then
    insert into public.assessment_answers (school_id, attempt_id, question_id, selected_option)
    select v_at.school_id, v_at.id, q.id, upper(x.selected_option)
    from jsonb_to_recordset(coalesce(p_answers, '[]'::jsonb)) as x(question_id uuid, selected_option text)
    join public.assessment_questions q on q.id = x.question_id
    where q.id = any (v_at.question_ids)
      and upper(coalesce(x.selected_option, '')) in ('A','B','C','D')
    on conflict (attempt_id, question_id) do update set selected_option = excluded.selected_option;
  end if;

  select * into r from app.finalize_attempt(v_at.id, 'submitted', v_late);
  return query select r.out_score, r.out_total, r.out_pct, v_late;
end $$;
grant execute on function public.submit_assessment_attempt(uuid, jsonb) to authenticated;

-- A student who abandons an attempt does not get a fresh one for free:
-- once the deadline has passed it is closed and counts as used.
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

  select * into v_existing from public.assessment_attempts
  where assessment_id = p_assessment_id and student_id = v_student
  order by attempt_no desc limit 1;

  if v_existing.id is not null and v_existing.status = 'in_progress' then
    if (v_existing.deadline_at is not null and now() > v_existing.deadline_at + interval '30 seconds')
       or a.status = 'closed' then
      perform app.finalize_attempt(v_existing.id, 'expired', true);
      select * into v_existing from public.assessment_attempts
      where assessment_id = p_assessment_id and student_id = v_student
      order by attempt_no desc limit 1;
    else
      return query select v_existing.id, a.title, v_existing.question_ids, v_existing.total_marks,
                          v_existing.started_at, v_existing.deadline_at, a.duration_minutes;
      return;
    end if;
  end if;

  if not app.assessment_open(p_assessment_id) then
    raise exception 'This assessment is not open at the moment.' using errcode = '42501';
  end if;
  if v_existing.id is not null and v_existing.attempt_no >= a.max_attempts then
    raise exception 'You have already used all % attempt(s) for this assessment.', a.max_attempts using errcode = '42501';
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
    into v_marks from public.assessment_questions q where q.id = any (v_ids);

  v_deadline := case when a.duration_minutes is not null
                     then least(now() + make_interval(mins => a.duration_minutes), coalesce(a.end_at, 'infinity'::timestamptz))
                     else a.end_at end;

  insert into public.assessment_attempts (school_id, assessment_id, student_id, attempt_no, question_ids, total_marks, deadline_at)
  values (a.school_id, p_assessment_id, v_student, v_no, v_ids, v_marks, v_deadline)
  returning id into v_attempt;

  return query select v_attempt, a.title, v_ids, v_marks, now()::timestamptz, v_deadline, a.duration_minutes;
end $$;
grant execute on function public.start_assessment_attempt(uuid) to authenticated;

-- Staff: close attempts a student walked away from, before reading results.
create or replace function public.close_overdue_attempts(p_assessment_id uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.assessments%rowtype; r record; n int := 0;
begin
  select * into a from public.assessments where id = p_assessment_id;
  if a.id is null or not coalesce(app.owns(a.school_id), false) or not app.can_manage_assessment(a.class_id, a.subject_id) then
    raise exception 'You cannot manage this assessment.' using errcode = '42501';
  end if;
  for r in select at.id from public.assessment_attempts at
           where at.assessment_id = p_assessment_id and at.status = 'in_progress'
             and at.deadline_at is not null and at.deadline_at < now() - interval '30 seconds'
  loop
    perform app.finalize_attempt(r.id, 'expired', true);
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.close_overdue_attempts(uuid) to authenticated;

create or replace function public.expire_stale_attempts()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0;
begin
  for r in select at.id from public.assessment_attempts at
           where at.status = 'in_progress' and at.deadline_at is not null
             and at.deadline_at < now() - interval '5 minutes'
  loop
    perform app.finalize_attempt(r.id, 'expired', true);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.expire_stale_attempts() from public, anon, authenticated;
grant execute on function public.expire_stale_attempts() to service_role;
