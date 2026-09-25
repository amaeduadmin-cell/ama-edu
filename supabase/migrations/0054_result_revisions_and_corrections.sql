-- AMA EDU 0054 — immutable result revisions and correction workflow

create table if not exists public.student_score_revisions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  score_id uuid not null references public.student_scores(id) on delete cascade,
  revision_no integer not null check (revision_no > 0),
  values jsonb not null,
  changed_by uuid references public.staff(id) on delete set null,
  change_reason text,
  created_at timestamptz not null default now(),
  unique (score_id, revision_no)
);
create index if not exists score_revisions_lookup_idx on public.student_score_revisions(school_id, score_id, revision_no desc);

create table if not exists public.score_correction_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  score_id uuid not null references public.student_scores(id) on delete cascade,
  requested_by uuid not null references public.staff(id) on delete restrict,
  proposed_values jsonb not null,
  reason text not null check (length(btrim(reason)) between 5 and 1000),
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  decided_by uuid references public.staff(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index if not exists score_corrections_school_idx on public.score_correction_requests(school_id, status, created_at desc);
create index if not exists score_corrections_score_idx on public.score_correction_requests(score_id, created_at desc);

alter table public.student_score_revisions enable row level security;
alter table public.student_score_revisions force row level security;
create policy score_revisions_read on public.student_score_revisions for select to authenticated using (app.owns(school_id) and app.is_reader());
revoke insert, update, delete on public.student_score_revisions from authenticated;
grant select on public.student_score_revisions to authenticated;

alter table public.score_correction_requests enable row level security;
alter table public.score_correction_requests force row level security;
create policy score_corrections_read on public.score_correction_requests for select to authenticated using (app.owns(school_id) and app.is_reader());
create policy score_corrections_insert on public.score_correction_requests for insert to authenticated with check (app.owns(school_id) and requested_by = app.current_staff_id() and app.is_staff());
revoke update, delete on public.score_correction_requests from authenticated;
grant select, insert on public.score_correction_requests to authenticated;

create or replace function app.record_score_revision()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_next integer;
begin
  if tg_op = 'UPDATE' and old.ca1 is not distinct from new.ca1 and old.ca2 is not distinct from new.ca2 and old.ca3 is not distinct from new.ca3 and old.exam is not distinct from new.exam and old.is_offered is not distinct from new.is_offered then
    return new;
  end if;
  select coalesce(max(revision_no), 0) + 1 into v_next from public.student_score_revisions where score_id = new.id;
  insert into public.student_score_revisions(school_id, score_id, revision_no, values, changed_by, change_reason)
  values (new.school_id, new.id, v_next, jsonb_build_object('ca1', new.ca1, 'ca2', new.ca2, 'ca3', new.ca3, 'exam', new.exam, 'is_offered', new.is_offered, 'total', new.total, 'grade', new.grade), app.current_staff_id(), case when tg_op = 'INSERT' then 'initial entry' else 'score update' end);
  return new;
end $$;
drop trigger if exists score_revision_capture on public.student_scores;
create trigger score_revision_capture after insert or update on public.student_scores for each row execute function app.record_score_revision();
revoke all on function app.record_score_revision() from public, anon, authenticated;
grant execute on function app.record_score_revision() to authenticated, service_role;

create or replace function public.request_score_correction(p_score_id uuid, p_values jsonb, p_reason text)
returns public.score_correction_requests
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_score public.student_scores; v_row public.score_correction_requests; v_values jsonb;
begin
  select * into v_score from public.student_scores where id = p_score_id and app.owns(school_id);
  if v_score.id is null or not app.is_staff() then raise exception 'Score not found or correction access denied.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Explain the correction.' using errcode = '22023'; end if;
  v_values := jsonb_build_object('ca1', case when p_values ? 'ca1' then p_values->'ca1' else to_jsonb(v_score.ca1) end, 'ca2', case when p_values ? 'ca2' then p_values->'ca2' else to_jsonb(v_score.ca2) end, 'ca3', case when p_values ? 'ca3' then p_values->'ca3' else to_jsonb(v_score.ca3) end, 'exam', case when p_values ? 'exam' then p_values->'exam' else to_jsonb(v_score.exam) end, 'is_offered', case when p_values ? 'is_offered' then p_values->'is_offered' else to_jsonb(v_score.is_offered) end);
  insert into public.score_correction_requests(school_id, score_id, requested_by, proposed_values, reason)
  values (v_score.school_id, v_score.id, app.current_staff_id(), v_values, btrim(p_reason)) returning * into v_row;
  perform app.write_audit(v_score.school_id, auth.uid(), 'score.correction_requested', 'student_scores', v_score.id, jsonb_build_object('request_id', v_row.id, 'reason', btrim(p_reason)));
  return v_row;
end $$;
grant execute on function public.request_score_correction(uuid, jsonb, text) to authenticated;

create or replace function public.resolve_score_correction(p_request_id uuid, p_decision text, p_note text default null)
returns public.score_correction_requests
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_request public.score_correction_requests; v_result public.score_correction_requests; v_staff uuid := app.current_staff_id();
begin
  if not app.is_school_admin() or p_decision not in ('approved','declined') then raise exception 'Administrator approval required.' using errcode = '42501'; end if;
  select * into v_request from public.score_correction_requests where id = p_request_id and app.owns(school_id) for update;
  if v_request.id is null or v_request.status <> 'pending' then raise exception 'Correction request is not pending.' using errcode = '40901'; end if;
  if p_decision = 'approved' then
    update public.student_scores set ca1 = nullif(v_request.proposed_values->>'ca1','')::numeric, ca2 = nullif(v_request.proposed_values->>'ca2','')::numeric, ca3 = nullif(v_request.proposed_values->>'ca3','')::numeric, exam = nullif(v_request.proposed_values->>'exam','')::numeric, is_offered = coalesce((v_request.proposed_values->>'is_offered')::boolean, is_offered), entered_by = v_staff where id = v_request.score_id;
  end if;
  update public.score_correction_requests set status=p_decision, decided_by=v_staff, decided_at=now(), decision_note=nullif(btrim(coalesce(p_note,'')), '') where id=p_request_id returning * into v_result;
  perform app.write_audit(v_request.school_id, auth.uid(), 'score.correction_' || p_decision, 'score_correction_requests', p_request_id, jsonb_build_object('score_id', v_request.score_id, 'note', p_note));
  return v_result;
end $$;
grant execute on function public.resolve_score_correction(uuid, text, text) to authenticated;
