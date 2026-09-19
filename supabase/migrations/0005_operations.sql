-- ===============================================================
-- AMA EDU 0005 — fees, timetable, announcements, awards, audit
-- ===============================================================

create table public.fee_structure (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  class_id   uuid not null references public.classes(id) on delete cascade,
  term_id    uuid not null references public.terms(id)   on delete cascade,
  amount     numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (class_id, term_id)
);
create index fee_structure_school_idx on public.fee_structure (school_id, term_id);

create table public.fee_payments (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id)  on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  term_id     uuid not null references public.terms(id)    on delete cascade,
  amount_paid numeric(12,2) not null default 0 check (amount_paid >= 0),
  -- Explicit override, three-valued on purpose. MyPAS1 treated "no row"
  -- as paid, which let unpaid students collect report cards; here the
  -- absence of a row means unpaid and is_paid_override only ever
  -- overrides deliberately.
  is_paid_override boolean,
  method      text,
  reference   text,
  note        text,
  recorded_by uuid references public.staff(id) on delete set null,
  paid_on     date default current_date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (student_id, term_id)
);
create index fee_payments_school_idx on public.fee_payments (school_id, term_id);
create trigger fee_payments_touch before update on public.fee_payments
  for each row execute function app.touch_updated_at();

-- Fail CLOSED: no payment row means not paid.
create or replace function app.student_fees_settled(p_student_id uuid, p_term_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case
      when fp.is_paid_override is not null then fp.is_paid_override
      else fp.amount_paid >= coalesce((
        select fs.amount from public.fee_structure fs
        join public.students st on st.id = p_student_id
        where fs.class_id = st.class_id and fs.term_id = p_term_id), 0)
      end
    from public.fee_payments fp
    where fp.student_id = p_student_id and fp.term_id = p_term_id
  ), false);
$$;
grant execute on function app.student_fees_settled(uuid, uuid) to authenticated;

-- ---------------- timetable ----------------
create table public.timetables (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  class_id   uuid not null references public.classes(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, session_id)
);
create index timetables_school_idx on public.timetables (school_id);

create table public.timetable_slots (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id)    on delete cascade,
  timetable_id uuid not null references public.timetables(id) on delete cascade,
  day_of_week  smallint not null check (day_of_week between 1 and 7),
  period_index smallint not null check (period_index between 1 and 20),
  starts_at    time,
  ends_at      time,
  subject_id   uuid references public.subjects(id) on delete set null,
  staff_id     uuid references public.staff(id)    on delete set null,
  label        text,
  unique (timetable_id, day_of_week, period_index)
);
create index slots_school_idx on public.timetable_slots (school_id);
-- A teacher cannot be in two rooms at once, within one school.
create unique index slots_no_double_booking
  on public.timetable_slots (school_id, staff_id, day_of_week, period_index)
  where staff_id is not null;

-- ---------------- announcements ----------------
create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  title        text not null,
  body         text not null,
  audience     text not null default 'all'
                 check (audience in ('all','staff','students','parents','class')),
  class_id     uuid references public.classes(id) on delete cascade,
  is_pinned    boolean not null default false,
  published_at timestamptz not null default now(),
  expires_at   timestamptz,
  created_by   uuid references public.staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (audience <> 'class' or class_id is not null)
);
create index announcements_school_idx on public.announcements (school_id, published_at desc);

create table public.announcement_reads (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  read_at         timestamptz not null default now(),
  unique (announcement_id, user_id)
);
create index announcement_reads_school_idx on public.announcement_reads (school_id);

-- ---------------- awards / certificates ----------------
create table public.awards (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id)  on delete cascade,
  student_id  uuid references public.students(id) on delete cascade,
  staff_id    uuid references public.staff(id)    on delete cascade,
  term_id     uuid references public.terms(id)    on delete set null,
  kind        text not null,
  title       text not null,
  note        text,
  awarded_on  date default current_date,
  created_at  timestamptz not null default now(),
  check (student_id is not null or staff_id is not null)
);
create index awards_school_idx on public.awards (school_id);

create table public.school_websites (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  label      text not null,
  url        text not null,
  username   text,
  note       text,
  created_at timestamptz not null default now()
);
create index school_websites_school_idx on public.school_websites (school_id);

-- ---------------- audit ----------------
create table public.audit_log (
  id         bigserial primary key,
  school_id  uuid references public.schools(id) on delete set null,
  user_id    uuid,
  action     text not null,
  entity     text,
  entity_id  uuid,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index audit_school_idx on public.audit_log (school_id, created_at desc);
