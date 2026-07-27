-- =========================================================
-- Cash Section — Notifications + shareable admin-partner invite links
-- =========================================================

-- ---------------------------------------------------------
-- notifications
--
-- Server-populated only (via the triggers below) -- there's no insert
-- policy, so nothing a client sends can forge a notification for
-- someone else. Clients may only flip `read` on their own rows.
-- ---------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in (
    'partner_invite', 'partner_accepted', 'partner_declined',
    'join_request', 'join_approved', 'join_denied',
    'expense_added'
  )),
  title text not null,
  body text,
  group_id uuid references public.groups(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_notifications_user_created on public.notifications(user_id, created_at desc);
create index idx_notifications_user_unread on public.notifications(user_id) where read = false;

alter table public.notifications enable row level security;

create policy "notifications_select_own" on public.notifications
  for select using (user_id = auth.uid());

create policy "notifications_update_own" on public.notifications
  for update using (user_id = auth.uid());

alter publication supabase_realtime add table public.notifications;

-- ---------------------------------------------------------
-- Trigger: admin_partners inserts/status changes -> notifications
-- Covers both the classic invite_admin_partner() flow (insert as
-- 'pending', later updated by decide_admin_partner_request) and the
-- new invite-link flow below (inserts straight in as 'accepted').
-- ---------------------------------------------------------
create or replace function public.notify_admin_partner_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  requester_name text;
  partner_name text;
begin
  select username into requester_name from public.profiles where id = coalesce(new.requester_id, old.requester_id);
  select username into partner_name from public.profiles where id = coalesce(new.partner_id, old.partner_id);

  if tg_op = 'INSERT' then
    if new.status = 'pending' then
      insert into public.notifications (user_id, type, title, body, actor_id)
      values (new.partner_id, 'partner_invite', 'New admin partner invite',
        '@' || requester_name || ' invited you to be admin partners.', new.requester_id);
    elsif new.status = 'accepted' then
      insert into public.notifications (user_id, type, title, body, actor_id)
      values (new.requester_id, 'partner_accepted', 'Admin partner added',
        '@' || partner_name || ' is now your admin partner.', new.partner_id);
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    insert into public.notifications (user_id, type, title, body, actor_id)
    values (new.requester_id, 'partner_accepted', 'Admin partner invite accepted',
      '@' || partner_name || ' accepted your admin partner invite.', new.partner_id);
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'declined' then
    insert into public.notifications (user_id, type, title, body, actor_id)
    values (new.requester_id, 'partner_declined', 'Admin partner invite declined',
      '@' || partner_name || ' declined your admin partner invite.', new.partner_id);
  end if;
  return new;
end;
$$;

create trigger trg_notify_admin_partner_change
after insert or update on public.admin_partners
for each row execute function public.notify_admin_partner_change();

-- ---------------------------------------------------------
-- Trigger: join_requests -> notifications (admins on new request,
-- requester on the decision).
-- ---------------------------------------------------------
create or replace function public.notify_join_request_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  requester_name text;
  grp_name text;
  admin_id uuid;
begin
  select username into requester_name from public.profiles where id = coalesce(new.user_id, old.user_id);
  select name into grp_name from public.groups where id = coalesce(new.group_id, old.group_id);

  if tg_op = 'INSERT' and new.status = 'pending' then
    for admin_id in select user_id from public.group_members where group_id = new.group_id and role = 'admin' loop
      insert into public.notifications (user_id, type, title, body, group_id, actor_id)
      values (admin_id, 'join_request', 'New join request',
        '@' || requester_name || ' wants to join "' || grp_name || '".', new.group_id, new.user_id);
    end loop;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'approved' then
    insert into public.notifications (user_id, type, title, body, group_id, actor_id)
    values (new.user_id, 'join_approved', 'Join request approved',
      'You''re in! "' || grp_name || '" approved your request.', new.group_id, new.decided_by);
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'denied' then
    insert into public.notifications (user_id, type, title, body, group_id, actor_id)
    values (new.user_id, 'join_denied', 'Join request denied',
      '"' || grp_name || '" didn''t approve your request.', new.group_id, new.decided_by);
  end if;
  return new;
end;
$$;

create trigger trg_notify_join_request_change
after insert or update on public.join_requests
for each row execute function public.notify_join_request_change();

-- ---------------------------------------------------------
-- Trigger: new expense -> notify every other group member.
-- ---------------------------------------------------------
create or replace function public.notify_expense_added()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  creator_name text;
  grp_id uuid;
  grp_name text;
  member_id uuid;
begin
  select username into creator_name from public.profiles where id = new.created_by;
  select g.id, g.name into grp_id, grp_name
  from public.sessions s join public.groups g on g.id = s.group_id
  where s.id = new.session_id;

  for member_id in select user_id from public.group_members where group_id = grp_id and user_id <> new.created_by loop
    insert into public.notifications (user_id, type, title, body, group_id, actor_id)
    values (member_id, 'expense_added', 'New expense in ' || grp_name,
      '@' || creator_name || ' added "' || new.description || '".', grp_id, new.created_by);
  end loop;
  return new;
end;
$$;

create trigger trg_notify_expense_added
after insert on public.expenses
for each row execute function public.notify_expense_added();

-- ---------------------------------------------------------
-- admin_partner_invite_links
--
-- One reusable link per user, same trust model as a group passkey:
-- whoever holds the link and is signed into a REAL (non-guest)
-- account can complete the partnership by opening it -- no need to
-- know their username up front, no separate approval step.
-- ---------------------------------------------------------
create table public.admin_partner_invite_links (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  token text unique not null default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);

alter table public.admin_partner_invite_links enable row level security;
-- No policies on purpose: only ever reached through the RPCs below.

create or replace function public.get_or_create_partner_invite_link()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  tok text;
begin
  if caller is null then raise exception 'Not authenticated'; end if;

  insert into public.admin_partner_invite_links (owner_id)
  values (caller)
  on conflict (owner_id) do nothing;

  select token into tok from public.admin_partner_invite_links where owner_id = caller;
  return tok;
end;
$$;
grant execute on function public.get_or_create_partner_invite_link() to authenticated;

-- Invalidates the old link (e.g. it leaked) and issues a fresh one.
create or replace function public.regenerate_partner_invite_link()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  tok text := replace(gen_random_uuid()::text, '-', '');
begin
  if caller is null then raise exception 'Not authenticated'; end if;

  insert into public.admin_partner_invite_links (owner_id, token, created_at)
  values (caller, tok, now())
  on conflict (owner_id) do update set token = excluded.token, created_at = now();

  return tok;
end;
$$;
grant execute on function public.regenerate_partner_invite_link() to authenticated;

-- Lets the invite-link landing page show who invited them before
-- they've decided anything -- security definer so it works even
-- though the two of them don't share a group yet (profiles RLS would
-- otherwise hide the owner's username). Open to anon too, since a
-- fresh guest hasn't signed up yet when they first open the link.
create or replace function public.get_partner_invite_owner(p_token text)
returns jsonb
language plpgsql
security definer set search_path = public
stable
as $$
declare
  r_owner_id uuid;
  r_username text;
begin
  select l.owner_id, p.username into r_owner_id, r_username
  from public.admin_partner_invite_links l
  join public.profiles p on p.id = l.owner_id
  where l.token = p_token;

  if r_owner_id is null then
    raise exception 'This invite link is no longer valid';
  end if;

  return jsonb_build_object('owner_id', r_owner_id, 'owner_username', r_username);
end;
$$;
grant execute on function public.get_partner_invite_owner(text) to anon, authenticated;

-- The actual accept action. Gated on a REAL account: admin partners
-- get genuine co-admin power over groups, so an anonymous, name-only
-- guest session shouldn't be able to become one just by holding a link.
create or replace function public.accept_partner_invite_link(p_token text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  owner_id uuid;
  owner_username text;
  existing public.admin_partners;
begin
  if caller is null then raise exception 'Not authenticated'; end if;

  if exists (select 1 from auth.users where id = caller and is_anonymous) then
    raise exception 'Create a real account first, then open the invite link again.';
  end if;

  select l.owner_id, p.username into owner_id, owner_username
  from public.admin_partner_invite_links l
  join public.profiles p on p.id = l.owner_id
  where l.token = p_token;

  if owner_id is null then
    raise exception 'This invite link is no longer valid';
  end if;
  if owner_id = caller then
    raise exception 'You cannot partner with yourself';
  end if;

  select * into existing
  from public.admin_partners
  where status in ('pending', 'accepted')
    and least(requester_id, partner_id) = least(caller, owner_id)
    and greatest(requester_id, partner_id) = greatest(caller, owner_id)
  limit 1;

  if existing.id is not null then
    if existing.status = 'accepted' then
      return jsonb_build_object('status', 'already_partners', 'owner_username', owner_username);
    else
      update public.admin_partners set status = 'accepted', decided_at = now() where id = existing.id;
      return jsonb_build_object('status', 'accepted', 'owner_username', owner_username);
    end if;
  end if;

  insert into public.admin_partners (requester_id, partner_id, status, decided_at)
  values (owner_id, caller, 'accepted', now());

  return jsonb_build_object('status', 'accepted', 'owner_username', owner_username);
end;
$$;
grant execute on function public.accept_partner_invite_link(text) to authenticated;
