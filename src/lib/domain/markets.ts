import { settleContractsForPeriod } from "./contracts";
import {
  orderDraftSchema,
  type Contract,
  type KnownPeriodView,
  type MarketTrade,
  type OrderDraft,
  type PeriodSnapshot,
  type Scenario,
  type ScenarioCalibrationReport,
} from "./types";

const TRANSACTION_FEE_PLN_MWH = 0.75;
const DAY_AHEAD_HEDGE_RATIO = 0.78;

export interface OrderExecution {
  accepted: boolean;
  trade?: MarketTrade;
  reason: string;
}

function round(value: number, precision = 2): number {
  return Number(value.toFixed(precision));
}

function clampPeriodIndex(index: number, scenario: Scenario): number {
  return Math.min(Math.max(index, 0), scenario.periods.length - 1);
}

function expectedImbalancePrices(period: PeriodSnapshot) {
  const spread = Math.max(period.intradayAsk - period.intradayBid, 1);
  const forecastSurplus = Math.max(period.forecastGeneration - period.forecastLoad, 0);
  const forecastDeficit = Math.max(period.forecastLoad - period.forecastGeneration, 0);
  const publicShortPremium = 34 + spread * 1.6 + forecastDeficit * 0.85;
  const publicLongDiscount = 26 + spread * 1.15 + forecastSurplus * 0.65;

  return {
    expectedImbalanceLongPrice: round(period.rdnPrice - publicLongDiscount),
    expectedImbalanceShortPrice: round(period.rdnPrice + publicShortPremium),
  };
}

export function createTradeId(actor: MarketTrade["actor"], periodIndex: number, count: number) {
  return `${actor}-${periodIndex}-${count + 1}`;
}

export function buildKnownPeriodView(
  scenario: Scenario,
  currentPeriod: number,
  targetPeriod: number
): KnownPeriodView {
  const safeTargetPeriod = clampPeriodIndex(targetPeriod, scenario);
  const safeCurrentPeriod = clampPeriodIndex(currentPeriod, scenario);
  const period = scenario.periods[safeTargetPeriod];
  const isSettled = safeTargetPeriod <= safeCurrentPeriod;
  const expectedPrices = expectedImbalancePrices(period);

  return {
    periodIndex: period.index,
    label: period.label,
    hour: period.hour,
    forecastGeneration: period.forecastGeneration,
    forecastLoad: period.forecastLoad,
    actualGeneration: isSettled ? period.actualGeneration : null,
    actualLoad: isSettled ? period.actualLoad : null,
    rdnPrice: period.rdnPrice,
    intradayBid: period.intradayBid,
    intradayAsk: period.intradayAsk,
    liquidityMwh: period.liquidityMwh,
    expectedImbalanceLongPrice: expectedPrices.expectedImbalanceLongPrice,
    expectedImbalanceShortPrice: expectedPrices.expectedImbalanceShortPrice,
    actualImbalanceLongPrice: isSettled ? period.imbalanceLongPrice : null,
    actualImbalanceShortPrice: isSettled ? period.imbalanceShortPrice : null,
    isSettled,
    weather: period.weather,
  };
}

export function buildKnownMarketTape(
  scenario: Scenario,
  currentPeriod: number
): KnownPeriodView[] {
  return scenario.periods.map((period) =>
    buildKnownPeriodView(scenario, currentPeriod, period.index)
  );
}

export function buildDayAheadAuctionTrades(
  scenario: Scenario,
  contracts: Contract[]
): MarketTrade[] {
  return scenario.periods.flatMap((period) => {
    const contractSettlement = settleContractsForPeriod(period, contracts, "forecast");
    const forecastNetMwh = contractSettlement.boughtMwh - contractSettlement.soldMwh;

    if (Math.abs(forecastNetMwh) < 0.05) {
      return [];
    }

    return [
      {
        id: `scenario-rdn-${period.index}`,
        actor: "scenario",
        side: forecastNetMwh > 0 ? "sell" : "buy",
        market: "RDN",
        periodIndex: period.index,
        volumeMwh: round(Math.abs(forecastNetMwh) * DAY_AHEAD_HEDGE_RATIO),
        pricePlnMwh: period.rdnPrice,
        submittedAtPeriod: -1,
        accepted: true,
        reason: "Locked D-1 RDN auction setup.",
      },
    ];
  });
}

export function getScenarioSetupTrades(trades: MarketTrade[]): MarketTrade[] {
  return trades.filter((trade) => trade.actor === "scenario" && trade.market === "RDN");
}

export function buildScenarioCalibrationReport(
  scenario: Scenario
): ScenarioCalibrationReport {
  const prices = scenario.periods.map((period) => period.rdnPrice);
  const spreads = scenario.periods.map((period) => period.intradayAsk - period.intradayBid);
  const averageRdnPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
  const variance =
    prices.reduce((sum, price) => sum + (price - averageRdnPrice) ** 2, 0) / prices.length;
  const rdnPriceStdDev = Math.sqrt(variance);
  const averageLiquidityMwh =
    scenario.periods.reduce((sum, period) => sum + period.liquidityMwh, 0) /
    scenario.periods.length;

  return {
    scenarioId: scenario.definition.id,
    averageRdnPrice: round(averageRdnPrice),
    rdnPriceStdDev: round(rdnPriceStdDev),
    minRdnPrice: round(Math.min(...prices)),
    maxRdnPrice: round(Math.max(...prices)),
    negativeRdnPeriods: prices.filter((price) => price < 0).length,
    minBidAskSpread: round(Math.min(...spreads)),
    maxBidAskSpread: round(Math.max(...spreads)),
    averageLiquidityMwh: round(averageLiquidityMwh, 1),
    priceSpikeThreshold: round(Math.max(650, averageRdnPrice + rdnPriceStdDev * 1.5)),
  };
}

export function executeOrder(
  draft: OrderDraft,
  period: PeriodSnapshot,
  submittedAtPeriod: number,
  actor: MarketTrade["actor"],
  tradeCount: number
): OrderExecution {
  const parsed = orderDraftSchema.safeParse(draft);

  if (!parsed.success) {
    return {
      accepted: false,
      reason: parsed.error.issues[0]?.message ?? "Invalid order.",
    };
  }

  if (draft.market !== "RDB") {
    return {
      accepted: false,
      reason: "RDN is locked as the D-1 auction setup. Use RDB/SIDC for intraday trading.",
    };
  }

  if (draft.periodIndex <= submittedAtPeriod) {
    return {
      accepted: false,
      reason: "Gate closure: current and past 15-minute periods are already locked.",
    };
  }

  if (draft.volumeMwh > period.liquidityMwh) {
    return {
      accepted: false,
      reason: `Insufficient RDB liquidity: ${period.liquidityMwh.toFixed(1)} MWh available.`,
    };
  }

  const liquidityRatio = draft.volumeMwh / Math.max(period.liquidityMwh, 1);
  const slippage = liquidityRatio * 5.5;
  const executablePrice =
    draft.side === "buy" ? period.intradayAsk + slippage : period.intradayBid - slippage;

  if (draft.side === "buy" && draft.limitPrice < executablePrice) {
    return {
      accepted: false,
      reason: `Buy limit below best executable ask (${round(executablePrice)} PLN/MWh).`,
    };
  }

  if (draft.side === "sell" && draft.limitPrice > executablePrice) {
    return {
      accepted: false,
      reason: `Sell limit above best executable bid (${round(executablePrice)} PLN/MWh).`,
    };
  }

  return {
    accepted: true,
    reason: "Order matched on the simulated intraday book.",
    trade: {
      id: createTradeId(actor, draft.periodIndex, tradeCount),
      actor,
      side: draft.side,
      market: draft.market,
      periodIndex: draft.periodIndex,
      volumeMwh: round(draft.volumeMwh),
      pricePlnMwh: round(executablePrice),
      submittedAtPeriod,
      accepted: true,
    },
  };
}

export function getTransactionFeePlnMwh(): number {
  return TRANSACTION_FEE_PLN_MWH;
}
