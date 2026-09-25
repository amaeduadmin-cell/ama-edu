-- AMA EDU 0052 — daily billing automation schedule
-- pg_cron executes the locked security-definer runner in the database.

create extension if not exists pg_cron;

create or replace function public.run_billing_automation(p_run_key text default null)
returns table (run_key text, usage_rows integer, overdue_invoices integer, alerts_created integer, status text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key text := coalesce(nullif(btrim(p_run_key), ''), 'billing:' || to_char(current_date, 'YYYY-MM-DD'));
  v_run public.platform_automation_runs%rowtype;
  v_school record;
  v_students integer;
  v_staff integer;
  v_usage integer := 0;
  v_overdue integer := 0;
  v_alerts integer := 0;
  v_grace_days integer;
  v_plan_max integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') and not app.is_platform_admin() then
    raise exception 'Automation runner requires a service role, scheduler, or platform administrator.' using errcode = '42501';
  end if;
  insert into public.platform_automation_runs(run_key, job_name) values (v_key, 'billing_automation') on conflict (run_key) do nothing;
  select * into v_run from public.platform_automation_runs where platform_automation_runs.run_key = v_key;
  if v_run.status = 'completed' then return query select v_run.run_key, v_run.usage_rows, v_run.overdue_invoices, v_run.alerts_created, v_run.status; return; end if;
  for v_school in select s.id from public.schools s where s.status = 'active' order by s.id limit 1000 loop
    select count(*)::integer into v_students from public.students st where st.school_id = v_school.id and st.is_active;
    select count(*)::integer into v_staff from public.staff sf where sf.school_id = v_school.id and sf.is_active;
    insert into public.school_usage_snapshots(school_id, captured_on, active_students, active_staff) values (v_school.id, current_date, v_students, v_staff) on conflict (school_id, captured_on) do update set active_students = excluded.active_students, active_staff = excluded.active_staff;
    v_usage := v_usage + 1;
    select coalesce(p.grace_days, 7), p.maximum_students into v_grace_days, v_plan_max from public.school_subscriptions ss left join public.billing_plans p on p.id = ss.plan_id where ss.school_id = v_school.id limit 1;
    if v_plan_max is not null and v_students >= ceil(v_plan_max * 0.9) then
      if not exists (select 1 from public.platform_alerts a where a.school_id = v_school.id and a.category = 'usage' and a.resolved_at is null and a.message like 'Student usage is at least 90% of plan capacity%') then
        insert into public.platform_alerts(category, severity, message, school_id, threshold, current_value) values ('usage', 'warning', 'Student usage is at least 90% of plan capacity.', v_school.id, v_plan_max, v_students);
        v_alerts := v_alerts + 1;
      end if;
    end if;
    update public.school_subscriptions ss set status = case when ss.current_period_end < current_date then 'grace' else ss.status end, grace_until = case when ss.current_period_end < current_date then current_date + coalesce(v_grace_days, 7) else ss.grace_until end, updated_at = now() where ss.school_id = v_school.id and ss.status in ('trial','active') and ss.current_period_end is not null and ss.current_period_end < current_date;
  end loop;
  update public.school_billing_invoices set status = 'overdue' where status in ('issued','pending','partially_paid') and due_at is not null and due_at < now();
  get diagnostics v_overdue = row_count;
  insert into public.platform_alerts(category, severity, message, threshold, current_value)
  select 'billing', 'warning', 'There are overdue AMA EDU invoices.', 0, count(*) from public.school_billing_invoices i where i.status = 'overdue' having count(*) > 0 and not exists (select 1 from public.platform_alerts a where a.category = 'billing' and a.resolved_at is null and a.message = 'There are overdue AMA EDU invoices.');
  if found then v_alerts := v_alerts + 1; end if;
  update public.platform_automation_runs set finished_at = now(), usage_rows = v_usage, overdue_invoices = v_overdue, alerts_created = v_alerts, status = 'completed' where platform_automation_runs.run_key = v_key;
  return query select v_key, v_usage, v_overdue, v_alerts, 'completed'::text;
exception when others then
  update public.platform_automation_runs set finished_at = now(), status = 'failed', error_message = left(sqlerrm, 500) where platform_automation_runs.run_key = v_key;
  raise;
end $$;

do $do$
begin
  if not exists (select 1 from cron.job where jobname = 'amaedu-billing-automation') then
    perform cron.schedule('amaedu-billing-automation', '15 2 * * *', $job$select public.run_billing_automation();$job$);
  end if;
end $do$;
