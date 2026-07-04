-- =========================================================
-- Cash Section — Row Level Security
-- =========================================================
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.sessions enable row level security;
alter table public.session_participants enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlements enable row level security;

-- ---------------------------------------------------------
-- profiles
-- ---------------------------------------------------------
-- Read: your own profile, or anyone who shares a group with you.
create policy "profiles_select" on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1 from public.group_members gm1
      join public.group_members gm2 on gm1.group_id = gm2.group_id
      where gm1.user_id = auth.uid() and gm2.user_id = profiles.id
    )
  );

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());

-- ---------------------------------------------------------
-- groups
-- ---------------------------------------------------------
create policy "groups_select_members" on public.groups
  for select using (public.is_group_member(id));

create policy "groups_insert_any_authenticated" on public.groups
  for insert with check (created_by = auth.uid());

create policy "groups_update_admin" on public.groups
  for update using (public.is_group_admin(id));

create policy "groups_delete_admin" on public.groups
  for delete using (public.is_group_admin(id));

-- ---------------------------------------------------------
-- group_members
-- ---------------------------------------------------------
create policy "group_members_select" on public.group_members
  for select using (public.is_group_member(group_id));

-- Inserts normally go through join_group_by_code() (security definer),
-- but allow a direct insert only by a group admin (e.g. manual add).
create policy "group_members_insert_admin" on public.group_members
  for insert with check (public.is_group_admin(group_id));

create policy "group_members_update_admin" on public.group_members
  for update using (public.is_group_admin(group_id));

create policy "group_members_delete_admin_or_self" on public.group_members
  for delete using (public.is_group_admin(group_id) or user_id = auth.uid());

-- ---------------------------------------------------------
-- sessions
-- ---------------------------------------------------------
create policy "sessions_select" on public.sessions
  for select using (public.is_group_member(group_id));

create policy "sessions_insert" on public.sessions
  for insert with check (public.is_group_member(group_id) and created_by = auth.uid());

create policy "sessions_update_admin_or_creator" on public.sessions
  for update using (
    public.is_group_admin(group_id) or created_by = auth.uid()
  );

create policy "sessions_delete_admin" on public.sessions
  for delete using (public.is_group_admin(group_id));

-- ---------------------------------------------------------
-- session_participants
-- ---------------------------------------------------------
create policy "session_participants_select" on public.session_participants
  for select using (public.is_group_member(public.group_id_for_session(session_id)));

create policy "session_participants_insert" on public.session_participants
  for insert with check (public.is_group_member(public.group_id_for_session(session_id)));

create policy "session_participants_delete" on public.session_participants
  for delete using (public.is_group_member(public.group_id_for_session(session_id)));

-- ---------------------------------------------------------
-- expenses
-- ---------------------------------------------------------
create policy "expenses_select" on public.expenses
  for select using (public.is_group_member(public.group_id_for_session(session_id)));

create policy "expenses_insert" on public.expenses
  for insert with check (
    public.is_group_member(public.group_id_for_session(session_id))
    and created_by = auth.uid()
  );

create policy "expenses_update_creator_or_admin" on public.expenses
  for update using (
    created_by = auth.uid()
    or public.is_group_admin(public.group_id_for_session(session_id))
  );

create policy "expenses_delete_creator_or_admin" on public.expenses
  for delete using (
    created_by = auth.uid()
    or public.is_group_admin(public.group_id_for_session(session_id))
  );

-- ---------------------------------------------------------
-- expense_splits
-- ---------------------------------------------------------
create policy "expense_splits_select" on public.expense_splits
  for select using (public.is_group_member(public.group_id_for_expense(expense_id)));

create policy "expense_splits_insert" on public.expense_splits
  for insert with check (public.is_group_member(public.group_id_for_expense(expense_id)));

create policy "expense_splits_update" on public.expense_splits
  for update using (
    exists (
      select 1 from public.expenses e
      where e.id = expense_splits.expense_id
      and (e.created_by = auth.uid() or public.is_group_admin(public.group_id_for_expense(e.id)))
    )
  );

create policy "expense_splits_delete" on public.expense_splits
  for delete using (
    exists (
      select 1 from public.expenses e
      where e.id = expense_splits.expense_id
      and (e.created_by = auth.uid() or public.is_group_admin(public.group_id_for_expense(e.id)))
    )
  );

-- ---------------------------------------------------------
-- settlements
-- ---------------------------------------------------------
create policy "settlements_select" on public.settlements
  for select using (public.is_group_member(public.group_id_for_session(session_id)));

create policy "settlements_insert_admin" on public.settlements
  for insert with check (public.is_group_admin(public.group_id_for_session(session_id)));

-- Any participant can mark a transfer as paid; only admin can otherwise edit.
create policy "settlements_update" on public.settlements
  for update using (
    from_user = auth.uid()
    or to_user = auth.uid()
    or public.is_group_admin(public.group_id_for_session(session_id))
  );

create policy "settlements_delete_admin" on public.settlements
  for delete using (public.is_group_admin(public.group_id_for_session(session_id)));
