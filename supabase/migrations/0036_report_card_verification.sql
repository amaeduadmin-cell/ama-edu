-- ===============================================================
-- AMA EDU 0036 — report card QR verification (spec section 4)
--
-- A forgery-check, not a results viewer: report_card_verifications
-- links a short random code to a student+term. The only public-facing
-- surface is verify_report_card(), which returns first name + last
-- initial, class, term and an "issued" flag -- never a score, full
-- name or admission number. Same narrowness spirit as
-- public.public_school_profile() (migration 0026).
--
-- Trap-check done: no new object here is called from a service_role
-- client -- get_or_create_report_verification() is called by the
-- report-card pages (report-cards.js, my-report.js) as `authenticated`,
-- and verify_report_card() is the one deliberately anon-callable RPC.
-- Neither goes through an Edge Function, so no service_role grant
-- applies. All writes happen inside the SECURITY DEFINER function
-- (which runs as the table owner and so isn't blocked by RLS) --
-- authenticated clients get SELECT only, never INSERT/UPDATE/DELETE,
-- on the table itself.
-- ===============================================================

create table public.report_card_verifications (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references public.schools(id)  on delete cascade,
  student_id        uuid not null references public.students(id) on delete cascade,
  term_id           uuid not null references public.terms(id)    on delete cascade,
  verification_code text not null,
  issued_at         timestamptz not null default now(),
  unique (student_id, term_id),
  unique (verification_code)
);
create index report_card_verifications_school_idx on public.report_card_verifications (school_id);

alter table public.report_card_verifications enable row level security;
grant select on public.report_card_verifications to authenticated;

create policy report_card_verifications_staff_read on public.report_card_verifications
  for select to authenticated using (app.owns(school_id) and app.is_reader());

create policy report_card_verifications_student_read on public.report_card_verifications
  for select to authenticated using (
    app.owns(school_id) and student_id = app.current_student_id()
    and app.student_result_visible(student_id, term_id)
  );

create policy report_card_verifications_parent_read on public.report_card_verifications
  for select to authenticated using (
    app.owns(school_id) and student_id in (select app.my_children())
    and app.student_result_visible(student_id, term_id)
  );

-- Fetch-or-create: same student+term always gets the same code, so
-- reopening/reprinting a report never mints a new one. Callable by
-- anyone who could already see this report (staff via is_reader(),
-- or the student/parent once app.student_result_visible() is true) --
-- issuing a code is gated the same as reading the report it points to.
create or replace function public.get_or_create_report_verification(p_student_id uuid, p_term_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_school   uuid;
  v_code     text;
  v_existing text;
  -- No 0/O/1/I -- a code that gets misread off a printed card is worse
  -- than a slightly smaller alphabet.
  v_chars    text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  select school_id into v_school from public.students where id = p_student_id;
  if v_school is null then raise exception 'student not found'; end if;

  if not (
    (coalesce(app.owns(v_school), false) and app.is_reader())
    or app.student_result_visible(p_student_id, p_term_id)
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select verification_code into v_existing
  from public.report_card_verifications
  where student_id = p_student_id and term_id = p_term_id;
  if v_existing is not null then return v_existing; end if;

  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    begin
      insert into public.report_card_verifications (school_id, student_id, term_id, verification_code)
      values (v_school, p_student_id, p_term_id, v_code);
      return v_code;
    exception when unique_violation then
      -- Either a concurrent call already created this student+term's
      -- row (common case), or -- astronomically unlikely at 8 chars
      -- from a 32-symbol alphabet -- the code itself collided.
      select verification_code into v_existing
      from public.report_card_verifications
      where student_id = p_student_id and term_id = p_term_id;
      if v_existing is not null then return v_existing; end if;
      -- genuine code collision: loop and generate a fresh one
    end;
  end loop;
end $$;
grant execute on function public.get_or_create_report_verification(uuid, uuid) to authenticated;

-- The anon-callable check. Deliberately returns nothing when the code
-- doesn't match, rather than a found:false row, so a brute-force
-- guesser learns nothing beyond "no".
create or replace function public.verify_report_card(p_code text)
returns table (
  first_name text, last_initial text, class_name text,
  term_label text, session_label text, issued boolean, issued_at date
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    split_part(btrim(st.full_name), ' ', 1) as first_name,
    left(coalesce(nullif(split_part(btrim(st.full_name), ' ', 2), ''), ''), 1) as last_initial,
    c.name as class_name,
    t.label as term_label,
    ses.label as session_label,
    app.results_published(coalesce(sts.class_id, st.class_id), v.term_id) as issued,
    v.issued_at::date as issued_at
  from public.report_card_verifications v
  join public.students st on st.id = v.student_id
  join public.terms t     on t.id = v.term_id
  join public.sessions ses on ses.id = t.session_id
  left join public.student_term_summary sts on sts.student_id = v.student_id and sts.term_id = v.term_id
  left join public.classes c on c.id = coalesce(sts.class_id, st.class_id)
  where v.verification_code = upper(btrim(p_code));
$$;
grant execute on function public.verify_report_card(text) to anon, authenticated;
