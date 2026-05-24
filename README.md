# Grid Balancing Tool

Interactive electricity portfolio balancing simulator built with Next.js, TypeScript, shadcn/ui, Zustand, Recharts, Motion, Zod, Vitest, and Playwright.

[Live demo](https://grid-balancing-tool.vercel.app)

![Dashboard desktop](./public/screenshots/dashboard-desktop.png)

The app models a simplified Polish/EU-style balancing workflow:

- 15-minute settlement periods across one trading day.
- Selectable training portfolios with distinct default contract books, balancing
  party metadata, and a clear settlement currency.
- Signed physical contracts: PPA, retail/load, forward, shaped peak, and swing.
- RDN/RDB-style spot and intraday price curves with simulated depth, VWAP
  execution, spread cost, fees, and partial fills.
- Scenario editor for deterministic seed, PV, wind, load, liquidity, price,
  and outage stress with a calibration preview before applying a new day.
- Imbalance settlement for residual open positions after gate closure.
- Manual trading challenge against a deterministic autopilot strategy.
- Live PnL, imbalance exposure, risk alerts, human-vs-script comparison, and
  a training replay with decision timeline, period drilldown, and lesson cards.

All v1 data is local and deterministic. The simulator is educational and intentionally does not use private company data or real trading systems.

The current market area is the Polish power market model and all monetary
values settle in PLN. The UI treats PLN as a fixed settlement currency, not as
an FX selector.

## Screenshots

![Intraday market desktop](./public/screenshots/market-desktop.png)

![Replay desktop](./public/screenshots/replay-desktop.png)

![Dashboard mobile](./public/screenshots/dashboard-mobile.png)

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

- `scenarios.ts` creates seeded weather, load, OZE, market, and imbalance curves
  from preset definitions plus optional scenario editor stress config.
- `contracts.ts` evaluates physical contract volumes and prices.
- `data-integrity.ts` validates the built-in scenario, portfolio, contract,
  RDN setup, and settlement data before release checks.
- `markets.ts` validates manual/script RDB orders, gate closure, depth-based
  VWAP execution, spread cost, fees, slippage, and partial fills.
- `portfolios.ts` defines selectable portfolio books and their default
  contract templates.
- `settlement.ts` calculates period and portfolio PnL.
- `strategy.ts` runs the no-future-sight autopilot.
- `replay.ts` builds the training timeline, manual/script/baseline period
  comparisons, and scenario lessons.

UI state lives in `src/lib/store/simulation-store.ts`; the main app surface is `src/components/grid-balancing-app.tsx`.

## Data Integrity Checks

The Vitest suite runs the built-in data catalog through all scenario and
portfolio combinations. The check fails on duplicate ids, missing contract
templates, unsupported market/currency combinations, malformed 15-minute
periods, invalid day-ahead setup trades, and non-finite settlement totals.

## Release Checks

Before release, run:

```bash
npm run typecheck
npm run lint
npm run test
npm run smoke
npm run build
```

The smoke test covers desktop and mobile flows, portfolio switching, scenario
editing, trading, strategy comparison, replay, and contract signing.

## Known Security Note

`npm audit` currently reports a moderate advisory through `next -> postcss`. The suggested `npm audit fix --force` would downgrade Next.js to `9.3.3`, which is a breaking and unsafe remediation for this app. Keep Next.js updated and re-run audit when a compatible patched release is available.
