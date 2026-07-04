# Cash Section

Split bills with your group, on the spot. A mobile-first PWA for tracking shared
expenses across outings, lunches, dinners, and trips — with bill photo/PDF
uploads, live updates, an automatic settlement calculator, and an AI chatbot
that gives the group admin a read on spending patterns.

Built with **React + Vite + TypeScript + Tailwind**, backed by **Supabase**
(Auth, Postgres + Row Level Security, Storage, Realtime), deployed on
**Vercel**, with **DeepSeek** powering the admin insights chatbot.

---

## 1. Prerequisites

- Node.js 18+
- A free [Supabase](https://supabase.com) account
- A free [Vercel](https://vercel.com) account, connected to a GitHub repo
- A [DeepSeek](https://platform.deepseek.com) API key

## 2. Supabase setup

1. Create a new Supabase project.
2. Open the SQL Editor and run the migration files **in order** from
   `supabase/migrations/`:
   - `0001_schema.sql` — tables, triggers, helper functions
   - `0002_rls.sql` — Row Level Security policies
   - `0003_storage.sql` — the private `bills` storage bucket + policies
   - `0004_realtime.sql` — enables Realtime on `expenses` and `settlements`
   - `0005_username_check.sql` — RPC for pre-signup username availability

   (If you have the Supabase CLI installed, `supabase db push` will apply
   all of them for you instead.)
3. Confirm the `bills` bucket was created: **Storage → bills** (private,
   10 MB limit, PDF/JPEG/PNG/WEBP/HEIC only).
4. Confirm Realtime is on for `expenses`/`settlements`: **Database → Replication**.
5. Grab your keys from **Project Settings → API**:
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public` key → `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only, keep secret)

## 3. Local development

```bash
cp .env.example .env
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

npm install
npm run dev
```

The `/api/insights` serverless function needs `SUPABASE_SERVICE_ROLE_KEY`
and `DEEPSEEK_API_KEY` too — if you're testing it locally, install the
[Vercel CLI](https://vercel.com/docs/cli) and run `vercel dev` instead of
`npm run dev` so the function actually executes (`npm run dev` only serves
the frontend).

Run the settlement-engine unit tests:

```bash
npm test
```

## 4. Deploy

1. Push this repo to GitHub.
2. Import it into Vercel.
3. In **Vercel → Project Settings → Environment Variables**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only — do **not** prefix with `VITE_`)
   - `DEEPSEEK_API_KEY` (server only)
4. Deploy. Every push to `main` redeploys automatically.

## 5. Inviting your group

1. Sign up, then create a group — you become its admin automatically.
2. Share the group's invite code (shown on the group page) with friends.
3. They sign up (or log in), tap **Join with code**, and enter it.
4. Anyone in the group can start a **session** for an outing and pick who's
   participating.
5. Add expenses as they happen — attach the bill photo/PDF if you want a
   record. Everyone in the session sees new expenses appear live.
6. When you're done, hit **Settle up → Calculate settlement** to see the
   minimum set of transfers needed to zero everyone out. The admin can mark
   the session **Closed** once everyone's paid up.
7. The group admin can open **Spending insights** on the group page to ask
   the AI things like "who spent the most this month?"

## 6. How the settlement math works

`src/utils/settlement.ts` implements a greedy min-cash-flow algorithm:
repeatedly match whoever owes the most against whoever is owed the most,
settle the smaller of the two amounts, and repeat. It's not guaranteed to
be the mathematically optimal minimum number of transfers (that's NP-hard
in general), but for typical group sizes it produces very few transfers
and is easy to audit. See `src/utils/settlement.test.ts` for the test
suite covering rounding edge cases, already-settled participants, and
multi-person chains.

## 7. Security notes

- The frontend only ever holds the public `anon` key. All access control is
  enforced by Postgres Row Level Security — every table is scoped to "are
  you a member of this group?", with admin-only policies for destructive
  actions (removing members, closing sessions, deleting settlements).
- `SUPABASE_SERVICE_ROLE_KEY` and `DEEPSEEK_API_KEY` live only in Vercel's
  server-side environment — `/api/insights` is the only place that reads
  them, and it independently re-verifies the caller's identity and admin
  role server-side before calling DeepSeek (it doesn't trust the client).
- Bill uploads live in a private Storage bucket; files are served via
  short-lived signed URLs rather than public links.

## 8. Project structure

```
src/
  components/   Reusable UI: modals, cards, layout, expense form
  context/      Auth context (Supabase session + profile)
  pages/        Route-level screens
  utils/        Settlement algorithm, currency formatting
  types/        Shared TypeScript types matching the DB schema
api/
  insights.ts   Vercel serverless function -> DeepSeek (admin-only)
supabase/
  migrations/   SQL migrations (schema, RLS, storage, realtime)
  seed.sql      Optional demo data
```
