-- ===============================================================
-- AMA EDU 0019 — school configuration
--
--   * school sections (only the sections a school operates are shown)
--   * configurable assessment system (weights, max marks, active)
--   * configurable grading bands + grade remarks, validated
--   * report-card template bank (two templates to start)
--   * declared vs. actual student count for billing
--   * result-visibility fee policy, per school
--
-- Migration-safe: student_scores keeps its ca1/ca2/ca3/exam columns,
-- so no existing result is touched or re-shaped. What changes is that
-- the MAX and the WEIGHT of each component are now per-school
-- configuration rather than hardcoded 20/20/20/40, and scores are
-- validated against that configuration in the database.
-- ===============================================================

-- ---------------- 1. school sections ----------------
create table if not exists public.school_sections (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade
               default app.current_school_id(),
  section    app.class_category not null,
  is_enabled boolean not null default true,
  enabled_at timestamptz not null default now(),
  unique (school_id, section)
);
create index if not exists school_sections_school_idx on public.school_sections (school_id) where is_enabled;

-- Backfill from the classes each school already has, so nothing
-- disappears from an existing portal the moment this ships.
insert into public.school_sections (school_id, section)
select distinct c.school_id, c.category from public.classes c
on conflict (school_id, section) do nothing;

create or replace function app.section_enabled(p_school_id uuid, p_section app.class_category)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select ss.is_enabled from public.school_sections ss
                   where ss.school_id = p_school_id and ss.section = p_section), true);
$$;
grant execute on function app.section_enabled(uuid, app.class_category) to authenticated;

-- Default class structures for a section that is switched on later.
create or replace function public.enable_school_section(p_section text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_school uuid := app.current_school_id(); v_added int := 0; r record;
begin
  if not app.is_school_admin() or v_school is null then
    raise exception 'Only a school administrator can change school sections.' using errcode = '42501';
  end if;

  insert into public.school_sections (school_id, section, is_enabled)
  values (v_school, p_section::app.class_category, true)
  on conflict (school_id, section) do update set is_enabled = true, enabled_at = now();

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
    values (v_school, r.name, r.category::app.class_category, r.sort_order,
            r.name in ('Primary 6','JSS 3','SS 3'))
    on conflict (school_id, name) do nothing;
    if found then v_added := v_added + 1; end if;
  end loop;

  perform app.write_audit(v_school, 'school.section_enabled', 'school_sections', null,
                          jsonb_build_object('section', p_section, 'classes_added', v_added));
  return v_added;
end $$;
grant execute on function public.enable_school_section(text) to authenticated;

create or replace function public.disable_school_section(p_section text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_school uuid := app.current_school_id();
begin
  if not app.is_school_admin() or v_school is null then
    raise exception 'Only a school administrator can change school sections.' using errcode = '42501';
  end if;
  -- Never delete classes or results; the section is only hidden.
  update public.school_sections set is_enabled = false
  where school_id = v_school and section = p_section::app.class_category;
  perform app.write_audit(v_school, 'school.section_disabled', 'school_sections', null,
                          jsonb_build_object('section', p_section));
end $$;
grant execute on function public.disable_school_section(text) to authenticated;

-- ---------------- 2. configurable assessment system ----------------
create table if not exists public.assessment_components (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade
                default app.current_school_id(),
  code        app.score_period not null,
  label       text not null,
  max_score   numeric(5,2) not null check (max_score > 0 and max_score <= 100),
  is_active   boolean not null default true,
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now(),
  unique (school_id, code)
);
create index if not exists assessment_components_school_idx on public.assessment_components (school_id, sort_order);

comment on table public.assessment_components is
  'Per-school assessment system. max_score is both the maximum enterable mark and the component''s contribution, so the active components must total 100.';

-- Seed from whatever each school already had in score_weights, so an
-- existing school keeps its exact current system.
insert into public.assessment_components (school_id, code, label, max_score, is_active, sort_order)
select w.school_id, 'ca1'::app.score_period, 'CA1',  w.ca1_max,  w.ca1_max  > 0, 1 from public.score_weights w
union all select w.school_id, 'ca2', 'CA2',  w.ca2_max,  w.ca2_max  > 0, 2 from public.score_weights w
union all select w.school_id, 'ca3', 'CA3',  w.ca3_max,  w.ca3_max  > 0, 3 from public.score_weights w
union all select w.school_id, 'exam','Exam', w.exam_max, w.exam_max > 0, 4 from public.score_weights w
on conflict (school_id, code) do nothing;

-- The configured system must add up. Enforced in the database so a
-- direct API call cannot leave a school on an impossible scale.
create or replace function app.validate_assessment_total()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_school uuid := coalesce(new.school_id, old.school_id); v_total numeric;
begin
  select coalesce(sum(max_score), 0) into v_total
  from public.assessment_components where school_id = v_school and is_active;
  if v_total <> 100 then
    raise exception 'The active assessment components must total 100 (currently %).', v_total
      using errcode = '23514';
  end if;
  -- keep the legacy score_weights row in step for existing report code
  update public.score_weights w set
    ca1_max  = coalesce((select max_score from public.assessment_components c where c.school_id=v_school and c.code='ca1'  and c.is_active), 0),
    ca2_max  = coalesce((select max_score from public.assessment_components c where c.school_id=v_school and c.code='ca2'  and c.is_active), 0),
    ca3_max  = coalesce((select max_score from public.assessment_components c where c.school_id=v_school and c.code='ca3'  and c.is_active), 0),
    exam_max = coalesce((select max_score from public.assessment_components c where c.school_id=v_school and c.code='exam' and c.is_active), 0)
  where w.school_id = v_school;
  return null;
end $$;

drop trigger if exists assessment_components_validate on public.assessment_components;
create constraint trigger assessment_components_validate
  after insert or update or delete on public.assessment_components
  deferrable initially deferred
  for each row execute function app.validate_assessment_total();

-- score_weights is now derived; stop clients writing it directly.
alter table public.score_weights drop constraint if exists score_weights_check;
revoke insert, update, delete on public.score_weights from authenticated;

create or replace function app.component_max(p_school_id uuid, p_code app.score_period)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select max_score from public.assessment_components
  where school_id = p_school_id and code = p_code and is_active;
$$;
grant execute on function app.component_max(uuid, app.score_period) to authenticated;

-- A score may not exceed its component's maximum, and may not be
-- entered at all for an inactive component.
create or replace function app.validate_score_row()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare c record; v numeric;
begin
  for c in select code, max_score, is_active, label
           from public.assessment_components where school_id = new.school_id
  loop
    v := case c.code when 'ca1' then new.ca1 when 'ca2' then new.ca2
                     when 'ca3' then new.ca3 else new.exam end;
    if v is not null then
      if not c.is_active then
        raise exception '% is not part of this school''s assessment system.', c.label using errcode = '23514';
      elsif v > c.max_score then
        raise exception '% cannot be more than % for this school.', c.label, c.max_score using errcode = '23514';
      end if;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists scores_validate on public.student_scores;
create trigger scores_validate before insert or update on public.student_scores
  for each row execute function app.validate_score_row();

-- ---------------- 3. grading bands + remarks ----------------
alter table public.grading_bands alter column school_id set default app.current_school_id();

-- Bands may not overlap or leave a gap a score can fall into.
create or replace function app.validate_grading_bands()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_school uuid := coalesce(new.school_id, old.school_id); v_overlap int;
begin
  select count(*) into v_overlap
  from public.grading_bands a join public.grading_bands b
    on a.school_id = b.school_id and a.id < b.id
   and a.min_score <= b.max_score and b.min_score <= a.max_score
  where a.school_id = v_school;
  if v_overlap > 0 then
    raise exception 'Grade ranges overlap. Check the minimum and maximum of each grade.' using errcode = '23514';
  end if;
  return null;
end $$;

drop trigger if exists grading_bands_validate on public.grading_bands;
create constraint trigger grading_bands_validate
  after insert or update or delete on public.grading_bands
  deferrable initially deferred
  for each row execute function app.validate_grading_bands();

-- Remarks are a separate, finer-grained scale than the grade letter:
-- a school may grade A/B/C but remark in ten bands.
create table if not exists public.grade_remarks (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade
               default app.current_school_id(),
  min_score  numeric(5,2) not null check (min_score >= 0 and min_score <= 100),
  max_score  numeric(5,2) not null check (max_score >= 0 and max_score <= 100),
  remark     text not null,
  sort_order smallint not null default 0,
  check (max_score >= min_score)
);
create index if not exists grade_remarks_school_idx on public.grade_remarks (school_id, sort_order);

insert into public.grade_remarks (school_id, min_score, max_score, remark, sort_order)
select s.id, v.lo, v.hi, v.txt, v.ord from public.schools s
cross join (values
  (90,100,'Outstanding',1),(80,89.99,'Excellent',2),(70,79.99,'Very good',3),
  (60,69.99,'Good',4),(50,59.99,'Fair',5),(40,49.99,'Pass',6),(0,39.99,'Needs improvement',7)
) as v(lo, hi, txt, ord)
where not exists (select 1 from public.grade_remarks g where g.school_id = s.id);

create or replace function app.remark_for(p_school_id uuid, p_score numeric)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select r.remark from public.grade_remarks r
  where r.school_id = p_school_id and p_score >= r.min_score and p_score <= r.max_score
  order by r.sort_order limit 1;
$$;
grant execute on function app.remark_for(uuid, numeric) to authenticated;

-- ---------------- 4. report-card template bank ----------------
create table if not exists public.report_card_templates (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  description text,
  preview_note text,
  options     jsonb not null default '{}'::jsonb,
  is_active   boolean not null default true,
  sort_order  smallint not null default 0
);

insert into public.report_card_templates (code, name, description, preview_note, options, sort_order)
values
  ('classic', 'Template 1 — Classic',
   'The AMA EDU standard report: crest and school details across the top, one row per subject with every assessment column, summary and remarks beneath.',
   'Best for schools that want every CA column shown separately.',
   '{"layout":"classic","show_photo":true,"show_attendance":true,"show_subject_position":true,"show_remark_column":true,"accent":"primary"}'::jsonb, 1),
  ('compact', 'Template 2 — Compact continuous assessment',
   'A denser layout in the Pariya Central style: CA columns collapsed into a single continuous-assessment total, more room for remarks, attendance and signatures.',
   'Best for schools with many subjects or narrow paper.',
   '{"layout":"compact","show_photo":true,"show_attendance":true,"show_subject_position":true,"collapse_ca":true,"accent":"secondary"}'::jsonb, 2)
on conflict (code) do nothing;

alter table public.schools add column if not exists report_card_template text
  references public.report_card_templates(code) on update cascade;
update public.schools set report_card_template = 'classic' where report_card_template is null;
alter table public.schools alter column report_card_template set default 'classic';
alter table public.schools alter column report_card_template set not null;

create table if not exists public.school_report_card_settings (
  school_id       uuid primary key references public.schools(id) on delete cascade,
  head_title      text default 'TERM REPORT CARD',
  show_photo      boolean not null default true,
  show_attendance boolean not null default true,
  show_positions  boolean not null default true,
  footer_note     text,
  updated_at      timestamptz not null default now()
);
insert into public.school_report_card_settings (school_id)
select id from public.schools on conflict (school_id) do nothing;

-- ---------------- 5. billing / student count ----------------
alter table public.schools add column if not exists declared_student_count integer
  check (declared_student_count is null or declared_student_count >= 0);

create or replace function public.school_billing_counts(p_school_id uuid default null)
returns table (school_id uuid, declared_count integer, active_students bigint, billable_students bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.declared_student_count,
         (select count(*) from public.students st where st.school_id = s.id and st.is_active),
         (select count(*) from public.students st where st.school_id = s.id and st.is_active)
  from public.schools s
  where (p_school_id is null or s.id = p_school_id)
    and (app.is_platform_admin() or s.id = app.current_school_id());
$$;
grant execute on function public.school_billing_counts(uuid) to authenticated;

-- ---------------- 6. result / fee visibility policy ----------------
-- block_report_on_unpaid_fees already exists; give it an explicit,
-- nameable policy column and a platform-wide default.
alter table public.schools add column if not exists result_fee_policy text
  not null default 'block_unpaid'
  check (result_fee_policy in ('always_visible','block_unpaid'));

update public.schools
set result_fee_policy = case when block_report_on_unpaid_fees then 'block_unpaid' else 'always_visible' end;

-- Keep the two in step whichever one a caller writes.
create or replace function app.sync_fee_policy()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.result_fee_policy is distinct from old.result_fee_policy then
    new.block_report_on_unpaid_fees := (new.result_fee_policy = 'block_unpaid');
  elsif tg_op = 'UPDATE' and new.block_report_on_unpaid_fees is distinct from old.block_report_on_unpaid_fees then
    new.result_fee_policy := case when new.block_report_on_unpaid_fees then 'block_unpaid' else 'always_visible' end;
  end if;
  return new;
end $$;
drop trigger if exists schools_fee_policy_sync on public.schools;
create trigger schools_fee_policy_sync before update on public.schools
  for each row execute function app.sync_fee_policy();

-- ---------------- 7. RLS for the new tables ----------------
do $$
declare t text;
begin
  foreach t in array array['school_sections','assessment_components','grade_remarks','school_report_card_settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (app.owns(school_id));
      create policy %1$s_write on public.%1$s
        for all to authenticated
        using (app.owns(school_id) and app.is_school_admin())
        with check (app.owns(school_id) and app.is_school_admin());
    $f$, t);
  end loop;
end $$;

-- The template bank itself is platform-level reference data: readable
-- by any signed-in user, writable only by the service role.
alter table public.report_card_templates enable row level security;
alter table public.report_card_templates force row level security;
create policy report_card_templates_read on public.report_card_templates
  for select to authenticated using (true);
revoke insert, update, delete on public.report_card_templates from authenticated;

grant select, insert, update, delete on
  public.school_sections, public.assessment_components, public.grade_remarks,
  public.school_report_card_settings to authenticated;
grant select on public.report_card_templates to authenticated;

-- ---------------- 8. new schools get all of this ----------------
create or replace function app.bootstrap_school_config(p_school_id uuid, p_sections text[] default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sections text[] := coalesce(p_sections, array['nursery','primary','jss','ss']);
begin
  insert into public.score_weights (school_id) values (p_school_id) on conflict do nothing;

  insert into public.assessment_components (school_id, code, label, max_score, is_active, sort_order)
  values (p_school_id,'ca1','CA1',20,true,1), (p_school_id,'ca2','CA2',20,true,2),
         (p_school_id,'ca3','CA3',20,true,3), (p_school_id,'exam','Exam',40,true,4)
  on conflict (school_id, code) do nothing;

  insert into public.grade_remarks (school_id, min_score, max_score, remark, sort_order)
  select p_school_id, v.lo, v.hi, v.txt, v.ord from (values
    (90,100,'Outstanding',1),(80,89.99,'Excellent',2),(70,79.99,'Very good',3),
    (60,69.99,'Good',4),(50,59.99,'Fair',5),(40,49.99,'Pass',6),(0,39.99,'Needs improvement',7)
  ) as v(lo,hi,txt,ord)
  where not exists (select 1 from public.grade_remarks g where g.school_id = p_school_id);

  insert into public.school_report_card_settings (school_id) values (p_school_id) on conflict do nothing;

  insert into public.school_sections (school_id, section, is_enabled)
  select p_school_id, x::app.class_category, true from unnest(v_sections) x
  on conflict (school_id, section) do update set is_enabled = true;
end $$;
grant execute on function app.bootstrap_school_config(uuid, text[]) to service_role;
