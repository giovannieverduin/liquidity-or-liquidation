# Liquidity or Liquidation / GIO/

A satirical crash-style market-timing game that doubles as financial-literacy
content. The market pumps, you cash out before it rugs, your bag compounds.
Hold too long and you become the exit liquidity. Built mobile-first for the
elevator / bathroom-break / boring-conference-call moment.

Part of the build-in-public GIO/ portfolio (sibling to the Exit Liquidity repo).

> **Financial literacy framing is load-bearing, not decorative.** The game
> depicts leverage and credit-fuelled gambling to teach *why* it destroys
> wealth. The disclaimer banner, footer, and launch copy all frame it as
> education. Keep that framing intact anywhere copy is touched.

## What's here

```
index.html            the game - single file, no build step (canvas + vanilla JS)
api/leaderboard.js    Vercel serverless function: the leaderboard data layer
lib/profanity.js      server-side handle moderation
supabase/schema.sql   leaderboard + rate-limit tables, RLS locked down
vercel.json           function + cache config
.env.example          required server-side env vars
```

## How the leaderboard works

The in-chat prototype stored scores in claude.ai shared storage
(`window.storage`), which does not exist on a deployed site. In production the
data layer is a serverless endpoint:

- The browser calls `/api/leaderboard` only. It never sees Supabase or any key.
- The function reads and writes Supabase with the **service role key**, held
  server-side in env vars.
- `GET` returns the top 50. `POST` submits a best run. `DELETE` (admin) removes
  a handle.

## Setup

1. **Supabase** - run `supabase/schema.sql` against the existing GGE website
   Supabase project. It only adds two `lol_`-prefixed tables, so it won't
   collide with anything already there.

2. **Vercel** - import this repo as a new Vercel project. Set env vars (see
   `.env.example`):

   | Var | Purpose |
   |-----|---------|
   | `SUPABASE_URL` | Existing GGE Supabase project URL |
   | `SUPABASE_SERVICE_KEY` | Service role key (server-side only) |
   | `RATE_SALT` | Long random string for hashing IPs |
   | `ADMIN_TOKEN` | Token for the admin delete path (`X-Admin-Token` header) |
   | `ALLOWED_ORIGINS` | Comma-separated CORS allowlist (your prod domain + localhost) |
   | `BLOCK_EXTRA` | Optional extra banned handle substrings |

3. **Deploy.** `index.html` serves at root, `/api/leaderboard` is the function.

### Local dev

```bash
npm install
cp .env.example .env.local   # fill in real values
vercel dev
```

## Admin: remove a handle from the board

```bash
curl -X DELETE "https://YOUR-DOMAIN/api/leaderboard?key=kSOMEKEY" \
  -H "X-Admin-Token: $ADMIN_TOKEN"
```

The `key` is the row identity shown in the board payload (derived from the
handle). This is the simple report/remove escape hatch for anything that slips
past the profanity filter.

## Security posture

- **No keys in the frontend.** The service key is server-side only.
- **RLS is on** for both tables with no anon policies, so a leaked anon key
  can't read or write them directly. The anon key isn't used by the game at all.
- **Rate limiting.** Submit is capped per IP per minute (hashed IP, never raw)
  to deter spam and score-stuffing.
- **Server-side input validation.** Handle/twitter are length-capped,
  char-filtered, and profanity-screened on the server - client checks aren't
  trusted. The row key is re-derived from the handle server-side, so nobody can
  overwrite another player's row by forging a key.
- **No leaks.** Errors return generic messages; details are logged server-side
  only and secrets are never logged. CORS is scoped to `ALLOWED_ORIGINS`.

## Honest limitation (by design)

Scores are **client-submitted**, so the board is spoofable - anyone can `POST`
any score. That is acceptable for a joke game. Real tamper-resistance would
require server-side score validation (replaying or signing the run), which is
intentionally out of scope unless we decide the board is worth defending.

---

A GIO/ game, built with Claude. · [giovannieverduin.com](https://giovannieverduin.com)
