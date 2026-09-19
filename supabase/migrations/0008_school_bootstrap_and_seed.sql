-- ===============================================================
-- AMA EDU 0008 — new-school defaults, and the first two tenants
--
-- bootstrap_school_defaults() is what the register-school Edge
-- Function calls, so every school that registers starts with a
-- session, three terms, a grading scale, classes and a curriculum
-- instead of an empty portal.
-- ===============================================================

create or replace function app.bootstrap_school_defaults(p_school_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_session uuid;
  v_year    int := extract(year from current_date);
  v_label   text;
  r         record;
begin
  v_label := v_year || '/' || (v_year + 1);

  insert into public.sessions (school_id, label, is_current)
  values (p_school_id, v_label, true)
  on conflict (school_id, label) do nothing
  returning id into v_session;

  if v_session is null then
    select id into v_session from public.sessions
    where school_id = p_school_id and label = v_label;
  end if;

  insert into public.terms (school_id, session_id, label, order_index, is_active)
  values (p_school_id, v_session, 'First',  1, true),
         (p_school_id, v_session, 'Second', 2, false),
         (p_school_id, v_session, 'Third',  3, false)
  on conflict (session_id, order_index) do nothing;

  insert into public.score_weights (school_id) values (p_school_id)
  on conflict (school_id) do nothing;

  insert into public.grading_bands (school_id, grade, min_score, max_score, remark, is_pass, sort_order)
  values (p_school_id, 'A', 70, 100, 'Excellent',  true,  1),
         (p_school_id, 'B', 60, 69.99, 'Very good', true,  2),
         (p_school_id, 'C', 50, 59.99, 'Good',      true,  3),
         (p_school_id, 'D', 45, 49.99, 'Fair',      true,  4),
         (p_school_id, 'E', 40, 44.99, 'Pass',      true,  5),
         (p_school_id, 'F',  0, 39.99, 'Fail',      false, 6)
  on conflict (school_id, grade) do nothing;

  for r in
    select * from (values
      ('Nursery 1','nursery',10),('Nursery 2','nursery',20),('Nursery 3','nursery',30),
      ('Primary 1','primary',40),('Primary 2','primary',50),('Primary 3','primary',60),
      ('Primary 4','primary',70),('Primary 5','primary',80),('Primary 6','primary',90),
      ('JSS 1','jss',100),('JSS 2','jss',110),('JSS 3','jss',120),
      ('SS 1','ss',130),('SS 2','ss',140),('SS 3','ss',150)
    ) as c(name, category, sort_order)
  loop
    insert into public.classes (school_id, name, category, sort_order, is_graduating)
    values (p_school_id, r.name, r.category::app.class_category, r.sort_order,
            r.name in ('Primary 6','JSS 3','SS 3'))
    on conflict (school_id, name) do nothing;
  end loop;

  insert into public.subjects (school_id, name)
  select p_school_id, s from unnest(array[
    'English Language','Mathematics','Basic Science','Basic Technology',
    'Social Studies','Civic Education','Agricultural Science',
    'Computer Studies','Business Studies','Home Economics',
    'Physical & Health Education','Creative & Cultural Arts',
    'Hausa Language','Islamic Religious Studies','Qur''an','Arabic'
  ]) as s
  on conflict (school_id, name) do nothing;

  -- Every class offers the core list to begin with; schools trim it
  -- from Curriculum rather than starting from nothing.
  insert into public.class_subjects (school_id, class_id, subject_id)
  select p_school_id, c.id, sub.id
  from public.classes c
  cross join public.subjects sub
  where c.school_id = p_school_id and sub.school_id = p_school_id
    and sub.name in ('English Language','Mathematics','Basic Science',
                     'Social Studies','Civic Education','Hausa Language',
                     'Islamic Religious Studies','Qur''an')
  on conflict (class_id, subject_id) do nothing;
end $$;

-- ---------------------------------------------------------------
-- The first two tenants.
-- ---------------------------------------------------------------
do $$
declare v_pas uuid; v_pcp uuid;
begin
  insert into public.schools (name, slug, short_name, motto, school_type, status,
                              primary_color, secondary_color, email, address)
  values ('Pariya Academy for Modern Science & Qur''an', 'pas', 'Pariya Academy',
          'Knowledge, character, service', 'combined', 'active',
          '#0f6b3f', '#b8862b', 'info@pariyaacademy.ng', NULL)
  on conflict (slug) do nothing
  returning id into v_pas;
  if v_pas is null then select id into v_pas from public.schools where slug = 'pas'; end if;

  insert into public.schools (name, slug, short_name, motto, school_type, status,
                              primary_color, secondary_color)
  values ('Pariya Central Primary', 'pcp', 'Pariya Central',
          'Start strong, grow further', 'nursery_primary', 'active',
          '#1d4ed8', '#b8862b')
  on conflict (slug) do nothing
  returning id into v_pcp;
  if v_pcp is null then select id into v_pcp from public.schools where slug = 'pcp'; end if;

  perform app.bootstrap_school_defaults(v_pas);
  perform app.bootstrap_school_defaults(v_pcp);
end $$;

grant execute on function app.bootstrap_school_defaults(uuid) to service_role;
