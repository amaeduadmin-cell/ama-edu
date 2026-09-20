-- ===============================================================
-- AMA EDU 0029 — save_assessment_components() left its constraint
-- trigger in IMMEDIATE mode for the rest of the transaction.
--
-- 0028 ran `set constraints assessment_components_validate immediate`
-- so the "must total 100" rule surfaces as an ordinary error. That
-- setting lasts until the transaction ends. Through the API every call
-- is its own transaction, so it was harmless there, but a second call
-- in the same transaction fired the trigger row by row and rejected a
-- perfectly valid change halfway through ("currently 70" while moving
-- between two valid systems). Found by the settings test run. The
-- function now puts the trigger back to DEFERRED straight afterwards.
-- ===============================================================
create or replace function public.save_assessment_components(p_components jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_school uuid := app.current_school_id(); c record; v_count int; v_before jsonb;
begin
  if not app.is_school_admin() or v_school is null then
    raise exception 'Only a school administrator can change the assessment system.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_components) <> 'array' or jsonb_array_length(p_components) = 0 then
    raise exception 'Send the list of assessment components.' using errcode = '22023';
  end if;

  select jsonb_agg(jsonb_build_object('code', x.code, 'label', x.label, 'max', x.max_score, 'active', x.is_active) order by x.sort_order)
    into v_before from public.assessment_components x where x.school_id = v_school;

  -- the whole set is validated together, so hold the rule until the end
  set constraints assessment_components_validate deferred;

  for c in select * from jsonb_to_recordset(p_components)
           as x(code text, label text, max_score numeric, is_active boolean, sort_order int)
  loop
    if c.code not in ('ca1','ca2','ca3','exam') then
      raise exception 'Unknown assessment component "%".', c.code using errcode = '22023';
    end if;
    if btrim(coalesce(c.label, '')) = '' then
      raise exception 'Every assessment component needs a name.' using errcode = '23514';
    end if;
    if coalesce(c.is_active, true) then
      if c.max_score is null or c.max_score <= 0 or c.max_score > 100 then
        raise exception '% must have a maximum mark between 1 and 100.', c.label using errcode = '23514';
      end if;
      execute format('select count(*) from public.student_scores where school_id = $1 and %I > $2', c.code)
        into v_count using v_school, c.max_score;
      if v_count > 0 then
        raise exception '% cannot be lowered to %: % student(s) already have a higher mark.', c.label, c.max_score, v_count
          using errcode = '23514';
      end if;
    else
      if c.code = 'exam' then
        raise exception 'The examination component must stay switched on.' using errcode = '23514';
      end if;
      execute format('select count(*) from public.student_scores where school_id = $1 and %I is not null', c.code)
        into v_count using v_school;
      if v_count > 0 then
        raise exception '% already has marks for % student(s), so it cannot be switched off.', c.label, v_count
          using errcode = '23514';
      end if;
    end if;

    insert into public.assessment_components (school_id, code, label, max_score, is_active, sort_order)
    values (v_school, c.code::app.score_period, btrim(c.label),
            case when coalesce(c.max_score, 0) > 0 then c.max_score else 1 end,
            coalesce(c.is_active, true), coalesce(c.sort_order, 0))
    on conflict (school_id, code) do update
      set label = excluded.label, max_score = excluded.max_score,
          is_active = excluded.is_active, sort_order = excluded.sort_order;
  end loop;

  -- check now so the failure is a clear error, then restore the default
  set constraints assessment_components_validate immediate;
  set constraints assessment_components_validate deferred;

  perform app.write_audit(v_school, 'settings.assessment_system_changed', 'assessment_components', null,
    jsonb_build_object('before', v_before, 'after', p_components));
end $$;
grant execute on function public.save_assessment_components(jsonb) to authenticated;
