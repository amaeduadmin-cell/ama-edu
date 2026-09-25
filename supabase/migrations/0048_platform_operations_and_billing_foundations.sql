-- AMA EDU 0048 — platform operations and billing foundations
-- This migration is intentionally additive. It separates AMA EDU billing from
-- school fee collection and stores historical invoice inputs rather than
-- recalculating old invoices from today's student count.

create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  school_type text not null default 'all',
  currency text not null default 'NGN',
  base_price numeric(12,2) not null default 0 check (base_price >= 0),
  price_per_student numeric(12,2) not null default 0 check (price_per_student >= 0),
  billing_period text not null default 'termly' check (billing_period in ('monthly','termly','annually')),
  minimum_students integer not null default 0 check (minimum_students >= 0),
  maximum_students integer check (maximum_students is null or maximum_students >= minimum_students),
  grace_days integer not null default 7 check (grace_days between 0 and 90),
  is_active boolean not null default true,
  effective_from date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.school_subscriptions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  plan_id uuid references public.billing_plans(id),
  status text not null default 'trial' check (status in ('trial','active','past_due','grace','read_only','suspended','cancelled')),
  started_at timestamptz not null default now(),
  current_period_start date,
  current_period_end date,
  grace_until date,
  student_snapshot integer not null default 0 check (student_snapshot >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id)
);

create table if not exists public.school_billing_invoices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  subscription_id uuid references public.school_subscriptions(id),
  invoice_number text not null unique,
  status text not null default 'draft' check (status in ('draft','issued','pending','partially_paid','paid','overdue','cancelled')),
  currency text not null default 'NGN',
  period_start date not null,
  period_end date not null,
  student_snapshot integer not null default 0 check (student_snapshot >= 0),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  due_at timestamptz,
  issued_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.school_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.school_billing_invoices(id) on delete cascade,
  description text not null,
  quantity numeric(12,2) not null default 1 check (quantity >= 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  amount numeric(12,2) not null default 0 check (amount >= 0)
);

create table if not exists public.school_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.school_billing_invoices(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'NGN',
  provider text,
  provider_reference text,
  status text not null default 'pending' check (status in ('pending','confirmed','failed','refunded')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_reference)
);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete set null,
  invoice_id uuid references public.school_billing_invoices(id) on delete set null,
  event_type text not null,
  provider_reference text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (event_type, provider_reference)
);

create table if not exists public.school_usage_snapshots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  captured_on date not null default current_date,
  active_students integer not null default 0 check (active_students >= 0),
  active_staff integer not null default 0 check (active_staff >= 0),
  storage_bytes bigint,
  api_requests bigint,
  active_users integer,
  files_count integer,
  created_at timestamptz not null default now(),
  unique (school_id, captured_on)
);

create table if not exists public.platform_alerts (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('system','database','storage','billing','usage','security','performance','maintenance','payment','api','infrastructure')),
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  message text not null,
  school_id uuid references public.schools(id) on delete set null,
  threshold numeric,
  current_value numeric,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_maintenance (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  scope text not null default 'global' check (scope in ('global','public','school_portals','admin','management','api')),
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  message text not null default 'AMA EDU is undergoing scheduled maintenance.',
  starts_at timestamptz,
  ends_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.platform_maintenance (id) values (true) on conflict (id) do nothing;

create table if not exists public.platform_service_status (
  service_key text primary key,
  label text not null,
  status text not null default 'operational' check (status in ('operational','degraded','partial_outage','major_outage','maintenance')),
  message text,
  checked_at timestamptz not null default now(),
  sort_order integer not null default 0
);
insert into public.platform_service_status(service_key,label,sort_order) values
 ('website','AMA EDU Website',1), ('school_portals','School Portals',2), ('admin_portal','Admin Portal',3),
 ('authentication','Authentication',4), ('database','Database',5), ('storage','Storage',6),
 ('api','API',7), ('notifications','Notifications',8), ('payments','Payments',9)
on conflict (service_key) do nothing;

create index if not exists school_subscriptions_status_idx on public.school_subscriptions(status);
create index if not exists invoices_school_status_idx on public.school_billing_invoices(school_id,status,period_end desc);
create index if not exists usage_school_date_idx on public.school_usage_snapshots(school_id,captured_on desc);
create index if not exists alerts_open_idx on public.platform_alerts(resolved_at,created_at desc);

create or replace function public.public_platform_maintenance()
returns table (enabled boolean, scope text, severity text, message text, starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.enabled and (m.starts_at is null or m.starts_at <= now()) and (m.ends_at is null or m.ends_at > now()),
         m.scope, m.severity, m.message, m.starts_at, m.ends_at
    from public.platform_maintenance m where m.id;
$$;

create or replace function public.public_service_status()
returns table (service_key text, label text, status text, message text, checked_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.service_key, s.label, s.status, s.message, s.checked_at
    from public.platform_service_status s order by s.sort_order, s.label;
$$;
grant execute on function public.public_platform_maintenance() to anon, authenticated;
grant execute on function public.public_service_status() to anon, authenticated;

alter table public.billing_plans enable row level security;
alter table public.school_subscriptions enable row level security;
alter table public.school_billing_invoices enable row level security;
alter table public.school_invoice_items enable row level security;
alter table public.school_invoice_payments enable row level security;
alter table public.billing_events enable row level security;
alter table public.school_usage_snapshots enable row level security;
alter table public.platform_alerts enable row level security;
alter table public.platform_maintenance enable row level security;
alter table public.platform_service_status enable row level security;

create policy billing_plans_read on public.billing_plans for select to authenticated using (is_active or app.is_platform_admin());
create policy billing_plans_admin on public.billing_plans for all to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy school_subscriptions_read on public.school_subscriptions for select to authenticated using (app.owns(school_id) or app.is_platform_admin());
create policy school_subscriptions_admin on public.school_subscriptions for all to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy invoices_read on public.school_billing_invoices for select to authenticated using (app.owns(school_id) or app.is_platform_admin());
create policy invoices_admin on public.school_billing_invoices for all to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy invoice_items_read on public.school_invoice_items for select to authenticated using (exists (select 1 from public.school_billing_invoices i where i.id = invoice_id and (app.owns(i.school_id) or app.is_platform_admin())));
create policy invoice_items_admin on public.school_invoice_items for all to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy invoice_payments_read on public.school_invoice_payments for select to authenticated using (exists (select 1 from public.school_billing_invoices i where i.id = invoice_id and (app.owns(i.school_id) or app.is_platform_admin())));
create policy invoice_payments_admin on public.school_invoice_payments for all to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy billing_events_admin on public.billing_events for all to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy usage_read on public.school_usage_snapshots for select to authenticated using (app.owns(school_id) or app.is_platform_admin());
create policy usage_admin on public.school_usage_snapshots for all to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy alerts_admin on public.platform_alerts for all to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy maintenance_admin on public.platform_maintenance for all to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy service_status_admin on public.platform_service_status for all to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());

grant select on public.billing_plans, public.school_subscriptions, public.school_billing_invoices, public.school_invoice_items, public.school_invoice_payments, public.school_usage_snapshots to authenticated;
grant select, insert, update, delete on public.billing_plans, public.school_subscriptions, public.school_billing_invoices, public.school_invoice_items, public.school_invoice_payments, public.billing_events, public.school_usage_snapshots, public.platform_alerts, public.platform_maintenance, public.platform_service_status to authenticated;
