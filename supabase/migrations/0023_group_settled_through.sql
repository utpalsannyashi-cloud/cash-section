-- =========================================================
-- Cash Section — settlement checkpoint column (settled_through)
-- =========================================================
-- "Add settlement checkpoint (start a fresh round)" (see GroupDashboard.tsx,
-- handleStartFreshRound / handleResetSettlementCheckpoint) shipped a working
-- feature — the column was added directly against the database on
-- 2026-08-10, the same day as the frontend code — but no matching file was
-- ever checked into supabase/migrations, so this repo's migration history
-- didn't actually reflect the live schema. This file reconciles that: it's
-- written to be safe to run against a database that already has the column
-- (production) as well as one that doesn't (a fresh environment built from
-- this repo's migrations alone, which — until now — would have been missing
-- it).
--
-- (Per-member contribution_start_date, from migration 0014, only ever gates
-- whether a member is folded into a NEW equal-split expense at creation
-- time — it was never meant to, and doesn't, filter historical expenses out
-- of a settlement recompute. settled_through is the only mechanism for
-- that, and it's a separate, manually-triggered action from setting a
-- member's contribution start date — see the "also start a fresh round"
-- checkbox added to the contribution-start modal in GroupDashboard.tsx,
-- which bridges the two so admins don't have to discover this on their own.)
alter table public.groups
add column if not exists settled_through timestamptz;

comment on column public.groups.settled_through is
'Expenses created at or before this timestamp are excluded from the next settlement computation ("Start a fresh round"). Null means include everything. Set/cleared from GroupDashboard.tsx; independent of marked_settled (migration 0019), which is a purely cosmetic admin toggle.';
