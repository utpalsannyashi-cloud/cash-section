-- =========================================================
-- Cash Section — Passkey-based session access for guests
-- Lets the admin share a per-session spoken passkey with a trip's
-- members instead of requiring them to create a full account.
-- Guests authenticate via Supabase anonymous sign-in (auth.uid()
-- still exists) and are scoped to exactly the session they unlock —
-- never to the rest of that group.
-- =========================================================

alter table public.sessions
  add column access_code text unique not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

-- ---------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------
create or replace function public.is_session_participant(check_session_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.session_participants
    where session_id = check_session_id and user_id = auth.uid()
  );
$$;

create or replace function public.session_id_for_expense(check_expense_id uuid)
returns uuid
language sql
security definer set search_path = public
stable
as $$
  select session_id from public.expenses where id = check_expense_id;
$$;

-- Path convention is bills/{group_id}/{session_id}/{expense_id}-{filename};
-- this pulls out the second segment.
create or replace function public.session_id_from_storage_path(object_path text)
returns uuid
language sql
immutable
as $$
  select (string_to_array(object_path, '/'))[2]::uuid;
$$;

-- ---------------------------------------------------------
-- Guest entry points
-- ---------------------------------------------------------

-- Anyone (even before unlocking any session) can see a lightweight,
-- non-financial list of sessions so they can recognize their trip
-- before asking the admin for its passkey.
create or replace function public.list_browsable_sessions()
returns table (
  id uuid,
  title text,
  status text,
  currency text,
  created_at timestamptz,
  group_name text
)
language sql
security definer set search_path = public
stable
as $$
  select s.id, s.title, s.status, s.currency, s.created_at, g.name
  from public.sessions s
  join public.groups g on g.id = s.group_id
  order by s.created_at desc;
$$;

grant execute on function public.list_browsable_sessions() to anon, authenticated;

-- Verifies a session passkey and grants the calling user session-scoped
-- access by adding them to session_participants only (never group_members),
-- so a guest never sees more than the one session they unlocked.
create or replace function public.unlock_session_by_code(code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  target_session_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select id into target_session_id from public.sessions where access_code = lower(code);
  if target_session_id is null then
    raise exception 'Invalid passkey';
  end if;

  insert into public.session_participants (session_id, user_id)
  values (target_session_id, auth.uid())
  on conflict (session_id, user_id) do nothing;

  return target_session_id;
end;
$$;

grant execute on function public.unlock_session_by_code(text) to anon, authenticated;

-- ---------------------------------------------------------
-- RLS: session participants (passkey guests) get the same read
-- access as full group members, scoped to just that session.
-- ---------------------------------------------------------
drop policy if exists "sessions_select" on public.sessions;
create policy "sessions_select" on public.sessions
  for select using (
    public.is_group_member(group_id) or public.is_session_participant(id)
  );

drop policy if exists "session_participants_select" on public.session_participants;
create policy "session_participants_select" on public.session_participants
  for select using (
    public.is_group_member(public.group_id_for_session(session_id))
    or public.is_session_participant(session_id)
  );

drop policy if exists "expenses_select" on public.expenses;
create policy "expenses_select" on public.expenses
  for select using (
    public.is_group_member(public.group_id_for_session(session_id))
    or public.is_session_participant(session_id)
  );

drop policy if exists "expenses_insert" on public.expenses;
create policy "expenses_insert" on public.expenses
  for insert with check (
    (
      public.is_group_member(public.group_id_for_session(session_id))
      or public.is_session_participant(session_id)
    )
    and created_by = auth.uid()
  );

drop policy if exists "expense_splits_select" on public.expense_splits;
create policy "expense_splits_select" on public.expense_splits
  for select using (
    public.is_group_member(public.group_id_for_expense(expense_id))
    or public.is_session_participant(public.session_id_for_expense(expense_id))
  );

drop policy if exists "expense_splits_insert" on public.expense_splits;
create policy "expense_splits_insert" on public.expense_splits
  for insert with check (
    public.is_group_member(public.group_id_for_expense(expense_id))
    or public.is_session_participant(public.session_id_for_expense(expense_id))
  );

drop policy if exists "settlements_select" on public.settlements;
create policy "settlements_select" on public.settlements
  for select using (
    public.is_group_member(public.group_id_for_session(session_id))
    or public.is_session_participant(session_id)
  );

-- Previously admin-only; a session's own participants (which normally
-- include everyone picked when the session was created) can now also
-- trigger the settlement calculation for their own open session.
drop policy if exists "settlements_insert_admin" on public.settlements;
create policy "settlements_insert" on public.settlements
  for insert with check (
    public.is_group_admin(public.group_id_for_session(session_id))
    or public.is_session_participant(session_id)
  );

-- ---------------------------------------------------------
-- Storage: session-scoped guests can view/upload bill photos for
-- their own session without needing full group membership.
-- ---------------------------------------------------------
drop policy if exists "bills_select_group_members" on storage.objects;
create policy "bills_select_group_members" on storage.objects
  for select using (
    bucket_id = 'bills'
    and (
      public.is_group_member(public.group_id_from_storage_path(name))
      or public.is_session_participant(public.session_id_from_storage_path(name))
    )
  );

drop policy if exists "bills_insert_group_members" on storage.objects;
create policy "bills_insert_group_members" on storage.objects
  for insert with check (
    bucket_id = 'bills'
    and (
      public.is_group_member(public.group_id_from_storage_path(name))
      or public.is_session_participant(public.session_id_from_storage_path(name))
    )
  );

create index idx_sessions_access_code on public.sessions(access_code);
