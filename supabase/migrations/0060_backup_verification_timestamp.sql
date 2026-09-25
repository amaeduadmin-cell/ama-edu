-- AMA EDU 0060 — record verification timestamp for verified backup runs
create or replace function public.record_backup_run(p_provider text,p_scope text,p_status text,p_artifact_ref text default null,p_checksum text default null,p_size_bytes bigint default null,p_retention_until timestamptz default null,p_error_message text default null)
returns public.platform_backup_runs language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.platform_backup_runs;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' and session_user not in ('postgres','supabase_admin') and not app.is_platform_admin() then raise exception 'Backup access required.' using errcode='42501'; end if;
  insert into public.platform_backup_runs(provider,scope,status,artifact_ref,checksum,size_bytes,completed_at,verified_at,retention_until,error_message,created_by)
  values(left(p_provider,80),left(coalesce(p_scope,'database'),80),p_status,left(p_artifact_ref,500),left(p_checksum,200),p_size_bytes,case when p_status in ('completed','verified','failed') then now() end,case when p_status='verified' then now() end,p_retention_until,left(p_error_message,500),auth.uid()) returning * into v_row;
  return v_row;
end $$;
