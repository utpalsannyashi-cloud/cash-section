-- =========================================================
-- Cash Section — Fix ambiguous "group_id" in create_group() (reintroduced)
--
-- The 3-arg create_group from 0018_admin_partners.sql returns table
-- (group_id uuid, session_id uuid), which implicitly declares those names
-- as PL/pgSQL variables. The lookup for the auto-created default session
-- used an unqualified "group_id" in the WHERE clause, colliding with the
-- variable and raising "column reference \"group_id\" is ambiguous".
--
-- This was fixed once in 0013_fix_create_group_ambiguous_column.sql by
-- qualifying the column (s.group_id). The rewrite in 0018 dropped the
-- qualification. Restore it.
-- =========================================================

create or replace function public.create_group(p_name text, p_access_code text default null, p_partner_id uuid default null)
returns table (group_id uuid, session_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  new_group_id uuid;
  new_session_id uuid;
  code text;
begin
  if caller is null then
    raise exception 'Not authenticated';
  end if;

  if p_partner_id is not null and not exists (
    select 1 from public.admin_partners
    where status = 'accepted'
      and ((requester_id = caller and partner_id = p_partner_id)
        or (requester_id = p_partner_id and partner_id = caller))
  ) then
    raise exception 'You can only create a joint group with an accepted admin partner';
  end if;

  code := lower(trim(coalesce(p_access_code, '')));
  if code = '' then
    code := null;
  elsif code !~ '^[a-z0-9]{6,20}$' then
    raise exception 'Use 6–20 lowercase letters/numbers for the passkey.';
  end if;

  insert into public.groups (name, created_by, access_code)
  values (
    p_name,
    caller,
    coalesce(code, substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  )
  returning id into new_group_id;
  -- handle_new_group() has now fired and made the caller an admin.

  if p_partner_id is not null then
    insert into public.group_members (group_id, user_id, role)
    values (new_group_id, p_partner_id, 'admin')
    on conflict (group_id, user_id) do nothing;
  end if;

  -- Qualify the column so it does not collide with the RETURNS TABLE
  -- variable of the same name.
  select s.id into new_session_id
  from public.sessions s
  where s.group_id = new_group_id
  order by s.created_at asc
  limit 1;

  return query select new_group_id, new_session_id;
end;
$$;

grant execute on function public.create_group(text, text, uuid) to authenticated;
