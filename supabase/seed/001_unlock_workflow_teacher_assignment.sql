-- AMA EDU test seed: teacher-subject assignment for unlock workflow
--
-- This script does not create users, teachers, classes, subjects, or students.
-- It selects existing active records from the same school and inserts only the
-- missing class/subject assignment. Review the selected row before COMMIT.
-- Run in a non-production project where possible.

begin;

with candidate as (
  select
    sm.school_id,
    sm.staff_id,
    c.id as class_id,
    sub.id as subject_id
  from public.school_members sm
  join lateral (
    select c.id
    from public.classes c
    where c.school_id = sm.school_id
      and c.is_active
      and exists (
        select 1
        from public.students st
        where st.school_id = c.school_id
          and st.class_id = c.id
          and st.is_active
      )
    order by c.name, c.id
    limit 1
  ) c on true
  join lateral (
    select sub.id
    from public.subjects sub
    where sub.school_id = sm.school_id
      and coalesce(sub.is_active, true)
    order by sub.name, sub.id
    limit 1
  ) sub on true
  where sm.role = 'teacher'
    and sm.is_active
  order by sm.school_id, sm.staff_id
  limit 1
)
insert into public.class_teacher_subjects (school_id, class_id, subject_id, staff_id)
select school_id, class_id, subject_id, staff_id
from candidate
on conflict (class_id, subject_id, staff_id) do nothing;

-- Review the assignment and its available affected student before committing.
select
  cts.school_id,
  cts.staff_id,
  stf.full_name as teacher_name,
  cts.class_id,
  c.name as class_name,
  cts.subject_id,
  sub.name as subject_name,
  student.id as sample_student_id,
  student.full_name as sample_student_name
from public.class_teacher_subjects cts
join public.staff stf on stf.id = cts.staff_id
join public.classes c on c.id = cts.class_id
join public.subjects sub on sub.id = cts.subject_id
left join lateral (
  select st.id, st.full_name
  from public.students st
  where st.school_id = cts.school_id
    and st.class_id = cts.class_id
    and st.is_active
  order by st.admission_no, st.id
  limit 1
) student on true
where cts.id = (
  select cts2.id
  from public.class_teacher_subjects cts2
  join public.school_members sm on sm.school_id = cts2.school_id and sm.staff_id = cts2.staff_id
  where sm.role = 'teacher' and sm.is_active
  order by cts2.created_at desc, cts2.id desc
  limit 1
);

-- Change COMMIT to ROLLBACK if the review row is not the intended fixture.
commit;
