-- ===============================================================
-- AMA EDU 0032 — the Director could not actually read the school
--
-- 0026 gave the Director the overview RPCs and read access to scores,
-- attendance, assessments and the audit log, but the base people and
-- money tables (staff, students, parents, fee_payments, announcements)
-- are guarded by app.is_staff(), which deliberately excludes the
-- Director so that they cannot write. Result: the dashboard's staff
-- list came back empty. Found while checking the Director's pages
-- against the policies they depend on.
--
-- Each policy below is SELECT-only. The Director gains no INSERT,
-- UPDATE or DELETE on any of these tables; the single controlled write
-- they have remains public.set_staff_active().
-- ===============================================================

create policy staff_director_read on public.staff
  for select to authenticated using (app.owns(school_id) and app.has_role('director'));
create policy students_director_read on public.students
  for select to authenticated using (app.owns(school_id) and app.has_role('director'));
create policy parents_director_read on public.parents
  for select to authenticated using (app.owns(school_id) and app.has_role('director'));
create policy parent_students_director_read on public.parent_students
  for select to authenticated using (app.owns(school_id) and app.has_role('director'));
create policy fee_payments_director_read on public.fee_payments
  for select to authenticated using (app.owns(school_id) and app.has_role('director'));
create policy announcements_director_read on public.announcements
  for select to authenticated using (app.owns(school_id) and app.has_role('director'));

-- "Performance overview": one row per class for the active term.
create or replace function public.director_class_performance()
returns table (out_class text, out_students bigint, out_average numeric, out_status text)
language sql stable security definer set search_path = public, pg_temp as $$
  with t as (select id from public.terms where school_id = app.current_school_id() and is_active limit 1)
  select c.name,
         (select count(*) from public.students st where st.class_id = c.id and st.is_active),
         (select round(avg(s.average_score), 1) from public.student_term_summary s
           where s.class_id = c.id and s.term_id = (select id from t)),
         coalesce((select rp.status from public.result_publications rp
                    where rp.class_id = c.id and rp.term_id = (select id from t)), 'draft')
  from public.classes c
  where c.school_id = app.current_school_id() and c.is_active and app.is_reader()
  order by c.sort_order;
$$;
grant execute on function public.director_class_performance() to authenticated;
