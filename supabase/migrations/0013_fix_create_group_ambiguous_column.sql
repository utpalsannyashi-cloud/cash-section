-- =========================================================
-- Cash Section — Fix ambiguous "group_id" in create_group()
-- RETURNS TABLE (group_id uuid, session_id uuid) implicitly declares
-- group_id/session_id as PL/pgSQL variables in the function body, which
-- collided with the sessions.group_id column in the lookup query below,
-- causing "column reference group_id is ambiguous" on every group
-- creation. Qualifying the column reference resolves it.
-- =========================================================

create or replace function public.create_group(p_name text, p_access_code text default null)
returns table (group_id uuid, session_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_group_id uuid;
  new_session_id uuid;
  code text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  code := lower(trim(coalesce(p_access_code, '')));
  if code = '' then
    code := null;
  elsif code !~ '^[a-z0-9]{4,20}$' then
    raise exception 'Use 4–20 lowercase letters/numbers for the passkey.';
  end if;

  insert into public.groups (name, created_by, access_code)
  values (
    p_name,
    auth.uid(),
    coalesce(code, substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
  )
  returning id into new_group_id;

  -- handle_new_group() (AFTER INSERT trigger) has already fired by this
  -- point in the same transaction, creating the admin membership and the
  -- default "General" session — so it's safe to look it up here.
  select s.id into new_session_id
  from public.sessions s
  where s.group_id = new_group_id
  order by s.created_at asc
  limit 1;

  return query select new_group_id, new_session_id;
end;
$$;

grant execute on function public.create_group(text, text) to authenticated;
