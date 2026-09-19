-- Bug found while smoke-testing report cards: recompute_class_term()
-- checked `if not (app.is_platform_admin() or v_school = app.current_school_id()) then raise`.
-- In PL/pgSQL, `IF NULL` takes the ELSE branch — it is not truthy, but
-- it is not "raise" either. When the caller has no resolvable tenant
-- (current_school_id() is null), the comparison `v_school = null` is
-- null, `false OR null` is null, `not null` is null, and the guard
-- silently does nothing instead of blocking the call. app.owns() avoids
-- this with an explicit `p_school_id is not null AND (...)` prefix,
-- which is why every RLS policy uses it — this function should have
-- too, and now does, wrapped in coalesce as a second line of defence.

create or replace function public.recompute_class_term(p_class_id uuid, p_term_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_school uuid;
  v_size   smallint;
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

  select count(*) into v_size
  from public.students st where st.class_id = p_class_id and st.is_active;

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

-- Audit every other SECURITY DEFINER function for the same NULL-bypass
-- shape. app.owns() itself has the same latent gap when current_school_id()
-- is null and p_school_id is non-null: "p_school_id is not null AND
-- (is_platform_admin() OR p_school_id = current_school_id())" -> the
-- OR's right side is null, "false OR null" is null, and the outer AND
-- with a true left side propagates that null. RLS treats a null qual as
-- "deny", which is safe -- but any future PL/pgSQL "IF NOT app.owns(...)"
-- check would inherit today's bug. Close it at the source instead of
-- trusting every call site to remember coalesce().
create or replace function app.owns(p_school_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    p_school_id is not null
    and (app.is_platform_admin() or p_school_id = app.current_school_id()),
    false
  );
$$;
