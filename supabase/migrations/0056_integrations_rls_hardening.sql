-- AMA EDU 0056 — integration hardening and disconnect controls
alter table public.api_request_windows enable row level security;
alter table public.api_request_windows force row level security;
revoke all on public.api_request_windows from public, anon, authenticated;

create or replace function public.revoke_webhook_subscription(p_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_school_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
  update public.webhook_subscriptions set is_active=false, updated_at=now() where id=p_id and school_id=app.current_school_id();
  return found;
end $$;
grant execute on function public.revoke_webhook_subscription(uuid) to authenticated;
