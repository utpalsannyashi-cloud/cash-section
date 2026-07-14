-- =========================================================
-- Cash Section — Start a member's contribution from a specific expense
-- Adds a fourth contribution_start_source, 'expense', letting an admin
-- pin exactly which expense a member starts sharing costs from — useful
-- when several expenses land on the same calendar date and the coarser
-- 'custom' (date-only) option can't tell them apart (contribution_start_date
-- is a `date`, no time component — see migration 0014).
--
-- Unlike every other contribution source, picking 'expense' retroactively
-- rewrites expense_splits: the chosen expense and every expense on or
-- after it (by created_at, across the whole group) get their equal split
-- recomputed to include the member, shrinking everyone else's share to
-- keep the split summing correctly (see check_expense_splits_sum in
-- 0001_schema.sql). Every other source only ever affects new expenses
-- added going forward — this is the one deliberate exception.
-- =========================================================

alter table public.group_members
  add column contribution_start_expense_id uuid references public.expenses(id) on delete set null;

alter table public.group_members
  drop constraint group_members_contribution_start_source_check;
alter table public.group_members
  add constraint group_members_contribution_start_source_check
    check (contribution_start_source in ('joined_at', 'group_creation', 'custom', 'expense'));

-- Extend the existing derivation trigger from 0014: for 'expense', pull the
-- date from the referenced expense (and require the reference to be set
-- and to actually belong to this group). Every other branch is unchanged.
create or replace function public.check_contribution_start()
returns trigger
language plpgsql
as $$
declare
  v_group_created date;
  v_expense_date date;
begin
  select created_at::date into v_group_created from public.groups where id = new.group_id;

  if new.contribution_start_source = 'joined_at' then
    new.contribution_start_date := new.joined_at::date;
  elsif new.contribution_start_source = 'group_creation' then
    new.contribution_start_date := v_group_created;
  elsif new.contribution_start_source = 'expense' then
    if new.contribution_start_expense_id is null then
      raise exception 'contribution_start_expense_id is required when contribution_start_source is ''expense''';
    end if;
    select e.created_at::date into v_expense_date
    from public.expenses e
    join public.sessions s on s.id = e.session_id
    where e.id = new.contribution_start_expense_id and s.group_id = new.group_id;
    if v_expense_date is null then
      raise exception 'contribution_start_expense_id must reference an expense in this group';
    end if;
    new.contribution_start_date := v_expense_date;
  end if;
  -- 'custom' leaves the caller-supplied contribution_start_date as-is,
  -- subject to the floor check below.

  if new.contribution_start_date < v_group_created then
    raise exception 'Contribution start date (%) can''t be before the group was created (%)',
      new.contribution_start_date, v_group_created;
  end if;

  return new;
end;
$$;

-- =========================================================
-- Retroactively backfills a member into every expense on or after a
-- chosen expense's created_at (inclusive), recomputing each affected
-- expense's equal split to include them — shrinking everyone who was
-- already part of that split, same integer-cents-with-remainder approach
-- used by the client's splitEqually() — then records the choice on
-- group_members (the check_contribution_start trigger above derives
-- contribution_start_date from the expense automatically).
--
-- No security definer here — it runs as the calling user, so the same
-- RLS policies that already let a group admin update/delete/insert
-- expense_splits and update group_members rows for their own group apply
-- exactly as they would to direct calls (see 0002_rls.sql).
-- =========================================================
create or replace function public.set_member_contribution_from_expense(
  p_group_id uuid,
  p_user_id uuid,
  p_expense_id uuid
)
returns void
language plpgsql
as $$
declare
  v_from_created_at timestamptz;
  v_expense record;
  v_ids uuid[];
  v_total_cents integer;
  v_count integer;
  v_base integer;
  v_remainder integer;
  i integer;
begin
  select e.created_at into v_from_created_at
  from public.expenses e
  join public.sessions s on s.id = e.session_id
  where e.id = p_expense_id and s.group_id = p_group_id;

  if v_from_created_at is null then
    raise exception 'Expense not found in this group';
  end if;

  for v_expense in
    select e.id, e.amount
    from public.expenses e
    join public.sessions s on s.id = e.session_id
    where s.group_id = p_group_id and e.created_at >= v_from_created_at
  loop
    -- Whoever was already splitting this expense, plus the new member —
    -- deduplicated, so re-running this is safe if they're already in it.
    select array_agg(distinct user_id) into v_ids
    from (
      select user_id from public.expense_splits where expense_id = v_expense.id
      union
      select p_user_id
    ) u;

    v_total_cents := round(v_expense.amount * 100);
    v_count := array_length(v_ids, 1);
    v_base := v_total_cents / v_count;
    v_remainder := v_total_cents - v_base * v_count;

    delete from public.expense_splits where expense_id = v_expense.id;
    for i in 1..v_count loop
      insert into public.expense_splits (expense_id, user_id, share)
      values (v_expense.id, v_ids[i], (v_base + case when i <= v_remainder then 1 else 0 end) / 100.0);
    end loop;
  end loop;

  update public.group_members
  set contribution_start_source = 'expense',
      contribution_start_expense_id = p_expense_id
  where group_id = p_group_id and user_id = p_user_id;
end;
$$;

grant execute on function public.set_member_contribution_from_expense(uuid, uuid, uuid) to authenticated;

comment on column public.group_members.contribution_start_expense_id is
  'When contribution_start_source is ''expense'', the specific expense this member starts sharing costs from (inclusive). Set via set_member_contribution_from_expense(), which also backfills their share into that expense and every later one, recomputing splits.';
