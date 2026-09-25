-- AMA EDU 0053 — tenant-scoped data export jobs

create table if not exists public.data_export_jobs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  scope text not null default 'school' check (scope in ('school','students','academic','billing')),
  format text not null default 'json' check (format in ('json','csv')),
  status text not null default 'queued' check (status in ('queued','running','ready','failed','expired')),
  storage_path text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz
);

create index if not exists data_export_jobs_school_idx on public.data_export_jobs(school_id, created_at desc);
create index if not exists data_export_jobs_status_idx on public.data_export_jobs(status, created_at);

insert into storage.buckets (id, name, public)
values ('data-exports', 'data-exports', false)
on conflict (id) do nothing;

alter table public.data_export_jobs enable row level security;
alter table public.data_export_jobs force row level security;
create policy data_export_jobs_read on public.data_export_jobs for select to authenticated
  using (app.owns(school_id) or app.is_platform_admin());
create policy data_export_jobs_admin on public.data_export_jobs for all to authenticated
  using (app.is_platform_admin() or (app.owns(school_id) and app.is_school_admin()))
  with check (app.is_platform_admin() or (app.owns(school_id) and app.is_school_admin()));
grant select, insert, update on public.data_export_jobs to authenticated;

create or replace function public.request_data_export(
  p_scope text default 'school',
  p_format text default 'json',
  p_school_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_school uuid := case when app.is_platform_admin() then p_school_id else app.current_school_id() end;
  v_job uuid;
begin
  if v_school is null then raise exception 'A school context is required for export.' using errcode = '42501'; end if;
  if p_scope not in ('school','students','academic','billing') or p_format not in ('json','csv') then
    raise exception 'Unsupported export scope or format.' using errcode = '22023';
  end if;
  if not app.is_platform_admin() and not app.is_school_admin() then
    raise exception 'Only school administrators can request exports.' using errcode = '42501';
  end if;
  insert into public.data_export_jobs(school_id, requested_by, scope, format)
  values (v_school, auth.uid(), p_scope, p_format)
  returning id into v_job;
  return v_job;
end $$;
grant execute on function public.request_data_export(text, text, uuid) to authenticated;
