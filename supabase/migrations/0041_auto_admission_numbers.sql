-- 0041_auto_admission_numbers.sql
-- AMA EDU feature-gap batch, section 6: automatic admission numbers, assigned by the DATABASE.
--
-- WHAT WAS ALREADY THERE (verified against the live schema; the spec said "check first"):
--   * schools.admission_prefix   (text, default 'ADM')
--   * schools.admission_next_no  (integer, default 1, CHECK > 0)
--   * students UNIQUE (school_id, admission_no) and students_write RLS (admin OR registrar_primary/secondary)
--   Nothing read those two columns yet, so there was no auto numbering. We REUSE them rather than adding
--   a second student_admission_prefix / student_admission_next_number pair. The default prefix stays 'ADM'
--   (the spec's 'SU' is Pariya's own school prefix; a multi-tenant default must not be one school's).
--
-- REAL GAPS THIS MIGRATION CLOSES:
--   1. No atomic assignment: two registrars submitting at once would both be handed the same "next" number by
--      the browser. -> public.register_student() locks the school row, picks the number, inserts, increments.
--   2. lpad() TRUNCATES when the number outgrows the width (lpad('12345',4,'0') = '1234'), which would silently
--      mint duplicate or wrong numbers past 9999. -> app.fmt_admission_no() never truncates.
--   3. Real data does not share one shape: pariyacentralprimary uses PCP2026 + 4 digits (PCP20260406),
--      pariyaacademy uses PAS/2026/ + 3 digits (PAS/2026/001). -> per-school admission_pad_width (default 4).
--   4. Numbers typed by hand or imported leave the counter behind. -> register_student skips taken numbers
--      (case-insensitively: login identifiers that differ only by case are a support nightmare), and
--      sync_admission_scheme() re-aligns the counter to highest-existing + 1.
--   5. The Add Student form needs a live "available / belongs to X" check and a "next number will be" preview
--      that uses the SAME formatting as the real assignment. -> check_admission_number(), admission_scheme_preview().
--   6. Prefix was unvalidated free text. -> CHECK on shape.
--
-- SCHEMA-PERMISSION TRAP (project history): app.* helpers below are executable by service_role (Edge Functions,
-- future bulk import/renumber) and deliberately NOT by authenticated (they take a school id argument and would
-- otherwise be a cross-tenant read). Public RPCs derive the school from the caller, never from an argument.

-- ---------------------------------------------------------------------------------------------
-- 1. per-school pad width + prefix shape
-- ---------------------------------------------------------------------------------------------
alter table public.schools
  add column admission_pad_width smallint not null default 4
    check (admission_pad_width between 1 and 8);

alter table public.schools
  add constraint schools_admission_prefix_format
    check (admission_prefix is null or admission_prefix ~ '^[A-Za-z0-9/_-]{1,20}$');

-- ---------------------------------------------------------------------------------------------
-- 2. formatting + next-free helpers (single source of truth for "what does number N look like")
-- ---------------------------------------------------------------------------------------------
create or replace function app.fmt_admission_no(p_prefix text, p_n integer, p_width integer)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(p_prefix, '')
      || case when length(p_n::text) >= p_width then p_n::text
              else lpad(p_n::text, p_width, '0') end;
$$;

-- First number at or after the school's counter that no student holds yet (case-insensitive).
-- Caller is responsible for holding the school-row lock when it is going to USE the result.
create or replace function app.next_free_admission_no(p_school uuid, out o_n integer, out o_no text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.schools%rowtype;
  i integer := 0;
begin
  select * into s from public.schools x where x.id = p_school;
  if not found then
    raise exception 'School not found.' using errcode = 'P0002';
  end if;
  o_n := s.admission_next_no;
  loop
    o_no := app.fmt_admission_no(s.admission_prefix, o_n, s.admission_pad_width);
    exit when not exists (
      select 1 from public.students st
       where st.school_id = p_school and lower(st.admission_no) = lower(o_no));
    o_n := o_n + 1;
    i := i + 1;
    if i > 20000 then
      raise exception 'Could not find a free admission number. Run "Sync from existing records" in Academic settings.'
        using errcode = 'P0001';
    end if;
  end loop;
end $$;

revoke all on function app.fmt_admission_no(text, integer, integer) from public, anon, authenticated;
revoke all on function app.next_free_admission_no(uuid) from public, anon, authenticated;
grant execute on function app.fmt_admission_no(text, integer, integer) to service_role;
grant execute on function app.next_free_admission_no(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. register_student: admin or registrar, atomic, returns the number the DATABASE assigned
-- ---------------------------------------------------------------------------------------------
create or replace function public.register_student(
  p_full_name text,
  p_class_id  uuid,
  p_gender    text,
  p_dob       date default null)
returns table (id uuid, admission_no text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_school uuid := app.current_school_id();
  v_name   text := btrim(coalesce(p_full_name, ''));
  v_gender text := nullif(lower(btrim(coalesce(p_gender, ''))), '');
  v_n      integer;
  v_no     text;
  v_id     uuid;
  v_prev   text;
begin
  if v_school is null then
    raise exception 'Sign in to a school account first.' using errcode = '42501';
  end if;
  if not (app.is_school_admin() or app.has_role('registrar_primary', 'registrar_secondary')) then
    raise exception 'Only an administrator or registrar can register students.' using errcode = '42501';
  end if;
  if length(v_name) < 2 or length(v_name) > 160 then
    raise exception 'Enter the student''s full name (2 to 160 characters).' using errcode = '22023';
  end if;
  if v_gender is not null and v_gender not in ('male', 'female') then
    raise exception 'Gender must be Male or Female.' using errcode = '22023';
  end if;
  if p_dob is not null and p_dob > current_date then
    raise exception 'Date of birth cannot be in the future.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.classes c
                  where c.id = p_class_id and c.school_id = v_school and c.is_active) then
    raise exception 'That class was not found in your school.' using errcode = '22023';
  end if;

  -- serialise every registration / sync for this school
  perform 1 from public.schools sc where sc.id = v_school for update;

  select f.o_n, f.o_no into v_n, v_no from app.next_free_admission_no(v_school) f;

  insert into public.students as st (school_id, admission_no, full_name, class_id, gender, date_of_birth)
  values (v_school, v_no, v_name, p_class_id, v_gender, p_dob)
  returning st.id into v_id;

  -- bump the counter without tripping the per-registration settings audit
  v_prev := current_setting('app.internal', true);
  perform set_config('app.internal', '1', true);
  update public.schools sc set admission_next_no = v_n + 1 where sc.id = v_school;
  perform set_config('app.internal', coalesce(v_prev, ''), true);

  perform app.write_audit(v_school, 'student.registered', 'students', v_id,
    jsonb_build_object('admission_no', v_no));

  return query select v_id, v_no;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. sync_admission_scheme: admin only. Re-align the counter with what already exists.
-- ---------------------------------------------------------------------------------------------
create or replace function public.sync_admission_scheme(p_prefix text default null)
returns table (prefix text, pad_width smallint, highest_found integer, matched_count integer,
               next_number integer, next_admission_no text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_school uuid := app.current_school_id();
  s        public.schools%rowtype;
  v_prefix text;
  v_high   integer;
  v_cnt    integer;
  v_prev   text;
begin
  if v_school is null then
    raise exception 'Sign in to a school account first.' using errcode = '42501';
  end if;
  if not app.is_school_admin() then
    raise exception 'Only an administrator can change the admission number scheme.' using errcode = '42501';
  end if;

  select * into s from public.schools x where x.id = v_school for update;

  v_prefix := coalesce(nullif(btrim(p_prefix), ''), s.admission_prefix, '');
  if v_prefix !~ '^[A-Za-z0-9/_-]{1,20}$' then
    raise exception 'Prefix may only contain letters, digits, / - _ (1 to 20 characters).' using errcode = '22023';
  end if;

  -- highest purely-numeric suffix among ALL students (active or not: their numbers stay taken)
  select max(substr(st.admission_no, length(v_prefix) + 1)::integer), count(*)::integer
    into v_high, v_cnt
    from public.students st
   where st.school_id = v_school
     and lower(left(st.admission_no, length(v_prefix))) = lower(v_prefix)
     and substr(st.admission_no, length(v_prefix) + 1) ~ '^[0-9]{1,9}$';

  v_prev := current_setting('app.internal', true);
  perform set_config('app.internal', '1', true);
  update public.schools sc
     set admission_prefix = v_prefix, admission_next_no = coalesce(v_high, 0) + 1
   where sc.id = v_school;
  perform set_config('app.internal', coalesce(v_prev, ''), true);

  perform app.write_audit(v_school, 'settings.admission_scheme_synced', 'schools', v_school,
    jsonb_build_object('prefix', v_prefix, 'highest_found', v_high, 'next', coalesce(v_high, 0) + 1));

  return query
    select v_prefix, s.admission_pad_width, v_high, v_cnt, coalesce(v_high, 0) + 1,
           app.fmt_admission_no(v_prefix, coalesce(v_high, 0) + 1, s.admission_pad_width);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. check_admission_number: live "available / already belongs to X" (admin + registrars only)
-- ---------------------------------------------------------------------------------------------
create or replace function public.check_admission_number(p_value text)
returns table (taken boolean, full_name text, class_name text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_school uuid := app.current_school_id();
  v        text := btrim(coalesce(p_value, ''));
begin
  if v_school is null then
    raise exception 'Sign in to a school account first.' using errcode = '42501';
  end if;
  if not (app.is_school_admin() or app.has_role('registrar_primary', 'registrar_secondary')) then
    raise exception 'Only an administrator or registrar can check admission numbers.' using errcode = '42501';
  end if;
  if length(v) > 40 then
    raise exception 'That admission number is too long.' using errcode = '22023';
  end if;
  if v = '' then
    return query select false, null::text, null::text;
    return;
  end if;

  return query
    select true, st.full_name, c.name
      from public.students st
      left join public.classes c on c.id = st.class_id
     where st.school_id = v_school and lower(st.admission_no) = lower(v)
     limit 1;
  if not found then
    return query select false, null::text, null::text;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. admission_scheme_preview: read-only numbers for the settings screen and Add Student form
-- ---------------------------------------------------------------------------------------------
create or replace function public.admission_scheme_preview()
returns table (prefix text, pad_width smallint, next_number integer, last_issued text,
               next_admission_no text, total_active_students bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_school uuid := app.current_school_id();
  s        public.schools%rowtype;
  f        record;
begin
  if v_school is null then
    raise exception 'Sign in to a school account first.' using errcode = '42501';
  end if;
  if not (app.is_school_admin() or app.has_role('registrar_primary', 'registrar_secondary')) then
    raise exception 'Only an administrator or registrar can view the admission number scheme.' using errcode = '42501';
  end if;

  select * into s from public.schools x where x.id = v_school;
  select * into f from app.next_free_admission_no(v_school);

  return query
    select coalesce(s.admission_prefix, ''), s.admission_pad_width, s.admission_next_no,
           case when s.admission_next_no > 1
                then app.fmt_admission_no(s.admission_prefix, s.admission_next_no - 1, s.admission_pad_width) end,
           f.o_no,
           (select count(*) from public.students st where st.school_id = v_school and st.is_active);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. audit manual edits of the scheme (but not the +1 the system does on every registration)
--    Full replacement of the existing function; its three original branches are unchanged.
-- ---------------------------------------------------------------------------------------------
create or replace function app.audit_school_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
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
  if new.admission_prefix is distinct from old.admission_prefix
     or new.admission_pad_width is distinct from old.admission_pad_width
     or (new.admission_next_no is distinct from old.admission_next_no and not app.is_internal()) then
    perform app.write_audit(new.id, 'settings.admission_scheme_changed', 'schools', new.id,
      jsonb_build_object(
        'from', jsonb_build_object('prefix', old.admission_prefix, 'next', old.admission_next_no, 'width', old.admission_pad_width),
        'to',   jsonb_build_object('prefix', new.admission_prefix, 'next', new.admission_next_no, 'width', new.admission_pad_width)));
  end if;
  return null;
end $function$;

-- ---------------------------------------------------------------------------------------------
-- 8. grants: signed-in users only (each function re-checks role + school internally)
-- ---------------------------------------------------------------------------------------------
revoke all on function public.register_student(text, uuid, text, date) from public, anon;
revoke all on function public.sync_admission_scheme(text) from public, anon;
revoke all on function public.check_admission_number(text) from public, anon;
revoke all on function public.admission_scheme_preview() from public, anon;
grant execute on function public.register_student(text, uuid, text, date) to authenticated, service_role;
grant execute on function public.sync_admission_scheme(text) to authenticated, service_role;
grant execute on function public.check_admission_number(text) to authenticated, service_role;
grant execute on function public.admission_scheme_preview() to authenticated, service_role;
