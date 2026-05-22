import { describe, expect, it } from "vitest";

import { createDefaultContracts } from "../contracts";
import {
  buildDecisionCandidates,
  buildOrderImpactPreview,
  pickBestDecisionCandidate,
} from "../decisions";
import {
  buildDayAheadAuctionTrades,
  buildKnownMarketTape,
  buildScenarioCalibrationReport,
  executeOrder,
  getScenarioSetupTrades,
} from "../markets";
import { buildDashboardMetrics, getTradablePeriods } from "../metrics";
import { createScenario } from "../scenarios";
import { settlePeriod, settlePortfolio } from "../settlement";
import { runAutopilot } from "../strategy";
import { useSimulationStore } from "../../store/simulation-store";
import type { Contract, PeriodSnapshot, Scenario } from "../types";

const basePeriod: PeriodSnapshot = {
  index: 12,
  label: "03:00",
  hour: 3,
  forecastGeneration: 10,
  actualGeneration: 10,
  forecastLoad: 8,
  actualLoad: 8,
  rdnPrice: 120,
  spotPrice: 120,
  intradayBid: 118,
  intradayAsk: 122,
  imbalanceLongPrice: 80,
  imbalanceShortPrice: 300,
  liquidityMwh: 30,
  weather: {
    cloudCover: 0.2,
    irradiance: 0,
    temperatureC: 12,
    windSpeedMs: 8,
  },
};

function fixedContract(
  id: string,
  side: "buy" | "sell",
  volumeMwh: number,
  pricePlnMwh: number
): Contract {
  return {
    id,
    templateId: id,
    name: id,
    type: "forward-otc",
    side,
    counterparty: "Test",
    deliveryStart: 0,
    deliveryEnd: 95,
    granularity: "15m",
    volumeFormula: { kind: "fixed", mwh: volumeMwh },
    priceFormula: { kind: "fixed", plnPerMwh: pricePlnMwh },
    imbalanceResponsibility: "portfolio",
    nominationDeadline: "D-1",
    penaltyRule: "None",
    settlementRule: "Fixed profile",
    serviceFeePerMwh: 0,
  };
}

describe("grid balancing simulation", () => {
  it("generates deterministic scenario periods for the same seed", () => {
    const first = createScenario("sunny-negative");
    const second = createScenario("sunny-negative");

    expect(first.periods).toHaveLength(96);
    expect(first.metadata).toMatchObject({
      source: "synthetic-calibrated",
      seed: first.definition.seed,
      marketArea: "PL Market",
    });
    expect(first.periods[42]).toEqual(second.periods[42]);
    expect(first.periods[60].rdnPrice).toBe(second.periods[60].rdnPrice);
    expect(buildScenarioCalibrationReport(first)).toEqual(buildScenarioCalibrationReport(second));
  });

  it("keeps calibrated scenario ranges realistic for v1", () => {
    const sunny = buildScenarioCalibrationReport(createScenario("sunny-negative"));
    const pvOversupply = createScenario("pv-oversupply");
    const pvReport = buildScenarioCalibrationReport(pvOversupply);
    const winter = createScenario("winter-peak");
    const winterReport = buildScenarioCalibrationReport(winter);
    const sunnyMiddayLiquidity =
      createScenario("sunny-negative")
        .periods.slice(40, 56)
        .reduce((sum, period) => sum + period.liquidityMwh, 0) / 16;
    const chaosEveningLiquidity =
      createScenario("chaos-hard-mode")
        .periods.slice(68, 84)
        .reduce((sum, period) => sum + period.liquidityMwh, 0) / 16;
    const pvMiddayAverage =
      pvOversupply.periods.slice(40, 56).reduce((sum, period) => sum + period.rdnPrice, 0) / 16;
    const pvEveningAverage =
      pvOversupply.periods.slice(68, 84).reduce((sum, period) => sum + period.rdnPrice, 0) / 16;

    expect(sunny.negativeRdnPeriods).toBeGreaterThanOrEqual(16);
    expect(sunny.negativeRdnPeriods).toBeLessThanOrEqual(28);
    expect(pvReport.negativeRdnPeriods).toBeGreaterThan(0);
    expect(pvMiddayAverage).toBeLessThan(pvEveningAverage);
    expect(winterReport.averageRdnPrice).toBeGreaterThan(650);
    expect(winterReport.priceSpikeThreshold).toBeGreaterThan(winterReport.averageRdnPrice);
    expect(chaosEveningLiquidity).toBeLessThan(sunnyMiddayLiquidity);

    for (const scenarioId of [
      "sunny-negative",
      "wind-drop",
      "winter-peak",
      "unit-outage",
      "pv-oversupply",
      "chaos-hard-mode",
    ] as const) {
      const report = buildScenarioCalibrationReport(createScenario(scenarioId));

      expect(report.minBidAskSpread).toBeGreaterThanOrEqual(8);
      expect(report.maxBidAskSpread).toBeLessThanOrEqual(68);
      expect(
        createScenario(scenarioId).periods.every(
          (period) =>
            period.intradayBid <= period.intradayAsk &&
            period.imbalanceShortPrice > period.imbalanceLongPrice
        )
      ).toBe(true);
    }
  });

  it("builds dashboard metrics from settlement state instead of mock values", () => {
    const scenario = createScenario("sunny-negative");
    const contracts = createDefaultContracts();
    const trades = buildDayAheadAuctionTrades(scenario, contracts);
    const metrics = buildDashboardMetrics(scenario, contracts, trades, 95);
    const settlement = settlePortfolio(scenario.periods, contracts, trades);

    expect(metrics.currentPositionMwh).toBe(settlement.periods[95].imbalanceMwh);
    expect(metrics.projectedSettlement.totalPnl).toBe(settlement.totalPnl);
    expect(metrics.pnlWaterfall.at(-1)?.value).toBe(settlement.totalPnl);
    expect(metrics.riskAlerts).toHaveLength(5);
  });

  it("returns only future tradable periods after gate closure", () => {
    const scenario = createScenario("sunny-negative");
    const periods = getTradablePeriods(scenario, 43);

    expect(periods[0].index).toBe(44);
    expect(periods.every((period) => period.index > 43)).toBe(true);
  });

  it("settles surplus and deficit energy with the correct PnL signs", () => {
    const surplus = settlePeriod(basePeriod, [
      fixedContract("buy-10", "buy", 10, 100),
      fixedContract("sell-8", "sell", 8, 150),
    ], []);
    const deficit = settlePeriod(basePeriod, [
      fixedContract("buy-5", "buy", 5, 100),
      fixedContract("sell-8", "sell", 8, 150),
    ], []);

    expect(surplus.imbalanceMwh).toBe(2);
    expect(surplus.imbalancePnl).toBe(160);
    expect(surplus.periodPnl).toBe(360);
    expect(deficit.imbalanceMwh).toBe(-3);
    expect(deficit.imbalancePnl).toBe(-900);
    expect(deficit.periodPnl).toBe(-200);
  });

  it("blocks RDN intraday orders, gate-closed orders and accepts executable future RDB orders", () => {
    const rdnBlocked = executeOrder(
      {
        side: "buy",
        market: "RDN",
        periodIndex: 13,
        volumeMwh: 1,
        limitPrice: 500,
      },
      basePeriod,
      12,
      "manual",
      0
    );
    const blocked = executeOrder(
      {
        side: "buy",
        market: "RDB",
        periodIndex: 12,
        volumeMwh: 1,
        limitPrice: 500,
      },
      basePeriod,
      12,
      "manual",
      0
    );
    const accepted = executeOrder(
      {
        side: "sell",
        market: "RDB",
        periodIndex: 12,
        volumeMwh: 2,
        limitPrice: 110,
      },
      basePeriod,
      10,
      "manual",
      0
    );

    expect(rdnBlocked.accepted).toBe(false);
    expect(rdnBlocked.reason).toMatch(/RDN is locked/);
    expect(blocked.accepted).toBe(false);
    expect(blocked.reason).toMatch(/Gate closure/);
    expect(accepted.accepted).toBe(true);
    expect(accepted.trade?.side).toBe("sell");
  });

  it("lets autopilot reduce absolute imbalance versus do-nothing", () => {
    const scenario = createScenario("wind-drop");
    const contracts = createDefaultContracts();
    const setupTrades = buildDayAheadAuctionTrades(scenario, contracts);
    const doNothing = settlePortfolio(scenario.periods, contracts, setupTrades);
    const autopilot = runAutopilot(scenario, contracts);

    expect(autopilot.trades.length).toBeGreaterThan(0);
    expect(autopilot.settlement.totalImbalanceAbsMwh).toBeLessThan(
      doNothing.totalImbalanceAbsMwh
    );
  });

  it("keeps script trades stable when only future actuals change", () => {
    const scenario = createScenario("chaos-hard-mode");
    const modifiedActuals: Scenario = {
      ...scenario,
      periods: scenario.periods.map((period) => ({
        ...period,
        actualGeneration: period.actualGeneration * 0.2,
        actualLoad: period.actualLoad * 1.8,
      })),
    };
    const contracts = createDefaultContracts();
    const originalRun = runAutopilot(scenario, contracts);
    const modifiedRun = runAutopilot(modifiedActuals, contracts);

    expect(modifiedRun.trades.map(({ side, periodIndex, volumeMwh }) => ({
      side,
      periodIndex,
      volumeMwh,
    }))).toEqual(
      originalRun.trades.map(({ side, periodIndex, volumeMwh }) => ({
        side,
        periodIndex,
        volumeMwh,
      }))
    );
  });

  it("keeps script trades stable when only hidden future settlement prices change", () => {
    const scenario = createScenario("chaos-hard-mode");
    const modifiedSettlementPrices: Scenario = {
      ...scenario,
      periods: scenario.periods.map((period) =>
        period.index > 20
          ? {
              ...period,
              imbalanceLongPrice: period.imbalanceLongPrice * 4,
              imbalanceShortPrice: period.imbalanceShortPrice * 4,
            }
          : period
      ),
    };
    const contracts = createDefaultContracts();
    const originalRun = runAutopilot(scenario, contracts);
    const modifiedRun = runAutopilot(modifiedSettlementPrices, contracts);

    expect(modifiedRun.trades.map(({ side, periodIndex, volumeMwh }) => ({
      side,
      periodIndex,
      volumeMwh,
    }))).toEqual(
      originalRun.trades.map(({ side, periodIndex, volumeMwh }) => ({
        side,
        periodIndex,
        volumeMwh,
      }))
    );
  });

  it("keeps future actuals and hidden settlement prices out of dashboard projections", () => {
    const scenario = createScenario("sunny-negative");
    const modifiedHiddenActuals: Scenario = {
      ...scenario,
      periods: scenario.periods.map((period) =>
        period.index > 43
          ? {
              ...period,
              actualGeneration: period.actualGeneration * 0.1,
              actualLoad: period.actualLoad * 2,
              imbalanceLongPrice: period.imbalanceLongPrice * 5,
              imbalanceShortPrice: period.imbalanceShortPrice * 5,
            }
          : period
      ),
    };
    const contracts = createDefaultContracts();
    const trades = buildDayAheadAuctionTrades(scenario, contracts);
    const originalMetrics = buildDashboardMetrics(scenario, contracts, trades, 43);
    const modifiedMetrics = buildDashboardMetrics(modifiedHiddenActuals, contracts, trades, 43);
    const knownTape = buildKnownMarketTape(scenario, 43);

    expect(originalMetrics.loadSeries[43].actual).not.toBeNull();
    expect(originalMetrics.loadSeries[44].actual).toBeNull();
    expect(knownTape[44].actualGeneration).toBeNull();
    expect(originalMetrics.projectedSettlement.totalPnl).toBe(
      modifiedMetrics.projectedSettlement.totalPnl
    );
  });

  it("does not keep winter peak price-spike alerts on for most of the day", () => {
    const scenario = createScenario("winter-peak");
    const contracts = createDefaultContracts();
    const trades = buildDayAheadAuctionTrades(scenario, contracts);
    const priceSpikeWarnings = scenario.periods.filter((period) => {
      const alert = buildDashboardMetrics(
        scenario,
        contracts,
        trades,
        period.index
      ).riskAlerts.find((candidate) => candidate.id === "price-spike");

      return alert?.tone === "warning" || alert?.tone === "danger";
    });

    expect(priceSpikeWarnings.length).toBeLessThan(48);
  });

  it("advances and closes the simulation clock through the store", () => {
    useSimulationStore.getState().resetScenario();
    const start = useSimulationStore.getState().currentPeriod;

    useSimulationStore.getState().step();
    expect(useSimulationStore.getState().currentPeriod).toBe(start + 1);
    expect(useSimulationStore.getState().selectedPeriod).toBeGreaterThan(start + 1);

    useSimulationStore.getState().runToEnd();
    expect(useSimulationStore.getState().currentPeriod).toBe(95);
    expect(useSimulationStore.getState().isClosed).toBe(true);
    expect(useSimulationStore.getState().isRunning).toBe(false);
  });

  it("places executable future orders through the store and updates trade state", () => {
    useSimulationStore.getState().resetScenario();
    const state = useSimulationStore.getState();
    const targetPeriod = state.currentPeriod + 1;
    const period = state.scenario.periods[targetPeriod];

    state.setSelectedPeriod(targetPeriod);
    useSimulationStore.getState().updateOrderDraft({
      side: "buy",
      periodIndex: targetPeriod,
      volumeMwh: 1,
      limitPrice: period.intradayAsk + 20,
    });
    useSimulationStore.getState().placeOrder();

    expect(getScenarioSetupTrades(useSimulationStore.getState().trades).length).toBeGreaterThan(0);
    expect(useSimulationStore.getState().trades.some((trade) => trade.actor === "manual")).toBe(
      true
    );
    expect(useSimulationStore.getState().trades.at(-1)).toMatchObject({
      actor: "manual",
      side: "buy",
      periodIndex: targetPeriod,
    });
  });

  it("builds decision candidates that reduce expected imbalance when loaded", () => {
    const scenario = createScenario("sunny-negative");
    const contracts = createDefaultContracts();
    const trades = buildDayAheadAuctionTrades(scenario, contracts);
    const candidates = buildDecisionCandidates(scenario, contracts, trades, 43, 12);
    const best = pickBestDecisionCandidate(candidates);

    expect(candidates).toHaveLength(12);
    expect(best.orderDraft).toBeDefined();
    expect(best.periodIndex).toBeGreaterThan(43);
    expect(best.expectedImbalanceReductionMwh).toBeGreaterThan(0);
    expect(best.orderDraft).toMatchObject({
      market: "RDB",
      periodIndex: best.periodIndex,
      side: best.recommendation,
    });
  });

  it("previews order impact before mutating the trade tape", () => {
    const scenario = createScenario("wind-drop");
    const contracts = createDefaultContracts();
    const trades = buildDayAheadAuctionTrades(scenario, contracts);
    const best = pickBestDecisionCandidate(
      buildDecisionCandidates(scenario, contracts, trades, 43, 12)
    );

    expect(best.orderDraft).toBeDefined();

    const preview = buildOrderImpactPreview(
      scenario,
      contracts,
      trades,
      43,
      best.orderDraft!
    );

    expect(preview.accepted).toBe(true);
    expect(preview.imbalanceReductionMwh).toBeGreaterThan(0);
    expect(trades.some((trade) => trade.actor === "manual")).toBe(false);
  });
});
