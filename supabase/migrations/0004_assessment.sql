-- ===============================================================
-- AMA EDU 0004 — scores, summaries, locking
--
-- Grading stays in Postgres, as it did in MyPAS1. The browser never
-- computes a grade, an average or a position, so a tampered client
-- cannot publish a wrong result.
-- ===============================================================

create table public.student_scores (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id)  on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  class_id   uuid not null references public.classes(id)  on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  term_id    uuid not null references public.terms(id)    on delete cascade,
  ca1        numeric(5,2) check (ca1  >= 0 and ca1  <= 100),
  ca2        numeric(5,2) check (ca2  >= 0 and ca2  <= 100),
  ca3        numeric(5,2) check (ca3  >= 0 and ca3  <= 100),
  exam       numeric(5,2) check (exam >= 0 and exam <= 100),
  total      numeric(5,2) generated always as (
               coalesce(ca1,0) + coalesce(ca2,0) + coalesce(ca3,0) + coalesce(exam,0)
             ) stored,
  -- A subject the student does not offer: excluded from the average
  -- rather than counted as zero (MyPAS1's "dead subject" rule).
  is_offered boolean not null default true,
  grade      text,
  subject_position smallint,
  entered_by uuid references public.staff(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (student_id, subject_id, term_id)
);
create index scores_lookup_idx on public.student_scores (school_id, term_id, class_id, subject_id);
create index scores_student_idx on public.student_scores (student_id, term_id);
create trigger scores_touch before update on public.student_scores
  for each row execute function app.touch_updated_at();

create table public.student_term_summary (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id)  on delete cascade,
  student_id     uuid not null references public.students(id) on delete cascade,
  class_id       uuid not null references public.classes(id)  on delete cascade,
  term_id        uuid not null references public.terms(id)    on delete cascade,
  subjects_count smallint,
  total_score    numeric(8,2),
  average_score  numeric(5,2),
  class_position smallint,
  class_size     smallint,
  overall_grade  text,
  teacher_remark text,
  head_remark    text,
  days_present   smallint,
  days_absent    smallint,
  -- Third term only: the annual roll-up across all three terms.
  annual_average numeric(5,2),
  annual_position smallint,
  is_published   boolean not null default false,
  computed_at    timestamptz not null default now(),
  unique (student_id, term_id)
);
create index summary_class_term_idx on public.student_term_summary (school_id, class_id, term_id);

-- Which assessment periods are open for entry, per class+term.
create table public.term_period_windows (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  term_id    uuid not null references public.terms(id)   on delete cascade,
  period     app.score_period not null,
  is_open    boolean not null default true,
  opens_at   timestamptz,
  closes_at  timestamptz,
  unique (term_id, period)
);
create index period_windows_school_idx on public.term_period_windows (school_id);

-- A teacher submits a subject for a period; it locks until released.
create table public.subject_score_locks (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id)  on delete cascade,
  class_id   uuid not null references public.classes(id)  on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  term_id    uuid not null references public.terms(id)    on delete cascade,
  period     app.score_period not null,
  locked     boolean not null default true,
  locked_by  uuid references public.staff(id) on delete set null,
  locked_at  timestamptz not null default now(),
  unique (class_id, subject_id, term_id, period)
);
create index locks_school_idx on public.subject_score_locks (school_id, term_id);

create table public.score_unlock_requests (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id)  on delete cascade,
  class_id    uuid not null references public.classes(id)  on delete cascade,
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  term_id     uuid not null references public.terms(id)    on delete cascade,
  period      app.score_period not null,
  requested_by uuid references public.staff(id) on delete set null,
  reason      text,
  status      text not null default 'pending' check (status in ('pending','approved','declined')),
  resolved_by uuid references public.staff(id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index unlock_requests_school_idx on public.score_unlock_requests (school_id, status);

-- ---------------------------------------------------------------
-- Grading: assign a grade from the school's own bands.
-- ---------------------------------------------------------------
create or replace function app.grade_for(p_school_id uuid, p_total numeric)
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select g.grade from public.grading_bands g
  where g.school_id = p_school_id
    and p_total >= g.min_score and p_total <= g.max_score
  order by g.sort_order limit 1;
$$;

create or replace function app.apply_grade()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.grade := case when new.is_offered then app.grade_for(new.school_id, new.total) else null end;
  return new;
end $$;

create trigger scores_grade before insert or update on public.student_scores
  for each row execute function app.apply_grade();

-- ---------------------------------------------------------------
-- Recompute a class+term: subject positions, averages, class positions.
-- Standard competition ranking (1,2,2,4), matching MyPAS1's output.
-- ---------------------------------------------------------------
create or replace function public.recompute_class_term(p_class_id uuid, p_term_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_school uuid;
  v_size   smallint;
begin
  select school_id into v_school from public.classes where id = p_class_id;
  if v_school is null then raise exception 'class not found'; end if;

  if not (app.is_platform_admin() or v_school = app.current_school_id()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- per-subject position within the class
  with ranked as (
    select s.id, rank() over (partition by s.subject_id order by s.total desc) as pos
    from public.student_scores s
    where s.class_id = p_class_id and s.term_id = p_term_id and s.is_offered
  )
  update public.student_scores s set subject_position = r.pos
  from ranked r where r.id = s.id;

  select count(*) into v_size
  from public.students st where st.class_id = p_class_id and st.is_active;

  -- per-student totals, excluding subjects not offered
  with agg as (
    select st.id as student_id,
           count(sc.id) filter (where sc.is_offered)      as subjects_count,
           sum(sc.total) filter (where sc.is_offered)     as total_score,
           avg(sc.total) filter (where sc.is_offered)     as average_score
    from public.students st
    left join public.student_scores sc
      on sc.student_id = st.id and sc.term_id = p_term_id
    where st.class_id = p_class_id and st.is_active
    group by st.id
  ), positioned as (
    select a.*, rank() over (order by a.average_score desc nulls last) as class_position
    from agg a
  )
  insert into public.student_term_summary
    (school_id, student_id, class_id, term_id, subjects_count, total_score,
     average_score, class_position, class_size, overall_grade, computed_at)
  select v_school, p.student_id, p_class_id, p_term_id, p.subjects_count,
         round(p.total_score, 2), round(p.average_score, 2),
         case when p.subjects_count > 0 then p.class_position end,
         v_size, app.grade_for(v_school, round(p.average_score, 2)), now()
  from positioned p
  on conflict (student_id, term_id) do update set
    subjects_count = excluded.subjects_count,
    total_score    = excluded.total_score,
    average_score  = excluded.average_score,
    class_position = excluded.class_position,
    class_size     = excluded.class_size,
    overall_grade  = excluded.overall_grade,
    computed_at    = now();
end $$;

grant execute on function public.recompute_class_term(uuid, uuid) to authenticated;
grant execute on function app.grade_for(uuid, numeric) to authenticated;
