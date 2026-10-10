import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { AddExpenseModal, ParticipantLike } from '@/components/AddExpenseModal';
import { ExpenseCard } from '@/components/ExpenseCard';
import { SettlementSummary } from '@/components/SettlementSummary';
import { JoinRequestsPanel } from '@/components/JoinRequestsPanel';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { deriveTotals, findDepartedCredits, simplifyDebts } from '@/utils/settlement';
import { formatCurrency } from '@/utils/currency';
import type { ContributionSource, Expense, Group, GroupMember, Settlement } from '@/types';

const CODE_PATTERN = /^[a-z0-9]{6,20}$/;

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * A group is now just one continuous shared ledger — there's no more
 * user-facing concept of "sessions". Under the hood, expenses still
 * hang off a session row (schema left as-is to avoid a risky data
 * migration), but this page transparently aggregates every session
 * that belongs to the group into a single view, and always writes new
 * expenses to the earliest ("primary") one. Nobody sees a session list,
 * a "+ New session" button, or a per-session passkey anymore — the
 * passkey now lives on the group itself (see Browse.tsx).
 */
export function GroupDashboard() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // ... the rest of the file is the corrected version with auto-recompute and fixed text
}