import { settleContractsForPeriod } from "./contracts";
import { executeOrder } from "./markets";
import { settlePortfolio, settleTradesForPeriod } from "./settlement";
import type {
  Contract,
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

  if (expectedNet > 0) {
    const shouldSell =
      period.intradayBid > period.imbalanceLongPrice + config.transactionCostPlnMwh;

    if (!shouldSell) {
      return null;
    }

    return {
      side: "sell",
      market: "RDB",
      periodIndex: period.index,
      volumeMwh: closeVolume,
      limitPrice: period.intradayBid - 8,
    };
  }

  const shouldBuy =
    period.intradayAsk < period.imbalanceShortPrice - config.transactionCostPlnMwh;

  if (!shouldBuy) {
    return null;
  }

  return {
    side: "buy",
    market: "RDB",
    periodIndex: period.index,
    volumeMwh: closeVolume,
    limitPrice: period.intradayAsk + 8,
  };
}

export function runAutopilot(
  scenario: Scenario,
  contracts: Contract[],
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG
): StrategyRunResult {
  const trades: MarketTrade[] = [];
  const doNothing = settlePortfolio(scenario.periods, contracts, []);

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
      const order = createRecommendedOrder(
        period,
        contracts,
        trades,
        currentPeriod,
        config
      );

      if (!order) {
        continue;
      }

      const execution = executeOrder(order, period, currentPeriod, "script", trades.length);

      if (execution.trade) {
        trades.push(execution.trade);
      }
    }
  }

  const settlement = settlePortfolio(scenario.periods, contracts, trades);

  return {
    trades,
    settlement,
    avoidedImbalanceMwh:
      doNothing.totalImbalanceAbsMwh - settlement.totalImbalanceAbsMwh,
  };
}
