-- =========================================================
-- Cash Section — manual settled toggle for groups
-- =========================================================
-- The "Settled up" badge on the groups list used to be computed purely
-- from settlement rows: a group with no debts to split (e.g. a single
-- member paying only themselves) showed up as "settled" even though
-- nobody had actually decided that. This replaces the computed badge
-- with an explicit, reversible flag the group's admin sets themselves,
-- independent of whatever the group's own Settle Up tab computes.
--
-- No RLS changes needed: groups_select_members already exposes the
-- whole row (including these new columns) to every member, and
-- groups_update_admin already permits an admin to update any column on
-- their group — the same policy that already lets Groups.tsx rename a
-- group or change its passkey via a plain client-side update() call.
alter table public.groups
  add column marked_settled boolean not null default false,
  add column settled_at timestamptz;

comment on column public.groups.marked_settled is
  'Explicit admin designation that this group''s expenses are all settled up. Toggled from the groups list; independent of computed settlement rows.';
comment on column public.groups.settled_at is
  'When marked_settled was last set to true. Cleared back to null when toggled off.';
