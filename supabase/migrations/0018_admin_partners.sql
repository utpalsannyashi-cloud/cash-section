-- =========================================================
-- Cash Section — Admin partners (joint group creation)
--
-- A user can partner with another account, mirroring an individual
-- bank account vs a joint one held with someone else. Pairing is a
-- standing, mutual relationship (invite by username, the other side
-- accepts) — accepting doesn't retroactively change anything. Instead,
-- it unlocks a per-group choice: when creating a NEW group, the
-- creator can pick "just me" (today's default, unchanged) or "jointly
-- with @partner", which makes both of them admins of that one group
-- from the moment it's created. A user can hold several partnerships
-- at once — each is its own separate "joint account" pairing, exactly
-- like someone might have a joint account with a spouse and a
-- separate one with a business partner.
--
-- Ending a partnership only stops it being offered for FUTURE groups.
-- group_members rows created while the partnership was active are
-- never touched — same principle as removing a member never rewriting
-- their past expenses.
-- =========================================================

create table public.admin_partners (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  partner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'declined', 'ended')) default 'pending',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  check (requester_id <> partner_id)
);

-- At most one live (pending or accepted) partnership per unordered
-- pair, no matter who invited whom. A declined or ended row doesn't
-- block a fresh invite later. least()/greatest() on uuid are
-- immutable, so this is safe as an index expression.
create unique index idx_admin_partners_one_active
  on public.admin_partners (least(requester_id, partner_id), greatest(requester_id, partner_id))
  where status in ('pending', 'accepted');

create index idx_admin_partners_requester on public.admin_partners(requester_id);
create index idx_admin_partners_partner on public.admin_partners(partner_id);

alter table public.admin_partners enable row level security;

create policy "admin_partners_select" on public.admin_partners
  for select using (requester_id = auth.uid() or partner_id = auth.uid());

-- No insert/update/delete policies on purpose: every write goes
-- through the security-definer RPCs below, same pattern as
-- join_requests in migration 0016.

-- ---------------------------------------------------------
-- invite_admin_partner
-- ---------------------------------------------------------
create or replace function public.invite_admin_partner(p_username text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  target_id uuid;
  existing public.admin_partners;
begin
  if caller is null then
    raise exception 'Not authenticated';
  end if;

  select id into target_id from public.profiles where lower(username) = lower(trim(p_username));
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
      raise exception 'You are already partners with @%', p_username;
    else
      raise exception 'There is already a pending invite between you and @%', p_username;
    end if;
  end if;

  insert into public.admin_partners (requester_id, partner_id)
  values (caller, target_id);

  return jsonb_build_object('status', 'pending', 'partner_username', p_username);
end;
$$;

grant execute on function public.invite_admin_partner(text) to authenticated;

-- ---------------------------------------------------------
-- list_partner_requests — both directions in one call, so the client
-- doesn't need two separate queries just to know what to show where.
-- ---------------------------------------------------------
create or replace function public.list_partner_requests()
returns table (
  id uuid,
  direction text,
  other_user_id uuid,
  other_username text,
  requested_at timestamptz
)
language plpgsql
security definer set search_path = public
stable
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    ap.id,
    case when ap.partner_id = caller then 'incoming' else 'outgoing' end,
    case when ap.partner_id = caller then ap.requester_id else ap.partner_id end,
    p.username,
    ap.requested_at
  from public.admin_partners ap
  join public.profiles p
    on p.id = case when ap.partner_id = caller then ap.requester_id else ap.partner_id end
  where ap.status = 'pending'
    and (ap.requester_id = caller or ap.partner_id = caller)
  order by ap.requested_at desc;
end;
$$;

grant execute on function public.list_partner_requests() to authenticated;

-- ---------------------------------------------------------
-- decide_admin_partner_request — only the invited party can answer.
-- ---------------------------------------------------------
create or replace function public.decide_admin_partner_request(p_request_id uuid, p_approve boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  req public.admin_partners;
begin
  if caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into req from public.admin_partners where id = p_request_id;
  if req.id is null then
    raise exception 'No such partner request';
  end if;
  if req.partner_id <> caller then
    raise exception 'Only the invited user can respond to this request';
  end if;
  if req.status <> 'pending' then
    raise exception 'This request has already been decided';
  end if;

  update public.admin_partners
  set status = case when p_approve then 'accepted' else 'declined' end,
      decided_at = now()
  where id = p_request_id;

  return jsonb_build_object('request_id', p_request_id, 'approved', p_approve);
end;
$$;

grant execute on function public.decide_admin_partner_request(uuid, boolean) to authenticated;

-- ---------------------------------------------------------
-- cancel_admin_partner_request — the requester backing out of their
-- own still-pending invite. Deleted outright rather than marked
-- declined, since there's nothing worth auditing about someone
-- withdrawing their own ask, and it frees the pair up to be invited
-- again immediately.
-- ---------------------------------------------------------
create or replace function public.cancel_admin_partner_request(p_request_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  req public.admin_partners;
begin
  if caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into req from public.admin_partners where id = p_request_id;
  if req.id is null then
    raise exception 'No such request';
  end if;
  if req.requester_id <> caller then
    raise exception 'Only the person who sent this invite can cancel it';
  end if;
  if req.status <> 'pending' then
    raise exception 'This request is no longer pending';
  end if;

  delete from public.admin_partners where id = p_request_id;
end;
$$;

grant execute on function public.cancel_admin_partner_request(uuid) to authenticated;

-- ---------------------------------------------------------
-- end_admin_partnership — either side can end an accepted pairing.
-- Only affects groups created from here on; existing group_members
-- rows are untouched, same as removing a group member never rewrites
-- their past expenses.
-- ---------------------------------------------------------
create or replace function public.end_admin_partnership(p_partnership_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  row_ public.admin_partners;
begin
  if caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into row_ from public.admin_partners where id = p_partnership_id;
  if row_.id is null then
    raise exception 'No such partnership';
  end if;
  if caller not in (row_.requester_id, row_.partner_id) then
    raise exception 'You are not part of this partnership';
  end if;
  if row_.status <> 'accepted' then
    raise exception 'This partnership is not active';
  end if;

  update public.admin_partners
  set status = 'ended', decided_at = now()
  where id = p_partnership_id;
end;
$$;

grant execute on function public.end_admin_partnership(uuid) to authenticated;

-- ---------------------------------------------------------
-- list_admin_partners — accepted pairings for the caller, with the
-- OTHER person's id/username already resolved so the client never
-- needs a second round trip (or to hit profiles RLS, which wouldn't
-- necessarily allow it before any joint group exists).
-- ---------------------------------------------------------
create or replace function public.list_admin_partners()
returns table (
  id uuid,
  partner_user_id uuid,
  partner_username text,
  since timestamptz
)
language plpgsql
security definer set search_path = public
stable
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    ap.id,
    case when ap.requester_id = caller then ap.partner_id else ap.requester_id end,
    p.username,
    ap.decided_at
  from public.admin_partners ap
  join public.profiles p
    on p.id = case when ap.requester_id = caller then ap.partner_id else ap.requester_id end
  where ap.status = 'accepted'
    and (ap.requester_id = caller or ap.partner_id = caller)
  order by ap.decided_at desc nulls last;
end;
$$;

grant execute on function public.list_admin_partners() to authenticated;

-- ---------------------------------------------------------
-- create_group — now takes an optional p_partner_id. When given (and
-- only when an accepted partnership actually exists between the
-- caller and that user), the partner is inserted as an admin of the
-- brand-new group alongside the creator. Solo creation (p_partner_id
-- omitted) behaves exactly as before.
--
-- Signature is changing (a third parameter), so the old two-arg
-- version has to be dropped first — CREATE OR REPLACE can't widen a
-- function's parameter list; it would just create a second overload,
-- and PostgREST would then see an ambiguous call whenever the client
-- sends only the two original arguments.
-- ---------------------------------------------------------
drop function if exists public.create_group(text, text);

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

  select id into new_session_id
  from public.sessions
  where group_id = new_group_id
  order by created_at asc
  limit 1;

  return query select new_group_id, new_session_id;
end;
$$;

grant execute on function public.create_group(text, text, uuid) to authenticated;

-- ---------------------------------------------------------
-- Realtime, so an incoming invite (or an answer to one you sent)
-- shows up without a manual refresh — same idea as join_requests.
-- ---------------------------------------------------------
alter publication supabase_realtime add table public.admin_partners;
