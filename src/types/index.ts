export type Role = 'admin' | 'member';
export type SessionStatus = 'open' | 'settled';
export type SplitType = 'equal' | 'custom' | 'percentage';
export type Category = 'Food' | 'Travel' | 'Stay' | 'Shopping' | 'Misc';

export interface Profile {
  id: string;
  username: string;
  created_at: string;
}

export interface Group {
  id: string;
  name: string;
  created_by: string;
  invite_code: string;
  created_at: string;
}

export interface GroupMember {
  group_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
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
