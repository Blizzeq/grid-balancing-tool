import {
  evaluateContractPrice,
  evaluateContractVolume,
} from "./contracts";
import {
  buildKnownMarketTape,
  buildKnownPeriodView,
  buildScenarioCalibrationReport,
} from "./markets";
import { aggregateSettlements, settlePeriod, settlePortfolio } from "./settlement";
import type {
  Contract,
  DashboardMetrics,
  MarketTrade,
  PeriodSettlement,
  PnlWaterfallEntry,
  RiskAlert,
  Scenario,
  SignedContractMetric,
} from "./types";

const MAX_POSITION_LIMIT_MWH = 150;

function clampPeriodIndex(index: number, scenario: Scenario): number {
  return Math.min(Math.max(index, 0), scenario.periods.length - 1);
}

function round(value: number, precision = 2): number {
  return Number(value.toFixed(precision));
}

function buildProjectedSettlement(
  scenario: Scenario,
  contracts: Contract[],
  trades: MarketTrade[],
  currentPeriod: number
) {
  const safeCurrentPeriod = clampPeriodIndex(currentPeriod, scenario);
  const projectedPeriods = scenario.periods.map((period) => {
    const knownPeriod = buildKnownPeriodView(scenario, safeCurrentPeriod, period.index);
    const isSettled = period.index <= safeCurrentPeriod;

    return settlePeriod(
      period,
      contracts,
      trades,
      isSettled ? "actual" : "forecast",
      {
        imbalanceLongPrice:
          knownPeriod.actualImbalanceLongPrice ?? knownPeriod.expectedImbalanceLongPrice,
        imbalanceShortPrice:
          knownPeriod.actualImbalanceShortPrice ?? knownPeriod.expectedImbalanceShortPrice,
      }
    );
  });

  return aggregateSettlements(projectedPeriods);
}

function productLabel(contract: Contract): string {
  if (contract.type === "forward-otc") {
    return contract.volumeFormula.kind === "fixed" && contract.volumeFormula.peakOnly
      ? "PEAK"
      : "BASE";
  }

  if (contract.type === "ppa-pay-as-produced") {
    return "PPA";
  }

  if (contract.type === "retail-load") {
    return "LOAD";
  }

  if (contract.type === "flexible-swing") {
    return "SWING";
  }

  return "SHAPED";
}

function buildSignedContracts(
  scenario: Scenario,
  contracts: Contract[],
  currentPeriod: number
): SignedContractMetric[] {
  const safeCurrentPeriod = clampPeriodIndex(currentPeriod, scenario);
  const markPeriod = scenario.periods[safeCurrentPeriod];

  return contracts.map((contract) => {
    const activePeriods = scenario.periods.filter(
      (period) => period.index >= contract.deliveryStart && period.index <= contract.deliveryEnd
    );
    const volumeMwh = activePeriods.reduce(
      (total, period) => total + evaluateContractVolume(contract, period, "forecast"),
      0
    );
    const weightedPrice = activePeriods.reduce((total, period) => {
      const volume = evaluateContractVolume(contract, period, "forecast");
      return total + volume * evaluateContractPrice(contract, period);
    }, 0);
    const averagePrice = volumeMwh > 0 ? weightedPrice / volumeMwh : 0;
    const mtmSign = contract.side === "buy" ? 1 : -1;
    const mtmPln = volumeMwh * (markPeriod.rdnPrice - averagePrice) * mtmSign;

    return {
      id: contract.id,
      counterparty: contract.counterparty,
      product: productLabel(contract),
      deliveryPeriod: `${scenario.periods[contract.deliveryStart]?.label ?? "00:00"}-${
        scenario.periods[contract.deliveryEnd]?.label ?? "23:45"
      }`,
      volumeMwh: round(volumeMwh, 1),
      pricePlnMwh: round(averagePrice, 2),
      status: safeCurrentPeriod <= contract.deliveryEnd ? "Active" : "Expired",
      mtmPln: round(mtmPln),
    };
  });
}

export function buildPnlWaterfall(settlement: {
  contractPnl: number;
  marketPnl: number;
  imbalancePnl: number;
  serviceFees: number;
  transactionFees: number;
  totalPnl: number;
}): PnlWaterfallEntry[] {
  return [
    { name: "Contract\nPnL", value: settlement.contractPnl, kind: "component" },
    { name: "Market\nPnL", value: settlement.marketPnl, kind: "component" },
    { name: "Imbalance\nPnL", value: settlement.imbalancePnl, kind: "component" },
    { name: "Service\nFees", value: settlement.serviceFees, kind: "component" },
    { name: "Tx\nFees", value: -settlement.transactionFees, kind: "component" },
    { name: "Total\nPnL", value: settlement.totalPnl, kind: "total" },
  ];
}

export function buildRiskAlerts(
  metrics: Pick<
    DashboardMetrics,
    "currentPositionMwh" | "projectedSettlement" | "maxPositionLimitMwh"
  >,
  scenario: Scenario,
  currentPeriod: number
): RiskAlert[] {
  const safeCurrentPeriod = clampPeriodIndex(currentPeriod, scenario);
  const now = scenario.periods[safeCurrentPeriod]?.label ?? "00:00";
  const calibration = buildScenarioCalibrationReport(scenario);
  const horizon = metrics.projectedSettlement.periods.slice(
    safeCurrentPeriod,
    Math.min(safeCurrentPeriod + 12, scenario.periods.length)
  );
  const riskPeriod = horizon.reduce<PeriodSettlement | undefined>(
    (candidate, period) =>
      !candidate || Math.abs(period.imbalanceMwh) > Math.abs(candidate.imbalanceMwh)
        ? period
        : candidate,
    undefined
  );
  const priceSpike = horizon.find(
    (period) =>
      period.imbalancePrice > calibration.priceSpikeThreshold ||
      scenario.periods[period.periodIndex].intradayAsk > calibration.priceSpikeThreshold
  );
  const currentPeriodSnapshot = scenario.periods[safeCurrentPeriod];
  const loadDeviation =
    currentPeriodSnapshot.forecastLoad > 0
      ? ((currentPeriodSnapshot.actualLoad - currentPeriodSnapshot.forecastLoad) /
          currentPeriodSnapshot.forecastLoad) *
        100
      : 0;
  const generationDeviation =
    currentPeriodSnapshot.forecastGeneration > 0
      ? ((currentPeriodSnapshot.actualGeneration - currentPeriodSnapshot.forecastGeneration) /
          currentPeriodSnapshot.forecastGeneration) *
        100
      : 0;
  const positionUtilization =
    Math.abs(metrics.currentPositionMwh) / metrics.maxPositionLimitMwh;

  return [
    {
      id: "imbalance-risk",
      title: "Imbalance Risk",
      description: riskPeriod
        ? `${riskPeriod.label}: projected ${riskPeriod.imbalanceMwh.toFixed(1)} MWh open position`
        : "No projected imbalance in the active horizon",
      timeLabel: now,
      tone:
        riskPeriod && Math.abs(riskPeriod.imbalanceMwh) > 18
          ? "danger"
          : riskPeriod && Math.abs(riskPeriod.imbalanceMwh) > 8
            ? "warning"
            : "info",
    },
    {
      id: "position-limit",
      title: "Position Limit",
      description: `${(positionUtilization * 100).toFixed(1)}% of ${metrics.maxPositionLimitMwh} MWh limit`,
      timeLabel: now,
      tone:
        positionUtilization > 0.9 ? "danger" : positionUtilization > 0.75 ? "warning" : "info",
    },
    {
      id: "gate-closure",
      title: "Gate Closure",
      description:
        safeCurrentPeriod >= scenario.periods.length - 1
          ? "Trading day closed"
          : `Next tradable delivery starts after ${scenario.periods[safeCurrentPeriod].label}`,
      timeLabel: now,
      tone: safeCurrentPeriod >= scenario.periods.length - 2 ? "warning" : "info",
    },
    {
      id: "price-spike",
      title: "Price Spike",
      description: priceSpike
        ? `${priceSpike.label}: imbalance price ${priceSpike.imbalancePrice.toFixed(0)} PLN/MWh`
        : `No >${calibration.priceSpikeThreshold.toFixed(0)} PLN/MWh spike in the next 3 hours`,
      timeLabel: now,
      tone: priceSpike ? "warning" : "info",
    },
    {
      id: "forecast-deviation",
      title: "Forecast Deviation",
      description: `Load ${loadDeviation.toFixed(1)}%, generation ${generationDeviation.toFixed(1)}% vs forecast`,
      timeLabel: now,
      tone:
        Math.max(Math.abs(loadDeviation), Math.abs(generationDeviation)) > 12
          ? "danger"
          : Math.max(Math.abs(loadDeviation), Math.abs(generationDeviation)) > 6
            ? "warning"
            : "info",
    },
  ];
}

export function getTradablePeriods(scenario: Scenario, currentPeriod: number) {
  return scenario.periods.slice(
    Math.min(clampPeriodIndex(currentPeriod, scenario) + 1, scenario.periods.length),
    scenario.periods.length
  );
}

export function buildDashboardMetrics(
  scenario: Scenario,
  contracts: Contract[],
  trades: MarketTrade[],
  currentPeriod: number
): DashboardMetrics {
  const safeCurrentPeriod = clampPeriodIndex(currentPeriod, scenario);
  const realizedPeriods = scenario.periods.slice(0, safeCurrentPeriod + 1);
  const realizedSettlement = settlePortfolio(realizedPeriods, contracts, trades);
  const knownMarketTape = buildKnownMarketTape(scenario, safeCurrentPeriod);
  const projectedSettlement = buildProjectedSettlement(
    scenario,
    contracts,
    trades,
    safeCurrentPeriod
  );
  const fullActualSettlement = settlePortfolio(scenario.periods, contracts, trades);
  const currentSettlement =
    projectedSettlement.periods[safeCurrentPeriod] ?? projectedSettlement.periods.at(-1);
  const signedContracts = buildSignedContracts(scenario, contracts, safeCurrentPeriod);
  const baseMetrics = {
    maxPositionLimitMwh: MAX_POSITION_LIMIT_MWH,
    currentPositionMwh: currentSettlement?.imbalanceMwh ?? 0,
    currentContractedMwh: currentSettlement?.contractedPosition ?? 0,
    currentMarketMwh: currentSettlement?.marketPosition ?? 0,
    currentImbalanceMwh: currentSettlement?.imbalanceMwh ?? 0,
    realizedSettlement,
    projectedSettlement,
    fullActualSettlement,
    balanceSeries: projectedSettlement.periods.map((period) => ({
      label: period.label,
      portfolio: period.periodIndex <= safeCurrentPeriod ? period.imbalanceMwh : null,
      projected: period.periodIndex >= safeCurrentPeriod ? period.imbalanceMwh : null,
      upper: MAX_POSITION_LIMIT_MWH,
      lower: -MAX_POSITION_LIMIT_MWH,
    })),
    loadSeries: knownMarketTape.map((period) => ({
      label: period.label,
      forecast: period.forecastLoad,
      actual: period.actualLoad,
    })),
    generationSeries: knownMarketTape.map((period) => ({
      label: period.label,
      forecast: period.forecastGeneration,
      actual: period.actualGeneration,
    })),
    pnlWaterfall: buildPnlWaterfall(projectedSettlement),
    riskAlerts: [] as RiskAlert[],
    signedContracts,
  };

  return {
    ...baseMetrics,
    riskAlerts: buildRiskAlerts(baseMetrics, scenario, safeCurrentPeriod),
  };
}
