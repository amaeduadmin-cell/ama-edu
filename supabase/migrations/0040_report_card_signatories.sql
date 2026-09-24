-- 0040_report_card_signatories.sql
-- AMA EDU feature-gap batch, section 5: staff signature images + school-level fallback signatories.
--
-- WHAT WAS ALREADY THERE (verified against the live schema, nothing re-added):
--   * public.staff.signature_url            (text, nullable)      -> NOT added again
--   * staff_self_update / staff_write RLS    -> a staff member can already edit their own row,
--                                               an admin can edit any row in their school
--
-- REAL GAPS THIS MIGRATION CLOSES:
--   1. Students and parents can NOT read public.staff (staff_read = staff-or-self only), so a report
--      card rendered for them had no legitimate way to fetch the Head/Principal/Admin Officer name and
--      signature. Pariya solved this by querying staff straight from the browser; AMA EDU must not.
--      -> public.report_card_signatories(): one narrow SECURITY DEFINER RPC returning only
--         (role, name, signature url) for the three signing positions, scoped to the caller's school.
--   2. No school-level fallback name/signature for when nobody holds a signing position yet.
--      -> 6 additive columns on school_report_card_settings (name + signature url x 3 positions).
--   3. signature_url was unvalidated free text rendered into <img src>. -> https-only CHECK + trim.
--   4. FORGERY PATH: staff.position is free text that a staff member can edit on their own row
--      (guard_staff_change only protected roles/pay/status/staff_code). "Admin Officer" is identified
--      by position (there is no admin_officer role), so any teacher could type that title and have their
--      own signature print on every report card. -> guard_staff_change now makes the Admin Officer
--      title admin-only to set or remove. Headmaster/Principal are matched by ROLE, which was already
--      admin-only. All other position text stays freely self-editable, exactly as before.
--   5. Signature / signatory changes were not audited. -> audit rows for both tables.
--
-- SCHEMA-PERMISSION TRAP (project history): every new schema-qualified object below has an explicit
-- GRANT EXECUTE to service_role; app schema USAGE for service_role was verified true.

-- ---------------------------------------------------------------------------------------------
-- 1. helper: is this position text the "Admin Officer" title?  (case/space/punctuation-insensitive)
-- ---------------------------------------------------------------------------------------------
create or replace function app.is_signatory_position(p_position text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select lower(regexp_replace(coalesce(p_position, ''), '[^A-Za-z]', '', 'g')) = 'adminofficer';
$$;

revoke all on function app.is_signatory_position(text) from public, anon;
grant execute on function app.is_signatory_position(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. fallback signatories on school_report_card_settings (additive)
-- ---------------------------------------------------------------------------------------------
alter table public.school_report_card_settings
  add column headmaster_fallback_name    text,
  add column headmaster_fallback_sig_url text,
  add column principal_fallback_name     text,
  add column principal_fallback_sig_url  text,
  add column admin_officer_fallback_name    text,
  add column admin_officer_fallback_sig_url text;

alter table public.school_report_card_settings
  add constraint rcs_signatory_names_len check (
        coalesce(length(headmaster_fallback_name), 0)     <= 120
    and coalesce(length(principal_fallback_name), 0)      <= 120
    and coalesce(length(admin_officer_fallback_name), 0)  <= 120),
  add constraint rcs_signatory_urls_https check (
        (headmaster_fallback_sig_url is null
           or (headmaster_fallback_sig_url ~ '^https://[^[:space:]]+$' and length(headmaster_fallback_sig_url) <= 2048))
    and (principal_fallback_sig_url is null
           or (principal_fallback_sig_url ~ '^https://[^[:space:]]+$' and length(principal_fallback_sig_url) <= 2048))
    and (admin_officer_fallback_sig_url is null
           or (admin_officer_fallback_sig_url ~ '^https://[^[:space:]]+$' and length(admin_officer_fallback_sig_url) <= 2048)));

-- Blank form fields arrive as '' -> store NULL so the https CHECK never trips on an empty box.
create or replace function app.normalize_report_signatories()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.headmaster_fallback_name       := nullif(btrim(new.headmaster_fallback_name), '');
  new.headmaster_fallback_sig_url    := nullif(btrim(new.headmaster_fallback_sig_url), '');
  new.principal_fallback_name        := nullif(btrim(new.principal_fallback_name), '');
  new.principal_fallback_sig_url     := nullif(btrim(new.principal_fallback_sig_url), '');
  new.admin_officer_fallback_name    := nullif(btrim(new.admin_officer_fallback_name), '');
  new.admin_officer_fallback_sig_url := nullif(btrim(new.admin_officer_fallback_sig_url), '');
  return new;
end $$;

create trigger rcs_normalize_signatories
  before insert or update on public.school_report_card_settings
  for each row execute function app.normalize_report_signatories();

-- ---------------------------------------------------------------------------------------------
-- 3. staff.signature_url: https-only + blank -> NULL  (column itself already exists)
-- ---------------------------------------------------------------------------------------------
create or replace function app.normalize_staff_signature()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.signature_url := nullif(btrim(new.signature_url), '');
  return new;
end $$;

create trigger staff_normalize_signature
  before insert or update of signature_url on public.staff
  for each row execute function app.normalize_staff_signature();

alter table public.staff
  add constraint staff_signature_url_https check (
    signature_url is null
    or (signature_url ~ '^https://[^[:space:]]+$' and length(signature_url) <= 2048));

-- ---------------------------------------------------------------------------------------------
-- 4. close the forgery path: only an administrator may give or take the "Admin Officer" title
--    (full replacement of the existing guard; every original rule is kept verbatim)
-- ---------------------------------------------------------------------------------------------
create or replace function app.guard_staff_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.school_id is distinct from old.school_id then
      raise exception 'A staff record cannot move between schools.' using errcode = '42501';
    end if;
    if old.is_active and not new.is_active and 'admin' = any(new.roles)
       and not exists (select 1 from public.staff o
                       where o.school_id = new.school_id and o.id <> new.id
                         and o.is_active and 'admin' = any(o.roles)) then
      raise exception 'A school must keep at least one active administrator.' using errcode = 'P0001';
    end if;
    if auth.uid() is not null and not app.is_school_admin() and not app.is_internal() and (
         new.roles is distinct from old.roles or new.salary_amount is distinct from old.salary_amount
         or new.is_active is distinct from old.is_active or new.user_id is distinct from old.user_id
         or new.staff_code is distinct from old.staff_code) then
      raise exception 'Only an administrator can change roles, status, pay or Staff ID.' using errcode = '42501';
    end if;
    -- NEW (0040): the Admin Officer title decides whose signature prints on report cards.
    if auth.uid() is not null and not app.is_school_admin() and not app.is_internal()
       and new.position is distinct from old.position
       and (app.is_signatory_position(new.position) or app.is_signatory_position(old.position)) then
      raise exception 'Only an administrator can set or change the "Admin Officer" position, because it decides whose signature prints on report cards.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $function$;

-- ---------------------------------------------------------------------------------------------
-- 5. audit trail for signature / signatory changes (booleans only, never the URL contents)
-- ---------------------------------------------------------------------------------------------
create or replace function app.audit_staff_signature()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.signature_url is distinct from old.signature_url then
    perform app.write_audit(new.school_id, 'staff.signature_changed', 'staff', new.id,
      jsonb_build_object('has_signature', new.signature_url is not null));
  end if;
  return null;
end $$;

create trigger staff_audit_signature
  after update of signature_url on public.staff
  for each row execute function app.audit_staff_signature();

create or replace function app.audit_report_signatories()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.headmaster_fallback_name, new.headmaster_fallback_sig_url,
      new.principal_fallback_name,  new.principal_fallback_sig_url,
      new.admin_officer_fallback_name, new.admin_officer_fallback_sig_url)
     is distinct from
     (old.headmaster_fallback_name, old.headmaster_fallback_sig_url,
      old.principal_fallback_name,  old.principal_fallback_sig_url,
      old.admin_officer_fallback_name, old.admin_officer_fallback_sig_url) then
    perform app.write_audit(new.school_id, 'settings.report_signatories_changed',
      'school_report_card_settings', new.school_id, null);
  end if;
  return null;
end $$;

create trigger rcs_audit_signatories
  after update on public.school_report_card_settings
  for each row execute function app.audit_report_signatories();

revoke all on function app.audit_staff_signature(), app.audit_report_signatories(),
                       app.normalize_staff_signature(), app.normalize_report_signatories()
  from public, anon;
grant execute on function app.audit_staff_signature(), app.audit_report_signatories(),
                          app.normalize_staff_signature(), app.normalize_report_signatories()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. THE RESOLVER the report-card renderer calls (students, parents and staff alike)
--    Returns exactly three rows: headmaster, principal, admin_officer.
--    Rule (matches the spec): if an ACTIVE staff member holds the position, use THEIR name and THEIR
--    signature only (blank signature -> blank line; we never print someone else's signature under
--    their name). Only when nobody holds it do we fall back to the school's stored fallback, and
--    finally to schools.headmaster_name / principal_name (name only) which Templates 1/2 already use.
--    Headmaster/Principal are matched by ROLE (admin-controlled); Admin Officer by the guarded position.
--    Which of headmaster/principal applies to a given class (nursery/primary vs JSS/SS) is decided by
--    the renderer; the database just supplies both.
-- ---------------------------------------------------------------------------------------------
create or replace function public.report_card_signatories()
returns table (role_key text, full_name text, signature_url text, source text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_school uuid := app.current_school_id();
  s        public.school_report_card_settings%rowtype;
  sc       public.schools%rowtype;
  h        public.staff%rowtype;
  k        text;
  v_found  boolean;
  fb_name  text;
  fb_sig   text;
  sc_name  text;
begin
  if v_school is null then
    raise exception 'Sign in to a school account first.' using errcode = '42501';
  end if;

  select * into s  from public.school_report_card_settings x where x.school_id = v_school;
  select * into sc from public.schools x where x.id = v_school;

  foreach k in array array['headmaster', 'principal', 'admin_officer'] loop
    select t.* into h
      from public.staff t
     where t.school_id = v_school
       and t.is_active
       and case k
             when 'headmaster' then 'headmaster'::app.user_role = any (t.roles)
             when 'principal'  then 'principal'::app.user_role  = any (t.roles)
             else app.is_signatory_position(t.position)
           end
     order by (t.signature_url is not null) desc, t.created_at, t.id
     limit 1;
    v_found := found;

    role_key := k;
    if v_found then
      full_name := h.full_name;
      signature_url := h.signature_url;
      source := 'staff';
    else
      if k = 'headmaster' then
        fb_name := s.headmaster_fallback_name; fb_sig := s.headmaster_fallback_sig_url; sc_name := sc.headmaster_name;
      elsif k = 'principal' then
        fb_name := s.principal_fallback_name;  fb_sig := s.principal_fallback_sig_url;  sc_name := sc.principal_name;
      else
        fb_name := s.admin_officer_fallback_name; fb_sig := s.admin_officer_fallback_sig_url; sc_name := null;
      end if;
      full_name := coalesce(fb_name, sc_name);
      signature_url := fb_sig;
      source := case when fb_name is not null or fb_sig is not null then 'fallback'
                     when sc_name is not null then 'school'
                     else 'none' end;
    end if;
    return next;
  end loop;
end $$;

comment on function public.report_card_signatories() is
  'Head/Principal/Admin Officer name + signature url for the caller''s own school. Narrow on purpose: no other staff fields.';

revoke all on function public.report_card_signatories() from public, anon;
grant execute on function public.report_card_signatories() to authenticated, service_role;
