-- AMA EDU 0044 — unlock notifications and administrator analytics
-- Forward-only. Notifications remain tenant-scoped and user-scoped.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'info',
  title text not null,
  body text not null,
  entity text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);
create index if not exists notifications_school_idx on public.notifications(school_id, created_at desc);
alter table public.notifications enable row level security;
alter table public.notifications force row level security;
create policy notifications_read_own on public.notifications for select to authenticated
  using (app.owns(school_id) and user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (app.owns(school_id) and user_id = auth.uid())
  with check (app.owns(school_id) and user_id = auth.uid());

create or replace function public.mark_notification_read(p_notification_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.notifications set read_at=coalesce(read_at,now())
  where id=p_notification_id and school_id=app.current_school_id() and user_id=auth.uid();
  return found;
end $$;
grant execute on function public.mark_notification_read(uuid) to authenticated;

-- Re-declare resolution so every decision creates an in-app notification for
-- the requesting teacher's login, while retaining the existing audit trail.
create or replace function public.resolve_score_unlock_request(p_request_id uuid, p_decision text)
returns public.score_unlock_requests
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.score_unlock_requests;
  v_result public.score_unlock_requests;
  v_requester_user uuid;
  v_class text;
  v_subject text;
  v_period text;
  v_count bigint;
begin
  if not app.is_school_admin() or p_decision not in ('approved','declined') then
    raise exception 'Administrator approval required.' using errcode = '42501';
  end if;
  select * into r from public.score_unlock_requests
    where id=p_request_id and app.owns(school_id) for update;
  if r.id is null then raise exception 'Unlock request not found.' using errcode = '42501'; end if;
  if r.status <> 'pending' then raise exception 'This unlock request has already been resolved.' using errcode = '22023'; end if;

  update public.score_unlock_requests
    set status=p_decision, resolved_by=app.current_staff_id(), resolved_at=now()
    where id=p_request_id returning * into v_result;

  if p_decision='approved' then
    update public.subject_score_locks set locked=false
    where class_id=r.class_id and subject_id=r.subject_id and term_id=r.term_id and period=r.period;
  end if;

  select c.name, s.name, r.period::text
    into v_class, v_subject, v_period
    from public.classes c, public.subjects s
    where c.id=r.class_id and s.id=r.subject_id;
  select sm.user_id into v_requester_user
    from public.school_members sm
    where sm.school_id=r.school_id and sm.staff_id=r.requested_by and sm.is_active
    limit 1;
  select count(*) into v_count from public.score_unlock_request_students x where x.request_id=r.id;

  if v_requester_user is not null then
    insert into public.notifications(school_id,user_id,kind,title,body,entity,entity_id)
    values(
      r.school_id,
      v_requester_user,
      case when p_decision='approved' then 'success' else 'warning' end,
      case when p_decision='approved' then 'Score unlock approved' else 'Score unlock declined' end,
      format('%s for %s · %s (%s) affecting %s student(s).%s',
        case when p_decision='approved' then 'Your unlock request was approved' else 'Your unlock request was declined' end,
        coalesce(v_class,'class'), coalesce(v_subject,'subject'), upper(v_period), v_count,
        case when p_decision='declined' then ' Review the administrator decision and submit a new request if needed.' else ' You may now correct the scores and resubmit the period.' end),
      'score_unlock_requests', r.id
    );
  end if;

  insert into public.audit_log(school_id,user_id,action,entity,entity_id,detail)
  values(r.school_id,auth.uid(),'score_unlock_request.'||p_decision,'score_unlock_requests',r.id,
    jsonb_build_object('class_id',r.class_id,'subject_id',r.subject_id,'term_id',r.term_id,
      'period',r.period,'affected_student_count',v_count,'notification_user_id',v_requester_user));
  return v_result;
end $$;
grant execute on function public.resolve_score_unlock_request(uuid,text) to authenticated;

-- Admin-only aggregate view. It returns teacher and subject dimensions in one
-- stable result shape for dashboards and CSV exports.
create or replace function public.unlock_request_analytics(p_term_id uuid)
returns table(
  dimension text,
  key_id uuid,
  label text,
  total_count bigint,
  pending_count bigint,
  approved_count bigint,
  declined_count bigint,
  approval_rate numeric,
  avg_resolution_hours numeric
)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not app.is_school_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
  if not exists(select 1 from public.terms t where t.id=p_term_id and app.owns(t.school_id)) then raise exception 'Term not found.' using errcode='42501'; end if;
  return query
  with base as (
    select r.*, r.resolved_at-r.created_at as resolution_age
    from public.score_unlock_requests r
    where r.term_id=p_term_id and app.owns(r.school_id)
  ), teacher as (
    select 'teacher'::text as dimension, r.requested_by as key_id,
      coalesce(st.full_name,'Unknown staff') as label,
      count(*) as total_count,
      count(*) filter(where r.status='pending') as pending_count,
      count(*) filter(where r.status='approved') as approved_count,
      count(*) filter(where r.status='declined') as declined_count,
      round(100.0*count(*) filter(where r.status='approved') / nullif(count(*) filter(where r.status in ('approved','declined')),0),2) as approval_rate,
      round(avg(extract(epoch from r.resolution_age)/3600.0) filter(where r.resolution_age is not null),2) as avg_resolution_hours
    from base r left join public.staff st on st.id=r.requested_by
    group by r.requested_by, st.full_name
  ), subject as (
    select 'subject'::text as dimension, r.subject_id as key_id,
      coalesce(s.name,'Unknown subject') as label,
      count(*) as total_count,
      count(*) filter(where r.status='pending') as pending_count,
      count(*) filter(where r.status='approved') as approved_count,
      count(*) filter(where r.status='declined') as declined_count,
      round(100.0*count(*) filter(where r.status='approved') / nullif(count(*) filter(where r.status in ('approved','declined')),0),2) as approval_rate,
      round(avg(extract(epoch from r.resolution_age)/3600.0) filter(where r.resolution_age is not null),2) as avg_resolution_hours
    from base r left join public.subjects s on s.id=r.subject_id
    group by r.subject_id, s.name
  )
  select * from teacher union all select * from subject
  order by dimension, total_count desc, label;
end $$;
grant execute on function public.unlock_request_analytics(uuid) to authenticated;
