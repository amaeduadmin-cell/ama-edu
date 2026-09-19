-- migration 0007 revoked all table privileges on school_members down to
-- SELECT only. The new RLS policy from 0011 is enforced on top of table
-- grants, not instead of them, so writes still need the grant.
grant insert, update, delete on public.school_members to authenticated;
