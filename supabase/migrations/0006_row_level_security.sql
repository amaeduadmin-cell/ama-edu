-- ===============================================================
-- AMA EDU 0006 — Row Level Security
--
-- RLS is ON for every table in public, with no policy granted to
-- `anon`. Nothing is readable without a session, and every readable
-- row is filtered by app.owns(school_id), which resolves the tenant
-- from auth.uid() server-side. Changing school_id in a request body,
-- in localStorage, or in the hostname changes nothing.
-- ===============================================================

-- Fees gate on a student's own results (school-configurable).
create or replace function app.report_visible(p_student_id uuid, p_term_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when (select s.block_report_on_unpaid_fees
          from public.schools s
          join public.students st on st.school_id = s.id
          where st.id = p_student_id) then app.student_fees_settled(p_student_id, p_term_id)
    else true
  end;
$$;
grant execute on function app.report_visible(uuid, uuid) to authenticated;

-- Children of the signed-in parent.
create or replace function app.my_children()
returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select ps.student_id
  from public.parent_students ps
  join public.parents p on p.id = ps.parent_id
  where p.user_id = auth.uid() and p.is_active;
$$;
grant execute on function app.my_children() to authenticated;

-- ---------------------------------------------------------------
-- Turn RLS on everywhere, and force it even for the table owner.
-- ---------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('alter table public.%I force row level security', t.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------
-- Tenant-uniform tables: every active member of the school may read;
-- only school admins may write.
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'sessions','terms','classes','subjects','class_subjects',
    'grading_bands','score_weights','class_teacher_subjects',
    'timetables','timetable_slots','awards','fee_structure',
    'term_period_windows'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (app.owns(school_id));
      create policy %1$s_write on public.%1$s
        for all to authenticated
        using (app.owns(school_id) and app.is_school_admin())
        with check (app.owns(school_id) and app.is_school_admin());
    $f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------
-- schools: members read their own school; platform admins read all.
-- The public marketing/login lookups do NOT go through this table
-- directly -- they use SECURITY DEFINER RPCs that return only
-- presentation fields for active schools.
-- ---------------------------------------------------------------
create policy schools_read_own on public.schools
  for select to authenticated using (app.owns(id));

create policy schools_update_own on public.schools
  for update to authenticated
  using (app.owns(id) and app.is_school_admin())
  with check (app.owns(id) and app.is_school_admin());

-- Only the platform may create or delete a school (Edge Function,
-- service role). No client-side INSERT policy exists on purpose.
create policy schools_platform_all on public.schools
  for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

-- ---------------------------------------------------------------
-- platform_admins / school_members / reserved_slugs:
-- readable where relevant, never writable from a client. Membership
-- is granted only by the service role, so a compromised school admin
-- cannot promote themselves to platform admin.
-- ---------------------------------------------------------------
create policy platform_admins_self on public.platform_admins
  for select to authenticated using (user_id = auth.uid() or app.is_platform_admin());

create policy members_read on public.school_members
  for select to authenticated
  using (user_id = auth.uid() or (app.owns(school_id) and app.is_school_admin()));

create policy reserved_read on public.reserved_slugs
  for select to authenticated using (true);

-- ---------------------------------------------------------------
-- staff: staff and admins see the directory. Students and parents do
-- NOT -- the table carries salary_amount, phone and email. Report-card
-- signatures reach them through a narrow RPC instead.
-- ---------------------------------------------------------------
create policy staff_read on public.staff
  for select to authenticated
  using (app.owns(school_id) and (app.is_staff() or user_id = auth.uid()));

create policy staff_write on public.staff
  for all to authenticated
  using (app.owns(school_id) and app.is_school_admin())
  with check (app.owns(school_id) and app.is_school_admin());

-- A staff member may edit their own non-privileged profile fields.
create policy staff_self_update on public.staff
  for update to authenticated
  using (app.owns(school_id) and user_id = auth.uid())
  with check (app.owns(school_id) and user_id = auth.uid());

-- ---------------------------------------------------------------
-- students
-- ---------------------------------------------------------------
create policy students_staff_read on public.students
  for select to authenticated using (app.owns(school_id) and app.is_staff());

create policy students_self_read on public.students
  for select to authenticated
  using (app.owns(school_id) and id = app.current_student_id());

create policy students_parent_read on public.students
  for select to authenticated
  using (app.owns(school_id) and id in (select app.my_children()));

create policy students_write on public.students
  for all to authenticated
  using (app.owns(school_id)
         and (app.is_school_admin() or app.has_role('registrar_primary','registrar_secondary')))
  with check (app.owns(school_id)
         and (app.is_school_admin() or app.has_role('registrar_primary','registrar_secondary')));

-- ---------------------------------------------------------------
-- parents
-- ---------------------------------------------------------------
create policy parents_read on public.parents
  for select to authenticated
  using (app.owns(school_id) and (app.is_staff() or user_id = auth.uid()));

create policy parents_write on public.parents
  for all to authenticated
  using (app.owns(school_id) and app.is_school_admin())
  with check (app.owns(school_id) and app.is_school_admin());

create policy parent_students_read on public.parent_students
  for select to authenticated
  using (app.owns(school_id)
         and (app.is_staff() or student_id in (select app.my_children())));

create policy parent_students_write on public.parent_students
  for all to authenticated
  using (app.owns(school_id) and app.is_school_admin())
  with check (app.owns(school_id) and app.is_school_admin());

-- ---------------------------------------------------------------
-- scores: staff by assignment; students and parents read-only, and
-- only when the school's fee policy allows it.
-- ---------------------------------------------------------------
create policy scores_staff_read on public.student_scores
  for select to authenticated using (app.owns(school_id) and app.is_staff());

create policy scores_student_read on public.student_scores
  for select to authenticated
  using (app.owns(school_id)
         and student_id = app.current_student_id()
         and app.report_visible(student_id, term_id));

create policy scores_parent_read on public.student_scores
  for select to authenticated
  using (app.owns(school_id)
         and student_id in (select app.my_children())
         and app.report_visible(student_id, term_id));

create policy scores_write on public.student_scores
  for all to authenticated
  using (app.owns(school_id) and app.can_mark(class_id, subject_id))
  with check (app.owns(school_id) and app.can_mark(class_id, subject_id));

create policy summary_staff_read on public.student_term_summary
  for select to authenticated using (app.owns(school_id) and app.is_staff());

create policy summary_student_read on public.student_term_summary
  for select to authenticated
  using (app.owns(school_id)
         and student_id = app.current_student_id()
         and app.report_visible(student_id, term_id));

create policy summary_parent_read on public.student_term_summary
  for select to authenticated
  using (app.owns(school_id)
         and student_id in (select app.my_children())
         and app.report_visible(student_id, term_id));

create policy summary_write on public.student_term_summary
  for all to authenticated
  using (app.owns(school_id) and app.is_staff())
  with check (app.owns(school_id) and app.is_staff());

-- ---------------------------------------------------------------
-- locking / unlock requests
-- ---------------------------------------------------------------
create policy locks_read on public.subject_score_locks
  for select to authenticated using (app.owns(school_id) and app.is_staff());
create policy locks_write on public.subject_score_locks
  for all to authenticated
  using (app.owns(school_id) and (app.is_school_admin() or app.can_mark(class_id, subject_id)))
  with check (app.owns(school_id) and (app.is_school_admin() or app.can_mark(class_id, subject_id)));

create policy unlock_read on public.score_unlock_requests
  for select to authenticated using (app.owns(school_id) and app.is_staff());
create policy unlock_insert on public.score_unlock_requests
  for insert to authenticated with check (app.owns(school_id) and app.is_staff());
create policy unlock_resolve on public.score_unlock_requests
  for update to authenticated
  using (app.owns(school_id) and app.is_school_admin())
  with check (app.owns(school_id) and app.is_school_admin());

-- ---------------------------------------------------------------
-- fees: admins and the bursar manage; a student or parent sees only
-- their own record.
-- ---------------------------------------------------------------
create policy fee_payments_staff_read on public.fee_payments
  for select to authenticated
  using (app.owns(school_id) and (app.is_school_admin() or app.has_role('bursar')));

create policy fee_payments_own_read on public.fee_payments
  for select to authenticated
  using (app.owns(school_id)
         and (student_id = app.current_student_id() or student_id in (select app.my_children())));

create policy fee_payments_write on public.fee_payments
  for all to authenticated
  using (app.owns(school_id) and (app.is_school_admin() or app.has_role('bursar')))
  with check (app.owns(school_id) and (app.is_school_admin() or app.has_role('bursar')));

-- ---------------------------------------------------------------
-- announcements: read filtered by audience.
-- (This policy is superseded by migration 0013 -- kept here to
-- preserve the exact deployed history.)
-- ---------------------------------------------------------------
create policy announcements_read on public.announcements
  for select to authenticated
  using (
    app.owns(school_id)
    and (published_at <= now())
    and (expires_at is null or expires_at > now())
    and (
      audience = 'all'
      or (audience = 'staff'    and app.is_staff())
      or (audience = 'students' and app.has_role('student'))
      or (audience = 'parents'  and app.has_role('parent'))
      or (audience = 'class'    and (
            app.is_staff()
            or class_id = (select st.class_id from public.students st where st.id = app.current_student_id())
            or class_id in (select st.class_id from public.students st where st.id in (select app.my_children()))
      ))
    )
  );

create policy announcements_write on public.announcements
  for all to authenticated
  using (app.owns(school_id) and app.is_staff())
  with check (app.owns(school_id) and app.is_staff());

create policy announcement_reads_own on public.announcement_reads
  for all to authenticated
  using (app.owns(school_id) and user_id = auth.uid())
  with check (app.owns(school_id) and user_id = auth.uid());

-- ---------------------------------------------------------------
-- school_websites holds portal credentials -> admins only.
-- audit_log is append-only from the server; admins may read.
-- ---------------------------------------------------------------
create policy websites_admin_only on public.school_websites
  for all to authenticated
  using (app.owns(school_id) and app.is_school_admin())
  with check (app.owns(school_id) and app.is_school_admin());

create policy audit_read on public.audit_log
  for select to authenticated using (app.owns(school_id) and app.is_school_admin());
