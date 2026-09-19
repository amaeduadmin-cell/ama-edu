-- student_scores.total is GENERATED ALWAYS ... STORED, and Postgres
-- computes generated columns AFTER before-row triggers run. So
-- new.total was still null when apply_grade() read it and every row
-- was saved with a null grade. Compute the sum in the trigger instead.

create or replace function app.apply_grade()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total numeric;
begin
  v_total := coalesce(new.ca1,0) + coalesce(new.ca2,0) + coalesce(new.ca3,0) + coalesce(new.exam,0);
  new.grade := case when new.is_offered then app.grade_for(new.school_id, v_total) else null end;
  return new;
end $$;

-- Backfill anything already saved without a grade.
update public.student_scores
set grade = case when is_offered then app.grade_for(school_id, total) else null end
where grade is distinct from (case when is_offered then app.grade_for(school_id, total) else null end);
