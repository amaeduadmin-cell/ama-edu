-- ===============================================================
-- AMA EDU 0035 — annual_grade (report-card spec, section 1/3)
--
-- Template 4's annual-summary box needs an "annual grade" letter next
-- to the annual average, the same way overall_grade sits next to
-- average_score. Every other letter grade in this project is computed
-- server-side and stored (app.grade_for(), applied by
-- recompute_class_term() and the app.apply_grade() trigger) rather
-- than derived from grading_bands on the client -- this keeps annual
-- grade consistent with that rule instead of being the one exception.
-- ===============================================================

alter table public.student_term_summary
  add column if not exists annual_grade text;

create or replace function public.recompute_class_term(p_class_id uuid, p_term_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_school uuid; v_size smallint;
  v_session_id uuid; v_this_order smallint; v_max_order smallint;
begin
  select school_id into v_school from public.classes where id = p_class_id;
  if v_school is null then raise exception 'class not found'; end if;
  if not coalesce(app.owns(v_school), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  with ranked as (
    select s.id, rank() over (partition by s.subject_id order by s.total desc) as pos
    from public.student_scores s
    where s.class_id = p_class_id and s.term_id = p_term_id and s.is_offered
  )
  update public.student_scores s set subject_position = r.pos
  from ranked r where r.id = s.id;

  select count(*) into v_size from public.students st
  where st.class_id = p_class_id and st.is_active;

  with agg as (
    select st.id as student_id,
           count(sc.id) filter (where sc.is_offered)  as subjects_count,
           sum(sc.total) filter (where sc.is_offered) as total_score,
           avg(sc.total) filter (where sc.is_offered) as average_score
    from public.students st
    left join public.student_scores sc on sc.student_id = st.id and sc.term_id = p_term_id
    where st.class_id = p_class_id and st.is_active
    group by st.id
  ), positioned as (
    select a.*, rank() over (order by a.average_score desc nulls last) as class_position from agg a
  ), att as (
    select r.student_id,
           count(*) filter (where r.status in ('present','late','excused')) as present,
           count(*) filter (where r.status = 'absent') as absent
    from public.attendance_records r
    join public.attendance_sessions s on s.id = r.attendance_id
    where s.class_id = p_class_id and s.term_id = p_term_id
    group by r.student_id
  )
  insert into public.student_term_summary
    (school_id, student_id, class_id, term_id, subjects_count, total_score,
     average_score, class_position, class_size, overall_grade,
     days_present, days_absent, computed_at)
  select v_school, p.student_id, p_class_id, p_term_id, p.subjects_count,
         round(p.total_score, 2), round(p.average_score, 2),
         case when p.subjects_count > 0 then p.class_position end,
         v_size, app.grade_for(v_school, round(p.average_score, 2)),
         a.present::smallint, a.absent::smallint, now()
  from positioned p
  left join att a on a.student_id = p.student_id
  on conflict (student_id, term_id) do update set
    subjects_count = excluded.subjects_count,
    total_score    = excluded.total_score,
    average_score  = excluded.average_score,
    class_position = excluded.class_position,
    class_size     = excluded.class_size,
    overall_grade  = excluded.overall_grade,
    days_present   = coalesce(excluded.days_present, public.student_term_summary.days_present),
    days_absent    = coalesce(excluded.days_absent,  public.student_term_summary.days_absent),
    computed_at    = now();

  select t.session_id, t.order_index into v_session_id, v_this_order
  from public.terms t where t.id = p_term_id;

  select max(order_index) into v_max_order
  from public.terms where session_id = v_session_id;

  if v_this_order is not null and v_this_order = v_max_order then
    with session_terms as (
      select id from public.terms where session_id = v_session_id
    ), per_student as (
      select sts.student_id, avg(sts.average_score) as ann_avg
      from public.student_term_summary sts
      where sts.term_id in (select id from session_terms)
        and sts.average_score is not null
        and sts.student_id in (
          select id from public.students where class_id = p_class_id and is_active
        )
      group by sts.student_id
    ), ranked as (
      select student_id, ann_avg,
             rank() over (order by ann_avg desc) as ann_pos,
             count(*) over ()::smallint as ann_size
      from per_student
    )
    update public.student_term_summary sts
    set annual_average = round(r.ann_avg, 2),
        annual_position = r.ann_pos,
        annual_position_label = app.ordinal_label(r.ann_pos, r.ann_size),
        annual_grade = app.grade_for(v_school, round(r.ann_avg, 2))
    from ranked r
    where sts.student_id = r.student_id and sts.term_id = p_term_id;
  end if;
end $$;
grant execute on function public.recompute_class_term(uuid, uuid) to authenticated;
