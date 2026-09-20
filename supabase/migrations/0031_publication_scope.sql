-- ===============================================================
-- AMA EDU 0031 — a teacher may publish only their OWN form class
--
-- 0020 added schools.teachers_may_publish, but app.may_publish_results()
-- has no class argument, so switching it on let ANY teacher publish ANY
-- class. This trigger closes that: unless the caller is an
-- administrator, headmaster or principal, they must be the form teacher
-- of the class whose results they are publishing.
--
-- It is a trigger on result_publications rather than a rewrite of
-- set_result_status(), so it also holds for any future code path that
-- touches the table.
-- ===============================================================
create or replace function app.guard_publication_scope()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    if not (app.is_school_admin() or app.has_role('headmaster', 'principal'))
       and not app.is_form_teacher(new.class_id) then
      raise exception 'A teacher can only publish results for their own form class.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists result_publications_scope on public.result_publications;
create trigger result_publications_scope before insert or update on public.result_publications
  for each row execute function app.guard_publication_scope();
