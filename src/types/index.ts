export type Role = 'admin' | 'member';
export type SessionStatus = 'open' | 'settled';
export type SplitType = 'equal' | 'custom' | 'percentage';
export type Category = 'Food' | 'Travel' | 'Stay' | 'Shopping' | 'Misc';
export type ContributionSource = 'joined_at' | 'group_creation' | 'custom' | 'expense';

export interface Profile {
  id: string;
  username: string;
  created_at: string;
  is_master_admin?: boolean;
}

export interface Group {
  id: string;
  name: string;
  created_by: string;
  invite_code: string;
  access_code: string;
  created_at: string;
  // Explicit, admin-set designation that every expense in this group has
  // been settled up — toggled from the groups list (see migration 0019).
  // Independent of the computed settlement rows shown in a group's own
  // Settle Up tab; nobody's expenses being auto-marked settled just
  // because there was nothing to split.
  marked_settled: boolean;
  settled_at: string | null;
  // Expenses at or before this are excluded from the next settlement
  // computation. Null means include everything.
  settled_through: string | null;
}

export interface GroupMember {
  group_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
  contribution_start_date: string;
  contribution_start_source: ContributionSource;
  contribution_start_expense_id: string | null;
  profile?: Profile;
}

export interface Session {
  id: string;
  group_id: string;
  title: string;
  status: SessionStatus;
  currency: string;
  created_by: string;
  created_at: string;
  settled_at: string | null;
  access_code: string;
}

export interface ExpenseSplit {
  expense_id: string;
  user_id: string;
  share: number;
  profile?: Profile;
}

export interface Expense {
  id: string;
  session_id: string;
  paid_by: string;
  amount: number;
  description: string;
  category: Category;
  split_type: SplitType;
  attachment_path: string | null;
  created_by: string;
  created_at: string;
  // Manual per-expense strike-through, toggled via the "Settled" action
  // next to Edit/Delete — independent of the group-wide settled_through
  // checkpoint. Purely cosmetic; never affects settlement computation.
  // See migration 0025.
  marked_settled: boolean;
  settled_at: string | null;
  payer?: Profile;
  splits?: ExpenseSplit[];
}

export interface Settlement {
  id: string;
  session_id: string;
  from_user: string;
  to_user: string;
  amount: number;
  is_paid: boolean;
  created_at: string;
  from_profile?: Profile;
  to_profile?: Profile;
}

/**
 * An accepted pairing with another account for jointly administering
 * groups created going forward — like a joint bank account alongside
 * your own individual one. Shaped to match what the list_admin_partners
 * RPC returns: the OTHER person's id/username, already resolved
 * server-side (see migration 0018).
 */
export interface AdminPartner {
  id: string;
  partner_user_id: string;
  partner_username: string;
  since: string | null;
}

/**
 * A pending admin-partner invite, from either side. Matches
 * list_partner_requests — one call covers both directions so the
 * client doesn't need to reconcile two separate queries.
 */
export interface PartnerRequest {
  id: string;
  direction: 'incoming' | 'outgoing';
  other_user_id: string;
  other_username: string;
  requested_at: string;
}

export type NotificationType =
  | 'partner_invite'
  | 'partner_accepted'
  | 'partner_declined'
  | 'join_request'
  | 'join_approved'
  | 'join_denied'
  | 'expense_added';

/**
 * A single item in the notification bell. Server-populated only — see
 * migration 0022's triggers on admin_partners/join_requests/expenses.
 * `group_id`/`actor_id` are convenience references for navigating to
 * the relevant group or showing who triggered it; either can be null
 * (e.g. a partner invite has no group_id).
 */
export interface AppNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  group_id: string | null;
  actor_id: string | null;
  read: boolean;
  created_at: string;
}
