-- =========================================================
-- Cash Section — Deleting an expense pinned as a member's contribution
-- start point must not block the delete.
--
-- Migration 0015 added contribution_start_expense_id (FK, on delete set
-- null) plus a guard in check_contribution_start() that requires
-- contribution_start_expense_id whenever contribution_start_source =
-- 'expense'. Those two conflict: when the referenced expense is
-- deleted, Postgres's FK action issues an UPDATE that nulls
-- contribution_start_expense_id but leaves contribution_start_source
-- untouched at 'expense' — the BEFORE UPDATE trigger (still 'expense',
-- now null id) immediately rejects that with "contribution_start_expense_id
-- is required when contribution_start_source is 'expense'", aborting the
-- whole DELETE. Confirmed live: deleting the "Trial" expense in
-- Food and Beverages (Delhi), pinned as Maomao's contribution start,
-- failed with exactly this error.
--
-- Fix: a BEFORE DELETE trigger on expenses proactively reverts any
-- group_member row pinned to the expense being deleted back to the
-- 'joined_at' source before the delete happens. By the time the FK's
-- own ON DELETE SET NULL action runs, no row still references the
-- expense, so it's a no-op and nothing conflicts.
--
-- security definer: the expense being deleted may belong to a non-admin
-- creator (expenses_delete_creator_or_admin allows creator-or-admin),
-- but resetting another member's contribution_start_* columns requires
-- admin per group_members_update_admin. This maintenance update must
-- succeed regardless of who deleted the expense, so it runs with
-- elevated privilege rather than the deleting user's own RLS context —
-- same convention as is_group_admin/is_group_member in 0006.
-- =========================================================

create or replace function public.clear_contribution_start_on_expense_delete()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.group_members
  set contribution_start_source = 'joined_at',
      contribution_start_expense_id = null
  where contribution_start_expense_id = old.id;

  return old;
end;
$$;

drop trigger if exists trg_clear_contribution_start_on_expense_delete on public.expenses;
create trigger trg_clear_contribution_start_on_expense_delete
  before delete on public.expenses
  for each row execute function public.clear_contribution_start_on_expense_delete();
