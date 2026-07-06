-- =========================================================
-- Cash Section — Group-level passkey entry
-- Guests now unlock an entire GROUP with one passkey and become a
-- real group member (not just a session participant), so there's no
-- second passkey prompt once inside. Sessions remain in the schema
-- (expenses still hang off a session row) but become a pure
-- implementation detail — the UI no longer lets anyone create,
-- switch between, or unlock an individual session.
-- =========================================================

alter table public.groups
  add column access_code text unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

update public.groups
  set access_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)
  where access_code is null;

alter table public.groups alter column access_code set not null;

create index idx_groups_access_code on public.groups(access_code);

-- ---------------------------------------------------------
-- Verifies a group's passkey and adds the caller as a regular member.
-- security definer because group_members inserts are normally admin-only.
-- ---------------------------------------------------------
create or replace function public.unlock_group_by_code(code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  target_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select id into target_group_id from public.groups where access_code = lower(code);
  if target_group_id is null then
    raise exception 'Invalid passkey';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (target_group_id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return target_group_id;
end;
$$;

grant execute on function public.unlock_group_by_code(text) to anon, authenticated;

-- ---------------------------------------------------------
-- create_group() now sets the passkey on the group itself, not on its
-- auto-created default session (sessions no longer have a user-facing
-- passkey at all).
-- ---------------------------------------------------------
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
  select id into new_session_id
  from public.sessions
  where group_id = new_group_id
  order by created_at asc
  limit 1;

  return query select new_group_id, new_session_id;
end;
$$;

grant execute on function public.create_group(text, text) to authenticated;
