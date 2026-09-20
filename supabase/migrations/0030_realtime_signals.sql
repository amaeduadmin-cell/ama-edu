-- ===============================================================
-- AMA EDU 0030 — realtime "something changed" signals
--
-- Deliberately NOT row data. A trigger sends only the table name on a
-- PRIVATE broadcast channel, one channel per school. The browser reacts
-- by re-fetching through the ordinary RLS-protected queries, so a
-- signal can never reveal anything the person could not already read.
--
-- Two protections stop this leaking across schools:
--   1. the channel is private, and realtime.messages has an RLS policy
--      admitting a user only to the topic of their OWN school;
--   2. the payload carries no school or student data at all.
--
-- The trigger swallows its own errors: a realtime hiccup must never
-- roll back a teacher publishing results or a student submitting an exam.
-- ===============================================================

create policy school_channel_read on realtime.messages
  for select to authenticated
  using (realtime.topic() = 'school:' || coalesce(app.current_school_id()::text, 'none'));

create or replace function app.notify_school_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_school uuid;
begin
  v_school := case when tg_op = 'DELETE' then old.school_id else new.school_id end;
  begin
    perform realtime.send(jsonb_build_object('t', tg_table_name), 'changed', 'school:' || v_school::text, true);
  exception when others then
    null;  -- signals are best-effort
  end;
  return null;
end $$;
revoke all on function app.notify_school_change() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['result_publications','assessments','assignments','assignment_submissions',
                           'announcements','attendance_sessions']
  loop
    execute format('drop trigger if exists %1$s_notify on public.%1$s', t);
    execute format('create trigger %1$s_notify after insert or update or delete on public.%1$s
                    for each row execute function app.notify_school_change()', t);
  end loop;
end $$;
