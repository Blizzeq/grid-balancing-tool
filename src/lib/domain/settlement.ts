import { settleContractsForPeriod } from "./contracts";
import { getTransactionFeePlnMwh } from "./markets";
import type {
  Contract,
  MarketTrade,
  PeriodSettlement,
  PeriodSnapshot,
  PortfolioSettlement,
  TradeSettlement,
} from "./types";

interface SettlementPriceOverride {
  imbalanceLongPrice?: number;
  imbalanceShortPrice?: number;
}

function round(value: number, precision = 2): number {
  return Number(value.toFixed(precision));
}

export function settleTradesForPeriod(
  periodIndex: number,
  trades: MarketTrade[]
): TradeSettlement {
  return trades
    .filter((trade) => trade.accepted && trade.periodIndex === periodIndex)
    .reduce<TradeSettlement>(
      (accumulator, trade) => {
        const cashflow = trade.volumeMwh * trade.pricePlnMwh;
        const fee = trade.volumeMwh * getTransactionFeePlnMwh();

        if (trade.side === "buy") {
          accumulator.boughtMwh += trade.volumeMwh;
          accumulator.purchaseCost += cashflow;
        } else {
          accumulator.soldMwh += trade.volumeMwh;
          accumulator.salesRevenue += cashflow;
        }

        accumulator.transactionFees += fee;
        accumulator.pnl =
          accumulator.salesRevenue - accumulator.purchaseCost - accumulator.transactionFees;

        return accumulator;
      },
      {
        boughtMwh: 0,
        soldMwh: 0,
        purchaseCost: 0,
        salesRevenue: 0,
        transactionFees: 0,
        pnl: 0,
      }
    );
}

export function settlePeriod(
  period: PeriodSnapshot,
  contracts: Contract[],
  trades: MarketTrade[],
  basis: "forecast" | "actual" = "actual",
  priceOverride: SettlementPriceOverride = {}
): PeriodSettlement {
  const contractSettlement = settleContractsForPeriod(period, contracts, basis);
  const tradeSettlement = settleTradesForPeriod(period.index, trades);
  const boughtMwh = contractSettlement.boughtMwh + tradeSettlement.boughtMwh;
  const soldMwh = contractSettlement.soldMwh + tradeSettlement.soldMwh;
  const contractedPosition = contractSettlement.boughtMwh - contractSettlement.soldMwh;
  const marketPosition = tradeSettlement.boughtMwh - tradeSettlement.soldMwh;
  const imbalanceMwh = boughtMwh - soldMwh;
  const imbalanceLongPrice = priceOverride.imbalanceLongPrice ?? period.imbalanceLongPrice;
  const imbalanceShortPrice = priceOverride.imbalanceShortPrice ?? period.imbalanceShortPrice;
  const imbalancePrice =
    imbalanceMwh >= 0 ? imbalanceLongPrice : imbalanceShortPrice;
  const imbalancePnl =
    imbalanceMwh >= 0
      ? imbalanceMwh * imbalanceLongPrice
      : -Math.abs(imbalanceMwh) * imbalanceShortPrice;
  const periodPnl = contractSettlement.pnl + tradeSettlement.pnl + imbalancePnl;

  return {
    periodIndex: period.index,
    label: period.label,
    forecastGeneration: period.forecastGeneration,
    actualGeneration: contractSettlement.generationMwh,
    forecastLoad: period.forecastLoad,
    actualLoad: contractSettlement.loadMwh,
    contractedPosition: round(contractedPosition),
    marketPosition: round(marketPosition),
    imbalanceMwh: round(imbalanceMwh),
    imbalancePrice: round(imbalancePrice),
    imbalancePnl: round(imbalancePnl),
    periodPnl: round(periodPnl),
    contractPnl: round(contractSettlement.pnl),
    marketPnl: round(tradeSettlement.pnl),
    serviceFees: round(contractSettlement.serviceFees),
    transactionFees: round(tradeSettlement.transactionFees),
  };
}

export function settlePortfolio(
  periods: PeriodSnapshot[],
  contracts: Contract[],
  trades: MarketTrade[],
  basis: "forecast" | "actual" = "actual"
): PortfolioSettlement {
  const settlements = periods.map((period) => settlePeriod(period, contracts, trades, basis));
  return aggregateSettlements(settlements);
}

export function aggregateSettlements(settlements: PeriodSettlement[]): PortfolioSettlement {
  const totals = settlements.reduce(
    (accumulator, settlement) => {
      accumulator.totalPnl += settlement.periodPnl;
      accumulator.contractPnl += settlement.contractPnl;
      accumulator.marketPnl += settlement.marketPnl;
      accumulator.imbalancePnl += settlement.imbalancePnl;
      accumulator.serviceFees += settlement.serviceFees;
      accumulator.transactionFees += settlement.transactionFees;
      accumulator.totalImbalanceAbsMwh += Math.abs(settlement.imbalanceMwh);

      if (Math.abs(settlement.imbalanceMwh) > 5) {
        accumulator.errorCount += 1;
      }

      return accumulator;
    },
    {
      totalPnl: 0,
      contractPnl: 0,
      marketPnl: 0,
      imbalancePnl: 0,
      serviceFees: 0,
      transactionFees: 0,
      totalImbalanceAbsMwh: 0,
      errorCount: 0,
    }
  );
  const sortedByPnl = [...settlements].sort((left, right) => left.periodPnl - right.periodPnl);

  return {
    periods: settlements,
    totalPnl: round(totals.totalPnl),
    contractPnl: round(totals.contractPnl),
    marketPnl: round(totals.marketPnl),
    imbalancePnl: round(totals.imbalancePnl),
    serviceFees: round(totals.serviceFees),
    transactionFees: round(totals.transactionFees),
    totalImbalanceAbsMwh: round(totals.totalImbalanceAbsMwh),
    worstPeriod: sortedByPnl[0],
    bestPeriod: sortedByPnl.at(-1),
    errorCount: totals.errorCount,
  };
}
