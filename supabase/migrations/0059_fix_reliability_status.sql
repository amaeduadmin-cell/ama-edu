-- AMA EDU 0059 — qualify status in reliability billing check
create or replace function public.run_reliability_checks(p_run_key text default null)
returns table(run_key text, checks_run integer, checks_failed integer, status text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key text := coalesce(nullif(btrim(p_run_key),''),'reliability:'||to_char(date_trunc('minute',now()),'YYYY-MM-DD-HH24-MI'));
  v_count integer := 0; v_failed integer := 0; v_run public.platform_reliability_runs%rowtype; v_started timestamptz := clock_timestamp();
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' and session_user not in ('postgres','supabase_admin') and not app.is_platform_admin() then raise exception 'Reliability runner requires a service role or platform administrator.' using errcode='42501'; end if;
  insert into public.platform_reliability_runs(run_key,job_name) values(v_key,'reliability_checks') on conflict on constraint platform_reliability_runs_pkey do nothing;
  select r.* into v_run from public.platform_reliability_runs r where r.run_key=v_key;
  if v_run.status='completed' then return query select v_run.run_key,v_run.checks_run,v_run.checks_failed,v_run.status; return; end if;
  perform public.record_platform_health_check('database','operational',round(extract(epoch from clock_timestamp()-v_started)*1000)::integer,null,'database-cron'); v_count := 1;
  if not exists(select 1 from public.platform_service_status ps where ps.service_key='database') then v_failed := 1; end if;
  perform public.record_platform_health_check('billing-automation',case when exists(select 1 from public.platform_automation_runs a where a.job_name='billing_automation' and a.started_at > now()-interval '26 hours' and a.status='completed') then 'operational' else 'degraded' end,null,null,'database-cron'); v_count := v_count + 1;
  update public.platform_reliability_runs r set checks_run=v_count, checks_failed=v_failed, summary=jsonb_build_object('database','checked','billing_automation','checked'), status='completed', finished_at=now() where r.run_key=v_key;
  return query select v_key,v_count,v_failed,'completed'::text;
exception when others then
  update public.platform_reliability_runs r set status='failed',finished_at=now(),error_message=left(sqlerrm,500) where r.run_key=v_key;
  raise;
end $$;
