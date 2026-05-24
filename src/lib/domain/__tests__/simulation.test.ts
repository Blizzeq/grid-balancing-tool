import { describe, expect, it } from "vitest";

import {
  createContractFromTemplate,
  createDefaultContracts,
  CONTRACT_TEMPLATES,
  evaluateContractPrice,
  evaluateContractVolume,
  settleContractsForPeriod,
} from "../contracts";
import {
  buildDecisionCandidates,
  buildDecisionLogEntry,
  buildOrderImpactPreview,
  buildScenarioDecisionReport,
  buildStrategyDuelInsights,
  pickBestDecisionCandidate,
} from "../decisions";
import { assertBuiltInDataIntegrity, validateBuiltInData } from "../data-integrity";
import {
  buildDayAheadAuctionTrades,
  buildKnownMarketTape,
  buildRdbDepth,
  buildScenarioCalibrationReport,
  executeOrder,
  getScenarioSetupTrades,
  quoteRdbOrder,
} from "../markets";
import { buildDashboardMetrics, getTradablePeriods } from "../metrics";
import { PORTFOLIOS, getPortfolioDefinition, parsePortfolioId } from "../portfolios";
import {
  buildReplayPeriodInsights,
  buildReplayTimeline,
  buildScenarioLessons,
} from "../replay";
import { createDefaultScenarioConfig, createScenario } from "../scenarios";
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
      currency: "PLN",
    });
    expect(first.periods[42]).toEqual(second.periods[42]);
    expect(first.periods[60].rdnPrice).toBe(second.periods[60].rdnPrice);
    expect(buildScenarioCalibrationReport(first)).toEqual(buildScenarioCalibrationReport(second));
  });

  it("defines selectable portfolios with valid default contracts and settlement currency", () => {
    const templateIds = new Set(CONTRACT_TEMPLATES.map((template) => template.templateId));

    expect(PORTFOLIOS).toHaveLength(3);
    expect(getPortfolioDefinition("alpha-power").name).toBe("Alpha Power");

    PORTFOLIOS.forEach((portfolio) => {
      expect(portfolio.baseCurrency).toBe("PLN");
      expect(portfolio.marketArea).toBe("PL Market");
      expect(portfolio.defaultContractTemplateIds.length).toBeGreaterThanOrEqual(3);
      expect(portfolio.defaultContractTemplateIds.every((templateId) => templateIds.has(templateId))).toBe(
        true
      );
      expect(createDefaultContracts(portfolio.defaultContractTemplateIds)).toHaveLength(
        portfolio.defaultContractTemplateIds.length
      );
    });
  });

  it("rejects unknown portfolio and contract identifiers instead of falling back", () => {
    useSimulationStore.getState().setPortfolio("alpha-power");
    const before = useSimulationStore.getState().portfolioId;

    expect(parsePortfolioId("missing-book")).toBeUndefined();
    expect(() => getPortfolioDefinition("missing-book" as never)).toThrow(/Unknown portfolio/);
    expect(() => createContractFromTemplate("missing-template", "test")).toThrow(
      /Unknown contract template/
    );

    useSimulationStore.getState().setPortfolio("missing-book");

    expect(useSimulationStore.getState().portfolioId).toBe(before);
    expect(useSimulationStore.getState().statusMessage).toMatch(/Unknown portfolio id/);
  });

  it("passes built-in data integrity checks for every scenario and portfolio", () => {
    const report = validateBuiltInData();
    const errorSummary = report.errors
      .map((issue) => `[${issue.area}:${issue.id}] ${issue.message}`)
      .join("\n");

    expect(report.errors, errorSummary).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
    expect(() => assertBuiltInDataIntegrity()).not.toThrow();
  });

  it("generates deterministic scenario editor tapes from seed and stress config", () => {
    const config = {
      ...createDefaultScenarioConfig("sunny-negative"),
      seed: 22222,
      pvIntensity: 1.45,
      windVolatility: 1.35,
      loadStress: 1.18,
      liquidityStress: 0.7,
      priceVolatility: 1.55,
      outageProbability: 0.65,
    };
    const first = createScenario("sunny-negative", config);
    const second = createScenario("sunny-negative", config);
    const changedSeed = createScenario("sunny-negative", { ...config, seed: 22223 });
    const defaultScenario = createScenario("sunny-negative");
    const stressedLiquidity = createScenario("sunny-negative", {
      ...createDefaultScenarioConfig("sunny-negative"),
      liquidityStress: 1,
    });
    const averageLiquidity = (scenario: Scenario) =>
      scenario.periods.reduce((sum, period) => sum + period.liquidityMwh, 0) /
      scenario.periods.length;
    const averageMiddayGeneration = (scenario: Scenario) =>
      scenario.periods
        .slice(40, 56)
        .reduce((sum, period) => sum + period.forecastGeneration, 0) / 16;

    expect(first.metadata.config).toEqual(config);
    expect(first.periods).toEqual(second.periods);
    expect(buildScenarioCalibrationReport(first)).toEqual(buildScenarioCalibrationReport(second));
    expect(first.periods.map((period) => period.rdnPrice)).not.toEqual(
      changedSeed.periods.map((period) => period.rdnPrice)
    );
    expect(averageLiquidity(stressedLiquidity)).toBeLessThan(
      averageLiquidity(defaultScenario)
    );
    expect(averageMiddayGeneration(first)).toBeGreaterThan(
      averageMiddayGeneration(defaultScenario)
    );
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

  it("changes the forward exposure profile after signing an extra contract", () => {
    const scenario = createScenario("sunny-negative");
    const contracts = createDefaultContracts();
    const trades = buildDayAheadAuctionTrades(scenario, contracts);
    const baseMetrics = buildDashboardMetrics(scenario, contracts, trades, 43);
    const peakContract = createContractFromTemplate("peak-shaped-sell", "acceptance");
    const previewMetrics = buildDashboardMetrics(
      scenario,
      [...contracts, peakContract],
      trades,
      43
    );
    const changedPeakPeriods = previewMetrics.projectedSettlement.periods.filter(
      (period, index) => {
        const basePeriod = baseMetrics.projectedSettlement.periods[index];

        return (
          period.periodIndex >= peakContract.deliveryStart &&
          period.periodIndex <= peakContract.deliveryEnd &&
          Math.abs(period.imbalanceMwh - (basePeriod?.imbalanceMwh ?? 0)) > 0.1
        );
      }
    );

    expect(changedPeakPeriods.length).toBeGreaterThan(0);
    expect(previewMetrics.projectedSettlement.totalPnl).not.toBe(
      baseMetrics.projectedSettlement.totalPnl
    );
    expect(previewMetrics.signedContracts.some((contract) => contract.product === "SHAPED")).toBe(
      true
    );
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

  it("settles contract templates with profile-specific volumes and prices", () => {
    const scenario = createScenario("sunny-negative");
    const night = scenario.periods.find((period) => period.hour === 3);
    const midday = scenario.periods.find((period) => period.hour === 12);
    const evening = scenario.periods.find((period) => period.hour === 20);

    expect(night).toBeDefined();
    expect(midday).toBeDefined();
    expect(evening).toBeDefined();

    const ppa = createContractFromTemplate("ppa-pv-pay-as-produced", "test");
    const retail = createContractFromTemplate("industrial-retail-load", "test");
    const base = createContractFromTemplate("base-forward-buy", "test");
    const peak = createContractFromTemplate("peak-shaped-sell", "test");
    const swing = createContractFromTemplate("swing-flex-buy", "test");

    expect(evaluateContractVolume(ppa, midday!, "actual")).toBeCloseTo(
      midday!.actualGeneration
    );
    expect(evaluateContractPrice(ppa, midday!)).toBe(285);
    expect(settleContractsForPeriod(midday!, [ppa], "actual")).toMatchObject({
      boughtMwh: midday!.actualGeneration,
      generationMwh: midday!.actualGeneration,
    });

    const retailVolume = evening!.actualLoad * 0.85;
    const retailSettlement = settleContractsForPeriod(evening!, [retail], "actual");

    expect(evaluateContractVolume(retail, evening!, "actual")).toBeCloseTo(retailVolume);
    expect(evaluateContractPrice(retail, evening!)).toBe(evening!.rdnPrice + 34);
    expect(retailSettlement.soldMwh).toBeCloseTo(retailVolume);
    expect(retailSettlement.salesRevenue).toBeCloseTo(retailVolume * (evening!.rdnPrice + 34));

    expect(evaluateContractVolume(base, night!, "forecast")).toBe(7);
    expect(evaluateContractPrice(base, night!)).toBe(318);
    expect(evaluateContractVolume(peak, night!, "forecast")).toBe(0);
    expect(evaluateContractVolume(peak, evening!, "forecast")).toBe(8.5);
    expect(evaluateContractPrice(peak, evening!)).toBe(466);

    expect(evaluateContractVolume(swing, evening!, "forecast")).toBe(5);
    expect(evaluateContractPrice(swing, evening!)).toBe(evening!.rdnPrice + 18);
    expect(swing.imbalanceResponsibility).toBe("counterparty");
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

  it("applies RDB slippage and partial fills from executable liquidity", () => {
    const depth = buildRdbDepth(basePeriod);
    const depthVolume = depth.reduce((sum, level) => sum + level.volumeMwh, 0);
    const smallBuy = executeOrder(
      {
        side: "buy",
        market: "RDB",
        periodIndex: 13,
        volumeMwh: 5,
        limitPrice: 500,
      },
      basePeriod,
      10,
      "manual",
      0
    );
    const smallQuote = quoteRdbOrder(
      {
        side: "buy",
        market: "RDB",
        periodIndex: 13,
        volumeMwh: 5,
        limitPrice: 500,
      },
      basePeriod
    );
    const largeQuote = quoteRdbOrder(
      {
        side: "buy",
        market: "RDB",
        periodIndex: 13,
        volumeMwh: 25,
        limitPrice: 500,
      },
      basePeriod
    );
    const largeBuy = executeOrder(
      {
        side: "buy",
        market: "RDB",
        periodIndex: 13,
        volumeMwh: 25,
        limitPrice: 500,
      },
      basePeriod,
      10,
      "manual",
      1
    );
    const partialSell = executeOrder(
      {
        side: "sell",
        market: "RDB",
        periodIndex: 13,
        volumeMwh: 50,
        limitPrice: 100,
      },
      basePeriod,
      10,
      "manual",
      2
    );
    const noLiquidity = executeOrder(
      {
        side: "buy",
        market: "RDB",
        periodIndex: 13,
        volumeMwh: 1,
        limitPrice: 500,
      },
      { ...basePeriod, liquidityMwh: 0 },
      10,
      "manual",
      3
    );

    expect(depth).toHaveLength(3);
    expect(depthVolume).toBeCloseTo(basePeriod.liquidityMwh);
    expect(depth[1].askPrice).toBeGreaterThan(depth[0].askPrice);
    expect(depth[1].bidPrice).toBeLessThan(depth[0].bidPrice);
    expect(smallBuy.accepted).toBe(true);
    expect(largeBuy.accepted).toBe(true);
    expect(smallQuote.fills).toHaveLength(1);
    expect(largeQuote.fills.length).toBeGreaterThan(1);
    expect(largeQuote.spreadCostPln).toBeGreaterThan(smallQuote.spreadCostPln);
    expect(largeQuote.transactionFeePln).toBeGreaterThan(smallQuote.transactionFeePln);
    expect(largeBuy.trade!.pricePlnMwh).toBeGreaterThan(smallBuy.trade!.pricePlnMwh);
    expect(partialSell.accepted).toBe(true);
    expect(partialSell.trade?.volumeMwh).toBe(basePeriod.liquidityMwh);
    expect(partialSell.reason).toMatch(/Partial fill/);
    expect(noLiquidity.accepted).toBe(false);
    expect(noLiquidity.reason).toMatch(/No executable RDB liquidity/);
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
    expect(useSimulationStore.getState().activeView).toBe("replay");
    expect(useSimulationStore.getState().mode).toBe("replay");

    useSimulationStore.getState().resetScenario();
    expect(useSimulationStore.getState().activeView).toBe("replay");
    expect(useSimulationStore.getState().mode).toBe("replay");

    useSimulationStore.getState().setMode("replay");
    expect(useSimulationStore.getState().activeView).toBe("replay");

    useSimulationStore.getState().setView("dashboard");
    expect(useSimulationStore.getState().mode).toBe("manual");
  });

  it("applies scenario editor drafts by rebuilding the store state", () => {
    useSimulationStore.getState().setScenario("sunny-negative");
    useSimulationStore.getState().setView("forecast");

    const baseState = useSimulationStore.getState();
    const basePriceTape = baseState.scenario.periods.map((period) => period.rdnPrice);
    const config = {
      ...baseState.scenarioConfigDraft,
      seed: 33333,
      pvIntensity: 1.5,
      liquidityStress: 0.85,
      priceVolatility: 1.6,
    };

    baseState.updateScenarioConfigDraft(config);

    expect(useSimulationStore.getState().scenarioConfigDraft).toEqual(config);
    expect(useSimulationStore.getState().scenario.periods.map((period) => period.rdnPrice)).toEqual(
      basePriceTape
    );

    useSimulationStore.getState().applyScenarioConfig();

    const appliedState = useSimulationStore.getState();

    expect(appliedState.scenarioConfig).toEqual(config);
    expect(appliedState.scenario.metadata.seed).toBe(33333);
    expect(appliedState.scenario.periods.map((period) => period.rdnPrice)).not.toEqual(
      basePriceTape
    );
    expect(appliedState.currentPeriod).toBe(43);
    expect(appliedState.isClosed).toBe(false);
    expect(appliedState.activeView).toBe("forecast");
    expect(getScenarioSetupTrades(appliedState.trades).length).toBeGreaterThan(0);

    useSimulationStore.getState().resetScenarioConfig();

    expect(useSimulationStore.getState().scenarioConfig).toEqual(
      createDefaultScenarioConfig("sunny-negative")
    );
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
    expect(useSimulationStore.getState().decisionLog[0]).toMatchObject({
      accepted: true,
      periodIndex: targetPeriod,
      side: "buy",
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
    expect(preview.trade).toBeDefined();

    const entry = buildDecisionLogEntry(preview, "10:45", 0);

    expect(entry).toMatchObject({
      accepted: true,
      periodIndex: best.periodIndex,
      side: best.recommendation,
    });
    expect(entry.summary).toContain("MWh moved expected imbalance");
    expect(entry.imbalanceReductionMwh).toBeGreaterThan(0);
    expect(trades.some((trade) => trade.actor === "manual")).toBe(false);
  });

  it("builds duel insights and a scenario decision report from the same RDN setup", () => {
    const scenario = createScenario("wind-drop");
    const contracts = createDefaultContracts();
    const setupTrades = buildDayAheadAuctionTrades(scenario, contracts);
    const autopilot = runAutopilot(scenario, contracts, undefined, setupTrades);
    const insights = buildStrategyDuelInsights(
      scenario,
      contracts,
      setupTrades,
      autopilot.trades,
      95
    );
    const report = buildScenarioDecisionReport(
      [],
      insights,
      settlePortfolio(scenario.periods, contracts, setupTrades),
      autopilot.settlement
    );

    expect(insights.length).toBeGreaterThan(0);
    expect(insights[0]).toMatchObject({
      category: "missed-trade",
    });
    expect(report.missedOpportunityCount).toBe(insights.length);
    expect(report.acceptedDecisionCount).toBe(0);
    expect(report.rejectedDecisionCount).toBe(0);
    expect(report.avoidableImbalanceCost).toBeGreaterThanOrEqual(0);
  });

  it("builds a deterministic replay timeline with lessons after settlement", () => {
    const scenario = createScenario("wind-drop");
    const contracts = createDefaultContracts();
    const setupTrades = buildDayAheadAuctionTrades(scenario, contracts);
    const best = pickBestDecisionCandidate(
      buildDecisionCandidates(scenario, contracts, setupTrades, 43, 12)
    );

    expect(best.orderDraft).toBeDefined();

    const preview = buildOrderImpactPreview(
      scenario,
      contracts,
      setupTrades,
      43,
      best.orderDraft!
    );
    const decision = buildDecisionLogEntry(preview, "10:45", 0);
    const rejectedPreview = buildOrderImpactPreview(
      scenario,
      contracts,
      setupTrades,
      43,
      {
        ...best.orderDraft!,
        market: "RDN",
      }
    );
    const rejectedDecision = buildDecisionLogEntry(rejectedPreview, "10:45", 1);
    const manualTrades = preview.trade ? [...setupTrades, preview.trade] : setupTrades;
    const autopilot = runAutopilot(scenario, contracts, undefined, setupTrades);
    const input = {
      scenario,
      contracts,
      manualTrades,
      scriptTrades: autopilot.trades,
      decisionLog: [decision, rejectedDecision],
      currentPeriod: 95,
    };

    const firstTimeline = buildReplayTimeline(input);
    const secondTimeline = buildReplayTimeline(input);
    const lessons = buildScenarioLessons(input);

    expect(firstTimeline).toEqual(secondTimeline);
    expect(firstTimeline.some((event) => event.kind === "good-hedge")).toBe(true);
    expect(firstTimeline.some((event) => event.kind === "manual-decision")).toBe(true);
    expect(firstTimeline.some((event) => event.kind === "bot-edge")).toBe(true);
    expect(
      firstTimeline.some(
        (event) => event.kind === "bot-edge" && event.title === "Missed trade"
      )
    ).toBe(true);
    expect(firstTimeline.some((event) => event.kind === "imbalance-leak")).toBe(true);
    expect(lessons.length).toBeGreaterThan(0);
    expect(lessons[0].recommendation.length).toBeGreaterThan(10);

    const costliestLeak = firstTimeline
      .filter((event) => event.kind === "imbalance-leak")
      .sort((left, right) => left.pnlImpact - right.pnlImpact)[0];
    const largestBotEdge = firstTimeline
      .filter((event) => event.kind === "bot-edge")
      .sort((left, right) => right.pnlImpact - left.pnlImpact)[0];

    expect(lessons).toContainEqual(
      expect.objectContaining({
        periodIndex: costliestLeak!.periodIndex,
        title: "Costliest imbalance",
      })
    );
    expect(lessons).toContainEqual(
      expect.objectContaining({
        periodIndex: largestBotEdge!.periodIndex,
        title: "Largest missed edge",
      })
    );
  });

  it("builds replay period insights with manual, script and baseline comparisons", () => {
    const scenario = createScenario("wind-drop");
    const contracts = createDefaultContracts();
    const setupTrades = buildDayAheadAuctionTrades(scenario, contracts);
    const autopilot = runAutopilot(scenario, contracts, undefined, setupTrades);
    const insights = buildReplayPeriodInsights({
      scenario,
      contracts,
      manualTrades: setupTrades,
      scriptTrades: autopilot.trades,
      decisionLog: [],
      currentPeriod: 95,
    });
    const scriptEdge = insights.find((insight) => (insight.pnlGapToScript ?? 0) > 100);

    expect(insights).toHaveLength(96);
    expect(scriptEdge).toBeDefined();
    expect(scriptEdge?.scriptPnl).toBeDefined();
    expect(scriptEdge?.baselinePnl).toBe(scriptEdge?.manualPnl);
    expect(scriptEdge?.recommendation).toMatch(/RDB|script|imbalance/);
  });

  it("keeps future actuals out of replay analysis before final settlement", () => {
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
    const input = {
      contracts,
      manualTrades: trades,
      scriptTrades: [],
      decisionLog: [],
      currentPeriod: 43,
    };

    expect(buildReplayPeriodInsights({ ...input, scenario })).toEqual(
      buildReplayPeriodInsights({ ...input, scenario: modifiedHiddenActuals })
    );
    expect(buildReplayTimeline({ ...input, scenario })).toEqual(
      buildReplayTimeline({ ...input, scenario: modifiedHiddenActuals })
    );
  });
});
