import { FormEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { supabase } from '@/lib/supabase';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Who spent the most this month?',
  "What's our biggest spending category?",
  'Compare the last two sessions.',
  'Any unusually large expenses?'
];

export function AdminInsights() {
  const { groupId } = useParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async (question: string) => {
    if (!groupId || !question.trim()) return;
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
        body: JSON.stringify({ groupId, question })
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

  return (
    <Layout back={`/groups/${groupId}`}>
      <div className="mb-5">
        <h1 className="font-mono text-xl font-semibold">Spending insights</h1>
        <p className="text-ink-soft text-sm mt-1">Ask about who's spending what, and where it's going. Admin only.</p>
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
          placeholder="Ask about spending patterns…"
        />
        <button type="submit" disabled={loading || !input.trim()} className="btn-primary shrink-0">
          Ask
        </button>
      </form>
    </Layout>
  );
}
