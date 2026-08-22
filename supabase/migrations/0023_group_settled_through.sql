-- =========================================================
-- Cash Section — settlement checkpoint column (settled_through)
-- =========================================================
-- "Add settlement checkpoint (start a fresh round)" (see GroupDashboard.tsx,
-- handleStartFreshRound / handleResetSettlementCheckpoint) shipped a
-- frontend-only feature: the code reads and writes groups.settled_through,
-- and the Group TS type declares it, but no migration ever added the
-- column to the actual table. In practice this meant:
--
--   - Clicking "Start a fresh round from today" issued an update() the
--     PostgREST schema cache rejected (unknown column); the error was
--     never checked, so it failed silently.
--   - group.settled_through was therefore always undefined on every load,
--     so the `if (group?.settled_through)` guards in GroupDashboard.tsx
--     never filtered anything, and every "Split up" / "Re-split" kept
--     recomputing the settlement across every expense ever added to the
--     group — including ones an admin believed were already checkpointed
--     away, e.g. right after adding a new member with a backdated
--     contribution_start_date.
--
-- (Per-member contribution_start_date, from migration 0014, only ever
-- gates whether a member is folded into a NEW equal-split expense at
-- creation time — it was never meant to filter historical expenses out
-- of a settlement recompute. settled_through is the only mechanism for
-- that, so it has to actually exist for "start a fresh round" to work.)
--
-- This migration adds the missing column so the existing frontend code
-- starts working as designed. No backfill needed — null (the column's
-- default) means "include everything", which matches every group's
-- current behavior exactly.
alter table public.groups
  add column settled_through timestamptz;

comment on column public.groups.settled_through is
  'Expenses created at or before this timestamp are excluded from the next settlement computation ("Start a fresh round"). Null means include everything. Set/cleared from GroupDashboard.tsx; independent of marked_settled (migration 0019), which is a purely cosmetic admin toggle.';
