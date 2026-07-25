import { settleContractsForPeriod } from "./contracts";
import { buildDayAheadAuctionTrades, buildKnownPeriodView, executeOrder } from "./markets";
import { settlePortfolio, settleTradesForPeriod } from "./settlement";
import type {
  Contract,
  KnownPeriodView,
  MarketTrade,
  OrderDraft,
  PeriodSnapshot,
  PortfolioSettlement,
  Scenario,
  StrategyConfig,
} from "./types";

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  riskLimitMwh: 13,
  bufferMwh: 1.5,
  horizonPeriods: 18,
  transactionCostPlnMwh: 2.5,
  reactionDelayPeriods: 1,
  aggressiveness: 0.82,
};

export interface StrategyRunResult {
  trades: MarketTrade[];
  settlement: PortfolioSettlement;
  avoidedImbalanceMwh: number;
}

function createRecommendedOrder(
  period: PeriodSnapshot,
  knownPeriod: KnownPeriodView,
  contracts: Contract[],
  existingTrades: MarketTrade[],
  currentPeriod: number,
  config: StrategyConfig
): OrderDraft | null {
  if (period.index <= currentPeriod + config.reactionDelayPeriods) {
    return null;
  }

  const expectedContracts = settleContractsForPeriod(period, contracts, "forecast");
  const existingTradeSettlement = settleTradesForPeriod(period.index, existingTrades);
  const expectedNet =
    expectedContracts.boughtMwh -
    expectedContracts.soldMwh +
    existingTradeSettlement.boughtMwh -
    existingTradeSettlement.soldMwh;

  if (Math.abs(expectedNet) <= config.bufferMwh) {
    return null;
  }

  const closeVolume = Math.min(
    Math.abs(expectedNet) - config.bufferMwh,
    config.riskLimitMwh,
    period.liquidityMwh * config.aggressiveness
  );

  if (closeVolume <= 0.2) {
    return null;
  }

  // Under a single imbalance price, closing is not automatically right.
  // Selling a surplus intraday earns the bid; leaving it open earns the
  // imbalance price. Closing only pays when the bid beats that estimate by
  // more than it costs to trade — and when the period is expected to settle
  // above the bid, holding the position is the better call.
  //
  // The previous test compared the bid against an "expected long price" that
  // was constructed a full spread below the day-ahead price, so it was true in
  // every period of every scenario. The bot was a fixed "always flatten" rule
  // wearing the costume of a price decision.
  if (expectedNet > 0) {
    const shouldSell =
      knownPeriod.intradayBid >
      knownPeriod.expectedImbalancePrice + config.transactionCostPlnMwh;

    if (!shouldSell) {
      return null;
    }

    return {
      side: "sell",
      market: "RDB",
      periodIndex: knownPeriod.periodIndex,
      volumeMwh: closeVolume,
      limitPrice: knownPeriod.intradayBid - 8,
    };
  }

  const shouldBuy =
    knownPeriod.intradayAsk <
    knownPeriod.expectedImbalancePrice - config.transactionCostPlnMwh;

  if (!shouldBuy) {
    return null;
  }

  return {
    side: "buy",
    market: "RDB",
    periodIndex: knownPeriod.periodIndex,
    volumeMwh: closeVolume,
    limitPrice: knownPeriod.intradayAsk + 8,
  };
}

export function runAutopilot(
  scenario: Scenario,
  contracts: Contract[],
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG,
  initialTrades: MarketTrade[] = buildDayAheadAuctionTrades(scenario, contracts)
): StrategyRunResult {
  const scriptTrades: MarketTrade[] = [];
  const settlementTrades: MarketTrade[] = [...initialTrades];
  const doNothing = settlePortfolio(scenario.periods, contracts, settlementTrades);

  for (let currentPeriod = 0; currentPeriod < scenario.periods.length; currentPeriod += 1) {
    const horizonEnd = Math.min(
      currentPeriod + config.horizonPeriods,
      scenario.periods.length - 1
    );

    for (
      let targetPeriod = currentPeriod + config.reactionDelayPeriods + 1;
      targetPeriod <= horizonEnd;
      targetPeriod += 1
    ) {
      const period = scenario.periods[targetPeriod];
      const knownPeriod = buildKnownPeriodView(scenario, currentPeriod, targetPeriod);
      const order = createRecommendedOrder(
        period,
        knownPeriod,
        contracts,
        settlementTrades,
        currentPeriod,
        config
      );

      if (!order) {
        continue;
      }

      const execution = executeOrder(
        order,
        period,
        currentPeriod,
        "script",
        scriptTrades.length
      );

      if (execution.trade) {
        scriptTrades.push(execution.trade);
        settlementTrades.push(execution.trade);
      }
    }
  }

  const settlement = settlePortfolio(scenario.periods, contracts, settlementTrades);

  return {
    trades: scriptTrades,
    settlement,
    avoidedImbalanceMwh:
      doNothing.totalImbalanceAbsMwh - settlement.totalImbalanceAbsMwh,
  };
}
