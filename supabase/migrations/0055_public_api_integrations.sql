-- AMA EDU 0055 — public API keys, integrations, and notification delivery
create extension if not exists pgcrypto;

create table if not exists public.school_api_keys (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 80),
  key_prefix text not null unique,
  secret_hash text not null,
  scopes text[] not null default array['school:read']::text[],
  is_active boolean not null default true,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists school_api_keys_school_idx on public.school_api_keys(school_id, is_active, created_at desc);

create table if not exists public.api_request_windows (
  api_key_id uuid primary key references public.school_api_keys(id) on delete cascade,
  window_started_at timestamptz not null default date_trunc('minute', now()),
  request_count integer not null default 0 check (request_count >= 0)
);

create table if not exists public.webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 80),
  endpoint_url text not null check (endpoint_url ~ '^https://'),
  events text[] not null default array['notification.created']::text[],
  is_active boolean not null default true,
  created_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists webhook_subscriptions_school_idx on public.webhook_subscriptions(school_id, is_active);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  subscription_id uuid not null references public.webhook_subscriptions(id) on delete cascade,
  notification_id uuid references public.notifications(id) on delete cascade,
  event_name text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notification_deliveries_queue_idx on public.notification_deliveries(status, next_attempt_at);
create index if not exists notification_deliveries_school_idx on public.notification_deliveries(school_id, created_at desc);

alter table public.school_api_keys enable row level security;
alter table public.school_api_keys force row level security;
create policy school_api_keys_read on public.school_api_keys for select to authenticated using (app.owns(school_id) and app.is_school_admin());
revoke insert, update, delete on public.school_api_keys from authenticated;
grant select on public.school_api_keys to authenticated;

alter table public.webhook_subscriptions enable row level security;
alter table public.webhook_subscriptions force row level security;
create policy webhook_subscriptions_admin_read on public.webhook_subscriptions for select to authenticated using (app.owns(school_id) and app.is_school_admin());
revoke insert, update, delete on public.webhook_subscriptions from authenticated;
grant select on public.webhook_subscriptions to authenticated;

alter table public.notification_deliveries enable row level security;
alter table public.notification_deliveries force row level security;
create policy notification_deliveries_admin_read on public.notification_deliveries for select to authenticated using (app.owns(school_id) and app.is_school_admin());
revoke insert, update, delete on public.notification_deliveries from authenticated;
grant select on public.notification_deliveries to authenticated;

create or replace function public.create_school_api_key(p_name text, p_scopes text[] default array['school:read']::text[])
returns table(id uuid, name text, token text, scopes text[])
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := gen_random_uuid(); v_secret text := encode(gen_random_bytes(32), 'hex'); v_scopes text[]; v_prefix text := 'ama_' || replace(v_id::text, '-', '');
begin
  if not app.is_school_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
  v_scopes := array(select distinct s from unnest(coalesce(p_scopes, array['school:read']::text[])) s where s in ('school:read','students:read','attendance:read','notifications:read'));
  if coalesce(array_length(v_scopes,1),0) = 0 then raise exception 'Choose at least one valid API scope.' using errcode='22023'; end if;
  insert into public.school_api_keys(id,school_id,name,key_prefix,secret_hash,scopes,created_by) values(v_id,app.current_school_id(),btrim(p_name),v_prefix,encode(digest(v_secret,'sha256'),'hex'),v_scopes,app.current_staff_id());
  return query select v_id,btrim(p_name),v_prefix || '.' || v_secret,v_scopes;
end $$;
grant execute on function public.create_school_api_key(text,text[]) to authenticated;

create or replace function public.revoke_school_api_key(p_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_school_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
  update public.school_api_keys set is_active=false where id=p_id and school_id=app.current_school_id();
  return found;
end $$;
grant execute on function public.revoke_school_api_key(uuid) to authenticated;

create or replace function app.authenticate_api_key(p_key_id text, p_secret_hash text)
returns table(school_id uuid, scopes text[], allowed boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_key public.school_api_keys; v_now timestamptz := now(); v_window public.api_request_windows;
begin
  select * into v_key from public.school_api_keys where key_prefix=p_key_id and is_active and (expires_at is null or expires_at > v_now);
  if v_key.id is null or v_key.secret_hash <> p_secret_hash then return query select null::uuid, array[]::text[], false; return; end if;
  insert into public.api_request_windows(api_key_id,window_started_at,request_count) values(v_key.id,date_trunc('minute',v_now),1)
  on conflict(api_key_id) do update set window_started_at=case when api_request_windows.window_started_at < date_trunc('minute',v_now) then date_trunc('minute',v_now) else api_request_windows.window_started_at end, request_count=case when api_request_windows.window_started_at < date_trunc('minute',v_now) then 1 else api_request_windows.request_count+1 end returning * into v_window;
  update public.school_api_keys set last_used_at=v_now where id=v_key.id;
  return query select v_key.school_id, v_key.scopes, v_window.request_count <= 120;
end $$;
revoke all on function app.authenticate_api_key(text,text) from public, anon, authenticated;
grant execute on function app.authenticate_api_key(text,text) to service_role;

create or replace function public.authenticate_api_key(p_key_id text, p_secret_hash text)
returns table(school_id uuid, scopes text[], allowed boolean)
language sql security definer set search_path = public, pg_temp as $$
  select * from app.authenticate_api_key(p_key_id, p_secret_hash);
$$;
revoke all on function public.authenticate_api_key(text,text) from public, anon, authenticated;
grant execute on function public.authenticate_api_key(text,text) to service_role;

create or replace function public.create_webhook_subscription(p_name text, p_endpoint_url text, p_events text[] default array['notification.created']::text[])
returns public.webhook_subscriptions language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.webhook_subscriptions;
begin
  if not app.is_school_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
  if p_endpoint_url !~ '^https://' then raise exception 'Webhook endpoint must use HTTPS.' using errcode='22023'; end if;
  insert into public.webhook_subscriptions(school_id,name,endpoint_url,events,created_by) values(app.current_school_id(),btrim(p_name),btrim(p_endpoint_url),array(select distinct e from unnest(coalesce(p_events,array['notification.created']::text[])) e where e in ('notification.created')),app.current_staff_id()) returning * into v_row;
  return v_row;
end $$;
grant execute on function public.create_webhook_subscription(text,text,text[]) to authenticated;

create or replace function app.queue_notification_delivery()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notification_deliveries(school_id,subscription_id,notification_id,event_name,payload)
  select new.school_id,w.id,new.id,'notification.created',jsonb_build_object('id',new.id,'kind',new.kind,'title',new.title,'body',new.body,'entity',new.entity,'entity_id',new.entity_id,'created_at',new.created_at)
  from public.webhook_subscriptions w where w.school_id=new.school_id and w.is_active and 'notification.created'=any(w.events);
  return new;
end $$;
drop trigger if exists notification_delivery_queue on public.notifications;
create trigger notification_delivery_queue after insert on public.notifications for each row execute function app.queue_notification_delivery();
revoke all on function app.queue_notification_delivery() from public, anon, authenticated;
grant execute on function app.queue_notification_delivery() to service_role;

create or replace function public.list_public_school(p_slug text)
returns table(id uuid, name text, slug text, motto text, address text, phone text, email text, logo_url text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id,s.name,s.slug,s.motto,s.address,s.phone,s.email,s.logo_url from public.schools s where s.slug=lower(btrim(p_slug)) and s.status='active' limit 1;
$$;
grant execute on function public.list_public_school(text) to service_role;
