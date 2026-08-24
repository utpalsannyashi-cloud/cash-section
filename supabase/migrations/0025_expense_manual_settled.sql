-- =========================================================
-- Cash Section — manual settled toggle for individual expenses
-- =========================================================
-- Mirrors migration 0019's group-level marked_settled/settled_at: a
-- member with canManage (the expense's creator, or a group admin — the
-- same gate that already shows Edit/Delete) can strike an individual
-- expense through in the list via a "Settled" action right next to
-- Edit/Delete, independent of the group-wide settled_through checkpoint
-- (0023) that gates what actually counts in the next split.
--
-- Two different "settled" concepts intentionally coexist:
--   - settled_through (0023) is a computed batch checkpoint — everything
--     at or before it is excluded from settlement computation.
--   - marked_settled here is a manual per-expense note — purely visual,
--     it does NOT exclude the expense from being split. An expense can
--     be manually marked settled long before (or after) settled_through
--     ever reaches it.
--
-- No new RLS policy needed: expenses_update_creator_or_admin (0002)
-- already lets the same people who can Edit/Delete an expense update
-- any of its columns, including these two — same reasoning as 0019's
-- groups_update_admin note.
alter table public.expenses
  add column marked_settled boolean not null default false,
  add column settled_at timestamptz;

comment on column public.expenses.marked_settled is
  'Manually toggled via the "Settled" action next to Edit/Delete on an expense — strikes it through in the list. Independent of settled_through (0023); purely cosmetic and does not affect settlement computation.';
comment on column public.expenses.settled_at is
  'When marked_settled was last set to true. Cleared back to null when toggled off.';
