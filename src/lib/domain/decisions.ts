import { buildKnownPeriodView, executeOrder } from "./markets";
import { settlePeriod } from "./settlement";
import type {
  Contract,
  MarketTrade,
  OrderDraft,
  PeriodSettlement,
  Scenario,
  TradeSide,
} from "./types";

const DECISION_BUFFER_MWH = 1.5;
const DECISION_RISK_LIMIT_MWH = 25;
const DECISION_LIQUIDITY_USAGE = 0.75;

export interface OrderImpactPreview {
  accepted: boolean;
  reason: string;
  periodIndex: number;
  label: string;
  side: TradeSide;
  volumeMwh: number;
  limitPrice: number;
  beforeImbalanceMwh: number;
  afterImbalanceMwh: number;
  beforePeriodPnl: number;
  afterPeriodPnl: number;
  pnlImpact: number;
  imbalanceReductionMwh: number;
  executionPrice?: number;
}

export interface DecisionCandidate {
  periodIndex: number;
  label: string;
  expectedNetMwh: number;
  expectedImbalancePnl: number;
  rdbBid: number;
  rdbAsk: number;
  liquidityMwh: number;
  recommendation: TradeSide | "hold";
  recommendedVolumeMwh: number;
  recommendedLimitPrice: number;
  expectedPnlImpact: number;
  expectedImbalanceReductionMwh: number;
  rationale: string;
  tone: "positive" | "warning" | "neutral";
  orderDraft?: OrderDraft;
}

function round(value: number, precision = 2): number {
  return Number(value.toFixed(precision));
}

function expectedPriceOverride(scenario: Scenario, currentPeriod: number, periodIndex: number) {
  const knownPeriod = buildKnownPeriodView(scenario, currentPeriod, periodIndex);

  return {
    imbalanceLongPrice:
      knownPeriod.actualImbalanceLongPrice ?? knownPeriod.expectedImbalanceLongPrice,
    imbalanceShortPrice:
      knownPeriod.actualImbalanceShortPrice ?? knownPeriod.expectedImbalanceShortPrice,
  };
}

function buildExpectedSettlement(
  scenario: Scenario,
  contracts: Contract[],
  trades: MarketTrade[],
  currentPeriod: number,
  periodIndex: number
): PeriodSettlement {
  const period = scenario.periods[periodIndex];

  return settlePeriod(
    period,
    contracts,
    trades,
    period.index <= currentPeriod ? "actual" : "forecast",
    expectedPriceOverride(scenario, currentPeriod, periodIndex)
  );
}

export function buildOrderImpactPreview(
  scenario: Scenario,
  contracts: Contract[],
  trades: MarketTrade[],
  currentPeriod: number,
  draft: OrderDraft
): OrderImpactPreview {
  const period = scenario.periods[draft.periodIndex] ?? scenario.periods[currentPeriod];
  const before = buildExpectedSettlement(
    scenario,
    contracts,
    trades,
    currentPeriod,
    period.index
  );
  const execution = executeOrder(draft, period, currentPeriod, "manual", trades.length);

  if (!execution.trade) {
    return {
      accepted: false,
      reason: execution.reason,
      periodIndex: period.index,
      label: period.label,
      side: draft.side,
      volumeMwh: draft.volumeMwh,
      limitPrice: draft.limitPrice,
      beforeImbalanceMwh: before.imbalanceMwh,
      afterImbalanceMwh: before.imbalanceMwh,
      beforePeriodPnl: before.periodPnl,
      afterPeriodPnl: before.periodPnl,
      pnlImpact: 0,
      imbalanceReductionMwh: 0,
    };
  }

  const after = buildExpectedSettlement(
    scenario,
    contracts,
    [...trades, execution.trade],
    currentPeriod,
    period.index
  );

  return {
    accepted: true,
    reason: execution.reason,
    periodIndex: period.index,
    label: period.label,
    side: draft.side,
    volumeMwh: draft.volumeMwh,
    limitPrice: draft.limitPrice,
    beforeImbalanceMwh: before.imbalanceMwh,
    afterImbalanceMwh: after.imbalanceMwh,
    beforePeriodPnl: before.periodPnl,
    afterPeriodPnl: after.periodPnl,
    pnlImpact: round(after.periodPnl - before.periodPnl),
    imbalanceReductionMwh: round(Math.abs(before.imbalanceMwh) - Math.abs(after.imbalanceMwh)),
    executionPrice: execution.trade.pricePlnMwh,
  };
}

function buildRecommendedDraft(
  scenario: Scenario,
  currentPeriod: number,
  settlement: PeriodSettlement
): OrderDraft | undefined {
  const period = scenario.periods[settlement.periodIndex];
  const expectedNetMwh = settlement.imbalanceMwh;

  if (Math.abs(expectedNetMwh) <= DECISION_BUFFER_MWH) {
    return undefined;
  }

  const side: TradeSide = expectedNetMwh > 0 ? "sell" : "buy";
  const volumeMwh = round(
    Math.min(
      Math.abs(expectedNetMwh) - DECISION_BUFFER_MWH,
      DECISION_RISK_LIMIT_MWH,
      period.liquidityMwh * DECISION_LIQUIDITY_USAGE
    ),
    1
  );

  if (volumeMwh <= 0.2 || period.index <= currentPeriod) {
    return undefined;
  }

  return {
    side,
    market: "RDB",
    periodIndex: period.index,
    volumeMwh,
    limitPrice:
      side === "buy" ? Math.ceil(period.intradayAsk + 8) : Math.floor(period.intradayBid - 8),
  };
}

function rationaleFor(recommendation: TradeSide | "hold", impact: OrderImpactPreview | undefined) {
  if (recommendation === "hold") {
    return "Expected open position stays inside the risk buffer.";
  }

  if (!impact?.accepted) {
    return impact?.reason ?? "RDB liquidity is not executable for this candidate.";
  }

  if (recommendation === "sell") {
    return "Expected surplus can be reduced before gate closure.";
  }

  return "Expected deficit can be covered before gate closure.";
}

export function buildDecisionCandidates(
  scenario: Scenario,
  contracts: Contract[],
  trades: MarketTrade[],
  currentPeriod: number,
  horizonPeriods = 12
): DecisionCandidate[] {
  const horizonEnd = Math.min(currentPeriod + horizonPeriods, scenario.periods.length - 1);
  const candidates: DecisionCandidate[] = [];

  for (let periodIndex = currentPeriod + 1; periodIndex <= horizonEnd; periodIndex += 1) {
    const period = scenario.periods[periodIndex];
    const settlement = buildExpectedSettlement(
      scenario,
      contracts,
      trades,
      currentPeriod,
      periodIndex
    );
    const orderDraft = buildRecommendedDraft(scenario, currentPeriod, settlement);
    const impact = orderDraft
      ? buildOrderImpactPreview(scenario, contracts, trades, currentPeriod, orderDraft)
      : undefined;
    const recommendation = orderDraft?.side ?? "hold";
    const expectedPnlImpact = impact?.pnlImpact ?? 0;
    const expectedImbalanceReductionMwh = impact?.imbalanceReductionMwh ?? 0;

    candidates.push({
      periodIndex,
      label: period.label,
      expectedNetMwh: settlement.imbalanceMwh,
      expectedImbalancePnl: settlement.imbalancePnl,
      rdbBid: period.intradayBid,
      rdbAsk: period.intradayAsk,
      liquidityMwh: period.liquidityMwh,
      recommendation,
      recommendedVolumeMwh: orderDraft?.volumeMwh ?? 0,
      recommendedLimitPrice: orderDraft?.limitPrice ?? 0,
      expectedPnlImpact,
      expectedImbalanceReductionMwh,
      rationale: rationaleFor(recommendation, impact),
      tone:
        expectedPnlImpact > 0 && expectedImbalanceReductionMwh > 0
          ? "positive"
          : Math.abs(settlement.imbalanceMwh) > 8
            ? "warning"
            : "neutral",
      orderDraft,
    });
  }

  return candidates;
}

export function pickBestDecisionCandidate(candidates: DecisionCandidate[]) {
  return (
    candidates
      .filter((candidate) => candidate.orderDraft && candidate.expectedPnlImpact > 0)
      .sort((left, right) => right.expectedPnlImpact - left.expectedPnlImpact)[0] ??
    candidates
      .filter((candidate) => candidate.orderDraft)
      .sort(
        (left, right) =>
          right.expectedImbalanceReductionMwh - left.expectedImbalanceReductionMwh
      )[0] ??
    candidates[0]
  );
}
