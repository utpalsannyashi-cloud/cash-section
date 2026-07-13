-- =========================================================
-- Cash Section — Per-member contribution start date
-- Lets a group admin decide, per member, when their cost-sharing
-- "clock" starts:
--   - joined_at       (default — matches current behavior exactly)
--   - group_creation  (liable since the group started, even if they
--                      actually joined later)
--   - custom          (any admin-chosen date, but never before the
--                      group itself existed)
--
-- Enforcement happens on the read side, not by rewriting history: a
-- member is only included in NEW equal-split expenses once today's
-- date reaches their contribution_start_date. Expenses already saved
-- (and their expense_splits) are never retroactively rewritten by this
-- migration — see src/pages/GroupDashboard.tsx for where the filter
-- is applied.
-- =========================================================

alter table public.group_members
  add column contribution_start_date date,
  add column contribution_start_source text not null default 'joined_at'
    check (contribution_start_source in ('joined_at', 'group_creation', 'custom'));

-- Backfill: every existing member keeps contributing from the date
-- they actually joined — i.e. this migration changes nothing about
-- today's behavior until an admin actively picks a different option.
update public.group_members
  set contribution_start_date = joined_at::date
  where contribution_start_date is null;

alter table public.group_members
  alter column contribution_start_date set not null,
  alter column contribution_start_date set default current_date;

-- Keeps contribution_start_date in sync with its chosen source, and
-- guarantees it can never predate the group's own creation — whether
-- the row is touched through the app or edited directly in the SQL
-- editor.
create or replace function public.check_contribution_start()
returns trigger
language plpgsql
as $$
declare
  v_group_created date;
begin
  select created_at::date into v_group_created from public.groups where id = new.group_id;

  if new.contribution_start_source = 'joined_at' then
    new.contribution_start_date := new.joined_at::date;
  elsif new.contribution_start_source = 'group_creation' then
    new.contribution_start_date := v_group_created;
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

create trigger trg_check_contribution_start
  before insert or update on public.group_members
  for each row execute function public.check_contribution_start();

comment on column public.group_members.contribution_start_source is
  'Which preset the admin picked: joined_at (default), group_creation (liable since the group started, even if they joined later), or custom (contribution_start_date set explicitly).';
comment on column public.group_members.contribution_start_date is
  'The date this member starts being included in new equal-split expenses. Auto-derived from contribution_start_source unless source is ''custom''. Existing expense_splits are never rewritten when this changes.';
