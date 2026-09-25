-- AMA EDU 0047 — richer school applications and controllable gateway connection
-- Gateway secret keys are deliberately not stored in Postgres or sent to the browser.
-- Configure them as Supabase Edge Function secrets; platform admins can disable the
-- connection here without rotating or exposing a secret.

alter table public.school_applications
  add column if not exists ward text check (ward is null or length(btrim(ward)) between 1 and 120),
  add column if not exists lga text check (lga is null or length(btrim(lga)) between 1 and 120),
  add column if not exists state text check (state is null or length(btrim(state)) between 1 and 120),
  add column if not exists country text not null default 'Nigeria' check (length(btrim(country)) between 2 and 120);

alter table public.schools
  add column if not exists ward text check (ward is null or length(btrim(ward)) between 1 and 120),
  add column if not exists lga text check (lga is null or length(btrim(lga)) between 1 and 120),
  add column if not exists state text check (state is null or length(btrim(state)) between 1 and 120),
  add column if not exists country text not null default 'Nigeria' check (length(btrim(country)) between 2 and 120),
  add column if not exists registration_number text check (registration_number is null or length(btrim(registration_number)) between 1 and 80);

alter table public.platform_payment_settings
  add column if not exists gateway_enabled boolean not null default false,
  add column if not exists gateway_provider text,
  add column if not exists gateway_secret_configured boolean not null default false,
  add column if not exists gateway_disconnected_at timestamptz;

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
  if jsonb_typeof(v) <> 'object' or length(v::text) > 12000 then
    raise exception 'That application could not be read. Please try again.' using errcode = '22023';
  end if;

  v_name   := btrim(coalesce(v->>'school_name', ''));
  v_slug   := lower(btrim(coalesce(v->>'slug', '')));
  v_semail := lower(btrim(coalesce(v->>'school_email', '')));
  v_aname  := btrim(coalesce(v->>'admin_full_name', ''));
  v_aemail := lower(btrim(coalesce(v->>'admin_email', '')));
  v_type   := coalesce(nullif(btrim(v->>'school_type'), ''), 'combined');
  v_website := nullif(btrim(coalesce(v->>'website', '')), '');

  if length(v_name) < 2 or length(v_name) > 160 then raise exception 'Enter the school''s name.' using errcode = '22023'; end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$' then raise exception 'That web address is not valid.' using errcode = '22023'; end if;
  if v_semail !~ v_email_re or length(v_semail) > 254 then raise exception 'Enter a valid school email address.' using errcode = '22023'; end if;
  if length(v_aname) < 2 or length(v_aname) > 120 then raise exception 'Enter the administrator''s full name.' using errcode = '22023'; end if;
  if v_aemail !~ v_email_re or length(v_aemail) > 254 then raise exception 'Enter a valid administrator email address.' using errcode = '22023'; end if;
  if v_website is not null and (v_website !~ '^https?://[^[:space:]]+$' or length(v_website) > 300) then raise exception 'The website must start with http:// or https://.' using errcode = '22023'; end if;
  if v_type not in ('nursery_primary', 'secondary', 'combined', 'islamiyya', 'other') then v_type := 'combined'; end if;

  v_sections := null;
  if jsonb_typeof(v->'sections') = 'array' then
    select array_agg(distinct x order by x) into v_sections
      from jsonb_array_elements_text(v->'sections') x
     where x in ('nursery', 'primary', 'jss', 'ss', 'islamiyya', 'other');
  end if;

  v_declared := case when (v->>'declared_student_count') ~ '^[0-9]{1,6}$' then (v->>'declared_student_count')::integer end;
  v_template := 'classic';
  if exists (select 1 from public.report_card_templates t where t.code = btrim(coalesce(v->>'report_card_template', '')) and t.is_active) then v_template := btrim(v->>'report_card_template'); end if;

  select * into v_existing from public.school_applications a
   where a.requested_slug = v_slug and lower(a.admin_email) = v_aemail and a.status = 'pending';
  if found then return query select v_existing.reference, v_existing.status; return; end if;

  if (select count(*) from public.school_applications a where lower(a.admin_email) = v_aemail and a.status = 'pending') >= 3 then
    raise exception 'You already have 3 applications waiting for review. Please wait for a decision.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.school_applications a where a.submitted_at > now() - interval '1 hour') >= 100 then
    raise exception 'We are receiving a lot of applications right now. Please try again in a little while.' using errcode = 'P0001';
  end if;
  if not public.is_slug_available(v_slug) then raise exception 'That web address is already taken or is being reviewed for another school. Choose another.' using errcode = '23505'; end if;

  loop
    v_try := v_try + 1;
    begin
      insert into public.school_applications as a (
        school_name, requested_slug, school_type, sections, school_email, school_phone, address,
        ward, lga, state, country, website, declared_student_count, registration_number,
        report_card_template, admin_full_name, admin_email, admin_phone, message)
      values (
        v_name, v_slug, v_type::app.school_type, v_sections, v_semail,
        nullif(btrim(coalesce(v->>'school_phone', '')), ''), nullif(btrim(coalesce(v->>'address', '')), ''),
        nullif(btrim(coalesce(v->>'ward', '')), ''), nullif(btrim(coalesce(v->>'lga', '')), ''),
        nullif(btrim(coalesce(v->>'state', '')), ''), coalesce(nullif(btrim(coalesce(v->>'country', '')), ''), 'Nigeria'),
        v_website, v_declared, nullif(btrim(coalesce(v->>'registration_number', '')), ''), v_template,
        v_aname, v_aemail, nullif(btrim(coalesce(v->>'admin_phone', '')), ''), nullif(btrim(coalesce(v->>'message', '')), ''))
      returning a.reference into v_ref;
      exit;
    exception when unique_violation then
      if not public.is_slug_available(v_slug) or v_try >= 3 then raise exception 'That web address is already taken or is being reviewed for another school. Choose another.' using errcode = '23505'; end if;
    end;
  end loop;
  return query select v_ref, 'pending'::text;
end $$;

grant execute on function public.submit_school_application(jsonb) to anon, authenticated, service_role;

create or replace function public.provision_school_application(p_id uuid, p_admin_user_id uuid)
returns table (school_id uuid, slug text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  a public.school_applications%rowtype;
  v_email text;
  v_school uuid;
  v_staff uuid;
begin
  if not app.is_platform_admin() then raise exception 'Only an AMA EDU administrator can set up a school.' using errcode = '42501'; end if;
  select * into a from public.school_applications x where x.id = p_id for update;
  if not found then raise exception 'Application not found.' using errcode = 'P0002'; end if;
  if a.status <> 'approved' then raise exception 'Only an approved application can be set up (this one is %).', a.status using errcode = 'P0001'; end if;
  select u.email into v_email from auth.users u where u.id = p_admin_user_id;
  if not found then raise exception 'No login exists with that user id. Create the administrator in Supabase Auth first.' using errcode = 'P0002'; end if;
  if lower(coalesce(v_email, '')) <> lower(a.admin_email) then raise exception 'That login''s email (%) does not match the applicant''s administrator email (%).', v_email, a.admin_email using errcode = 'P0001'; end if;
  if exists (select 1 from public.school_members m where m.user_id = p_admin_user_id) or exists (select 1 from public.platform_admins p where p.user_id = p_admin_user_id) then raise exception 'That login already belongs to a school or to the platform team. Use a separate account.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.schools s where s.slug = a.requested_slug) then raise exception 'A school with that web address already exists.' using errcode = '23505'; end if;

  insert into public.schools as s (name, slug, school_type, status, email, phone, address, ward, lga, state, country, website, registration_number, declared_student_count, report_card_template)
  values (a.school_name, a.requested_slug, a.school_type, 'active', a.school_email, a.school_phone, a.address, a.ward, a.lga, a.state, a.country, a.website, a.registration_number, a.declared_student_count, a.report_card_template)
  returning s.id into v_school;
  perform public.bootstrap_new_school(v_school, a.sections);
  insert into public.staff as t (school_id, user_id, staff_code, full_name, email, phone, position, roles)
  values (v_school, p_admin_user_id, 'ADMIN', a.admin_full_name, a.admin_email, a.admin_phone, 'School Administrator', array['admin']::app.user_role[])
  returning t.id into v_staff;
  insert into public.school_members (school_id, user_id, role, staff_id) values (v_school, p_admin_user_id, 'admin', v_staff) on conflict (user_id, school_id, role) do update set staff_id = excluded.staff_id;
  update public.school_applications x set status = 'provisioned', school_id = v_school, provisioned_at = now() where x.id = p_id;
  perform app.write_audit(v_school, 'school.provisioned', 'schools', v_school, jsonb_build_object('application', a.reference, 'slug', a.requested_slug, 'sections', a.sections));
  return query select v_school, a.requested_slug;
end $$;

grant execute on function public.provision_school_application(uuid, uuid) to authenticated, service_role;
