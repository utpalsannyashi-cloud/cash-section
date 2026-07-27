-- =========================================================
-- Cash Section — invite_admin_partner: tolerate a leading "@"
-- =========================================================
-- Usernames are stored without a leading "@" (see 0001_schema.sql),
-- but "@" is how every username is displayed everywhere else in the
-- app (the partner list, join requests, etc.), so it's the natural
-- thing to type into the invite box too. Before this fix, typing
-- "@aishwarya" for a real user "aishwarya" failed with "No user with
-- that username" -- an exact-match lookup against the stored value,
-- which never has the "@". Stripping any leading "@"s before the
-- lookup makes both forms work.
create or replace function public.invite_admin_partner(p_username text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  target_id uuid;
  existing public.admin_partners;
  clean_username text := regexp_replace(trim(p_username), '^@+', '');
begin
  if caller is null then
    raise exception 'Not authenticated';
  end if;

  select id into target_id from public.profiles where lower(username) = lower(clean_username);
  if target_id is null then
    raise exception 'No user with that username';
  end if;
  if target_id = caller then
    raise exception 'You cannot partner with yourself';
  end if;

  select * into existing
  from public.admin_partners
  where status in ('pending', 'accepted')
    and least(requester_id, partner_id) = least(caller, target_id)
    and greatest(requester_id, partner_id) = greatest(caller, target_id)
  limit 1;

  if existing.id is not null then
    if existing.status = 'accepted' then
      raise exception 'You are already partners with @%', clean_username;
    else
      raise exception 'There is already a pending invite between you and @%', clean_username;
    end if;
  end if;

  insert into public.admin_partners (requester_id, partner_id)
  values (caller, target_id);

  return jsonb_build_object('status', 'pending', 'partner_username', clean_username);
end;
$$;
