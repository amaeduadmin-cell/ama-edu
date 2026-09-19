-- app.student_fees_settled lives in the app schema, which is not
-- exposed over the REST API — only `public` is. Everything the
-- frontend calls as an RPC needs a public wrapper. Added while
-- building fees.js, for my-report.js to use.
create or replace function public.fee_status(p_student_id uuid, p_term_id uuid)
returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
  select app.student_fees_settled(p_student_id, p_term_id);
$$;
grant execute on function public.fee_status(uuid, uuid) to authenticated;
