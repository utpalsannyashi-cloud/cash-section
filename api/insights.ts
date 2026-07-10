import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Server-only clients/keys — never exposed to the browser.
const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
  auth: { persistSession: false }
});

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY as string;

interface InsightsBody {
  groupId: string;
  question: string;
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
  if (!groupId || !question) {
    res.status(400).json({ error: 'groupId and question are required' });
    return;
  }

  // 1. Verify the caller's identity from their Supabase JWT.
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }
  const userId = userData.user.id;

  // 2. Confirm the caller has some standing in this group: either a full
  // group_members row (any role, not just admin), a session_participants
  // row on one of this group's sessions (i.e. they unlocked it with a
  // passkey), or master admin status — mirroring the is_master_admin()
  // RLS bypass used everywhere else in the app, so master admins get
  // read-only insights access across every group, not just ones they
  // personally belong to.
  const { data: profile } = await supabaseAdmin.from('profiles').select('is_master_admin').eq('id', userId).single();

  let authorized = Boolean(profile?.is_master_admin);

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
      res.status(502).json({ error: `DeepSeek error: ${text}` });
      return;
    }

    const data = await deepseekRes.json();
    const answer = data.choices?.[0]?.message?.content ?? 'No response generated.';
    res.status(200).json({ answer });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Failed to reach DeepSeek' });
  }
}
