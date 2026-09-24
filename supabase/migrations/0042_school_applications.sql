-- 0042_school_applications.sql
-- AMA EDU: "Register a school" becomes "Apply for school registration".
--
-- BEFORE: the public register-school Edge Function created a live school + administrator login instantly,
--         from an anonymous request, with the password chosen in the form.
-- AFTER:  a school SUBMITS AN APPLICATION (all details, no password). It appears in the AMA EDU platform
--         admin dashboard. A platform admin approves or rejects it. Because Cloudflare Pages cannot serve
--         *.amaedu.com.ng directly, approval does NOT auto-create anything: the admin sets the subdomain up by
--         hand, creates the administrator's login in Supabase Auth, then runs ONE function that builds the school
--         atomically from the stored application (provision_school_application). Nothing to unwind by hand.
--
-- DESIGN CHOICES WORTH KNOWING
--   * No password is collected or stored at application time. The admin sets/sends credentials at provisioning.
--   * All access to the table is through RPCs; anon/authenticated have NO direct table privileges except that
--     platform admins may SELECT (RLS) so the dashboard can list applications.
--   * The requested web address is HELD while an application is pending/approved (partial unique index), and
--     public.is_slug_available() now reports held slugs as taken, so the form's live check stays truthful.
--   * Submission is anon-callable, so it is throttled: max 3 pending per administrator email, 100 per hour overall,
--     and re-sending the same slug+email returns the existing reference (a phone losing signal can retry safely).
--   * The applicant has no account, so public.check_school_application(reference, email) lets them see the decision.
--     Both must match; a wrong pair returns nothing (no way to probe which half was wrong).
--   * The old register-school Edge Function must be replaced by the 410 stub shipped with this change, otherwise
--     it remains a public bypass of the approval step (see supabase/functions/register-school/index.ts).
--
-- SCHEMA-PERMISSION TRAP: every function below has explicit EXECUTE grants; service_role gets EXECUTE on all of them.

-- ---------------------------------------------------------------------------------------------
-- 1. the applications table
-- ---------------------------------------------------------------------------------------------
create table public.school_applications (
  id            uuid primary key default gen_random_uuid(),
  reference     text not null unique
                  default ('AP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  status        text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected', 'provisioned')),

  -- the school
  school_name   text not null check (length(btrim(school_name)) between 2 and 160),
  requested_slug text not null check (requested_slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),
  school_type   app.school_type not null default 'combined',
  sections      text[] check (sections is null or sections <@ array['nursery','primary','jss','ss','islamiyya','other']::text[]),
  school_email  text not null check (school_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and length(school_email) <= 254),
  school_phone  text check (length(school_phone) <= 40),
  address       text check (length(address) <= 400),
  website       text check (website is null or (website ~ '^https?://[^[:space:]]+$' and length(website) <= 300)),
  declared_student_count integer check (declared_student_count is null or declared_student_count between 0 and 200000),
  registration_number text check (length(registration_number) <= 80),
  report_card_template text not null default 'classic'
                  references public.report_card_templates(code) on update cascade,

  -- the person who will administer it
  admin_full_name text not null check (length(btrim(admin_full_name)) between 2 and 120),
  admin_email   text not null check (admin_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and length(admin_email) <= 254),
  admin_phone   text check (length(admin_phone) <= 40),
  message       text check (length(message) <= 2000),

  -- review + setup trail
  submitted_at  timestamptz not null default now(),
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (length(decision_note) <= 1000),
  school_id     uuid references public.schools(id) on delete set null,
  provisioned_at timestamptz
);

comment on table public.school_applications is
  'Schools applying to join AMA EDU. Reviewed by platform admins; approved ones are set up manually via provision_school_application().';

-- a web address is held while its application is waiting or approved-but-not-yet-built
create unique index school_applications_slug_held
  on public.school_applications (requested_slug) where status in ('pending', 'approved');
create index school_applications_status_idx on public.school_applications (status, submitted_at desc);
create index school_applications_email_idx on public.school_applications (lower(admin_email));

alter table public.school_applications enable row level security;
create policy school_applications_platform_read on public.school_applications
  for select to authenticated using (app.is_platform_admin());

-- default privileges in this project hand every table to anon/authenticated; take them back.
revoke all on public.school_applications from anon, authenticated;
grant select on public.school_applications to authenticated;
grant all on public.school_applications to service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. is_slug_available: a slug held by a waiting/approved application is not available
--    (full replacement of the existing function; the first three rules are unchanged)
-- ---------------------------------------------------------------------------------------------
create or replace function public.is_slug_available(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select lower(btrim(p_slug)) ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'
     and not exists (select 1 from public.reserved_slugs r where r.slug = lower(btrim(p_slug)))
     and not exists (select 1 from public.schools s where s.slug = lower(btrim(p_slug)))
     and not exists (select 1 from public.school_applications a
                      where a.requested_slug = lower(btrim(p_slug)) and a.status in ('pending', 'approved'));
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. submit (public): validate everything, throttle, store, return a reference
-- ---------------------------------------------------------------------------------------------
create or replace function public.submit_school_application(p_payload jsonb)
returns table (reference text, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v          jsonb := coalesce(p_payload, '{}'::jsonb);
  v_name     text;
  v_slug     text;
  v_type     text;
  v_semail   text;
  v_aname    text;
  v_aemail   text;
  v_sections text[];
  v_declared integer;
  v_website  text;
  v_template text;
  v_existing public.school_applications%rowtype;
  v_ref      text;
  v_try      integer := 0;
  v_email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
begin
  if jsonb_typeof(v) <> 'object' or length(v::text) > 10000 then
    raise exception 'That application could not be read. Please try again.' using errcode = '22023';
  end if;

  v_name   := btrim(coalesce(v->>'school_name', ''));
  v_slug   := lower(btrim(coalesce(v->>'slug', '')));
  v_semail := lower(btrim(coalesce(v->>'school_email', '')));
  v_aname  := btrim(coalesce(v->>'admin_full_name', ''));
  v_aemail := lower(btrim(coalesce(v->>'admin_email', '')));
  v_type   := coalesce(nullif(btrim(v->>'school_type'), ''), 'combined');
  v_website := nullif(btrim(coalesce(v->>'website', '')), '');

  if length(v_name) < 2 or length(v_name) > 160 then
    raise exception 'Enter the school''s name.' using errcode = '22023';
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$' then
    raise exception 'That web address is not valid.' using errcode = '22023';
  end if;
  if v_semail !~ v_email_re or length(v_semail) > 254 then
    raise exception 'Enter a valid school email address.' using errcode = '22023';
  end if;
  if length(v_aname) < 2 or length(v_aname) > 120 then
    raise exception 'Enter the administrator''s full name.' using errcode = '22023';
  end if;
  if v_aemail !~ v_email_re or length(v_aemail) > 254 then
    raise exception 'Enter a valid administrator email address.' using errcode = '22023';
  end if;
  if v_website is not null and (v_website !~ '^https?://[^[:space:]]+$' or length(v_website) > 300) then
    raise exception 'The website must start with http:// or https://.' using errcode = '22023';
  end if;
  if v_type not in ('nursery_primary', 'secondary', 'combined', 'islamiyya', 'other') then
    v_type := 'combined';
  end if;

  v_sections := null;
  if jsonb_typeof(v->'sections') = 'array' then
    select array_agg(distinct x order by x) into v_sections
      from jsonb_array_elements_text(v->'sections') x
     where x in ('nursery', 'primary', 'jss', 'ss', 'islamiyya', 'other');
  end if;

  v_declared := case when (v->>'declared_student_count') ~ '^[0-9]{1,6}$'
                     then (v->>'declared_student_count')::integer end;

  -- an unknown or retired report card falls back to Template 1, exactly as the old registration did
  v_template := 'classic';
  if exists (select 1 from public.report_card_templates t
              where t.code = btrim(coalesce(v->>'report_card_template', '')) and t.is_active) then
    v_template := btrim(v->>'report_card_template');
  end if;

  -- retrying the same application (dropped connection, double tap) is safe: hand back the same reference
  select * into v_existing from public.school_applications a
   where a.requested_slug = v_slug and lower(a.admin_email) = v_aemail and a.status = 'pending';
  if found then
    return query select v_existing.reference, v_existing.status;
    return;
  end if;

  if (select count(*) from public.school_applications a
       where lower(a.admin_email) = v_aemail and a.status = 'pending') >= 3 then
    raise exception 'You already have 3 applications waiting for review. Please wait for a decision.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.school_applications a where a.submitted_at > now() - interval '1 hour') >= 100 then
    raise exception 'We are receiving a lot of applications right now. Please try again in a little while.' using errcode = 'P0001';
  end if;
  if not public.is_slug_available(v_slug) then
    raise exception 'That web address is already taken or is being reviewed for another school. Choose another.' using errcode = '23505';
  end if;

  loop
    v_try := v_try + 1;
    begin
      insert into public.school_applications as a (
        school_name, requested_slug, school_type, sections, school_email, school_phone, address, website,
        declared_student_count, registration_number, report_card_template,
        admin_full_name, admin_email, admin_phone, message)
      values (
        v_name, v_slug, v_type::app.school_type, v_sections, v_semail,
        nullif(btrim(coalesce(v->>'school_phone', '')), ''),
        nullif(btrim(coalesce(v->>'address', '')), ''),
        v_website, v_declared,
        nullif(btrim(coalesce(v->>'registration_number', '')), ''),
        v_template,
        v_aname, v_aemail,
        nullif(btrim(coalesce(v->>'admin_phone', '')), ''),
        nullif(btrim(coalesce(v->>'message', '')), ''))
      returning a.reference into v_ref;
      exit;
    exception when unique_violation then
      -- either the slug was taken between the check and the insert, or a (astronomically unlikely) reference clash
      if not public.is_slug_available(v_slug) or v_try >= 3 then
        raise exception 'That web address is already taken or is being reviewed for another school. Choose another.' using errcode = '23505';
      end if;
    end;
  end loop;

  return query select v_ref, 'pending'::text;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. applicant status lookup (public, needs BOTH reference and administrator email)
-- ---------------------------------------------------------------------------------------------
create or replace function public.check_school_application(p_reference text, p_email text)
returns table (status text, school_name text, requested_slug text, submitted_at timestamptz,
               decided_at timestamptz, decision_note text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.status, a.school_name, a.requested_slug, a.submitted_at, a.decided_at, a.decision_note
    from public.school_applications a
   where a.reference = upper(btrim(coalesce(p_reference, '')))
     and lower(a.admin_email) = lower(btrim(coalesce(p_email, '')))
   limit 1;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. decide (platform admin): approve or reject
-- ---------------------------------------------------------------------------------------------
create or replace function public.decide_school_application(p_id uuid, p_decision text, p_note text default null)
returns table (id uuid, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  a      public.school_applications%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not app.is_platform_admin() then
    raise exception 'Only an AMA EDU administrator can review school applications.' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and (v_note is null or length(v_note) < 3) then
    raise exception 'Give the school a short reason for the rejection.' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'That note is too long (1000 characters maximum).' using errcode = '22023';
  end if;

  select * into a from public.school_applications x where x.id = p_id for update;
  if not found then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  if a.status = 'provisioned' then
    raise exception 'That school has already been set up.' using errcode = 'P0001';
  end if;
  if a.status = p_decision then
    raise exception 'That application is already %.', p_decision using errcode = 'P0001';
  end if;
  if a.status = 'rejected' then
    raise exception 'A rejected application cannot be reopened. Ask the school to apply again.' using errcode = 'P0001';
  end if;

  if p_decision = 'approved' and (
       exists (select 1 from public.reserved_slugs r where r.slug = a.requested_slug)
    or exists (select 1 from public.schools s where s.slug = a.requested_slug)) then
    raise exception 'That web address is no longer available. Reject the application and ask the school to pick another.'
      using errcode = '23505';
  end if;

  update public.school_applications x
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = v_note
   where x.id = p_id;

  perform app.write_audit(null, 'school_application.' || p_decision, 'school_applications', p_id,
    jsonb_build_object('reference', a.reference, 'slug', a.requested_slug));

  return query select p_id, p_decision;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. provision (platform admin): the MANUAL backend step, done atomically
--    Admin first creates the administrator's login in Supabase Auth (Authentication > Users > Add user, using
--    the applicant's administrator email), sets up the school's subdomain in Cloudflare, then runs:
--        select * from public.provision_school_application('<application id>', '<auth user id>');
--    Same build as the old register-school function (school, defaults, staff ADMIN, membership) but in ONE
--    transaction, so a failure leaves nothing behind.
-- ---------------------------------------------------------------------------------------------
create or replace function public.provision_school_application(p_id uuid, p_admin_user_id uuid)
returns table (school_id uuid, slug text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  a        public.school_applications%rowtype;
  v_email  text;
  v_school uuid;
  v_staff  uuid;
begin
  if not app.is_platform_admin() then
    raise exception 'Only an AMA EDU administrator can set up a school.' using errcode = '42501';
  end if;

  select * into a from public.school_applications x where x.id = p_id for update;
  if not found then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  if a.status <> 'approved' then
    raise exception 'Only an approved application can be set up (this one is %).', a.status using errcode = 'P0001';
  end if;

  select u.email into v_email from auth.users u where u.id = p_admin_user_id;
  if not found then
    raise exception 'No login exists with that user id. Create the administrator in Supabase Auth first.' using errcode = 'P0002';
  end if;
  if lower(coalesce(v_email, '')) <> lower(a.admin_email) then
    raise exception 'That login''s email (%) does not match the applicant''s administrator email (%).', v_email, a.admin_email
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.school_members m where m.user_id = p_admin_user_id)
     or exists (select 1 from public.platform_admins p where p.user_id = p_admin_user_id) then
    raise exception 'That login already belongs to a school or to the platform team. Use a separate account.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.schools s where s.slug = a.requested_slug) then
    raise exception 'A school with that web address already exists.' using errcode = '23505';
  end if;

  insert into public.schools as s (name, slug, school_type, status, email, phone, address, website,
                                   declared_student_count, report_card_template)
  values (a.school_name, a.requested_slug, a.school_type, 'active', a.school_email, a.school_phone, a.address,
          a.website, a.declared_student_count, a.report_card_template)
  returning s.id into v_school;

  perform public.bootstrap_new_school(v_school, a.sections);

  insert into public.staff as t (school_id, user_id, staff_code, full_name, email, phone, position, roles)
  values (v_school, p_admin_user_id, 'ADMIN', a.admin_full_name, a.admin_email, a.admin_phone,
          'School Administrator', array['admin']::app.user_role[])
  returning t.id into v_staff;

  insert into public.school_members (school_id, user_id, role, staff_id)
  values (v_school, p_admin_user_id, 'admin', v_staff)
  on conflict (user_id, school_id, role) do update set staff_id = excluded.staff_id;

  update public.school_applications x
     set status = 'provisioned', school_id = v_school, provisioned_at = now()
   where x.id = p_id;

  perform app.write_audit(v_school, 'school.provisioned', 'schools', v_school,
    jsonb_build_object('application', a.reference, 'slug', a.requested_slug, 'sections', a.sections));

  return query select v_school, a.requested_slug;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. grants
-- ---------------------------------------------------------------------------------------------
revoke all on function public.submit_school_application(jsonb) from public, anon;
revoke all on function public.check_school_application(text, text) from public, anon;
revoke all on function public.decide_school_application(uuid, text, text) from public, anon;
revoke all on function public.provision_school_application(uuid, uuid) from public, anon;
grant execute on function public.submit_school_application(jsonb) to anon, authenticated, service_role;
grant execute on function public.check_school_application(text, text) to anon, authenticated, service_role;
grant execute on function public.decide_school_application(uuid, text, text) to authenticated, service_role;
grant execute on function public.provision_school_application(uuid, uuid) to authenticated, service_role;
