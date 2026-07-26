-- =========================================================
-- Cash Section — a settable date on an expense
--
-- The add-expense form had no date field: expenses.created_at just took
-- its default of now(). That's fine when you log a bill at the table,
-- and wrong whenever you're entering something from a few days ago.
--
-- The whole app already treats created_at as "when the expense
-- happened" — ExpenseCard prints it, GroupDashboard orders by it, and
-- set_member_contribution_from_expense (0015) compares it. So rather
-- than introduce a second date column and update every one of those
-- read sites, created_at becomes user-settable and a new entered_at
-- column takes over the audit role it was quietly doubling as.
--
--   created_at  -> the date the expense happened   (user-settable)
--   entered_at  -> when the row was actually written (never edited)
--
-- Dates are unconstrained on purpose, including future ones, so a
-- prepaid booking can be logged against the day it's for.
-- =========================================================

alter table public.expenses
  add column entered_at timestamptz not null default now();

-- Existing rows: the row really was created when created_at says, since
-- nothing could change it before now.
update public.expenses set entered_at = created_at;

comment on column public.expenses.created_at is
  'The date the expense happened. Set by the client, defaults to now(). Sorted and displayed by the UI.';
comment on column public.expenses.entered_at is
  'When the row was written. Audit only — never edited, never shown.';

-- Kept out of the client's reach: nothing should be able to rewrite the
-- audit timestamp, including via the update_expense RPC below.
create or replace function public.freeze_entered_at()
returns trigger
language plpgsql
as $$
begin
  new.entered_at := old.entered_at;
  return new;
end;
$$;

create trigger trg_freeze_entered_at
before update on public.expenses
for each row execute function public.freeze_entered_at();

-- ---------------------------------------------------------
-- update_expense gains p_created_at.
--
-- Note this function was never in a migration file — it existed only in
-- the database. Recreating it here brings it under version control.
-- Dropped rather than replaced because adding a parameter would leave
-- two overloads that PostgREST can't choose between.
--
-- security invoker (as before): the caller's own RLS decides whether
-- they may touch this expense.
-- ---------------------------------------------------------
drop function if exists public.update_expense(uuid, text, numeric, text, uuid, text, text, jsonb);

create or replace function public.update_expense(
  p_expense_id uuid,
  p_description text,
  p_amount numeric,
  p_category text,
  p_paid_by uuid,
  p_split_type text,
  p_attachment_path text,
  p_splits jsonb,
  p_created_at timestamptz default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.expenses
  set description = p_description,
      amount = p_amount,
      category = p_category,
      paid_by = p_paid_by,
      split_type = p_split_type,
      attachment_path = p_attachment_path,
      -- Null means "leave the date alone", so an older client that
      -- doesn't send the parameter keeps working unchanged.
      created_at = coalesce(p_created_at, created_at)
  where id = p_expense_id;

  -- Replace the split rows wholesale. The splits-sum check is a
  -- deferred constraint trigger, so the table is allowed to be
  -- momentarily inconsistent between the delete and the insert.
  delete from public.expense_splits where expense_id = p_expense_id;

  insert into public.expense_splits (expense_id, user_id, share)
  select p_expense_id, (elem ->> 'user_id')::uuid, (elem ->> 'share')::numeric
  from jsonb_array_elements(p_splits) as elem;
end;
$$;

grant execute on function public.update_expense(uuid, text, numeric, text, uuid, text, text, jsonb, timestamptz) to anon, authenticated;

create index if not exists idx_expenses_created_at on public.expenses (created_at desc);
