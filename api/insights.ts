import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Server-only clients/keys — never exposed to the browser.
const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
  auth: { persistSession: false }
});

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY as string;

interface InsightsBody {
  // Omitted entirely for the master-admin "all groups" view -- every other
  // caller always sends the single group they're asking about.
  groupId?: string;
  question: string;
}

async function askDeepSeek(summary: unknown, question: string): Promise<{ status: number; body: { answer?: string; error?: string } }> {
  try {
    const deepseekRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content:
              'You are a financial insights assistant for a group expense-splitting app called Cash Section. ' +
              'Answer the admin\'s questions about spending patterns, per-person totals, category breakdowns, ' +
              'and anomalies using ONLY the JSON data provided below. Be concise and use ₹ for amounts. ' +
              'If the data cannot answer the question, say so plainly instead of guessing.\n\n' +
              `DATA: ${JSON.stringify(summary)}`
          },
          { role: 'user', content: question }
        ],
        temperature: 0.3,
        stream: false
      })
    });

    if (!deepseekRes.ok) {
      const text = await deepseekRes.text();
      return { status: 502, body: { error: `DeepSeek error: ${text}` } };
    }

    const data = await deepseekRes.json();
    const answer = data.choices?.[0]?.message?.content ?? 'No response generated.';
    return { status: 200, body: { answer } };
  } catch (err: any) {
    return { status: 500, body: { error: err.message ?? 'Failed to reach DeepSeek' } };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing auth token' });
    return;
  }
  const token = authHeader.replace('Bearer ', '');

  const { groupId, question } = req.body as InsightsBody;
  if (!question) {
    res.status(400).json({ error: 'question is required' });
    return;
  }

  // 1. Verify the caller's identity from their Supabase JWT.
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }
  const userId = userData.user.id;

  const { data: profile } = await supabaseAdmin.from('profiles').select('is_master_admin').eq('id', userId).single();
  const isMasterAdmin = Boolean(profile?.is_master_admin);

  // No groupId at all means the caller is asking about every group at once
  // -- only the master admin gets that view, mirroring the same oversight
  // scope as the /master dashboard.
  if (!groupId) {
    if (!isMasterAdmin) {
      res.status(403).json({ error: 'Only the master admin can ask about spending across every group.' });
      return;
    }

    const { data: groups } = await supabaseAdmin.from('groups').select('id, name');
    if (!groups || groups.length === 0) {
      res.status(200).json({ answer: "There are no groups yet, so I don't have anything to analyze." });
      return;
    }
    const groupNameById = new Map(groups.map((g) => [g.id, g.name]));

    const { data: sessions } = await supabaseAdmin.from('sessions').select('id, group_id');
    const groupIdBySession = new Map((sessions ?? []).map((s) => [s.id, s.group_id]));
    const sessionIds = (sessions ?? []).map((s) => s.id);

    const { data: expenses } = await supabaseAdmin
      .from('expenses')
      .select('id, session_id, amount, category, payer:profiles!expenses_paid_by_fkey(username)')
      .in('session_id', sessionIds.length ? sessionIds : ['00000000-0000-0000-0000-000000000000']);

    const expenseIds = (expenses ?? []).map((e) => e.id);
    const { data: splits } = await supabaseAdmin
      .from('expense_splits')
      .select('share, expense_id, profile:profiles(username)')
      .in('expense_id', expenseIds.length ? expenseIds : ['00000000-0000-0000-0000-000000000000']);

    const splitsByExpense = new Map<string, { share: number; username: string }[]>();
    for (const s of splits ?? []) {
      const list = splitsByExpense.get((s as any).expense_id) ?? [];
      list.push({ share: Number(s.share), username: (s as any).profile?.username ?? 'unknown' });
      splitsByExpense.set((s as any).expense_id, list);
    }

    // Per-group breakdown, plus a running overall total across every group.
    const perGroup = new Map<
      string,
      { totalSpend: number; expenseCount: number; paidByUsername: Record<string, number>; spendByCategory: Record<string, number> }
    >();
    const overallPaidByUsername: Record<string, number> = {};
    const overallConsumedByUsername: Record<string, number> = {};
    const overallSpendByCategory: Record<string, number> = {};

    for (const e of expenses ?? []) {
      const gid = groupIdBySession.get(e.session_id) ?? 'unknown';
      const groupName = groupNameById.get(gid) ?? 'unknown group';
      const username = (e as any).payer?.username ?? 'unknown';
      const amount = Number(e.amount);

      if (!perGroup.has(groupName)) {
        perGroup.set(groupName, { totalSpend: 0, expenseCount: 0, paidByUsername: {}, spendByCategory: {} });
      }
      const bucket = perGroup.get(groupName)!;
      bucket.totalSpend += amount;
      bucket.expenseCount += 1;
      bucket.paidByUsername[username] = (bucket.paidByUsername[username] ?? 0) + amount;
      bucket.spendByCategory[e.category] = (bucket.spendByCategory[e.category] ?? 0) + amount;

      overallPaidByUsername[username] = (overallPaidByUsername[username] ?? 0) + amount;
      overallSpendByCategory[e.category] = (overallSpendByCategory[e.category] ?? 0) + amount;

      for (const split of splitsByExpense.get(e.id) ?? []) {
        overallConsumedByUsername[split.username] = (overallConsumedByUsername[split.username] ?? 0) + split.share;
      }
    }

    const summary = {
      totalGroups: groups.length,
      totalSessions: sessionIds.length,
      totalExpenses: (expenses ?? []).length,
      groups: Array.from(perGroup.entries()).map(([groupName, bucket]) => ({ groupName, ...bucket })),
      overallTotalPaidByPerson: overallPaidByUsername,
      overallTotalConsumedByPerson: overallConsumedByUsername,
      overallSpendByCategory: overallSpendByCategory
    };

    const result = await askDeepSeek(summary, question);
    res.status(result.status).json(result.body);
    return;
  }

  // 2. Confirm the caller has some standing in this group: either a full
  // group_members row (any role, not just admin), a session_participants
  // row on one of this group's sessions (i.e. they unlocked it with a
  // passkey), or master admin status — mirroring the is_master_admin()
  // RLS bypass used everywhere else in the app, so master admins get
  // read-only insights access across every group, not just ones they
  // personally belong to.
  let authorized = isMasterAdmin;

  if (!authorized) {
    const { data: membership } = await supabaseAdmin
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .single();
    authorized = Boolean(membership);
  }

  if (!authorized) {
    const { data: unlockedSessions } = await supabaseAdmin
      .from('sessions')
      .select('id, session_participants!inner(user_id)')
      .eq('group_id', groupId)
      .eq('session_participants.user_id', userId)
      .limit(1);
    authorized = Boolean(unlockedSessions && unlockedSessions.length > 0);
  }

  if (!authorized) {
    res.status(403).json({ error: 'You need access to a session in this group to use spending insights.' });
    return;
  }

  // 3. Aggregate the group's expense data into a compact summary (no PII beyond usernames).
  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('id, title, status, created_at')
    .eq('group_id', groupId);

  const sessionIds = (sessions ?? []).map((s) => s.id);

  if (sessionIds.length === 0) {
    res.status(200).json({ answer: "There's no session data in this group yet, so I don't have anything to analyze." });
    return;
  }

  const { data: expenses } = await supabaseAdmin
    .from('expenses')
    .select('id, session_id, amount, category, created_at, payer:profiles!expenses_paid_by_fkey(username)')
    .in('session_id', sessionIds);

  const expenseIds = (expenses ?? []).map((e) => e.id);

  const { data: splits } = await supabaseAdmin
    .from('expense_splits')
    .select('share, expense_id, profile:profiles(username)')
    .in('expense_id', expenseIds.length ? expenseIds : ['00000000-0000-0000-0000-000000000000']);

  // Per-person totals: how much they paid out-of-pocket vs. how much they actually consumed.
  const paidByUsername: Record<string, number> = {};
  const spendByCategory: Record<string, number> = {};
  for (const e of expenses ?? []) {
    const username = (e as any).payer?.username ?? 'unknown';
    paidByUsername[username] = (paidByUsername[username] ?? 0) + Number(e.amount);
    spendByCategory[e.category] = (spendByCategory[e.category] ?? 0) + Number(e.amount);
  }

  const consumedByUsername: Record<string, number> = {};
  for (const s of splits ?? []) {
    const username = (s as any).profile?.username ?? 'unknown';
    consumedByUsername[username] = (consumedByUsername[username] ?? 0) + Number(s.share);
  }

  const summary = {
    groupSessions: (sessions ?? []).map((s) => ({ title: s.title, status: s.status, created_at: s.created_at })),
    totalPaidByPerson: paidByUsername,
    totalConsumedByPerson: consumedByUsername,
    totalSpendByCategory: spendByCategory,
    sessionCount: sessions?.length ?? 0,
    expenseCount: expenses?.length ?? 0
  };

  // 4. Ask DeepSeek, grounded only in the aggregated summary above.
  const result = await askDeepSeek(summary, question);
  res.status(result.status).json(result.body);
}
