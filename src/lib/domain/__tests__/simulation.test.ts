import { describe, expect, it } from "vitest";

import { createDefaultContracts } from "../contracts";
import { executeOrder } from "../markets";
import { createScenario } from "../scenarios";
import { settlePeriod, settlePortfolio } from "../settlement";
import { runAutopilot } from "../strategy";
import type { Contract, PeriodSnapshot, Scenario } from "../types";

const basePeriod: PeriodSnapshot = {
  index: 12,
  label: "03:00",
  hour: 3,
  forecastGeneration: 10,
  actualGeneration: 10,
  forecastLoad: 8,
  actualLoad: 8,
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
    expect(first.periods[42]).toEqual(second.periods[42]);
    expect(first.periods[60].spotPrice).toBe(second.periods[60].spotPrice);
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

  it("blocks orders after gate closure and accepts executable future RDB orders", () => {
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

    expect(blocked.accepted).toBe(false);
    expect(blocked.reason).toMatch(/Gate closure/);
    expect(accepted.accepted).toBe(true);
    expect(accepted.trade?.side).toBe("sell");
  });

  it("lets autopilot reduce absolute imbalance versus do-nothing", () => {
    const scenario = createScenario("wind-drop");
    const contracts = createDefaultContracts();
    const doNothing = settlePortfolio(scenario.periods, contracts, []);
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
});
