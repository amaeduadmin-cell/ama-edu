-- ===============================================================
-- AMA EDU 0003 — staff, students, parents
--
-- Staff codes and admission numbers are unique WITHIN a school, not
-- globally. That is the fix for MyPAS1's ambiguous login: two schools
-- may both issue "T001" without colliding, because every lookup is
-- keyed on (school_id, identifier).
-- ===============================================================

create table public.staff (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  staff_code    text not null,
  full_name     text not null,
  email         citext,
  phone         text,
  photo_url     text,
  signature_url text,
  position      text,
  qualification text,
  date_joined   date,
  salary_amount numeric(12,2),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (school_id, staff_code)
);
create index staff_school_idx on public.staff (school_id) where is_active;
create index staff_user_idx   on public.staff (user_id);
create trigger staff_touch before update on public.staff
  for each row execute function app.touch_updated_at();

create table public.students (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete set null,
  admission_no   text not null,
  full_name      text not null,
  class_id       uuid references public.classes(id) on delete set null,
  gender         text check (gender in ('male','female')),
  date_of_birth  date,
  photo_url      text,
  guardian_name  text,
  guardian_phone text,
  guardian_email citext,
  address        text,
  date_admitted  date default current_date,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (school_id, admission_no)
);
create index students_school_class_idx on public.students (school_id, class_id) where is_active;
create index students_user_idx on public.students (user_id);
create trigger students_touch before update on public.students
  for each row execute function app.touch_updated_at();

alter table public.classes
  add constraint classes_form_teacher_fk
  foreign key (form_teacher_id) references public.staff(id) on delete set null;

alter table public.school_members
  add constraint school_members_staff_fk
    foreign key (staff_id) references public.staff(id) on delete cascade,
  add constraint school_members_student_fk
    foreign key (student_id) references public.students(id) on delete cascade;

create table public.parents (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  full_name  text not null,
  email      citext,
  phone      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, email)
);
create index parents_school_idx on public.parents (school_id);
create index parents_user_idx   on public.parents (user_id);

-- A parent sees exactly the children linked here, and nothing else.
create table public.parent_students (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  parent_id    uuid not null references public.parents(id)  on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  relationship text,
  created_at   timestamptz not null default now(),
  unique (parent_id, student_id)
);
create index parent_students_school_idx  on public.parent_students (school_id);
create index parent_students_student_idx on public.parent_students (student_id);

-- Teacher is assigned to a class+subject pair. Drives what a plain
-- teacher may enter scores for.
create table public.class_teacher_subjects (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  class_id   uuid not null references public.classes(id)  on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  staff_id   uuid not null references public.staff(id)    on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, subject_id, staff_id)
);
create index cts_school_idx on public.class_teacher_subjects (school_id);
create index cts_staff_idx  on public.class_teacher_subjects (staff_id);

-- May the caller enter scores for this class+subject?
create or replace function app.can_mark(p_class_id uuid, p_subject_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when app.is_school_admin() then true
    when app.has_role('headmaster') then exists (
      select 1 from public.classes c
      where c.id = p_class_id and c.school_id = app.current_school_id()
        and c.category in ('nursery','primary'))
    when app.has_role('principal') then exists (
      select 1 from public.classes c
      where c.id = p_class_id and c.school_id = app.current_school_id()
        and c.category in ('jss','ss'))
    when app.has_role('teacher') then exists (
      select 1 from public.class_teacher_subjects t
      where t.class_id = p_class_id
        and t.subject_id = p_subject_id
        and t.staff_id = app.current_staff_id()
        and t.school_id = app.current_school_id())
    else false
  end;
$$;

grant execute on function app.can_mark(uuid, uuid) to authenticated;
