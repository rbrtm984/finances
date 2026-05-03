# Paycheck Tracker

Single-user, single-page React app. Open it when a paycheck lands, hit **Log Paycheck**, follow the allocation, close the tab. ~60 seconds.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. State is persisted to `localStorage`, so refreshing won't lose anything. Same browser = same data.

## Deploy to Vercel + cloud sync

There's an optional tiny backend (`api/state.js`) that stores your state JSON in Upstash Redis behind a password, so any device with the password sees the same data.

1. **Create an Upstash Redis database** — sign up at upstash.com (free tier), create a Redis DB, copy the `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
2. **Push this repo to GitHub**, then in the Vercel dashboard → New Project → import it. Framework preset auto-detects as Vite.
3. **Set env vars** in Vercel project settings → Environment Variables:
   - `UPSTASH_REDIS_REST_URL` — from Upstash
   - `UPSTASH_REDIS_REST_TOKEN` — from Upstash
   - `STATE_PASSWORD` — any string you'll remember; this gates the API
4. **Deploy.** Visit your URL on any device, click the **Local only** badge in the top-right, enter your `STATE_PASSWORD`, click **Connect**. From then on, that device syncs.

Shortcut: instead of Upstash directly, you can also add the Upstash integration via the Vercel marketplace — it auto-injects the two `UPSTASH_*` env vars. You still set `STATE_PASSWORD` yourself.

### How sync behaves

- Every state change auto-saves to the server ~1 second after you stop changing things.
- On app load, the server's copy hydrates the UI (server wins over local cache).
- If the network drops, the badge flips to **Offline** and the app keeps working from localStorage. It'll re-sync on the next change once back online.
- The Sync menu has **Pull latest** if you suspect another device has fresher data, and **Disconnect** to revert a device to local-only.
- No password set = local-only mode (state stays in that browser's localStorage, no API calls). Safe default.

## How it works

Three phases, derived from your current state:

- **Phase 1** — Buffer Vault < $1,000. Build the buffer. Extra to SoFi = $0.
- **Phase 2** — Buffer ≥ $1,000 and SoFi > $0. Attack the loan with everything left after bills + spending.
- **Phase 3** — SoFi paid off. Roth + emergency fund + moving fund.

The SoFi payoff projection runs a month-by-month amortization at the configured APR, paying minimum + extra. While in Phase 1 the projection assumes Phase 2's extra (so the date is always meaningful, not infinity).

## Adjust anything

Settings (top-right) edits the rule numbers and the current balances. Use it if a vault drifts from reality, or to correct a SoFi balance after a statement.
