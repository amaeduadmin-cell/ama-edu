-- AMA EDU 0057 — reliability, backup verification, and disaster-recovery foundations

create table if not exists public.platform_health_checks (
  id uuid primary key default gen_random_uuid(),
  service_key text not null,
  status text not null check (status in ('operational','degraded','failed')),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  error_message text,
  checked_at timestamptz not null default now(),
  source text not null default 'scheduler'
);
create index if not exists platform_health_checks_service_idx on public.platform_health_checks(service_key, checked_at desc);

create table if not exists public.platform_incidents (
  id uuid primary key default gen_random_uuid(),
  service_key text,
  severity text not null check (severity in ('minor','major','critical')),
  title text not null,
  public_message text not null,
  status text not null default 'open' check (status in ('open','monitoring','resolved')),
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists platform_incidents_status_idx on public.platform_incidents(status, started_at desc);

create table if not exists public.platform_backup_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  scope text not null default 'database',
  status text not null check (status in ('started','completed','failed','verified')),
  artifact_ref text,
  checksum text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  verified_at timestamptz,
  retention_until timestamptz,
  error_message text,
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists platform_backup_runs_recent_idx on public.platform_backup_runs(started_at desc);

create table if not exists public.platform_restore_drills (
  id uuid primary key default gen_random_uuid(),
  backup_id uuid references public.platform_backup_runs(id) on delete set null,
  status text not null check (status in ('planned','running','passed','failed')),
  target text not null,
  verification_notes text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists platform_restore_drills_recent_idx on public.platform_restore_drills(started_at desc);

create table if not exists public.platform_reliability_runs (
  run_key text primary key,
  job_name text not null,
  status text not null default 'running' check (status in ('running','completed','failed')),
  checks_run integer not null default 0,
  checks_failed integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text
);
create index if not exists platform_reliability_runs_recent_idx on public.platform_reliability_runs(job_name, started_at desc);

alter table public.platform_health_checks enable row level security;
alter table public.platform_health_checks force row level security;
create policy health_checks_platform_read on public.platform_health_checks for select to authenticated using (app.is_platform_admin());
revoke insert, update, delete on public.platform_health_checks from authenticated;
grant select on public.platform_health_checks to authenticated;

alter table public.platform_incidents enable row level security;
alter table public.platform_incidents force row level security;
create policy incidents_platform_all on public.platform_incidents for all to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());
grant select, insert, update on public.platform_incidents to authenticated;

alter table public.platform_backup_runs enable row level security;
alter table public.platform_backup_runs force row level security;
create policy backups_platform_read on public.platform_backup_runs for select to authenticated using (app.is_platform_admin());
revoke insert, update, delete on public.platform_backup_runs from authenticated;
grant select on public.platform_backup_runs to authenticated;

alter table public.platform_restore_drills enable row level security;
alter table public.platform_restore_drills force row level security;
create policy restore_drills_platform_all on public.platform_restore_drills for all to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());
grant select, insert, update on public.platform_restore_drills to authenticated;

alter table public.platform_reliability_runs enable row level security;
alter table public.platform_reliability_runs force row level security;
create policy reliability_runs_platform_read on public.platform_reliability_runs for select to authenticated using (app.is_platform_admin());
revoke insert, update, delete on public.platform_reliability_runs from authenticated;
grant select on public.platform_reliability_runs to authenticated;

create or replace function public.record_platform_health_check(p_service_key text, p_status text, p_latency_ms integer default null, p_error_message text default null, p_source text default 'scheduler')
returns public.platform_health_checks
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.platform_health_checks;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' and session_user not in ('postgres','supabase_admin') and not app.is_platform_admin() then raise exception 'Platform health access required.' using errcode='42501'; end if;
  if p_status not in ('operational','degraded','failed') then raise exception 'Invalid health status.' using errcode='22023'; end if;
  insert into public.platform_health_checks(service_key,status,latency_ms,error_message,source) values(btrim(p_service_key),p_status,p_latency_ms,left(p_error_message,500),left(coalesce(p_source,'scheduler'),80)) returning * into v_row;
  update public.platform_service_status set status=case p_status when 'operational' then 'operational' when 'degraded' then 'degraded' else 'major_outage' end, message=left(coalesce(p_error_message, message),500), checked_at=now() where service_key=btrim(p_service_key);
  return v_row;
end $$;
revoke all on function public.record_platform_health_check(text,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.record_platform_health_check(text,text,integer,text,text) to service_role, authenticated;

create or replace function public.run_reliability_checks(p_run_key text default null)
returns table(run_key text, checks_run integer, checks_failed integer, status text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_key text := coalesce(nullif(btrim(p_run_key),''),'reliability:'||to_char(date_trunc('minute',now()),'YYYY-MM-DD-HH24-MI')); v_count integer := 0; v_failed integer := 0; v_run public.platform_reliability_runs%rowtype; v_started timestamptz := clock_timestamp();
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' and session_user not in ('postgres','supabase_admin') and not app.is_platform_admin() then raise exception 'Reliability runner requires a service role or platform administrator.' using errcode='42501'; end if;
  insert into public.platform_reliability_runs(run_key,job_name) values(v_key,'reliability_checks') on conflict(run_key) do nothing;
  select * into v_run from public.platform_reliability_runs where platform_reliability_runs.run_key=v_key;
  if v_run.status='completed' then return query select v_run.run_key,v_run.checks_run,v_run.checks_failed,v_run.status; return; end if;
  perform public.record_platform_health_check('database','operational',round(extract(epoch from clock_timestamp()-v_started)*1000)::integer,null,'database-cron'); v_count := v_count + 1;
  if not exists(select 1 from public.platform_service_status where service_key='database') then v_failed := v_failed + 1; end if;
  perform public.record_platform_health_check('billing-automation',case when exists(select 1 from public.platform_automation_runs where job_name='billing_automation' and started_at > now()-interval '26 hours' and status='completed') then 'operational' else 'degraded' end,null,null,'database-cron'); v_count := v_count + 1;
  update public.platform_reliability_runs set checks_run=v_count, checks_failed=v_failed, summary=jsonb_build_object('database','checked','billing_automation','checked'), status='completed', finished_at=now() where platform_reliability_runs.run_key=v_key;
  return query select v_key,v_count,v_failed,'completed'::text;
exception when others then
  update public.platform_reliability_runs set status='failed',finished_at=now(),error_message=left(sqlerrm,500) where platform_reliability_runs.run_key=v_key;
  raise;
end $$;
grant execute on function public.run_reliability_checks(text) to authenticated;

create or replace function public.record_backup_run(p_provider text,p_scope text,p_status text,p_artifact_ref text default null,p_checksum text default null,p_size_bytes bigint default null,p_retention_until timestamptz default null,p_error_message text default null)
returns public.platform_backup_runs language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.platform_backup_runs;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' and session_user not in ('postgres','supabase_admin') and not app.is_platform_admin() then raise exception 'Backup access required.' using errcode='42501'; end if;
  insert into public.platform_backup_runs(provider,scope,status,artifact_ref,checksum,size_bytes,completed_at,retention_until,error_message,created_by) values(left(p_provider,80),left(coalesce(p_scope,'database'),80),p_status,left(p_artifact_ref,500),left(p_checksum,200),p_size_bytes,case when p_status in ('completed','verified','failed') then now() end,p_retention_until,left(p_error_message,500),auth.uid()) returning * into v_row;
  return v_row;
end $$;
revoke all on function public.record_backup_run(text,text,text,text,text,bigint,timestamptz,text) from public, anon, authenticated;
grant execute on function public.record_backup_run(text,text,text,text,text,bigint,timestamptz,text) to service_role, authenticated;

select cron.schedule('amaedu-reliability-checks','*/15 * * * *',$job$select public.run_reliability_checks();$job$) where not exists(select 1 from cron.job where jobname='amaedu-reliability-checks');
