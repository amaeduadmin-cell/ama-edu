-- Rolled-back tests for 0040_report_card_signatories + 0041_auto_admission_numbers.
-- Run AFTER both migrations are applied. Everything happens inside a transaction that is rolled back.
-- The UUIDs below are the seeded users/staff of the amaeduDB1 project (PCP = pariyacentralprimary,
-- PA = pariyaacademy, HRUR = hrur). Replace them if you run this against another database.
--   PCP admin user 9213eb91..  PCP teacher user 971f2d15.. (staff 2732a960..)  PCP bursar user fae343a0.. (staff b38b5e96..)
--   PCP student user 3ba39ebd..  HRUR admin user 84440ade..  PA admin user cfb5fff0..
begin;

create temp table t_res(seq serial primary key, name text, ok boolean, detail text);
grant all on t_res to public;
grant usage, select on sequence t_res_seq_seq to public;

create function pg_temp.q(p_name text, p_uid uuid, p_sql text, p_expect text default 'ok',
                          p_like text default null, p_role text default 'authenticated')
returns void language plpgsql as $$
declare v_out text; v_ok boolean; v_detail text;
begin
  reset role;
  begin
    perform set_config('request.jwt.claims',
      case when p_uid is null then '{}' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    execute format('set local role %I', p_role);
    execute p_sql into v_out;
    v_detail := coalesce(v_out, '(null)');
    v_ok := (p_expect = 'ok') and (p_like is null or v_detail like p_like);
  exception when others then
    v_detail := sqlstate || ': ' || sqlerrm;
    v_ok := (p_expect = 'err') and (p_like is null or v_detail like p_like);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  insert into t_res(name, ok, detail) values (p_name, v_ok, v_detail);
end $$;

-- ===== 0040 =====
select pg_temp.q('5.01 admin: javascript: url rejected', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$with u as (update public.staff set signature_url='javascript:alert(1)' where id='b38b5e96-1014-4acc-a05e-03cba8ca1721' returning 1) select count(*)::text from u$q$, 'err', '23514%');
select pg_temp.q('5.02 admin: http:// url rejected', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$with u as (update public.staff set signature_url='http://x.com/a.png' where id='b38b5e96-1014-4acc-a05e-03cba8ca1721' returning 1) select count(*)::text from u$q$, 'err', '23514%');
select pg_temp.q('5.03 admin: https url accepted (bursar)', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$with u as (update public.staff set signature_url='https://i.postimg.cc/bursar.png' where id='b38b5e96-1014-4acc-a05e-03cba8ca1721' returning 1) select count(*)::text from u$q$, 'ok', '1');
select pg_temp.q('5.04 teacher: blank sig stored as NULL', '971f2d15-5b0e-42e1-81fa-a527b761e501',
  $q$with u as (update public.staff set signature_url='   ' where id='2732a960-ad68-4bd8-b82c-f8b6be9ddcf8' returning signature_url) select coalesce(signature_url,'NULL') from u$q$, 'ok', 'NULL');
select pg_temp.q('5.05 teacher: sets OWN https signature', '971f2d15-5b0e-42e1-81fa-a527b761e501',
  $q$with u as (update public.staff set signature_url='https://i.postimg.cc/teacher.png' where id='2732a960-ad68-4bd8-b82c-f8b6be9ddcf8' returning 1) select count(*)::text from u$q$, 'ok', '1');
select pg_temp.q('5.06 teacher: cannot edit ANOTHER staff signature (0 rows)', '971f2d15-5b0e-42e1-81fa-a527b761e501',
  $q$with u as (update public.staff set signature_url='https://evil.example/x.png' where id='b38b5e96-1014-4acc-a05e-03cba8ca1721' returning 1) select count(*)::text from u$q$, 'ok', '0');
select pg_temp.q('5.07 teacher: cannot self-award Admin Officer', '971f2d15-5b0e-42e1-81fa-a527b761e501',
  $q$with u as (update public.staff set position='Admin Officer' where id='2732a960-ad68-4bd8-b82c-f8b6be9ddcf8' returning 1) select count(*)::text from u$q$, 'err', '42501%Admin Officer%');
select pg_temp.q('5.08 teacher: obfuscated "admin  officer." also blocked', '971f2d15-5b0e-42e1-81fa-a527b761e501',
  $q$with u as (update public.staff set position='admin  officer.' where id='2732a960-ad68-4bd8-b82c-f8b6be9ddcf8' returning 1) select count(*)::text from u$q$, 'err', '42501%');
select pg_temp.q('5.09 teacher: ordinary position edit still allowed', '971f2d15-5b0e-42e1-81fa-a527b761e501',
  $q$with u as (update public.staff set position='Maths Teacher (JSS)' where id='2732a960-ad68-4bd8-b82c-f8b6be9ddcf8' returning 1) select count(*)::text from u$q$, 'ok', '1');
select pg_temp.q('5.10 admin: CAN make bursar the Admin Officer', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$with u as (update public.staff set position='Admin Officer' where id='b38b5e96-1014-4acc-a05e-03cba8ca1721' returning 1) select count(*)::text from u$q$, 'ok', '1');
select pg_temp.q('5.11 student: resolver returns Admin Officer = bursar + bursar sig (teacher sig NOT used)', '3ba39ebd-93a9-44de-a908-3cfa04398e18',
  $q$select string_agg(role_key||':'||source||':'||coalesce(full_name,'-')||':'||coalesce(signature_url,'-'), ' | ' order by role_key) from public.report_card_signatories()$q$, 'ok', '%admin_officer:staff:%bursar.png%');
select pg_temp.q('5.12 student: still cannot read staff table directly', '3ba39ebd-93a9-44de-a908-3cfa04398e18',
  $q$select count(*)::text from public.staff$q$, 'ok', '0');
select pg_temp.q('5.13 cross-tenant: hrur admin resolver contains no PCP data', '84440ade-06d7-419f-aefb-b681a6594af1',
  $q$select (not exists (select 1 from public.report_card_signatories() where signature_url like '%bursar%' or full_name is not null and role_key='admin_officer'))::text$q$, 'ok', 'true');
select pg_temp.q('5.14 cross-tenant: hrur admin cannot touch PCP staff signature (0 rows)', '84440ade-06d7-419f-aefb-b681a6594af1',
  $q$with u as (update public.staff set signature_url='https://evil.example/y.png' where id='b38b5e96-1014-4acc-a05e-03cba8ca1721' returning 1) select count(*)::text from u$q$, 'ok', '0');
select pg_temp.q('5.15 anon cannot call resolver', null,
  $q$select count(*)::text from public.report_card_signatories()$q$, 'err', '42501%', 'anon');
select pg_temp.q('5.16 admin: sets headmaster fallback', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$with u as (update public.school_report_card_settings set headmaster_fallback_name='Mr Head', headmaster_fallback_sig_url='https://i.postimg.cc/head.png' where school_id=(select id from public.schools where slug='pariyacentralprimary') returning 1) select count(*)::text from u$q$, 'ok', '1');
select pg_temp.q('5.17 admin: bad fallback url rejected', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$with u as (update public.school_report_card_settings set principal_fallback_sig_url='ftp://x/y.png' where school_id=(select id from public.schools where slug='pariyacentralprimary') returning 1) select count(*)::text from u$q$, 'err', '23514%');
select pg_temp.q('5.18 teacher: cannot edit fallback settings (0 rows)', '971f2d15-5b0e-42e1-81fa-a527b761e501',
  $q$with u as (update public.school_report_card_settings set headmaster_fallback_name='Hacked' where school_id=(select id from public.schools where slug='pariyacentralprimary') returning 1) select count(*)::text from u$q$, 'ok', '0');
select pg_temp.q('5.19 student: headmaster resolves to fallback', '3ba39ebd-93a9-44de-a908-3cfa04398e18',
  $q$select source||':'||full_name||':'||signature_url from public.report_card_signatories() where role_key='headmaster'$q$, 'ok', 'fallback:Mr Head:%head.png');
update public.staff set roles = roles || 'headmaster'::app.user_role where id='2732a960-ad68-4bd8-b82c-f8b6be9ddcf8';
select pg_temp.q('5.20 holder beats fallback: headmaster = teacher + teacher sig', '3ba39ebd-93a9-44de-a908-3cfa04398e18',
  $q$select source||':'||signature_url from public.report_card_signatories() where role_key='headmaster'$q$, 'ok', 'staff:%teacher.png');
update public.staff set is_active=false where id='2732a960-ad68-4bd8-b82c-f8b6be9ddcf8';
select pg_temp.q('5.21 deactivated holder ignored -> back to fallback', '3ba39ebd-93a9-44de-a908-3cfa04398e18',
  $q$select source||':'||full_name from public.report_card_signatories() where role_key='headmaster'$q$, 'ok', 'fallback:Mr Head');
update public.staff set is_active=true where id='2732a960-ad68-4bd8-b82c-f8b6be9ddcf8';
update public.staff set roles = array_remove(roles, 'headmaster'::app.user_role) where id='2732a960-ad68-4bd8-b82c-f8b6be9ddcf8';
-- two REAL signature changes (5.03, 5.05); the blank->NULL no-op (5.04) must not audit
insert into t_res(name, ok, detail)
select '5.22 audit rows written (only real changes)',
  count(*) filter (where action='staff.signature_changed')=2 and count(*) filter (where action='settings.report_signatories_changed')=1,
  count(*) filter (where action='staff.signature_changed')||' sig, '||count(*) filter (where action='settings.report_signatories_changed')||' settings'
from public.audit_log where action in ('staff.signature_changed','settings.report_signatories_changed');
insert into t_res(name, ok, detail)
select '5.23 service_role grants (schema USAGE + EXECUTE on every new fn)',
  has_schema_privilege('service_role','app','USAGE') and has_schema_privilege('service_role','public','USAGE')
  and has_function_privilege('service_role','public.report_card_signatories()','EXECUTE')
  and has_function_privilege('service_role','app.is_signatory_position(text)','EXECUTE')
  and has_function_privilege('service_role','app.audit_staff_signature()','EXECUTE')
  and not has_function_privilege('anon','public.report_card_signatories()','EXECUTE'), 'checked';

-- ===== 0041 =====
insert into t_res(name, ok, detail) select '6.01 fmt never truncates / pads correctly',
  app.fmt_admission_no('PCP',12345,4)='PCP12345' and app.fmt_admission_no('A',7,4)='A0007'
  and app.fmt_admission_no('PAS/2026/',2,3)='PAS/2026/002' and app.fmt_admission_no(null,5,2)='05',
  app.fmt_admission_no('PCP',12345,4)||','||app.fmt_admission_no('A',7,4)||','||app.fmt_admission_no('PAS/2026/',2,3);
select pg_temp.q('6.02 admin: invalid prefix rejected by CHECK', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$with u as (update public.schools set admission_prefix='bad prefix!' where slug='pariyacentralprimary' returning 1) select count(*)::text from u$q$, 'err', '23514%');
select pg_temp.q('6.03 admin: pad width 9 rejected', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$with u as (update public.schools set admission_pad_width=9 where slug='pariyacentralprimary' returning 1) select count(*)::text from u$q$, 'err', '23514%');
select pg_temp.q('6.04 admin: next number 0 rejected', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$with u as (update public.schools set admission_next_no=0 where slug='pariyacentralprimary' returning 1) select count(*)::text from u$q$, 'err', '23514%');
select pg_temp.q('6.05 admin: sets PCP scheme (prefix PCP2026, next 1)', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$with u as (update public.schools set admission_prefix='PCP2026', admission_next_no=1 where slug='pariyacentralprimary' returning 1) select count(*)::text from u$q$, 'ok', '1');
select pg_temp.q('6.06 admin: sync finds highest 446 of 41 -> next PCP20260447', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$select prefix||'|'||coalesce(highest_found,0)||'|'||matched_count||'|'||next_number||'|'||next_admission_no from public.sync_admission_scheme()$q$, 'ok', '%|446|41|447|PCP20260447');
select pg_temp.q('6.07 admin: register #1', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$select id::text||'#'||admission_no from public.register_student('  Test Pupil  ', (select id from public.classes where school_id=(select id from public.schools where slug='pariyacentralprimary') and is_active order by sort_order limit 1), 'Male', date '2018-05-01')$q$, 'ok', '%#PCP20260447');
select pg_temp.q('6.08 admin: register #2', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$select admission_no from public.register_student('Test Pupil Two', (select id from public.classes where school_id=(select id from public.schools where slug='pariyacentralprimary') and is_active order by sort_order limit 1), 'female')$q$, 'ok', 'PCP20260448');
select pg_temp.q('6.09 stored row normalised (trim, gender lowercased)', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$select admission_no||'|'||gender||'|'||full_name from public.students where admission_no='PCP20260447'$q$, 'ok', 'PCP20260447|male|Test Pupil');
select pg_temp.q('6.10 counter advanced to 449', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$select admission_next_no::text from public.schools where slug='pariyacentralprimary'$q$, 'ok', '449');
insert into t_res(name, ok, detail)
select '6.11 audit: 1 manual scheme change, 2 registrations, 1 sync (no per-registration flood)',
  count(*) filter (where action='settings.admission_scheme_changed')=1 and count(*) filter (where action='student.registered')=2 and count(*) filter (where action='settings.admission_scheme_synced')=1,
  count(*) filter (where action='settings.admission_scheme_changed')||' changed, '||count(*) filter (where action='student.registered')||' registered, '||count(*) filter (where action='settings.admission_scheme_synced')||' synced'
from public.audit_log where action in ('settings.admission_scheme_changed','student.registered','settings.admission_scheme_synced');
update public.schools set admission_next_no=406 where slug='pariyacentralprimary';
select pg_temp.q('6.12 stale counter (406): register skips taken numbers -> 449', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$select admission_no from public.register_student('Skip Test', (select id from public.classes where school_id=(select id from public.schools where slug='pariyacentralprimary') and is_active order by sort_order limit 1), 'male')$q$, 'ok', 'PCP20260449');
insert into public.students(school_id, admission_no, full_name) select id, 'pcp20260450', 'Lower Case Existing' from public.schools where slug='pariyacentralprimary';
select pg_temp.q('6.13 case-insensitive collision (pcp20260450 exists) -> 451', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$select admission_no from public.register_student('Case Test', (select id from public.classes where school_id=(select id from public.schools where slug='pariyacentralprimary') and is_active order by sort_order limit 1), 'male')$q$, 'ok', 'PCP20260451');
select pg_temp.q('6.14 invalid gender rejected', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$select admission_no from public.register_student('Gender Test', (select id from public.classes where school_id=(select id from public.schools where slug='pariyacentralprimary') and is_active limit 1), 'x')$q$, 'err', '22023%Male or Female%');
select pg_temp.q('6.15 blank gender allowed (NULL)', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$select admission_no from public.register_student('Blank Gender', (select id from public.classes where school_id=(select id from public.schools where slug='pariyacentralprimary') and is_active limit 1), '')$q$, 'ok', 'PCP2026%');
select pg_temp.q('6.16 future DOB rejected', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$select admission_no from public.register_student('Future Kid', (select id from public.classes where school_id=(select id from public.schools where slug='pariyacentralprimary') and is_active limit 1), 'male', current_date + 5)$q$, 'err', '22023%');
select pg_temp.q('6.17 one-letter name rejected', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$select admission_no from public.register_student('A', (select id from public.classes where school_id=(select id from public.schools where slug='pariyacentralprimary') and is_active limit 1), 'male')$q$, 'err', '22023%');
insert into t_res(name, ok, detail) select '6.18 sanity: hrur has a class to attack with', exists(select 1 from public.classes where school_id=(select id from public.schools where slug='hrur')), 'setup';
select pg_temp.q('6.19 cross-tenant: PCP admin cannot register into a HRUR class', '9213eb91-299b-46b3-8138-30848fcca73f',
  format($f$select admission_no from public.register_student('Sneaky', %L::uuid, 'male')$f$, (select id from public.classes where school_id=(select id from public.schools where slug='hrur') limit 1)::text), 'err', '22023%not found%');
select pg_temp.q('6.20 teacher cannot register', '971f2d15-5b0e-42e1-81fa-a527b761e501',
  $q$select admission_no from public.register_student('Teacher Try', (select id from public.classes where is_active limit 1), 'male')$q$, 'err', '42501%');
select pg_temp.q('6.21 student cannot register', '3ba39ebd-93a9-44de-a908-3cfa04398e18',
  $q$select admission_no from public.register_student('Student Try', (select id from public.classes where is_active limit 1), 'male')$q$, 'err', '42501%');
select pg_temp.q('6.22 bursar (no registrar role) cannot register', 'fae343a0-5164-4c0e-aa30-9d32b5f2fb1a',
  $q$select admission_no from public.register_student('Bursar Try', (select id from public.classes where is_active limit 1), 'male')$q$, 'err', '42501%');
select pg_temp.q('6.23 anon cannot call register_student', null,
  $q$select admission_no from public.register_student('Anon Try', gen_random_uuid(), 'male')$q$, 'err', '42501%', 'anon');
update public.staff set roles = roles || 'registrar_primary'::app.user_role where id='b38b5e96-1014-4acc-a05e-03cba8ca1721';
select pg_temp.q('6.24 registrar CAN register', 'fae343a0-5164-4c0e-aa30-9d32b5f2fb1a',
  $q$select admission_no from public.register_student('Registrar Pupil', (select id from public.classes where is_active order by sort_order limit 1), 'female')$q$, 'ok', 'PCP2026%');
select pg_temp.q('6.25 registrar CAN check numbers', 'fae343a0-5164-4c0e-aa30-9d32b5f2fb1a',
  $q$select taken::text from public.check_admission_number('PCP20260406')$q$, 'ok', 'true');
select pg_temp.q('6.26 registrar cannot sync the scheme (admin only)', 'fae343a0-5164-4c0e-aa30-9d32b5f2fb1a',
  $q$select next_number::text from public.sync_admission_scheme()$q$, 'err', '42501%');
select pg_temp.q('6.27 registrar cannot rewrite the scheme directly (0 rows)', 'fae343a0-5164-4c0e-aa30-9d32b5f2fb1a',
  $q$with u as (update public.schools set admission_next_no=1 where slug='pariyacentralprimary' returning 1) select count(*)::text from u$q$, 'ok', '0');
select pg_temp.q('6.28 check: existing number, case-insensitive', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$select taken::text||'|'||coalesce(full_name,'-')||'|'||coalesce(class_name,'-') from public.check_admission_number(' pcp20260406 ')$q$, 'ok', 'true|%');
select pg_temp.q('6.29 check: free number', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$select taken::text||'|'||coalesce(full_name,'-')||'|'||coalesce(class_name,'-') from public.check_admission_number('PCP20269999')$q$, 'ok', 'false|-|-');
select pg_temp.q('6.30 check: blank', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$select taken::text from public.check_admission_number('   ')$q$, 'ok', 'false');
select pg_temp.q('6.31 cross-tenant: HRUR admin checking a PCP number sees "available" (no leak)', '84440ade-06d7-419f-aefb-b681a6594af1',
  $q$select taken::text||'|'||coalesce(full_name,'-') from public.check_admission_number('PCP20260406')$q$, 'ok', 'false|-');
select pg_temp.q('6.32 teacher cannot check numbers', '971f2d15-5b0e-42e1-81fa-a527b761e501',
  $q$select taken::text from public.check_admission_number('PCP20260406')$q$, 'err', '42501%');
select pg_temp.q('6.33 student cannot check numbers', '3ba39ebd-93a9-44de-a908-3cfa04398e18',
  $q$select taken::text from public.check_admission_number('PCP20260406')$q$, 'err', '42501%');
select pg_temp.q('6.34 sync: bad prefix rejected', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$select next_number::text from public.sync_admission_scheme('bad prefix!')$q$, 'err', '22023%');
select pg_temp.q('6.35 sync: teacher denied', '971f2d15-5b0e-42e1-81fa-a527b761e501',
  $q$select next_number::text from public.sync_admission_scheme()$q$, 'err', '42501%');
select pg_temp.q('6.36 cross-tenant: HRUR admin sync only sees HRUR (0 matches, next 1)', '84440ade-06d7-419f-aefb-b681a6594af1',
  $q$select coalesce(highest_found,0)||'|'||matched_count||'|'||next_number from public.sync_admission_scheme()$q$, 'ok', '0|0|1');
insert into t_res(name, ok, detail)
select '6.37 cross-tenant: PCP counter untouched by HRUR sync', admission_next_no >= 450, admission_next_no::text from public.schools where slug='pariyacentralprimary';
select pg_temp.q('6.38 PA admin: prefix PAS/2026/ width 3', 'cfb5fff0-511d-421b-8581-d4ffa841d2ff',
  $q$with u as (update public.schools set admission_prefix='PAS/2026/', admission_pad_width=3 where slug='pariyaacademy' returning 1) select count(*)::text from u$q$, 'ok', '1');
select pg_temp.q('6.39 PA admin: sync -> highest 1 -> next PAS/2026/002', 'cfb5fff0-511d-421b-8581-d4ffa841d2ff',
  $q$select coalesce(highest_found,0)||'|'||next_admission_no from public.sync_admission_scheme()$q$, 'ok', '1|PAS/2026/002');
select pg_temp.q('6.40 PA admin: register -> PAS/2026/002', 'cfb5fff0-511d-421b-8581-d4ffa841d2ff',
  $q$select admission_no from public.register_student('PA Pupil', (select id from public.classes where is_active order by sort_order limit 1), 'male')$q$, 'ok', 'PAS/2026/002');
select pg_temp.q('6.41 preview (PCP admin)', '9213eb91-299b-46b3-8138-30848fcca73f',
  $q$select prefix||'|'||pad_width||'|'||next_number||'|'||coalesce(last_issued,'-')||'|'||next_admission_no||'|'||total_active_students from public.admission_scheme_preview()$q$, 'ok', 'PCP2026|4|%');
select pg_temp.q('6.42 preview: teacher denied', '971f2d15-5b0e-42e1-81fa-a527b761e501',
  $q$select prefix from public.admission_scheme_preview()$q$, 'err', '42501%');
insert into t_res(name, ok, detail)
select '6.43 grants: service_role has USAGE+EXECUTE; authenticated/anon locked out of app helpers',
  has_schema_privilege('service_role','app','USAGE')
  and has_function_privilege('service_role','app.next_free_admission_no(uuid)','EXECUTE')
  and has_function_privilege('service_role','app.fmt_admission_no(text,integer,integer)','EXECUTE')
  and has_function_privilege('service_role','public.register_student(text,uuid,text,date)','EXECUTE')
  and has_function_privilege('service_role','public.sync_admission_scheme(text)','EXECUTE')
  and has_function_privilege('service_role','public.check_admission_number(text)','EXECUTE')
  and has_function_privilege('service_role','public.admission_scheme_preview()','EXECUTE')
  and not has_function_privilege('authenticated','app.next_free_admission_no(uuid)','EXECUTE')
  and not has_function_privilege('anon','app.next_free_admission_no(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.register_student(text,uuid,text,date)','EXECUTE'), 'checked';
select pg_temp.q('6.44 service_role can actually call the app helper', null,
  format($f$select o_no from app.next_free_admission_no(%L::uuid)$f$, (select id from public.schools where slug='pariyacentralprimary')::text), 'ok', 'PCP2026%', 'service_role');
select pg_temp.q('6.45 authenticated cannot call the tenant-arg helper directly', '9213eb91-299b-46b3-8138-30848fcca73f',
  format($f$select o_no from app.next_free_admission_no(%L::uuid)$f$, (select id from public.schools where slug='hrur')::text), 'err', '42501%');

select seq, name, case when ok then 'PASS' else 'FAIL' end as result, detail from t_res order by seq;
rollback;
