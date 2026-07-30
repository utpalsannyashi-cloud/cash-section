import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Which group has spent the most overall?',
  'Who are the top spenders across all groups?',
  "What's the biggest spending category across every group?",
  'Any groups with unusually large expenses?'
];

// Master-admin-only cross-group chat: unlike AdminInsights.tsx (which is
// pinned to a single :groupId from the route), this asks /api/insights
// with no groupId at all, which the server only allows for the master
// admin -- see api/insights.ts's "no groupId" branch for the aggregation
// across every group.
export function AllGroupsInsights() {
  const { isMasterAdmin, loading: authLoading } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async (question: string) => {
    if (!question.trim()) return;
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setInput('');
    setLoading(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Not signed in.');

      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.');

      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer }]);
    } catch (err: any) {
      setError(err.message ?? 'Could not get a response.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  if (authLoading) return null;
  if (!isMasterAdmin) return <Navigate to="/" replace />;

  return (
    <Layout back="/master">
      <div className="mb-5">
        <h1 className="font-mono text-xl font-semibold flex items-center gap-2">
          Spending insights <span className="status-pill bg-violet-light text-violet">all groups</span>
        </h1>
        <p className="text-ink-soft text-sm mt-1">Ask about spending across every group on Cash Section.</p>
      </div>

      {messages.length === 0 ? (
        <div className="flex flex-wrap gap-2 mb-5">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} className="text-xs px-3 py-1.5 rounded-full border border-ink/20 text-ink-soft hover:border-emerald">
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <div className="space-y-3 mb-4">
        {messages.map((m, i) => (
          <div key={i} className={`receipt-card p-4 ${m.role === 'user' ? 'bg-emerald-light border-emerald/30' : ''}`}>
            <p className="label-eyebrow mb-1">{m.role === 'user' ? 'You asked' : 'Cash Section AI'}</p>
            <p className="text-sm whitespace-pre-wrap">{m.content}</p>
          </div>
        ))}
        {loading ? (
          <div className="receipt-card p-4">
            <p className="label-eyebrow">Cash Section AI</p>
            <p className="text-sm text-ink-faint mt-1">Thinking…</p>
          </div>
        ) : null}
      </div>

      {error ? <p className="text-brick text-sm mb-3">{error}</p> : null}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="input-field"
          placeholder="Ask about spending across every group…"
        />
        <button type="submit" disabled={loading || !input.trim()} className="btn-primary shrink-0">
          Ask
        </button>
      </form>
    </Layout>
  );
}
