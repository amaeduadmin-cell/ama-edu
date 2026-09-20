-- ===============================================================
-- AMA EDU 0020 — result publication, enforced in the database
--
-- THE BUG THIS FIXES: results became visible to students and parents
-- the moment a score row existed. The student/parent policies on
-- student_scores and student_term_summary checked only the fee gate;
-- student_term_summary.is_published existed but nothing read it. So a
-- teacher halfway through entering CA2 was publishing, unknowingly.
--
-- THE MODEL: publication is per class + term, with three states:
--     draft  -> ready -> published
-- Only an authorised administrator (admin, headmaster, principal, or a
-- teacher the school has explicitly permitted) may publish. Students
-- and parents can read a result only when BOTH:
--     the class+term is published, AND
--     the school's fee policy allows it for that student.
-- Enforced in RLS, so it holds against a direct Supabase API call.
-- ===============================================================

create table if not exists public.result_publications (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade
                  default app.current_school_id(),
  class_id      uuid not null references public.classes(id) on delete cascade,
  term_id       uuid not null references public.terms(id)   on delete cascade,
  status        text not null default 'draft'
                  check (status in ('draft','ready','published')),
  readied_by    uuid references public.staff(id) on delete set null,
  readied_at    timestamptz,
  published_by  uuid references public.staff(id) on delete set null,
  published_at  timestamptz,
  unpublished_by uuid references public.staff(id) on delete set null,
  unpublished_at timestamptz,
  note          text,
  updated_at    timestamptz not null default now(),
  unique (class_id, term_id)
);
create index if not exists result_pub_lookup_idx on public.result_publications (school_id, term_id, status);

comment on table public.result_publications is
  'One row per class+term. Students and parents see results only when status = published.';

-- Whether ordinary teachers may publish. Off by default: the spec says
-- a teacher must not publish final results unless explicitly allowed.
alter table public.schools add column if not exists teachers_may_publish boolean not null default false;

-- ---------------- the gate ----------------
create or replace function app.results_published(p_class_id uuid, p_term_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select rp.status = 'published'
                   from public.result_publications rp
                   where rp.class_id = p_class_id and rp.term_id = p_term_id), false);
$$;
grant execute on function app.results_published(uuid, uuid) to authenticated;

-- A student's own class is read from their record, never from the row
-- being tested, so moving a student between classes cannot expose an
-- unpublished result.
create or replace function app.student_result_visible(p_student_id uuid, p_term_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select app.results_published(st.class_id, p_term_id) from public.students st where st.id = p_student_id)
    and app.report_visible(p_student_id, p_term_id),
  false);
$$;
grant execute on function app.student_result_visible(uuid, uuid) to authenticated;

-- ---------------- rebuild the student/parent read policies ----------------
drop policy if exists scores_student_read  on public.student_scores;
drop policy if exists scores_parent_read   on public.student_scores;
drop policy if exists summary_student_read on public.student_term_summary;
drop policy if exists summary_parent_read  on public.student_term_summary;

create policy scores_student_read on public.student_scores
  for select to authenticated
  using (app.owns(school_id) and student_id = app.current_student_id()
         and app.student_result_visible(student_id, term_id));

create policy scores_parent_read on public.student_scores
  for select to authenticated
  using (app.owns(school_id) and student_id in (select app.my_children())
         and app.student_result_visible(student_id, term_id));

create policy summary_student_read on public.student_term_summary
  for select to authenticated
  using (app.owns(school_id) and student_id = app.current_student_id()
         and app.student_result_visible(student_id, term_id));

create policy summary_parent_read on public.student_term_summary
  for select to authenticated
  using (app.owns(school_id) and student_id in (select app.my_children())
         and app.student_result_visible(student_id, term_id));

-- Staff and the director may read their own school's results as before.
drop policy if exists summary_staff_read on public.student_term_summary;
create policy summary_staff_read on public.student_term_summary
  for select to authenticated using (app.owns(school_id) and app.is_reader());
drop policy if exists scores_staff_read on public.student_scores;
create policy scores_staff_read on public.student_scores
  for select to authenticated using (app.owns(school_id) and app.is_reader());

-- A published result must not keep changing underneath the students
-- looking at it. Scores are writable only while the class+term is not
-- published (an administrator can unpublish to correct something).
drop policy if exists scores_write on public.student_scores;
create policy scores_write on public.student_scores
  for all to authenticated
  using (app.owns(school_id) and app.can_mark(class_id, subject_id))
  with check (app.owns(school_id) and app.can_mark(class_id, subject_id)
              and (app.is_school_admin() or not app.results_published(class_id, term_id)));

-- ---------------- the workflow ----------------
create or replace function app.may_publish_results()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_school_admin()
      or app.has_role('headmaster','principal')
      or (app.has_role('teacher') and coalesce(
            (select s.teachers_may_publish from public.schools s where s.id = app.current_school_id()), false));
$$;
grant execute on function app.may_publish_results() to authenticated;

create or replace function public.set_result_status(p_class_id uuid, p_term_id uuid, p_status text, p_note text default null)
returns table (status text, published_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_school uuid; v_staff uuid := app.current_staff_id(); v_missing int;
begin
  if p_status not in ('draft','ready','published') then
    raise exception 'Unknown result status "%".', p_status using errcode = '22023';
  end if;

  select c.school_id into v_school from public.classes c where c.id = p_class_id;
  if v_school is null or not coalesce(app.owns(v_school), false) then
    raise exception 'That class was not found.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.terms t where t.id = p_term_id and t.school_id = v_school) then
    raise exception 'That term does not belong to this school.' using errcode = '42501';
  end if;

  -- Moving to ready or published is a privileged act; moving back to
  -- draft (unpublishing) is administrators only.
  if p_status = 'published' and not app.may_publish_results() then
    raise exception 'You do not have permission to publish results.' using errcode = '42501';
  end if;
  if p_status = 'draft' and not (app.is_school_admin() or app.has_role('headmaster','principal')) then
    raise exception 'You do not have permission to unpublish results.' using errcode = '42501';
  end if;
  if p_status = 'ready' and not app.is_staff() then
    raise exception 'You do not have permission to change result status.' using errcode = '42501';
  end if;

  -- Publishing recomputes first, so positions and averages on a
  -- published report are never stale.
  if p_status = 'published' then
    select count(*) into v_missing
    from public.students st where st.class_id = p_class_id and st.is_active
      and not exists (select 1 from public.student_scores sc
                      where sc.student_id = st.id and sc.term_id = p_term_id);
    perform public.recompute_class_term(p_class_id, p_term_id);
  end if;

  insert into public.result_publications as rp
    (school_id, class_id, term_id, status, note,
     readied_by,   readied_at,
     published_by, published_at,
     unpublished_by, unpublished_at, updated_at)
  values (v_school, p_class_id, p_term_id, p_status, p_note,
     case when p_status = 'ready'     then v_staff end, case when p_status = 'ready'     then now() end,
     case when p_status = 'published' then v_staff end, case when p_status = 'published' then now() end,
     case when p_status = 'draft'     then v_staff end, case when p_status = 'draft'     then now() end,
     now())
  on conflict (class_id, term_id) do update set
    status         = excluded.status,
    note           = coalesce(excluded.note, rp.note),
    readied_by     = coalesce(excluded.readied_by,     rp.readied_by),
    readied_at     = coalesce(excluded.readied_at,     rp.readied_at),
    published_by   = coalesce(excluded.published_by,   rp.published_by),
    published_at   = case when excluded.status = 'published' then now() else rp.published_at end,
    unpublished_by = coalesce(excluded.unpublished_by, rp.unpublished_by),
    unpublished_at = case when excluded.status = 'draft' then now() else rp.unpublished_at end,
    updated_at     = now();

  -- student_term_summary.is_published is kept in step so existing code
  -- reading that flag stays correct.
  update public.student_term_summary s set is_published = (p_status = 'published')
  where s.class_id = p_class_id and s.term_id = p_term_id;

  perform app.write_audit(v_school,
    case p_status when 'published' then 'results.published'
                  when 'draft'     then 'results.unpublished'
                  else 'results.ready' end,
    'result_publications', p_class_id,
    jsonb_build_object('term_id', p_term_id, 'status', p_status,
                       'students_without_scores', coalesce(v_missing, 0), 'note', p_note));

  return query
    select rp2.status, rp2.published_at from public.result_publications rp2
    where rp2.class_id = p_class_id and rp2.term_id = p_term_id;
end $$;
grant execute on function public.set_result_status(uuid, uuid, text, text) to authenticated;

-- What staff see on the publication screen: one row per class for a
-- term, with entry progress so nobody publishes a half-entered class
-- by accident.
create or replace function public.result_publication_overview(p_term_id uuid)
returns table (class_id uuid, class_name text, category text, status text,
               students bigint, students_with_scores bigint, expected_subjects bigint,
               published_at timestamptz)
language sql stable security invoker set search_path = public, pg_temp as $$
  select c.id, c.name, c.category::text,
         coalesce(rp.status, 'draft'),
         (select count(*) from public.students st where st.class_id = c.id and st.is_active),
         (select count(distinct sc.student_id) from public.student_scores sc
           where sc.class_id = c.id and sc.term_id = p_term_id),
         (select count(*) from public.class_subjects cs where cs.class_id = c.id),
         rp.published_at
  from public.classes c
  left join public.result_publications rp on rp.class_id = c.id and rp.term_id = p_term_id
  where c.is_active and app.section_enabled(c.school_id, c.category)
  order by c.sort_order, c.name;
$$;
grant execute on function public.result_publication_overview(uuid) to authenticated;

-- A student or parent asking "where is my result?" deserves a straight
-- answer rather than an empty table. This returns the REASON only --
-- never any score.
create or replace function public.my_result_availability(p_student_id uuid, p_term_id uuid)
returns table (available boolean, reason text, message text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_class uuid; v_school uuid; v_status text; v_fees boolean; v_blocks boolean;
begin
  select st.class_id, st.school_id into v_class, v_school
  from public.students st where st.id = p_student_id;
  if v_class is null then return; end if;

  -- Only the student themselves, their parent, or school staff may ask.
  if not (p_student_id = app.current_student_id()
          or p_student_id in (select app.my_children())
          or (coalesce(app.owns(v_school), false) and app.is_reader())) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select coalesce(rp.status, 'draft') into v_status
  from public.result_publications rp
  where rp.class_id = v_class and rp.term_id = p_term_id;
  v_status := coalesce(v_status, 'draft');

  select s.block_report_on_unpaid_fees into v_blocks from public.schools s where s.id = v_school;
  v_fees := app.student_fees_settled(p_student_id, p_term_id);

  if v_status <> 'published' then
    return query select false, 'not_published',
      'This term''s report card has not been released yet. Your school will publish it once all results have been checked.';
  elsif v_blocks and not v_fees then
    return query select false, 'fees_outstanding',
      'Your result is currently unavailable because the school''s fee policy requires fees to be settled. Please contact the school bursary.';
  else
    return query select true, 'available', null::text;
  end if;
end $$;
grant execute on function public.my_result_availability(uuid, uuid) to authenticated;

-- ---------------- RLS on the publication table ----------------
alter table public.result_publications enable row level security;
alter table public.result_publications force row level security;

-- Readable by staff, and by a student/parent for their own class, so
-- the portal can show "Draft / Released" honestly. It carries no scores.
create policy result_pub_staff_read on public.result_publications
  for select to authenticated using (app.owns(school_id) and app.is_reader());

create policy result_pub_own_read on public.result_publications
  for select to authenticated
  using (app.owns(school_id) and class_id in (
    select st.class_id from public.students st
    where st.id = app.current_student_id() or st.id in (select app.my_children())));

-- No direct writes: status changes go through set_result_status(),
-- which is where the permission rules and the audit trail live.
revoke insert, update, delete on public.result_publications from authenticated;
grant select on public.result_publications to authenticated;

-- ---------------- backfill ----------------
-- Existing classes with scores already entered are marked DRAFT, not
-- published: after this migration nothing is visible to students until
-- a school deliberately publishes it. That is the intended behaviour
-- change, and the reason this is called out in the deploy notes.
insert into public.result_publications (school_id, class_id, term_id, status)
select distinct sc.school_id, sc.class_id, sc.term_id, 'draft'
from public.student_scores sc
on conflict (class_id, term_id) do nothing;

update public.student_term_summary set is_published = false where is_published;
