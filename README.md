# Paycheck Tracker

Single-user, single-page React app. Open it when a paycheck lands, hit **Log Paycheck**, follow the allocation, close the tab. ~60 seconds.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. State is persisted to `localStorage`, so refreshing won't lose anything. Same browser = same data.

## Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Or push to GitHub and import the repo in the Vercel dashboard. Framework preset auto-detects as Vite. No env vars, no backend.

## How it works

Three phases, derived from your current state:

- **Phase 1** — Buffer Vault < $1,000. Build the buffer. Extra to SoFi = $0.
- **Phase 2** — Buffer ≥ $1,000 and SoFi > $0. Attack the loan with everything left after bills + spending.
- **Phase 3** — SoFi paid off. Roth + emergency fund + moving fund.

The SoFi payoff projection runs a month-by-month amortization at the configured APR, paying minimum + extra. While in Phase 1 the projection assumes Phase 2's extra (so the date is always meaningful, not infinity).

## Adjust anything

Settings (top-right) edits the rule numbers and the current balances. Use it if a vault drifts from reality, or to correct a SoFi balance after a statement.
