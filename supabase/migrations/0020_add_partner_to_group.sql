-- =========================================================
-- Cash Section — add an admin partner to an existing group
-- =========================================================
-- Pairing up as admin partners (migration 0018) deliberately only
-- affected NEW groups going forward — accepting a partner request
-- was never supposed to silently change who could administer a group
-- someone had already created. This adds the other half: an explicit,
-- per-group action letting an admin bring an accepted partner into a
-- group that already existed before the partnership did (or one they
-- simply chose to create solo at the time). Nothing happens
-- automatically — the admin picks the group (via its long-press menu
-- in Groups.tsx), then picks the partner.
create or replace function public.add_partner_to_group(p_group_id uuid, p_partner_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  was_already_admin boolean;
begin
  if caller is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'Only an admin of this group can add a co-admin';
  end if;

  if not exists (
    select 1 from public.admin_partners
    where status = 'accepted'
    and ((requester_id = caller and partner_id = p_partner_id)
      or (requester_id = p_partner_id and partner_id = caller))
  ) then
    raise exception 'You can only add an accepted admin partner';
  end if;

  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = p_partner_id and role = 'admin'
  ) into was_already_admin;

  -- Promotes an existing plain member to admin, or adds them fresh —
  -- either way they end up an admin of this one group. Their
  -- contribution_start_date/source fall back to trg_check_contribution_start's
  -- normal defaults (joined_at), same as any other new member.
  insert into public.group_members (group_id, user_id, role)
  values (p_group_id, p_partner_id, 'admin')
  on conflict (group_id, user_id) do update set role = 'admin';

  return jsonb_build_object('already_admin', was_already_admin);
end;
$$;

grant execute on function public.add_partner_to_group(uuid, uuid) to authenticated;
