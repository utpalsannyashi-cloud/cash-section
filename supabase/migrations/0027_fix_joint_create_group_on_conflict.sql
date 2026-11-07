-- =========================================================
-- Cash Section - Fix ambiguous "group_id" in joint create_group()
--
-- 0026 qualified the default-session lookup, which fixed solo group
-- creation. Joint creation (p_partner_id set) still failed with
-- 'column reference "group_id" is ambiguous', because the partner
-- insert uses ON CONFLICT (group_id, user_id) and the conflict target
-- collides with the RETURNS TABLE variable "group_id".
--
-- Fix: tell PL/pgSQL to prefer table columns on any name clash, and
-- name the conflict target by its constraint instead of by columns.
-- =========================================================

create or replace function public.create_group(p_name text, p_access_code text default null, p_partner_id uuid default null)
returns table (group_id uuid, session_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
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
    select 1 from public.admin_partners ap
    where ap.status = 'accepted'
      and ((ap.requester_id = caller and ap.partner_id = p_partner_id)
        or (ap.requester_id = p_partner_id and ap.partner_id = caller))
  ) then
    raise exception 'You can only create a joint group with an accepted admin partner';
  end if;

  code := lower(trim(coalesce(p_access_code, '')));
  if code = '' then
    code := null;
  elsif code !~ '^[a-z0-9]{6,20}$' then
    raise exception 'Use 6-20 lowercase letters/numbers for the passkey.';
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
    on conflict on constraint group_members_pkey do nothing;
  end if;

  select s.id into new_session_id
  from public.sessions s
  where s.group_id = new_group_id
  order by s.created_at asc
  limit 1;

  return query select new_group_id, new_session_id;
end;
$$;

grant execute on function public.create_group(text, text, uuid) to authenticated;