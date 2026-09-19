-- ===============================================================
-- AMA EDU 0002 — academic structure
-- Everything here is per school. Two schools may both have "JSS 1",
-- both have a subject called "Mathematics", and neither can see the
-- other's. Uniqueness is always scoped by school_id.
-- ===============================================================

create table public.sessions (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  label      text not null,                       -- e.g. 2025/2026
  starts_on  date,
  ends_on    date,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (school_id, label)
);
create index sessions_school_idx on public.sessions (school_id);

create table public.terms (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  label       text not null,                      -- First / Second / Third
  order_index smallint not null check (order_index between 1 and 6),
  starts_on   date,
  ends_on     date,
  next_term_starts_on date,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (session_id, order_index)
);
create index terms_school_idx  on public.terms (school_id);
create index terms_active_idx  on public.terms (school_id) where is_active;

-- Exactly one active term per school.
create unique index terms_one_active_per_school
  on public.terms (school_id) where is_active;

create table public.classes (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  name       text not null,
  category   app.class_category not null default 'primary',
  sort_order smallint not null default 0,
  is_graduating boolean not null default false,   -- testimonials only
  form_teacher_id uuid,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name)
);
create index classes_school_idx on public.classes (school_id, sort_order);
create trigger classes_touch before update on public.classes
  for each row execute function app.touch_updated_at();

create table public.subjects (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  name       text not null,
  code       text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);
create index subjects_school_idx on public.subjects (school_id);

-- Which classes offer which subjects.
create table public.class_subjects (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  class_id   uuid not null references public.classes(id)  on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, subject_id)
);
create index class_subjects_school_idx on public.class_subjects (school_id);

-- Grading bands, per school. MyPAS1 hardcoded one school's scale; this
-- lets each school set its own boundaries, remarks and pass mark.
create table public.grading_bands (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  grade      text not null,
  min_score  numeric(5,2) not null check (min_score >= 0   and min_score <= 100),
  max_score  numeric(5,2) not null check (max_score >= 0   and max_score <= 100),
  remark     text,
  is_pass    boolean not null default true,
  sort_order smallint not null default 0,
  check (max_score >= min_score),
  unique (school_id, grade)
);
create index grading_bands_school_idx on public.grading_bands (school_id, sort_order);

-- Max obtainable per assessment period, per school.
create table public.score_weights (
  school_id uuid primary key references public.schools(id) on delete cascade,
  ca1_max   numeric(5,2) not null default 20,
  ca2_max   numeric(5,2) not null default 20,
  ca3_max   numeric(5,2) not null default 20,
  exam_max  numeric(5,2) not null default 40,
  check (ca1_max + ca2_max + ca3_max + exam_max = 100)
);
