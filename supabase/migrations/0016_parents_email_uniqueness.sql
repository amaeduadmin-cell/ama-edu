-- RECONSTRUCTED from the live database (migration 0016 was applied to the
-- project but was not present in the repository snapshot). Kept so a fresh
-- environment built from this folder matches production.
-- Parent e-mails are normalised (trimmed, lower-cased) and unique per school.
create or replace function app.normalise_parent_email()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.email is not null then new.email := lower(btrim(new.email)); end if;
  return new;
end $$;

drop trigger if exists parents_normalise_email on public.parents;
create trigger parents_normalise_email before insert or update on public.parents
  for each row execute function app.normalise_parent_email();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'parents_school_id_email_key') then
    alter table public.parents add constraint parents_school_id_email_key unique (school_id, email);
  end if;
end $$;
