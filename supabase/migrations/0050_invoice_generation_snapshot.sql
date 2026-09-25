-- AMA EDU 0050 — idempotent invoice generation from a historical student snapshot

create unique index if not exists school_invoice_period_unique
  on public.school_billing_invoices (school_id, period_start, period_end);

create or replace function public.create_school_billing_invoice(
  p_school_id uuid,
  p_plan_id uuid,
  p_period_start date,
  p_period_end date,
  p_due_at timestamptz default null
)
returns table (invoice_id uuid, invoice_number text, student_snapshot integer, total numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.billing_plans%rowtype;
  v_existing public.school_billing_invoices%rowtype;
  v_students integer;
  v_billable integer;
  v_total numeric(12,2);
  v_invoice uuid;
  v_number text;
begin
  if not app.is_platform_admin() then
    raise exception 'Only an AMA EDU administrator can generate platform invoices.' using errcode = '42501';
  end if;
  if p_school_id is null or p_plan_id is null or p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'Invoice school, plan and valid billing period are required.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.schools s where s.id = p_school_id) then
    raise exception 'School not found.' using errcode = 'P0002';
  end if;
  select * into v_plan from public.billing_plans p where p.id = p_plan_id and p.is_active;
  if not found then raise exception 'Active billing plan not found.' using errcode = 'P0002'; end if;

  select * into v_existing from public.school_billing_invoices i
   where i.school_id = p_school_id and i.period_start = p_period_start and i.period_end = p_period_end;
  if found then return query select v_existing.id, v_existing.invoice_number, v_existing.student_snapshot, v_existing.total; return; end if;

  select count(*)::integer into v_students from public.students st where st.school_id = p_school_id and st.is_active;
  v_billable := greatest(v_students, v_plan.minimum_students);
  if v_plan.maximum_students is not null then v_billable := least(v_billable, v_plan.maximum_students); end if;
  v_total := round(v_plan.base_price + (v_billable * v_plan.price_per_student), 2);
  v_number := 'AMA-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.school_billing_invoices (
    school_id, invoice_number, status, currency, period_start, period_end,
    student_snapshot, subtotal, total, due_at, issued_at)
  values (
    p_school_id, v_number, 'issued', v_plan.currency, p_period_start, p_period_end,
    v_students, v_total, v_total, coalesce(p_due_at, now() + make_interval(days => v_plan.grace_days)), now())
  on conflict (school_id, period_start, period_end) do nothing
  returning id into v_invoice;

  if v_invoice is null then
    select * into v_existing from public.school_billing_invoices i
     where i.school_id = p_school_id and i.period_start = p_period_start and i.period_end = p_period_end;
    return query select v_existing.id, v_existing.invoice_number, v_existing.student_snapshot, v_existing.total;
    return;
  end if;

  insert into public.school_invoice_items (invoice_id, description, quantity, unit_price, amount)
  values (v_invoice, v_plan.name || ' — ' || v_plan.billing_period, v_billable, v_plan.price_per_student, v_billable * v_plan.price_per_student);
  if v_plan.base_price > 0 then
    insert into public.school_invoice_items (invoice_id, description, quantity, unit_price, amount)
    values (v_invoice, v_plan.name || ' base subscription', 1, v_plan.base_price, v_plan.base_price);
  end if;

  return query select v_invoice, v_number, v_students, v_total;
end $$;

grant execute on function public.create_school_billing_invoice(uuid, uuid, date, date, timestamptz) to authenticated;
