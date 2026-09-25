-- 0042_staff_codes_and_default_passwords.sql
-- AMA EDU feature-gap batch, section 7: automatic staff IDs, school-wide default
-- passwords, and the bulk renumber/reset operations that use both.
--
-- WHAT WAS ALREADY THERE (verified against the live schema; the spec said "check first"):
--   * public.staff.staff_code, UNIQUE (school_id, staff_code)     -> reused, not duplicated
--   * app.fmt_admission_no(prefix, n, width)                      -> generic; reused for staff
--     codes too instead of writing a second, near-identical formatter
--   * app.next_free_admission_no() / register_student() / sync_admission_scheme() /
--     check_admission_number() / admission_scheme_preview() (0041) -> the staff-code
--     equivalents below are deliberately shaped the same way
--   * app.write_audit(), app.is_school_admin(), app.is_internal() (0018)
--
-- REAL GAPS THIS MIGRATION CLOSES:
--   1. Staff IDs are still typed by hand with no suggestion and no live availability check.
--      -> app.next_free_staff_code(), register_staff_code(), check_staff_code(),
--         staff_code_scheme_preview(), sync_staff_code_scheme() — the same five-function
--         shape as the admission-number scheme, reusing app.fmt_admission_no().
--      Unlike register_student(), register_staff_code() does NOT insert a staff row (staff
--      creation stays a plain client insert with many more fields than this function could
--      sensibly take). It reserves-and-returns a number to prefill the Add Staff form, so a
--      cancelled "Add staff" dialog can leave a gap in the sequence — exactly the same
--      accepted, recoverable trade-off register_student's own comment 4 already describes
--      for admission numbers, fixed the same way: press "Sync from existing records".
--   2. No school-wide default password for first-time logins, so provision-user could only
--      ever fail (never succeed) when a form was submitted with no password typed, and every
--      admission/hiring batch forced an admin to invent and distribute a password per person.
--      -> schools.student_default_password / staff_default_password, read only from the
--      server side (Edge Functions use the service_role client; RLS never exposes these to a
--      browser query — school_read/schools_update_own, unchanged by this migration, do not
--      list these columns in anything the client selects, and the app's own code must not
--      either). A trigger below blanks '' to NULL and enforces the same 6-character floor
--      provision-user already enforces for a typed password.
--   3. Nothing could renumber a whole cohort at once (e.g. replacing ad-hoc legacy IDs with
--      a clean scheme) or bulk-reset a cohort's passwords; both were entirely manual,
--      one person at a time. -> public.renumber_students(), public.renumber_teachers(),
--      called from the new bulk-credential-reset Edge Function together with plain
--      auth.users updates (numbering is SQL's job; touching auth.users is not something SQL
--      can do, so that half stays in the Edge Function, same division of labour
--      provision-user already uses).
--
-- SCHEMA-PERMISSION TRAP (project history): renumber_students / renumber_teachers are called
-- by bulk-credential-reset using the CALLER's own JWT (not the service_role admin client) so
-- that app.is_school_admin() / app.current_school_id() resolve to the real signed-in admin —
-- exactly how sync_admission_scheme() is already called from the browser. They still get an
-- explicit grant to service_role too, for consistency with every other function in this file
-- and in 0041, so a future change that switches the caller never silently loses the grant.

-- ---------------------------------------------------------------------------------------------
-- 1. schema: staff-code scheme + default passwords, both on schools (same table section 6 used)
-- ---------------------------------------------------------------------------------------------
alter table public.schools
  add column staff_code_prefix       text not null default 'ST',
  add column staff_code_next_number  integer not null default 1 check (staff_code_next_number > 0),
  add column staff_code_pad_width    smallint not null default 4 check (staff_code_pad_width between 1 and 8),
  add column student_default_password text,
  add column staff_default_password   text;

alter table public.schools
  add constraint schools_staff_code_prefix_format
    check (staff_code_prefix is null or staff_code_prefix ~ '^[A-Za-z0-9/_-]{1,20}$');

-- Blank -> NULL (so "clear the default" just means leaving the box empty), and the same
-- 6-character floor provision-user already applies to a password typed by hand.
create or replace function app.normalize_school_credentials()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.student_default_password := nullif(btrim(coalesce(new.student_default_password, '')), '');
  new.staff_default_password   := nullif(btrim(coalesce(new.staff_default_password, '')), '');
  if new.student_default_password is not null and length(new.student_default_password) < 6 then
    raise exception 'The student default password must be at least 6 characters.' using errcode = '22023';
  end if;
  if new.staff_default_password is not null and length(new.staff_default_password) < 6 then
    raise exception 'The staff default password must be at least 6 characters.' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger schools_normalize_credentials
  before insert or update of student_default_password, staff_default_password on public.schools
  for each row execute function app.normalize_school_credentials();

revoke all on function app.normalize_school_credentials() from public, anon;
grant execute on function app.normalize_school_credentials() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. staff-code equivalents of app.next_free_admission_no() (reuses app.fmt_admission_no())
-- ---------------------------------------------------------------------------------------------
create or replace function app.next_free_staff_code(p_school uuid, out o_n integer, out o_code text)
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
  o_n := s.staff_code_next_number;
  loop
    o_code := app.fmt_admission_no(s.staff_code_prefix, o_n, s.staff_code_pad_width);
    exit when not exists (
      select 1 from public.staff st
       where st.school_id = p_school and lower(st.staff_code) = lower(o_code));
    o_n := o_n + 1;
    i := i + 1;
    if i > 20000 then
      raise exception 'Could not find a free Staff ID. Run "Sync from existing records" in Academic settings.'
        using errcode = 'P0001';
    end if;
  end loop;
end $$;

revoke all on function app.next_free_staff_code(uuid) from public, anon, authenticated;
grant execute on function app.next_free_staff_code(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. register_staff_code(): admin only. Reserves and returns the next Staff ID (prefill only —
--    it does not insert a staff row; see note 1 at the top of this file).
-- ---------------------------------------------------------------------------------------------
create or replace function public.register_staff_code()
returns table (next_number integer, staff_code text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_school uuid := app.current_school_id();
  v_n      integer;
  v_code   text;
  v_prev   text;
begin
  if v_school is null then
    raise exception 'Sign in to a school account first.' using errcode = '42501';
  end if;
  if not app.is_school_admin() then
    raise exception 'Only an administrator can register a Staff ID.' using errcode = '42501';
  end if;

  perform 1 from public.schools sc where sc.id = v_school for update;

  select f.o_n, f.o_code into v_n, v_code from app.next_free_staff_code(v_school) f;

  v_prev := current_setting('app.internal', true);
  perform set_config('app.internal', '1', true);
  update public.schools sc set staff_code_next_number = v_n + 1 where sc.id = v_school;
  perform set_config('app.internal', coalesce(v_prev, ''), true);

  perform app.write_audit(v_school, 'staff.code_reserved', 'schools', v_school,
    jsonb_build_object('staff_code', v_code));

  return query select v_n, v_code;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. sync_staff_code_scheme(): admin only. Re-align the counter with what already exists.
--    Mirrors sync_admission_scheme() exactly, one table over.
-- ---------------------------------------------------------------------------------------------
create or replace function public.sync_staff_code_scheme(p_prefix text default null)
returns table (prefix text, pad_width smallint, highest_found integer, matched_count integer,
               next_number integer, next_staff_code text)
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
    raise exception 'Only an administrator can change the Staff ID scheme.' using errcode = '42501';
  end if;

  select * into s from public.schools x where x.id = v_school for update;

  v_prefix := coalesce(nullif(btrim(p_prefix), ''), s.staff_code_prefix, '');
  if v_prefix !~ '^[A-Za-z0-9/_-]{1,20}$' then
    raise exception 'Prefix may only contain letters, digits, / - _ (1 to 20 characters).' using errcode = '22023';
  end if;

  select max(substr(st.staff_code, length(v_prefix) + 1)::integer), count(*)::integer
    into v_high, v_cnt
    from public.staff st
   where st.school_id = v_school
     and lower(left(st.staff_code, length(v_prefix))) = lower(v_prefix)
     and substr(st.staff_code, length(v_prefix) + 1) ~ '^[0-9]{1,9}$';

  v_prev := current_setting('app.internal', true);
  perform set_config('app.internal', '1', true);
  update public.schools sc
     set staff_code_prefix = v_prefix, staff_code_next_number = coalesce(v_high, 0) + 1
   where sc.id = v_school;
  perform set_config('app.internal', coalesce(v_prev, ''), true);

  perform app.write_audit(v_school, 'settings.staff_code_scheme_synced', 'schools', v_school,
    jsonb_build_object('prefix', v_prefix, 'highest_found', v_high, 'next', coalesce(v_high, 0) + 1));

  return query
    select v_prefix, s.staff_code_pad_width, v_high, v_cnt, coalesce(v_high, 0) + 1,
           app.fmt_admission_no(v_prefix, coalesce(v_high, 0) + 1, s.staff_code_pad_width);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. check_staff_code(): live "available / already belongs to X" (admin only, same shape as
--    check_admission_number())
-- ---------------------------------------------------------------------------------------------
create or replace function public.check_staff_code(p_value text)
returns table (taken boolean, full_name text, staff_position text)
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
  if not app.is_school_admin() then
    raise exception 'Only an administrator can check Staff IDs.' using errcode = '42501';
  end if;
  if length(v) > 40 then
    raise exception 'That Staff ID is too long.' using errcode = '22023';
  end if;
  if v = '' then
    return query select false, null::text, null::text;
    return;
  end if;

  return query
    select true, st.full_name, st.position
      from public.staff st
     where st.school_id = v_school and lower(st.staff_code) = lower(v)
     limit 1;
  if not found then
    return query select false, null::text, null::text;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. staff_code_scheme_preview(): read-only numbers for the settings screen (admin only)
-- ---------------------------------------------------------------------------------------------
create or replace function public.staff_code_scheme_preview()
returns table (prefix text, pad_width smallint, next_number integer, last_issued text,
               next_staff_code text, total_active_staff bigint)
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
  if not app.is_school_admin() then
    raise exception 'Only an administrator can view the Staff ID scheme.' using errcode = '42501';
  end if;

  select * into s from public.schools x where x.id = v_school;
  select * into f from app.next_free_staff_code(v_school);

  return query
    select coalesce(s.staff_code_prefix, ''), s.staff_code_pad_width, s.staff_code_next_number,
           case when s.staff_code_next_number > 1
                then app.fmt_admission_no(s.staff_code_prefix, s.staff_code_next_number - 1, s.staff_code_pad_width) end,
           f.o_code,
           (select count(*) from public.staff st where st.school_id = v_school and st.is_active);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. renumber_students() / renumber_teachers(): admin only, whole-cohort resequencing.
--    Used by the bulk-credential-reset Edge Function, which pairs this with an auth.users
--    email+password update per returned row (SQL cannot touch auth.users itself).
--
--    Two-pass update (temp value, then final value) so a batch resequencing can never trip
--    the (school_id, admission_no) / (school_id, staff_code) unique constraint mid-statement,
--    regardless of overlap between the old and new numbering schemes.
-- ---------------------------------------------------------------------------------------------
create or replace function public.renumber_students(p_prefix text)
returns table (id uuid, user_id uuid, full_name text, old_admission_no text, new_admission_no text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_school uuid := app.current_school_id();
  s        public.schools%rowtype;
  v_prefix text;
  v_n      integer := 1;
  v_prev   text;
begin
  if v_school is null then
    raise exception 'Sign in to a school account first.' using errcode = '42501';
  end if;
  if not app.is_school_admin() then
    raise exception 'Only an administrator can renumber students.' using errcode = '42501';
  end if;

  select * into s from public.schools x where x.id = v_school for update;

  v_prefix := nullif(btrim(p_prefix), '');
  if v_prefix is null or v_prefix !~ '^[A-Za-z0-9/_-]{1,20}$' then
    raise exception 'Prefix may only contain letters, digits, / - _ (1 to 20 characters).' using errcode = '22023';
  end if;

  create temporary table tmp_student_renumber (
    id uuid, user_id uuid, full_name text, old_no text, new_no text, seq integer
  ) on commit drop;

  insert into tmp_student_renumber (id, user_id, full_name, old_no, new_no, seq)
  select st.id, st.user_id, st.full_name, st.admission_no,
         app.fmt_admission_no(v_prefix, (row_number() over (order by st.full_name, st.id))::integer, s.admission_pad_width),
         row_number() over (order by st.full_name, st.id)
    from public.students st
   where st.school_id = v_school and st.is_active;

  select count(*) into v_n from tmp_student_renumber;

  -- pass 1: move every affected row to a value that cannot collide with anything
  update public.students st set admission_no = '~renumber~' || st.id::text
    from tmp_student_renumber t where st.id = t.id;

  -- pass 2: apply the real, final numbers
  update public.students st set admission_no = t.new_no
    from tmp_student_renumber t where st.id = t.id;

  v_prev := current_setting('app.internal', true);
  perform set_config('app.internal', '1', true);
  update public.schools sc set admission_prefix = v_prefix, admission_next_no = v_n + 1 where sc.id = v_school;
  perform set_config('app.internal', coalesce(v_prev, ''), true);

  perform app.write_audit(v_school, 'students.bulk_renumbered', 'schools', v_school,
    jsonb_build_object('prefix', v_prefix, 'count', v_n));

  return query select t.id, t.user_id, t.full_name, t.old_no, t.new_no
    from tmp_student_renumber t order by t.seq;
end $$;

create or replace function public.renumber_teachers(p_prefix text)
returns table (id uuid, user_id uuid, full_name text, old_staff_code text, new_staff_code text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_school uuid := app.current_school_id();
  s        public.schools%rowtype;
  v_prefix text;
  v_n      integer := 1;
  v_prev   text;
begin
  if v_school is null then
    raise exception 'Sign in to a school account first.' using errcode = '42501';
  end if;
  if not app.is_school_admin() then
    raise exception 'Only an administrator can renumber teachers.' using errcode = '42501';
  end if;

  select * into s from public.schools x where x.id = v_school for update;

  v_prefix := nullif(btrim(p_prefix), '');
  if v_prefix is null or v_prefix !~ '^[A-Za-z0-9/_-]{1,20}$' then
    raise exception 'Prefix may only contain letters, digits, / - _ (1 to 20 characters).' using errcode = '22023';
  end if;

  create temporary table tmp_teacher_renumber (
    id uuid, user_id uuid, full_name text, old_code text, new_code text, seq integer
  ) on commit drop;

  -- ONLY staff whose roles are exactly {teacher} — never admin/headmaster/principal/bursar/
  -- director, even if 'teacher' happens to be among their other roles.
  insert into tmp_teacher_renumber (id, user_id, full_name, old_code, new_code, seq)
  select st.id, st.user_id, st.full_name, st.staff_code,
         app.fmt_admission_no(v_prefix, (row_number() over (order by st.full_name, st.id))::integer, s.staff_code_pad_width),
         row_number() over (order by st.full_name, st.id)
    from public.staff st
   where st.school_id = v_school and st.is_active
     and st.roles = array['teacher']::app.user_role[];

  select count(*) into v_n from tmp_teacher_renumber;

  update public.staff st set staff_code = '~renumber~' || st.id::text
    from tmp_teacher_renumber t where st.id = t.id;

  update public.staff st set staff_code = t.new_code
    from tmp_teacher_renumber t where st.id = t.id;

  v_prev := current_setting('app.internal', true);
  perform set_config('app.internal', '1', true);
  update public.schools sc set staff_code_prefix = v_prefix, staff_code_next_number = v_n + 1 where sc.id = v_school;
  perform set_config('app.internal', coalesce(v_prev, ''), true);

  perform app.write_audit(v_school, 'teachers.bulk_renumbered', 'schools', v_school,
    jsonb_build_object('prefix', v_prefix, 'count', v_n));

  return query select t.id, t.user_id, t.full_name, t.old_code, t.new_code
    from tmp_teacher_renumber t order by t.seq;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 8. audit manual edits of the staff-code scheme and the default passwords (booleans only for
--    the passwords — never their contents). Full replacement; every existing branch is kept
--    verbatim (this is the same function 0041 last replaced).
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
  -- NEW (0042)
  if new.staff_code_prefix is distinct from old.staff_code_prefix
     or new.staff_code_pad_width is distinct from old.staff_code_pad_width
     or (new.staff_code_next_number is distinct from old.staff_code_next_number and not app.is_internal()) then
    perform app.write_audit(new.id, 'settings.staff_code_scheme_changed', 'schools', new.id,
      jsonb_build_object(
        'from', jsonb_build_object('prefix', old.staff_code_prefix, 'next', old.staff_code_next_number, 'width', old.staff_code_pad_width),
        'to',   jsonb_build_object('prefix', new.staff_code_prefix, 'next', new.staff_code_next_number, 'width', new.staff_code_pad_width)));
  end if;
  if new.student_default_password is distinct from old.student_default_password then
    perform app.write_audit(new.id, 'settings.student_default_password_changed', 'schools', new.id,
      jsonb_build_object('was_set', old.student_default_password is not null, 'now_set', new.student_default_password is not null));
  end if;
  if new.staff_default_password is distinct from old.staff_default_password then
    perform app.write_audit(new.id, 'settings.staff_default_password_changed', 'schools', new.id,
      jsonb_build_object('was_set', old.staff_default_password is not null, 'now_set', new.staff_default_password is not null));
  end if;
  return null;
end $function$;

-- ---------------------------------------------------------------------------------------------
-- 9. grants: signed-in users only (each function re-checks app.is_school_admin() internally),
--    plus service_role for consistency with 0041's pattern (see the trap note at the top).
-- ---------------------------------------------------------------------------------------------
revoke all on function public.register_staff_code() from public, anon;
revoke all on function public.sync_staff_code_scheme(text) from public, anon;
revoke all on function public.check_staff_code(text) from public, anon;
revoke all on function public.staff_code_scheme_preview() from public, anon;
revoke all on function public.renumber_students(text) from public, anon;
revoke all on function public.renumber_teachers(text) from public, anon;

grant execute on function public.register_staff_code() to authenticated, service_role;
grant execute on function public.sync_staff_code_scheme(text) to authenticated, service_role;
grant execute on function public.check_staff_code(text) to authenticated, service_role;
grant execute on function public.staff_code_scheme_preview() to authenticated, service_role;
grant execute on function public.renumber_students(text) to authenticated, service_role;
grant execute on function public.renumber_teachers(text) to authenticated, service_role;

-- app schema USAGE for service_role was verified true (0040's note); re-confirmed here since
-- this migration adds more app.*-schema objects service_role code paths may eventually reach.
grant usage on schema app to service_role;
