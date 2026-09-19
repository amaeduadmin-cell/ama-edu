-- Gap found while building the Announcements management page: the
-- original read policy gated by audience even for staff, so a staff
-- member could not see a "students only" or "parents only"
-- announcement they (or a colleague) had posted — the management
-- list would silently hide rows. Staff need full visibility of their
-- own school's announcements to manage them; the audience gate is
-- for the student/parent-facing feed, not for staff.

drop policy announcements_read on public.announcements;

create policy announcements_read on public.announcements
  for select to authenticated
  using (
    app.owns(school_id)
    and (
      app.is_staff()
      or (
        published_at <= now()
        and (expires_at is null or expires_at > now())
        and (
          audience = 'all'
          or (audience = 'students' and app.has_role('student'))
          or (audience = 'parents'  and app.has_role('parent'))
          or (audience = 'class' and (
                class_id = (select st.class_id from public.students st where st.id = app.current_student_id())
                or class_id in (select st.class_id from public.students st where st.id in (select app.my_children()))
          ))
        )
      )
    )
  );
