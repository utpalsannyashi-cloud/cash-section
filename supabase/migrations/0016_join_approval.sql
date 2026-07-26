-- =========================================================
-- Cash Section — Admin-approved group entry + unlock rate limiting
--
-- Before this migration, unlock_group_by_code() verified a group's
-- passkey and immediately inserted the caller into group_members —
-- knowing the passkey WAS the authorisation. Two changes here:
--
--   1. A correct passkey now only creates a PENDING join request. The
--      group admin approves or denies it; membership is granted at
--      approval time, not at unlock time. The passkey stays a simple,
--      memorable, admin-chosen word — it just gets someone into the
--      waiting room rather than into the ledger.
--
--   2. Wrong passkeys are recorded per caller. Five failures inside a
--      15-minute window locks that caller out of unlock_group_by_code
--      for 15 minutes, which is what stops someone enumerating short
--      codes across every group in the table.
--
-- Everything the client needs is exposed through security-definer
-- RPCs, so no existing RLS policy on groups/profiles has to be
-- widened to let a not-yet-approved requester see a group name, or to
-- let an admin see a requester's username.
-- =========================================================

-- ---------------------------------------------------------
-- Join requests
-- ---------------------------------------------------------
create table public.join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('pending', 'approved', 'denied')) default 'pending',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id)
);

-- At most one live request per person per group. Approved/denied rows
-- are kept as history, so this is a partial index rather than a plain
-- unique constraint on (group_id, user_id).
create unique index idx_join_requests_one_pending
  on public.join_requests (group_id, user_id)
  where status = 'pending';

-- A denied decision is also terminal until an admin reverses it (see
-- decide_join_request), so there can only be one of those too.
create unique index idx_join_requests_one_denied
  on public.join_requests (group_id, user_id)
  where status = 'denied';

create index idx_join_requests_group_status
  on public.join_requests (group_id, status);

create index idx_join_requests_user
  on public.join_requests (user_id);

alter table public.join_requests enable row level security;

-- You can see your own requests; an admin can see their group's.
-- This policy exists mainly so Realtime (which enforces RLS on
-- postgres_changes) can push status flips to the waiting guest.
create policy "join_requests_select" on public.join_requests
for select using (
  user_id = auth.uid()
  or public.is_group_admin(group_id)
);

-- No insert/update/delete policies on purpose: every write goes
-- through the security-definer RPCs below, which do their own checks.

-- ---------------------------------------------------------
-- Unlock attempt log (rate limiting)
--
-- Only failures need to be counted, but successes are recorded too so
-- there's an audit trail of who got into which group and when.
-- ---------------------------------------------------------
create table public.unlock_attempts (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  succeeded boolean not null,
  group_id uuid references public.groups(id) on delete set null,
  attempted_at timestamptz not null default now()
);

create index idx_unlock_attempts_user_time
  on public.unlock_attempts (user_id, attempted_at desc);

alter table public.unlock_attempts enable row level security;

-- Deliberately no policies: nothing reads this from the client. The
-- security-definer functions below bypass RLS to read and write it.

-- ---------------------------------------------------------
-- Rate-limit knobs, kept as functions so they're easy to find and
-- change in one place rather than being buried as literals.
-- ---------------------------------------------------------
create or replace function public.unlock_max_attempts()
returns int language sql immutable as $$ select 5 $$;

create or replace function public.unlock_window()
returns interval language sql immutable as $$ select interval '15 minutes' $$;

-- ---------------------------------------------------------
-- unlock_group_by_code
--
-- Return type changes from uuid to jsonb, so the old signature has to
-- be dropped rather than replaced.
--
-- Shape of the returned object:
--   { "status": "member",   "group_id": "…", "group_name": "…" }
--   { "status": "pending",  "group_id": "…", "group_name": "…", "request_id": "…" }
--   { "status": "denied",   "group_id": "…", "group_name": "…" }
--
-- "member" means the caller was already in the group (they'd used the
-- passkey before, or they're re-entering) — no approval needed, go
-- straight in. Errors are raised for a bad passkey and for a
-- rate-limited caller, so the client can tell those apart from any
-- legitimate outcome.
-- ---------------------------------------------------------
drop function if exists public.unlock_group_by_code(text);

create or replace function public.unlock_group_by_code(code text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  target public.groups;
  recent_failures int;
  oldest_failure timestamptz;
  existing public.join_requests;
  new_request_id uuid;
begin
  if caller is null then
    raise exception 'Not authenticated';
  end if;

  -- Rate limit gate. Counts only failures, and only inside the window,
  -- so a caller who waits it out starts clean without any cleanup job.
  select count(*), min(attempted_at)
    into recent_failures, oldest_failure
  from public.unlock_attempts
  where user_id = caller
    and succeeded = false
    and attempted_at > now() - public.unlock_window();

  if recent_failures >= public.unlock_max_attempts() then
    raise exception 'Too many incorrect passkeys. Try again in % minutes.',
      greatest(1, ceil(extract(epoch from (oldest_failure + public.unlock_window() - now())) / 60))
      using errcode = 'P0001';
  end if;

  select * into target
  from public.groups
  where access_code = lower(trim(code));

  if target.id is null then
    insert into public.unlock_attempts (user_id, succeeded) values (caller, false);
    raise exception 'Invalid passkey' using errcode = 'P0002';
  end if;

  insert into public.unlock_attempts (user_id, succeeded, group_id)
  values (caller, true, target.id);

  -- Already inside: nothing to approve.
  if public.is_group_member(target.id) then
    return jsonb_build_object(
      'status', 'member',
      'group_id', target.id,
      'group_name', target.name
    );
  end if;

  select * into existing
  from public.join_requests
  where group_id = target.id
    and user_id = caller
    and status in ('pending', 'denied')
  limit 1;

  if existing.id is not null then
    return jsonb_build_object(
      'status', existing.status,
      'group_id', target.id,
      'group_name', target.name,
      'request_id', existing.id
    );
  end if;

  insert into public.join_requests (group_id, user_id)
  values (target.id, caller)
  returning id into new_request_id;

  return jsonb_build_object(
    'status', 'pending',
    'group_id', target.id,
    'group_name', target.name,
    'request_id', new_request_id
  );
end;
$$;

grant execute on function public.unlock_group_by_code(text) to anon, authenticated;

-- ---------------------------------------------------------
-- get_join_request_status
--
-- Polled/subscribed by the waiting screen. Security definer so a
-- requester who isn't a member yet can still be told the group's name
-- and their own status without opening up the groups table's RLS.
-- ---------------------------------------------------------
create or replace function public.get_join_request_status(p_group_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
stable
as $$
declare
  caller uuid := auth.uid();
  group_name text;
  current_status text;
begin
  if caller is null then
    raise exception 'Not authenticated';
  end if;

  select name into group_name from public.groups where id = p_group_id;
  if group_name is null then
    raise exception 'No such group';
  end if;

  if public.is_group_member(p_group_id) then
    return jsonb_build_object('status', 'member', 'group_id', p_group_id, 'group_name', group_name);
  end if;

  select status into current_status
  from public.join_requests
  where group_id = p_group_id and user_id = caller
  order by requested_at desc
  limit 1;

  return jsonb_build_object(
    'status', coalesce(current_status, 'none'),
    'group_id', p_group_id,
    'group_name', group_name
  );
end;
$$;

grant execute on function public.get_join_request_status(uuid) to anon, authenticated;

-- ---------------------------------------------------------
-- list_join_requests
--
-- Admin-facing queue. Security definer so the admin can read a
-- requester's username before that person is a member of anything the
-- two of them share — profiles RLS would otherwise hide it.
-- ---------------------------------------------------------
create or replace function public.list_join_requests(p_group_id uuid)
returns table (
  id uuid,
  user_id uuid,
  username text,
  status text,
  requested_at timestamptz,
  decided_at timestamptz
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if not public.is_group_admin(p_group_id) then
    raise exception 'Only a group admin can see join requests';
  end if;

  return query
  select jr.id, jr.user_id, p.username, jr.status, jr.requested_at, jr.decided_at
  from public.join_requests jr
  join public.profiles p on p.id = jr.user_id
  where jr.group_id = p_group_id
    and jr.status in ('pending', 'denied')
  order by
    case jr.status when 'pending' then 0 else 1 end,
    jr.requested_at asc;
end;
$$;

grant execute on function public.list_join_requests(uuid) to authenticated;

-- ---------------------------------------------------------
-- decide_join_request
--
-- p_approve = true  -> status 'approved' + group_members row
-- p_approve = false -> status 'denied', no membership
--
-- Approving a previously denied request is allowed and is how an admin
-- undoes a mis-tap. Denying is terminal: the unique partial index on
-- denied rows means that person can't re-request by re-entering the
-- passkey, they'd need the admin to reverse it.
-- ---------------------------------------------------------
create or replace function public.decide_join_request(p_request_id uuid, p_approve boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  req public.join_requests;
begin
  if caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into req from public.join_requests where id = p_request_id;
  if req.id is null then
    raise exception 'No such join request';
  end if;

  if not public.is_group_admin(req.group_id) then
    raise exception 'Only a group admin can decide join requests';
  end if;

  if p_approve then
    insert into public.group_members (group_id, user_id, role)
    values (req.group_id, req.user_id, 'member')
    on conflict (group_id, user_id) do nothing;

    update public.join_requests
    set status = 'approved', decided_at = now(), decided_by = caller
    where id = p_request_id;
  else
    -- Clear any older denied row for this person so the partial unique
    -- index can't collide, then record this decision.
    delete from public.join_requests
    where group_id = req.group_id
      and user_id = req.user_id
      and status = 'denied'
      and id <> p_request_id;

    update public.join_requests
    set status = 'denied', decided_at = now(), decided_by = caller
    where id = p_request_id;
  end if;

  return jsonb_build_object('request_id', p_request_id, 'approved', p_approve);
end;
$$;

grant execute on function public.decide_join_request(uuid, boolean) to authenticated;

-- ---------------------------------------------------------
-- Realtime
--
-- The guest's waiting screen subscribes filtered on user_id, and the
-- admin's banner subscribes filtered on group_id. Both rely on the
-- join_requests_select policy above for row visibility.
-- ---------------------------------------------------------
alter publication supabase_realtime add table public.join_requests;

-- ---------------------------------------------------------
-- Raise the passkey floor from 4 to 6 characters.
--
-- Not a cryptographic argument — 4 characters is short enough that two
-- unrelated groups plausibly pick the same real word, which is a
-- collision problem before it's a security one. Existing shorter codes
-- are left alone; this only constrains newly set ones.
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
  elsif code !~ '^[a-z0-9]{6,20}$' then
    raise exception 'Use 6–20 lowercase letters/numbers for the passkey.';
  end if;

  insert into public.groups (name, created_by, access_code)
  values (
    p_name,
    auth.uid(),
    coalesce(code, substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  )
  returning id into new_group_id;

  select id into new_session_id
  from public.sessions
  where group_id = new_group_id
  order by created_at asc
  limit 1;

  return query select new_group_id, new_session_id;
end;
$$;

grant execute on function public.create_group(text, text) to authenticated;

-- create_group() only covers the creation path. Groups.tsx and
-- GroupDashboard.tsx both change a passkey with a plain
-- groups.update({ access_code }) that never goes near the RPC, so the
-- rule needs to live on the column too. NOT VALID means existing rows
-- (including any 4- or 5-character codes already in use) are left
-- alone — the constraint is only enforced on inserts and updates from
-- here on, so nobody's live group breaks on deploy.
alter table public.groups
  add constraint groups_access_code_format
  check (access_code ~ '^[a-z0-9]{6,20}$')
  not valid;
