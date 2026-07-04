-- =========================================================
-- Cash Section — Core Schema
-- =========================================================
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (char_length(username) between 3 and 24),
  created_at timestamptz not null default now()
);

-- Auto-create a profile row on signup, using the username passed in
-- raw_user_meta_data.username (set at sign-up time from the client).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', 'user_' || substr(new.id::text, 1, 8))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------
-- groups
-- ---------------------------------------------------------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  created_by uuid not null references public.profiles(id),
  invite_code text unique not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin', 'member')) default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- Auto-add the group creator as an admin member.
create or replace function public.handle_new_group()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.created_by, 'admin');
  return new;
end;
$$;

create trigger on_group_created
  after insert on public.groups
  for each row execute function public.handle_new_group();

-- ---------------------------------------------------------
-- sessions (an outing / lunch / dinner / trip)
-- ---------------------------------------------------------
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  status text not null check (status in ('open', 'settled')) default 'open',
  currency text not null default 'INR',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create table public.session_participants (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (session_id, user_id)
);

-- ---------------------------------------------------------
-- expenses
-- ---------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  paid_by uuid not null references public.profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  description text not null check (char_length(description) between 1 and 140),
  category text not null default 'Misc' check (category in ('Food','Travel','Stay','Shopping','Misc')),
  split_type text not null check (split_type in ('equal','custom','percentage')) default 'equal',
  attachment_path text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.expense_splits (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  share numeric(12,2) not null check (share >= 0),
  primary key (expense_id, user_id)
);

-- Ensure the sum of an expense's splits always equals its amount (to the cent).
create or replace function public.check_expense_splits_sum()
returns trigger
language plpgsql
as $$
declare
  expense_amount numeric(12,2);
  split_total numeric(12,2);
begin
  select amount into expense_amount from public.expenses where id = coalesce(new.expense_id, old.expense_id);
  select coalesce(sum(share), 0) into split_total
  from public.expense_splits
  where expense_id = coalesce(new.expense_id, old.expense_id);

  if split_total <> expense_amount then
    raise exception 'Expense splits (%) must sum to the expense amount (%)', split_total, expense_amount;
  end if;
  return new;
end;
$$;

-- Deferred so all rows in a batch insert are in place before the sum is checked.
create constraint trigger trg_check_expense_splits_sum
  after insert or update or delete on public.expense_splits
  deferrable initially deferred
  for each row execute function public.check_expense_splits_sum();

-- Block new expenses on a settled session.
create or replace function public.check_session_open()
returns trigger
language plpgsql
as $$
declare
  session_status text;
begin
  select status into session_status from public.sessions where id = new.session_id;
  if session_status = 'settled' then
    raise exception 'Cannot add expenses to a settled session';
  end if;
  return new;
end;
$$;

create trigger trg_check_session_open
  before insert on public.expenses
  for each row execute function public.check_session_open();

-- ---------------------------------------------------------
-- settlements (computed transfers for a session)
-- ---------------------------------------------------------
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  from_user uuid not null references public.profiles(id),
  to_user uuid not null references public.profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  is_paid boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- Helper: join a group via invite code (security definer so it
-- works cleanly even though group_members has restrictive RLS).
-- ---------------------------------------------------------
create or replace function public.join_group_by_code(code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  target_group_id uuid;
begin
  select id into target_group_id from public.groups where invite_code = code;
  if target_group_id is null then
    raise exception 'Invalid invite code';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (target_group_id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return target_group_id;
end;
$$;

-- Helper used throughout RLS policies: is the current user a member of a group?
create or replace function public.is_group_member(check_group_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.group_members
    where group_id = check_group_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_group_admin(check_group_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.group_members
    where group_id = check_group_id and user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.group_id_for_session(check_session_id uuid)
returns uuid
language sql
security definer set search_path = public
stable
as $$
  select group_id from public.sessions where id = check_session_id;
$$;

create or replace function public.group_id_for_expense(check_expense_id uuid)
returns uuid
language sql
security definer set search_path = public
stable
as $$
  select s.group_id from public.expenses e
  join public.sessions s on s.id = e.session_id
  where e.id = check_expense_id;
$$;

-- Indexes for common lookups
create index idx_group_members_user on public.group_members(user_id);
create index idx_sessions_group on public.sessions(group_id);
create index idx_expenses_session on public.expenses(session_id);
create index idx_expense_splits_user on public.expense_splits(user_id);
create index idx_settlements_session on public.settlements(session_id);
