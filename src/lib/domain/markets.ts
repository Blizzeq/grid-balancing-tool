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
  type TradeSide,
} from "./types";

const TRANSACTION_FEE_PLN_MWH = 0.75;
const DAY_AHEAD_HEDGE_RATIO = 0.78;
const MIN_EXECUTABLE_RDB_MWH = 0.1;
const RDB_DEPTH_VOLUME_SHARES = [0.35, 0.35, 0.3] as const;

export interface OrderExecution {
  accepted: boolean;
  trade?: MarketTrade;
  reason: string;
  quote?: RdbExecutionQuote;
}

export interface RdbBookLevel {
  level: number;
  bidPrice: number;
  askPrice: number;
  volumeMwh: number;
  cumulativeVolumeMwh: number;
}

export interface RdbFillLevel {
  level: number;
  pricePlnMwh: number;
  volumeMwh: number;
}

export interface RdbExecutionQuote {
  side: TradeSide;
  requestedVolumeMwh: number;
  filledVolumeMwh: number;
  averagePricePlnMwh: number;
  bestPricePlnMwh: number;
  midpointPricePlnMwh: number;
  vwapSlippagePlnMwh: number;
  spreadCostPln: number;
  transactionFeePln: number;
  totalExecutionCostPln: number;
  partialFill: boolean;
  fills: RdbFillLevel[];
}

function round(value: number, precision = 2): number {
  return Number(value.toFixed(precision));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampPeriodIndex(index: number, scenario: Scenario): number {
  return Math.min(Math.max(index, 0), scenario.periods.length - 1);
}

/**
 * Ex-ante estimate of the imbalance price, from information a participant
 * actually has before delivery: the day-ahead price and the forecast tightness
 * of the period.
 *
 * The previous version returned a long price a full spread *below* and a short
 * price a full spread *above* the day-ahead price. That wedge grew with the
 * spread, which made "close the position" arithmetically profitable in every
 * period of every scenario — the autopilot's supposed economic test could
 * never be false. The estimate now centres on the day-ahead price and only
 * tilts with forecast tightness, so staying open is sometimes the better call,
 * which is the actual intraday decision.
 */
function expectedImbalancePrice(period: PeriodSnapshot): number {
  const tightness = period.forecastLoad - period.forecastGeneration;
  const reference = (period.forecastLoad + period.forecastGeneration) / 2 || 1;
  // Normalised: positive when the period looks short, negative when long.
  const tilt = clamp(tightness / reference, -1, 1);

  return round(period.rdnPrice + tilt * 42);
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
  const expectedPrice = expectedImbalancePrice(period);

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
    expectedImbalancePrice: expectedPrice,
    actualImbalancePrice: isSettled ? period.imbalancePrice : null,
    actualSystemImbalanceMw: isSettled ? period.systemImbalanceMw : null,
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

export function buildRdbDepth(period: PeriodSnapshot): RdbBookLevel[] {
  const spread = Math.max(period.intradayAsk - period.intradayBid, 1);
  const priceStep = Math.max(2, spread * 0.2);
  let remainingVolume = period.liquidityMwh;

  return RDB_DEPTH_VOLUME_SHARES.map((share, index) => {
    const level = index + 1;
    const volumeMwh =
      index === RDB_DEPTH_VOLUME_SHARES.length - 1
        ? remainingVolume
        : round(period.liquidityMwh * share, 1);

    remainingVolume = round(Math.max(0, remainingVolume - volumeMwh), 1);

    return {
      level,
      bidPrice: round(period.intradayBid - priceStep * index),
      askPrice: round(period.intradayAsk + priceStep * index),
      volumeMwh: round(volumeMwh, 1),
      cumulativeVolumeMwh: round(
        period.liquidityMwh - remainingVolume,
        1
      ),
    };
  });
}

export function quoteRdbOrder(draft: OrderDraft, period: PeriodSnapshot): RdbExecutionQuote {
  const depth = buildRdbDepth(period);
  const midpointPricePlnMwh = (period.intradayBid + period.intradayAsk) / 2;
  const bestPricePlnMwh = draft.side === "buy" ? depth[0]?.askPrice ?? 0 : depth[0]?.bidPrice ?? 0;
  const fills: RdbFillLevel[] = [];
  let remainingVolumeMwh = draft.volumeMwh;

  for (const level of depth) {
    const pricePlnMwh = draft.side === "buy" ? level.askPrice : level.bidPrice;
    const insideLimit =
      draft.side === "buy" ? pricePlnMwh <= draft.limitPrice : pricePlnMwh >= draft.limitPrice;

    if (!insideLimit || remainingVolumeMwh <= 0) {
      break;
    }

    const volumeMwh = Math.min(remainingVolumeMwh, level.volumeMwh);

    if (volumeMwh > 0) {
      fills.push({
        level: level.level,
        pricePlnMwh,
        volumeMwh: round(volumeMwh, 1),
      });
    }

    remainingVolumeMwh = round(remainingVolumeMwh - volumeMwh, 1);
  }

  const filledVolumeMwh = round(
    fills.reduce((sum, fill) => sum + fill.volumeMwh, 0),
    1
  );
  const weightedPrice = fills.reduce(
    (sum, fill) => sum + fill.volumeMwh * fill.pricePlnMwh,
    0
  );
  const averagePricePlnMwh =
    filledVolumeMwh > 0 ? round(weightedPrice / filledVolumeMwh) : 0;
  const vwapSlippagePlnMwh =
    filledVolumeMwh > 0
      ? round(
          draft.side === "buy"
            ? averagePricePlnMwh - bestPricePlnMwh
            : bestPricePlnMwh - averagePricePlnMwh
        )
      : 0;
  const spreadCostPln =
    filledVolumeMwh > 0
      ? round(
          filledVolumeMwh *
            (draft.side === "buy"
              ? averagePricePlnMwh - midpointPricePlnMwh
              : midpointPricePlnMwh - averagePricePlnMwh)
        )
      : 0;
  const transactionFeePln = round(filledVolumeMwh * TRANSACTION_FEE_PLN_MWH);

  return {
    side: draft.side,
    requestedVolumeMwh: round(draft.volumeMwh, 1),
    filledVolumeMwh,
    averagePricePlnMwh,
    bestPricePlnMwh,
    midpointPricePlnMwh: round(midpointPricePlnMwh),
    vwapSlippagePlnMwh,
    spreadCostPln,
    transactionFeePln,
    totalExecutionCostPln: round(spreadCostPln + transactionFeePln),
    partialFill: filledVolumeMwh < draft.volumeMwh,
    fills,
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

  const quote = quoteRdbOrder(draft, period);

  if (quote.filledVolumeMwh < MIN_EXECUTABLE_RDB_MWH) {
    const bestPrice = draft.side === "buy" ? "ask" : "bid";

    return {
      accepted: false,
      reason:
        period.liquidityMwh < MIN_EXECUTABLE_RDB_MWH
          ? "No executable RDB liquidity remains for this delivery period."
          : `${draft.side === "buy" ? "Buy" : "Sell"} limit does not cross executable RDB ${bestPrice} depth.`,
      quote,
    };
  }

  return {
    accepted: true,
    reason:
      quote.partialFill
        ? `Partial fill: ${quote.filledVolumeMwh.toFixed(1)} of ${quote.requestedVolumeMwh.toFixed(
            1
          )} MWh matched across ${quote.fills.length} RDB depth levels.`
        : `Order matched across ${quote.fills.length} simulated RDB depth levels.`,
    quote,
    trade: {
      id: createTradeId(actor, draft.periodIndex, tradeCount),
      actor,
      side: draft.side,
      market: draft.market,
      periodIndex: draft.periodIndex,
      volumeMwh: quote.filledVolumeMwh,
      pricePlnMwh: quote.averagePricePlnMwh,
      submittedAtPeriod,
      accepted: true,
    },
  };
}

export function getTransactionFeePlnMwh(): number {
  return TRANSACTION_FEE_PLN_MWH;
}
