-- AMA EDU 0045 — separate fee schedules for Nursery, Primary, JSS, SS, and Islamiyya
-- Existing class-level fee_structure values remain valid overrides. Section fees are
-- the school-wide defaults used when a class has no class-specific amount.

create table if not exists public.school_section_fees (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  term_id uuid not null references public.terms(id) on delete cascade,
  section text not null check (section in ('nursery','primary','jss','ss','islamiyya')),
  amount numeric(12,2) not null check (amount >= 0),
  updated_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, term_id, section)
);
create index if not exists school_section_fees_term_idx on public.school_section_fees(school_id, term_id, section);
create trigger school_section_fees_touch before update on public.school_section_fees
  for each row execute function app.touch_updated_at();
alter table public.school_section_fees enable row level security;
alter table public.school_section_fees force row level security;
create policy section_fees_read on public.school_section_fees for select to authenticated
  using (app.owns(school_id) and app.is_staff());
create policy section_fees_admin_write on public.school_section_fees for all to authenticated
  using (app.owns(school_id) and app.is_school_admin())
  with check (app.owns(school_id) and app.is_school_admin());

create or replace function app.section_fee_amount(p_school_id uuid, p_class_id uuid, p_term_id uuid)
returns numeric language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(
    (select fs.amount from public.fee_structure fs where fs.school_id=p_school_id and fs.class_id=p_class_id and fs.term_id=p_term_id),
    (select ssf.amount from public.school_section_fees ssf join public.classes c on c.id=p_class_id and c.school_id=ssf.school_id where ssf.school_id=p_school_id and ssf.term_id=p_term_id and ssf.section=c.category::text)
  );
$$;
grant execute on function app.section_fee_amount(uuid,uuid,uuid) to authenticated;

create or replace function app.student_fees_settled(p_student_id uuid, p_term_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select case when fp.waived then true when fp.is_paid_override is not null then fp.is_paid_override else fp.amount_paid >= coalesce(app.section_fee_amount(st.school_id, st.class_id, p_term_id), 0) end from public.fee_payments fp join public.students st on st.id=fp.student_id where fp.student_id=p_student_id and fp.term_id=p_term_id), false);
$$;

grant execute on function app.student_fees_settled(uuid,uuid) to authenticated;

create or replace function public.fee_status_detail(p_student_id uuid, p_term_id uuid)
returns table (out_status text, out_expected numeric, out_paid numeric, out_balance numeric)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_school uuid; v_class uuid; v_expected numeric; fp public.fee_payments%rowtype;
begin
  select st.school_id, st.class_id into v_school, v_class from public.students st where st.id=p_student_id;
  if v_school is null then return; end if;
  if not (p_student_id = app.current_student_id() or p_student_id in (select app.my_children()) or (coalesce(app.owns(v_school),false) and (app.is_school_admin() or app.has_role('bursar','director')))) then raise exception 'Not permitted.' using errcode='42501'; end if;
  v_expected := coalesce(app.section_fee_amount(v_school, v_class, p_term_id),0);
  select * into fp from public.fee_payments f where f.student_id=p_student_id and f.term_id=p_term_id;
  return query select case when fp.id is null then 'unpaid' when fp.waived then 'waived' when fp.is_paid_override is true then 'paid' when fp.is_paid_override is false then case when fp.amount_paid > 0 then 'partial' else 'unpaid' end when fp.amount_paid >= v_expected then 'paid' when fp.amount_paid > 0 then 'partial' else 'unpaid' end, v_expected, coalesce(fp.amount_paid,0), greatest(v_expected-coalesce(fp.amount_paid,0),0);
end $$;
grant execute on function public.fee_status_detail(uuid,uuid) to authenticated;
