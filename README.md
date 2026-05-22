# Grid Balancing Tool

Interactive electricity portfolio balancing simulator built with Next.js, TypeScript, shadcn/ui, Zustand, Recharts, Motion, Zod, Vitest, and Playwright.

The app models a simplified Polish/EU-style balancing workflow:

- 15-minute settlement periods across one trading day.
- Signed physical contracts: PPA, retail/load, forward, shaped peak, and swing.
- RDN/RDB-style spot and intraday price curves.
- Imbalance settlement for residual open positions after gate closure.
- Manual trading challenge against a deterministic autopilot strategy.
- Live PnL, imbalance exposure, risk alerts, replay, and human-vs-script comparison.

All v1 data is local and deterministic. The simulator is educational and intentionally does not use private company data or real trading systems.

## Commands

```bash
npm run dev        # start local Next.js dev server
npm run build      # production build
npm run lint       # ESLint
npm run typecheck  # TypeScript check
npm run test       # Vitest domain tests
npm run smoke      # Playwright smoke test against localhost:3000
```

`npm run smoke` expects the app to be running at `http://localhost:3000`. Override with `SMOKE_URL` if needed.

## Domain Model

Core simulation logic lives in `src/lib/domain`:

- `scenarios.ts` creates seeded weather, load, OZE, market, and imbalance curves.
- `contracts.ts` evaluates physical contract volumes and prices.
- `markets.ts` validates manual/script RDB orders and gate closure.
- `settlement.ts` calculates period and portfolio PnL.
- `strategy.ts` runs the no-future-sight autopilot.

UI state lives in `src/lib/store/simulation-store.ts`; the main app surface is `src/components/grid-balancing-app.tsx`.

## Known Security Note

`npm audit` currently reports a moderate advisory through `next -> postcss`. The suggested `npm audit fix --force` would downgrade Next.js to `9.3.3`, which is a breaking and unsafe remediation for this app. Keep Next.js updated and re-run audit when a compatible patched release is available.
