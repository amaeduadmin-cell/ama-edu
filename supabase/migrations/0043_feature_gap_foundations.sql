-- AMA EDU 0043 — verified feature-gap foundations
-- Forward-only migration. Existing AMA EDU tables, RLS model and recomputation
-- logic are reused; no Pariya Central tables or auth model are copied.

-- -----------------------------------------------------------------------------
-- Staff salary payments
-- -----------------------------------------------------------------------------
create table if not exists public.staff_salary_payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  term_id uuid not null references public.terms(id) on delete cascade,
  month_no smallint not null check (month_no between 1 and 3),
  paid boolean not null default false,
  paid_on date,
  amount numeric(12,2) check (amount is null or amount >= 0),
  note text,
  recorded_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, term_id, month_no)
);
create index if not exists staff_salary_payments_school_idx
  on public.staff_salary_payments (school_id, term_id, staff_id);
create trigger staff_salary_payments_touch before update on public.staff_salary_payments
  for each row execute function app.touch_updated_at();

alter table public.staff_salary_payments enable row level security;
alter table public.staff_salary_payments force row level security;
create policy salary_read on public.staff_salary_payments for select to authenticated
  using (app.owns(school_id) and (app.is_school_admin() or app.has_role('bursar')));
create policy salary_write on public.staff_salary_payments for all to authenticated
  using (app.owns(school_id) and app.is_school_admin())
  with check (app.owns(school_id) and app.is_school_admin());

-- -----------------------------------------------------------------------------
-- Student transfer audit
-- -----------------------------------------------------------------------------
create table if not exists public.student_class_transfers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  from_class_id uuid references public.classes(id) on delete set null,
  to_class_id uuid not null references public.classes(id) on delete restrict,
  reason text,
  transferred_by uuid references public.staff(id) on delete set null,
  transferred_at timestamptz not null default now()
);
create index if not exists student_class_transfers_school_idx
  on public.student_class_transfers (school_id, transferred_at desc);
create index if not exists student_class_transfers_student_idx
  on public.student_class_transfers (student_id, transferred_at desc);
alter table public.student_class_transfers enable row level security;
alter table public.student_class_transfers force row level security;
create policy student_transfers_read on public.student_class_transfers for select to authenticated
  using (app.owns(school_id) and app.is_staff());
create policy student_transfers_insert on public.student_class_transfers for insert to authenticated
  with check (app.owns(school_id) and app.is_school_admin());

create or replace function public.transfer_students(
  p_student_ids uuid[], p_to_class_id uuid, p_reason text default null
)
returns table (student_id uuid, from_class_id uuid, to_class_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_school uuid := app.current_school_id();
  r record;
  v_from uuid;
begin
  if v_school is null or not app.is_school_admin() then
    raise exception 'Only a school administrator can transfer students.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_student_ids, 1), 0) = 0 then
    raise exception 'Select at least one student.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.classes c where c.id = p_to_class_id and c.school_id = v_school) then
    raise exception 'Destination class not found.' using errcode = '42501';
  end if;
  for r in select st.id, st.class_id from public.students st
    where st.id = any(p_student_ids) and st.school_id = v_school and st.is_active
    for update
  loop
    v_from := r.class_id;
    if v_from is distinct from p_to_class_id then
      insert into public.student_class_transfers
        (school_id, student_id, from_class_id, to_class_id, reason, transferred_by)
      values (v_school, r.id, v_from, p_to_class_id, nullif(btrim(p_reason), ''), app.current_staff_id());
      update public.students set class_id = p_to_class_id where id = r.id;
    end if;
    student_id := r.id; from_class_id := v_from; to_class_id := p_to_class_id;
    return next;
  end loop;
end $$;
grant execute on function public.transfer_students(uuid[], uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Score control management
-- -----------------------------------------------------------------------------
create or replace function public.set_score_period_window(
  p_term_id uuid, p_period app.score_period, p_is_open boolean,
  p_opens_at timestamptz default null, p_closes_at timestamptz default null
)
returns public.term_period_windows
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_school uuid := app.current_school_id(); v_row public.term_period_windows;
begin
  if v_school is null or not app.is_school_admin() then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  if not exists (select 1 from public.terms t where t.id = p_term_id and t.school_id = v_school) then raise exception 'Term not found.' using errcode = '42501'; end if;
  if p_closes_at is not null and p_opens_at is not null and p_closes_at <= p_opens_at then raise exception 'Closing time must be after opening time.' using errcode = '22023'; end if;
  insert into public.term_period_windows(school_id, term_id, period, is_open, opens_at, closes_at)
  values(v_school,p_term_id,p_period,p_is_open,p_opens_at,p_closes_at)
  on conflict(term_id,period) do update set is_open=excluded.is_open, opens_at=excluded.opens_at, closes_at=excluded.closes_at
  returning * into v_row;
  return v_row;
end $$;
grant execute on function public.set_score_period_window(uuid, app.score_period, boolean, timestamptz, timestamptz) to authenticated;

create or replace function public.submit_score_period(
  p_class_id uuid, p_subject_id uuid, p_term_id uuid, p_period app.score_period
)
returns public.subject_score_locks
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_school uuid := app.current_school_id(); v_row public.subject_score_locks;
begin
  if v_school is null or not app.can_mark(p_class_id,p_subject_id) then raise exception 'You are not assigned to this class and subject.' using errcode = '42501'; end if;
  if exists (select 1 from public.term_period_windows w where w.term_id=p_term_id and w.period=p_period and not w.is_open) and not app.is_school_admin() then
    raise exception 'This score period is closed.' using errcode = '42501';
  end if;
  insert into public.subject_score_locks(school_id,class_id,subject_id,term_id,period,locked,locked_by)
  values(v_school,p_class_id,p_subject_id,p_term_id,p_period,true,app.current_staff_id())
  on conflict(class_id,subject_id,term_id,period) do update set locked=true, locked_by=excluded.locked_by, locked_at=now()
  returning * into v_row;
  return v_row;
end $$;
grant execute on function public.submit_score_period(uuid,uuid,uuid,app.score_period) to authenticated;

create or replace function public.request_score_unlock(
  p_class_id uuid, p_subject_id uuid, p_term_id uuid, p_period app.score_period,
  p_student_ids uuid[] default null, p_reason text default null
)
returns public.score_unlock_requests
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_school uuid := app.current_school_id(); v_row public.score_unlock_requests;
begin
  if v_school is null or not app.can_mark(p_class_id,p_subject_id) or app.is_school_admin() then
    if not app.is_school_admin() and not app.can_mark(p_class_id,p_subject_id) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  end if;
  insert into public.score_unlock_requests(school_id,class_id,subject_id,term_id,period,requested_by,reason)
  values(v_school,p_class_id,p_subject_id,p_term_id,p_period,app.current_staff_id(),nullif(btrim(p_reason),''))
  returning * into v_row;
  return v_row;
end $$;
grant execute on function public.request_score_unlock(uuid,uuid,uuid,app.score_period,uuid[],text) to authenticated;

create or replace function public.resolve_score_unlock_request(p_request_id uuid, p_decision text)
returns public.score_unlock_requests
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.score_unlock_requests; v_result public.score_unlock_requests;
begin
  if not app.is_school_admin() or p_decision not in ('approved','declined') then raise exception 'Administrator approval required.' using errcode = '42501'; end if;
  select * into r from public.score_unlock_requests where id=p_request_id and app.owns(school_id) for update;
  if r.id is null then raise exception 'Unlock request not found.' using errcode = '42501'; end if;
  update public.score_unlock_requests set status=p_decision,resolved_by=app.current_staff_id(),resolved_at=now() where id=p_request_id returning * into v_result;
  if p_decision='approved' then
    update public.subject_score_locks set locked=false where class_id=r.class_id and subject_id=r.subject_id and term_id=r.term_id and period=r.period;
  end if;
  return v_result;
end $$;
grant execute on function public.resolve_score_unlock_request(uuid,text) to authenticated;

create or replace function public.force_unlock_subject_period(
  p_class_id uuid,p_subject_id uuid,p_term_id uuid,p_period app.score_period
)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not app.is_school_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
  update public.subject_score_locks set locked=false where class_id=p_class_id and subject_id=p_subject_id and term_id=p_term_id and period=p_period;
  return true;
end $$;
grant execute on function public.force_unlock_subject_period(uuid,uuid,uuid,app.score_period) to authenticated;

-- -----------------------------------------------------------------------------
-- Assessment extensions: explicit distribution mode and server-side CA import.
-- -----------------------------------------------------------------------------
alter table public.assessments add column if not exists distribution_mode text not null default 'standard';
alter table public.assessments add constraint assessments_distribution_mode_check
  check (distribution_mode in ('standard','smart_anti_leak'));

create or replace function public.import_assessment_questions(
  p_target_assessment_id uuid, p_source_assessment_id uuid
)
returns table (out_added int, out_skipped int)
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.assessments; s public.assessments; q record; n int:=0; skipped int:=0;
begin
  select * into t from public.assessments where id=p_target_assessment_id and app.owns(school_id);
  select * into s from public.assessments where id=p_source_assessment_id and app.owns(school_id);
  if t.id is null or s.id is null or not app.can_manage_assessment(t.class_id,t.subject_id) then raise exception 'You cannot import questions into this assessment.' using errcode='42501'; end if;
  if s.subject_id <> t.subject_id then raise exception 'Source and target must use the same subject.' using errcode='22023'; end if;
  for q in select * from public.assessment_questions where assessment_id=s.id order by order_index loop
    begin
      insert into public.assessment_questions(school_id,assessment_id,question_text,option_a,option_b,option_c,option_d,correct_option,marks,order_index)
      values(t.school_id,t.id,q.question_text,q.option_a,q.option_b,q.option_c,q.option_d,q.correct_option,q.marks,
             coalesce((select max(order_index)+1 from public.assessment_questions where assessment_id=t.id),0));
      n:=n+1;
    exception when unique_violation then skipped:=skipped+1;
    end;
  end loop;
  return query select n, skipped;
end $$;
grant execute on function public.import_assessment_questions(uuid,uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Audit registration
-- -----------------------------------------------------------------------------
insert into public.audit_log(school_id,user_id,action,entity,detail)
select app.current_school_id(), auth.uid(), 'migration.feature_gap_foundations', 'schema',
       jsonb_build_object('migration','0043','note','Forward-only feature foundations')
where app.current_school_id() is not null;

-- -----------------------------------------------------------------------------
-- Bulk score import: browser parses text, this function is authoritative.
-- -----------------------------------------------------------------------------
create or replace function public.bulk_import_scores(
  p_class_id uuid, p_subject_id uuid, p_term_id uuid, p_rows jsonb,
  p_dry_run boolean default true
)
returns table(admission_no text, status text, detail text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_school uuid := app.current_school_id(); x jsonb; st public.students%rowtype;
  v_period app.score_period; v_value numeric; v_existing public.student_scores%rowtype;
  v_locked boolean; v_open boolean; v_bad boolean; v_status text; v_detail text;
  v_ca1 numeric; v_ca2 numeric; v_ca3 numeric; v_exam numeric;
begin
  if v_school is null or not app.can_mark(p_class_id,p_subject_id) then
    raise exception 'You are not assigned to this class and subject.' using errcode='42501';
  end if;
  if not exists (select 1 from public.terms t where t.id=p_term_id and t.school_id=v_school) then raise exception 'Term not found.' using errcode='42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a JSON array.' using errcode='22023'; end if;
  for x in select value from jsonb_array_elements(p_rows) loop
    admission_no := btrim(coalesce(x->>'admission_no',''));
    status := 'blank'; detail := 'No score values supplied.';
    select * into st from public.students s where s.school_id=v_school and s.class_id=p_class_id and s.is_active and lower(s.admission_no)=lower(admission_no);
    if st.id is null then status := 'student_not_found'; detail := 'Admission number is not an active student in this class.'; return next; continue; end if;
    v_ca1 := case when coalesce(x->>'ca1','') ~ '^([0-9]+(\.[0-9]+)?)?$' then nullif(x->>'ca1','')::numeric end;
    v_ca2 := case when coalesce(x->>'ca2','') ~ '^([0-9]+(\.[0-9]+)?)?$' then nullif(x->>'ca2','')::numeric end;
    v_ca3 := case when coalesce(x->>'ca3','') ~ '^([0-9]+(\.[0-9]+)?)?$' then nullif(x->>'ca3','')::numeric end;
    v_exam := case when coalesce(x->>'exam','') ~ '^([0-9]+(\.[0-9]+)?)?$' then nullif(x->>'exam','')::numeric end;
    if ((coalesce(x->>'ca1','') <> '' and v_ca1 is null) or (coalesce(x->>'ca2','') <> '' and v_ca2 is null) or (coalesce(x->>'ca3','') <> '' and v_ca3 is null) or (coalesce(x->>'exam','') <> '' and v_exam is null)) then
      status:='invalid_score'; detail:='A score is not numeric.'; return next; continue;
    end if;
    v_bad := false;
    if v_ca1 is not null and (v_ca1 < 0 or v_ca1 > app.component_max(v_school,'ca1')) then v_bad:=true; end if;
    if v_ca2 is not null and (v_ca2 < 0 or v_ca2 > app.component_max(v_school,'ca2')) then v_bad:=true; end if;
    if v_ca3 is not null and (v_ca3 < 0 or v_ca3 > app.component_max(v_school,'ca3')) then v_bad:=true; end if;
    if v_exam is not null and (v_exam < 0 or v_exam > app.component_max(v_school,'exam')) then v_bad:=true; end if;
    if v_bad then status:='invalid_score'; detail:='One or more scores exceed the configured period maximum.'; return next; continue; end if;
    foreach v_period in array array['ca1'::app.score_period,'ca2'::app.score_period,'ca3'::app.score_period,'exam'::app.score_period] loop
      v_value := case v_period when 'ca1' then v_ca1 when 'ca2' then v_ca2 when 'ca3' then v_ca3 else v_exam end;
      if v_value is not null then
        v_open := true;
        select coalesce(w.is_open,true) and (w.opens_at is null or w.opens_at <= now()) and (w.closes_at is null or w.closes_at > now()) into v_open from public.term_period_windows w where w.term_id=p_term_id and w.period=v_period;
        v_open := coalesce(v_open,true);
        v_locked := false;
        select coalesce(l.locked,false) into v_locked from public.subject_score_locks l where l.class_id=p_class_id and l.subject_id=p_subject_id and l.term_id=p_term_id and l.period=v_period;
        if not v_open then status:='closed_period'; detail:=format('%s is closed.',v_period); return next; continue; end if;
        if coalesce(v_locked,false) and not app.is_school_admin() then status:='locked_field'; detail:=format('%s is locked.',v_period); return next; continue; end if;
      end if;
    end loop;
    select * into v_existing from public.student_scores ss where ss.student_id=st.id and ss.subject_id=p_subject_id and ss.term_id=p_term_id;
    status := case when v_existing.id is null then 'imported' else 'existing_score_preserved' end;
    detail := case when p_dry_run then 'Ready for commit.' else 'Imported and recomputed.' end;
    if not p_dry_run then
      insert into public.student_scores(school_id,student_id,class_id,subject_id,term_id,ca1,ca2,ca3,exam,entered_by)
      values(v_school,st.id,p_class_id,p_subject_id,p_term_id,v_ca1,v_ca2,v_ca3,v_exam,app.current_staff_id())
      on conflict(student_id,subject_id,term_id) do update set
        ca1=coalesce(excluded.ca1,public.student_scores.ca1), ca2=coalesce(excluded.ca2,public.student_scores.ca2),
        ca3=coalesce(excluded.ca3,public.student_scores.ca3), exam=coalesce(excluded.exam,public.student_scores.exam), entered_by=excluded.entered_by;
      perform public.recompute_class_term(p_class_id,p_term_id);
    end if;
    return next;
  end loop;
end $$;
grant execute on function public.bulk_import_scores(uuid,uuid,uuid,jsonb,boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Timetable auto-generation: assignment-driven, database constraint remains final authority.
-- -----------------------------------------------------------------------------
create or replace function public.auto_generate_timetable(
  p_class_id uuid, p_session_id uuid, p_days smallint[] default array[1,2,3,4,5], p_periods smallint[] default array[1,2,3,4,5,6,7,8]
)
returns table(generated_count int, unfilled_count int, unfilled_subject_ids uuid[])
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_school uuid:=app.current_school_id(); a record; d smallint; p smallint; v_staff uuid; n int:=0; missing uuid[]:='{}'; placed boolean;
begin
  if v_school is null or not app.is_school_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
  if not exists(select 1 from public.classes where id=p_class_id and school_id=v_school) then raise exception 'Class not found.' using errcode='42501'; end if;
  delete from public.timetable_slots ts using public.timetables t where ts.timetable_id=t.id and t.class_id=p_class_id and t.session_id=p_session_id and t.school_id=v_school;
  insert into public.timetables(school_id,class_id,session_id) values(v_school,p_class_id,p_session_id) on conflict(class_id,session_id) do nothing;
  for a in select c.subject_id, c.staff_id from public.class_teacher_subjects c where c.school_id=v_school and c.class_id=p_class_id order by c.subject_id loop
    placed:=false;
    foreach d in array p_days loop foreach p in array p_periods loop
      if not exists(select 1 from public.timetable_slots ts join public.timetables t on t.id=ts.timetable_id where ts.school_id=v_school and ts.staff_id=a.staff_id and ts.day_of_week=d and ts.period_index=p)
      then
        insert into public.timetable_slots(school_id,timetable_id,day_of_week,period_index,subject_id,staff_id)
        select v_school,t.id,d,p,a.subject_id,a.staff_id from public.timetables t where t.class_id=p_class_id and t.session_id=p_session_id;
        n:=n+1; placed:=true; exit;
      end if;
    end loop; exit when placed; end loop;
    if not placed then missing:=array_append(missing,a.subject_id); end if;
  end loop;
  return query select n,coalesce(array_length(missing,1),0),missing;
end $$;
grant execute on function public.auto_generate_timetable(uuid,uuid,smallint[],smallint[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Database write guard: browser-side disabled inputs are not a security boundary.
-- -----------------------------------------------------------------------------
create or replace function app.guard_score_period_write()
returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare p app.score_period; v_open boolean; v_locked boolean;
begin
  if app.is_school_admin() then return new; end if;
  if not app.can_mark(new.class_id,new.subject_id) then raise exception 'You are not assigned to this class and subject.' using errcode='42501'; end if;
  foreach p in array array['ca1'::app.score_period,'ca2'::app.score_period,'ca3'::app.score_period,'exam'::app.score_period] loop
    if (tg_op='INSERT' and (case p when 'ca1' then new.ca1 when 'ca2' then new.ca2 when 'ca3' then new.ca3 else new.exam end) is not null)
       or (tg_op='UPDATE' and (case p when 'ca1' then new.ca1 when 'ca2' then new.ca2 when 'ca3' then new.ca3 else new.exam end)
           is distinct from (case p when 'ca1' then old.ca1 when 'ca2' then old.ca2 when 'ca3' then old.ca3 else old.exam end)) then
      v_open := true;
      select coalesce(w.is_open,true) and (w.opens_at is null or w.opens_at <= now()) and (w.closes_at is null or w.closes_at > now()) into v_open
        from public.term_period_windows w where w.term_id=new.term_id and w.period=p;
      if not coalesce(v_open,true) then raise exception 'The % score period is closed.' , p using errcode='42501'; end if;
      v_locked := false;
      select coalesce(l.locked,false) into v_locked from public.subject_score_locks l
        where l.class_id=new.class_id and l.subject_id=new.subject_id and l.term_id=new.term_id and l.period=p;
      if coalesce(v_locked,false) then raise exception 'The % scores are locked.' , p using errcode='42501'; end if;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists student_scores_period_guard on public.student_scores;
create trigger student_scores_period_guard
  before insert or update on public.student_scores
  for each row execute function app.guard_score_period_write();
revoke all on function app.guard_score_period_write() from public, anon;
grant execute on function app.guard_score_period_write() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Unlock request review context: affected students are normalized, not hidden in
-- a browser-only payload. This supports auditability and administrator review.
-- -----------------------------------------------------------------------------
create table if not exists public.score_unlock_request_students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  request_id uuid not null references public.score_unlock_requests(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(request_id, student_id)
);
create index if not exists unlock_request_students_request_idx on public.score_unlock_request_students(request_id);
create index if not exists unlock_request_students_school_idx on public.score_unlock_request_students(school_id);
alter table public.score_unlock_request_students enable row level security;
alter table public.score_unlock_request_students force row level security;
create policy unlock_request_students_read on public.score_unlock_request_students for select to authenticated
  using (app.owns(school_id) and app.is_staff());
create policy unlock_request_students_insert on public.score_unlock_request_students for insert to authenticated
  with check (app.owns(school_id) and app.is_staff());

create or replace function public.request_score_unlock(
  p_class_id uuid, p_subject_id uuid, p_term_id uuid, p_period app.score_period,
  p_student_ids uuid[] default null, p_reason text default null
)
returns public.score_unlock_requests
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_school uuid := app.current_school_id(); v_row public.score_unlock_requests; v_student uuid;
begin
  if v_school is null or not app.can_mark(p_class_id,p_subject_id) or app.is_school_admin() then
    if not app.is_school_admin() and not app.can_mark(p_class_id,p_subject_id) then raise exception 'Not authorized.' using errcode = '42501'; end if;
  end if;
  if not exists (select 1 from public.subject_score_locks l where l.school_id=v_school and l.class_id=p_class_id and l.subject_id=p_subject_id and l.term_id=p_term_id and l.period=p_period and l.locked) then
    raise exception 'This subject period is not locked.' using errcode = '22023';
  end if;
  insert into public.score_unlock_requests(school_id,class_id,subject_id,term_id,period,requested_by,reason)
  values(v_school,p_class_id,p_subject_id,p_term_id,p_period,app.current_staff_id(),nullif(btrim(p_reason),''))
  returning * into v_row;
  for v_student in select distinct unnest(coalesce(p_student_ids, '{}'::uuid[])) loop
    if exists (select 1 from public.students st where st.id=v_student and st.school_id=v_school and st.class_id=p_class_id and st.is_active) then
      insert into public.score_unlock_request_students(school_id,request_id,student_id) values(v_school,v_row.id,v_student);
    else
      raise exception 'An affected student is not active in this class.' using errcode='22023';
    end if;
  end loop;
  return v_row;
end $$;
grant execute on function public.request_score_unlock(uuid,uuid,uuid,app.score_period,uuid[],text) to authenticated;

create or replace function public.resolve_score_unlock_request(p_request_id uuid, p_decision text)
returns public.score_unlock_requests
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.score_unlock_requests; v_result public.score_unlock_requests;
begin
  if not app.is_school_admin() or p_decision not in ('approved','declined') then raise exception 'Administrator approval required.' using errcode = '42501'; end if;
  select * into r from public.score_unlock_requests where id=p_request_id and app.owns(school_id) for update;
  if r.id is null then raise exception 'Unlock request not found.' using errcode = '42501'; end if;
  if r.status <> 'pending' then raise exception 'This unlock request has already been resolved.' using errcode = '22023'; end if;
  update public.score_unlock_requests set status=p_decision,resolved_by=app.current_staff_id(),resolved_at=now() where id=p_request_id returning * into v_result;
  if p_decision='approved' then
    update public.subject_score_locks set locked=false where class_id=r.class_id and subject_id=r.subject_id and term_id=r.term_id and period=r.period;
  end if;
  insert into public.audit_log(school_id,user_id,action,entity,entity_id,detail)
  values(r.school_id,auth.uid(),'score_unlock_request.'||p_decision,'score_unlock_requests',r.id,
         jsonb_build_object('class_id',r.class_id,'subject_id',r.subject_id,'term_id',r.term_id,'period',r.period,'affected_student_count',(select count(*) from public.score_unlock_request_students s where s.request_id=r.id)));
  return v_result;
end $$;
grant execute on function public.resolve_score_unlock_request(uuid,text) to authenticated;
