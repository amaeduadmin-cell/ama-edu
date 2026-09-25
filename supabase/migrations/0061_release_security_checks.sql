-- AMA EDU 0061 — release security test matrix
create or replace function public.run_release_security_checks()
returns table(check_name text, passed boolean, detail text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_table text;
  v_exists boolean;
  v_rls boolean;
  v_force boolean;
  v_policy_count integer;
  v_tables text[] := array[
    'schools','school_members','students','staff','classes','subjects','terms',
    'student_scores','student_term_summary','attendance_records','fee_payments',
    'notifications','data_export_jobs','school_payment_settings','school_api_keys',
    'webhook_subscriptions','notification_deliveries','platform_health_checks',
    'platform_incidents','platform_backup_runs','platform_restore_drills',
    'platform_reliability_runs'
  ];
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception 'Release security checks require service role.' using errcode='42501';
  end if;
  foreach v_table in array v_tables loop
    select c.relrowsecurity, c.relforcerowsecurity into v_rls, v_force
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=v_table and c.relkind='r';
    v_exists := v_rls is not null;
    select count(*)::integer into v_policy_count from pg_policies p where p.schemaname='public' and p.tablename=v_table;
    return query select 'rls:'||v_table, coalesce(v_exists and v_force, false), case when not v_exists then 'table missing' when not v_rls then 'RLS disabled' when not v_force then 'forced RLS disabled' else 'forced RLS enabled' end;
    return query select 'policy:'||v_table, v_policy_count > 0, 'policies='||v_policy_count::text;
  end loop;
  return query select 'public:status-rpc', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('public_platform_maintenance','public_service_status')), 'public status functions present';
  return query select 'public:tenant-rpc', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('public_school_by_slug','list_public_school')), 'public tenant lookup functions present';
end $$;
revoke all on function public.run_release_security_checks() from public, anon, authenticated;
grant execute on function public.run_release_security_checks() to service_role;
