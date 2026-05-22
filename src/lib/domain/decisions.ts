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
  trade?: MarketTrade;
}

export interface DecisionLogEntry {
  id: string;
  periodIndex: number;
  label: string;
  side: TradeSide;
  volumeMwh: number;
  limitPrice: number;
  accepted: boolean;
  title: string;
  summary: string;
  reason: string;
  pnlImpact: number;
  imbalanceReductionMwh: number;
  beforeImbalanceMwh: number;
  afterImbalanceMwh: number;
  priceQuality: "good" | "fair" | "poor" | "rejected";
  exposureChange: "reduced" | "increased" | "unchanged";
  tone: "positive" | "warning" | "negative" | "neutral";
  createdAtLabel: string;
}

export interface StrategyDuelInsight {
  id: string;
  periodIndex: number;
  label: string;
  category: "missed-trade" | "wrong-side" | "too-late" | "too-much-volume";
  title: string;
  description: string;
  manualPnl: number;
  scriptPnl: number;
  opportunityPln: number;
}

export interface ScenarioDecisionReport {
  acceptedDecisionCount: number;
  rejectedDecisionCount: number;
  totalDecisionPnlImpact: number;
  totalRiskCutMwh: number;
  avoidableImbalanceCost: number;
  totalPnlGapToScript: number;
  missedOpportunityCount: number;
  bestDecision?: DecisionLogEntry;
  worstDecision?: DecisionLogEntry;
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
    trade: execution.trade,
  };
}

function titleForDecision(preview: OrderImpactPreview): string {
  if (!preview.accepted) {
    return "Order rejected";
  }

  if (preview.pnlImpact > 0 && preview.imbalanceReductionMwh > 0) {
    return "Good hedge";
  }

  if (preview.imbalanceReductionMwh > 0) {
    return "Risk cut, paid premium";
  }

  if (preview.imbalanceReductionMwh < 0) {
    return "Added imbalance risk";
  }

  return "Neutral execution";
}

function priceQualityFor(preview: OrderImpactPreview): DecisionLogEntry["priceQuality"] {
  if (!preview.accepted) {
    return "rejected";
  }

  if (preview.pnlImpact > 0 && preview.imbalanceReductionMwh > 0) {
    return "good";
  }

  if (preview.imbalanceReductionMwh > 0) {
    return "fair";
  }

  return "poor";
}

function toneForDecision(preview: OrderImpactPreview): DecisionLogEntry["tone"] {
  if (!preview.accepted || preview.imbalanceReductionMwh < 0) {
    return "negative";
  }

  if (preview.pnlImpact > 0 && preview.imbalanceReductionMwh > 0) {
    return "positive";
  }

  if (preview.imbalanceReductionMwh > 0) {
    return "warning";
  }

  return "neutral";
}

export function buildDecisionLogEntry(
  preview: OrderImpactPreview,
  submittedAtLabel: string,
  count: number
): DecisionLogEntry {
  const exposureChange =
    preview.imbalanceReductionMwh > 0
      ? "reduced"
      : preview.imbalanceReductionMwh < 0
        ? "increased"
        : "unchanged";

  return {
    id: `decision-${count + 1}`,
    periodIndex: preview.periodIndex,
    label: preview.label,
    side: preview.side,
    volumeMwh: round(preview.volumeMwh, 1),
    limitPrice: round(preview.limitPrice),
    accepted: preview.accepted,
    title: titleForDecision(preview),
    summary: preview.accepted
      ? `${preview.side.toUpperCase()} ${round(preview.volumeMwh, 1)} MWh moved expected imbalance from ${round(
          preview.beforeImbalanceMwh,
          1
        )} to ${round(preview.afterImbalanceMwh, 1)} MWh.`
      : preview.reason,
    reason: preview.reason,
    pnlImpact: preview.pnlImpact,
    imbalanceReductionMwh: preview.imbalanceReductionMwh,
    beforeImbalanceMwh: preview.beforeImbalanceMwh,
    afterImbalanceMwh: preview.afterImbalanceMwh,
    priceQuality: priceQualityFor(preview),
    exposureChange,
    tone: toneForDecision(preview),
    createdAtLabel: submittedAtLabel,
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

interface AggregatedPeriodTrades {
  periodIndex: number;
  volumeMwh: number;
  averagePrice: number;
  side?: TradeSide;
  submittedAtPeriod?: number;
}

function aggregateRdbTradesByPeriod(trades: MarketTrade[]) {
  return trades
    .filter((trade) => trade.market === "RDB" && trade.accepted)
    .reduce<Map<number, AggregatedPeriodTrades>>((map, trade) => {
      const existing = map.get(trade.periodIndex);
      const existingVolume = existing?.volumeMwh ?? 0;
      const volumeMwh = existingVolume + trade.volumeMwh;
      const weightedPrice =
        ((existing?.averagePrice ?? 0) * existingVolume +
          trade.pricePlnMwh * trade.volumeMwh) /
        volumeMwh;

      map.set(trade.periodIndex, {
        periodIndex: trade.periodIndex,
        volumeMwh,
        averagePrice: round(weightedPrice),
        side: existing?.side && existing.side !== trade.side ? undefined : trade.side,
        submittedAtPeriod:
          existing?.submittedAtPeriod === undefined
            ? trade.submittedAtPeriod
            : Math.min(existing.submittedAtPeriod, trade.submittedAtPeriod),
      });

      return map;
    }, new Map());
}

function insightCategory(
  manual?: AggregatedPeriodTrades,
  script?: AggregatedPeriodTrades
): StrategyDuelInsight["category"] {
  if (!manual || !script) {
    return "missed-trade";
  }

  if (manual.side && script.side && manual.side !== script.side) {
    return "wrong-side";
  }

  if (
    manual.submittedAtPeriod !== undefined &&
    script.submittedAtPeriod !== undefined &&
    manual.submittedAtPeriod > script.submittedAtPeriod + 1
  ) {
    return "too-late";
  }

  if (manual.volumeMwh > script.volumeMwh * 1.35) {
    return "too-much-volume";
  }

  return "missed-trade";
}

function insightCopy(
  category: StrategyDuelInsight["category"],
  manual?: AggregatedPeriodTrades,
  script?: AggregatedPeriodTrades
) {
  if (category === "wrong-side") {
    return {
      title: "Wrong side",
      description: `Manual ${manual?.side ?? "mixed"} vs script ${script?.side ?? "mixed"} in the same delivery period.`,
    };
  }

  if (category === "too-late") {
    return {
      title: "Too late",
      description: "The script closed the exposure earlier before gate-closure pressure increased.",
    };
  }

  if (category === "too-much-volume") {
    return {
      title: "Too much volume",
      description: "Manual volume overshot the script hedge and left more PnL leakage.",
    };
  }

  return {
    title: "Missed trade",
    description: script
      ? `Script traded ${round(script.volumeMwh, 1)} MWh while manual left the period unmanaged.`
      : "Manual book leaked PnL in a period the script handled better.",
  };
}

export function buildStrategyDuelInsights(
  scenario: Scenario,
  contracts: Contract[],
  manualTrades: MarketTrade[],
  scriptTrades: MarketTrade[],
  currentPeriod: number,
  limit = 8
): StrategyDuelInsight[] {
  const setupTrades = manualTrades.filter(
    (trade) => trade.actor === "scenario" && trade.market === "RDN"
  );
  const manualByPeriod = aggregateRdbTradesByPeriod(
    manualTrades.filter((trade) => trade.actor === "manual")
  );
  const scriptByPeriod = aggregateRdbTradesByPeriod(scriptTrades);
  const candidatePeriods = new Set<number>([
    ...Array.from(manualByPeriod.keys()),
    ...Array.from(scriptByPeriod.keys()),
  ]);

  return Array.from(candidatePeriods)
    .map((periodIndex) => {
      const manualPeriodTrades = manualTrades.filter(
        (trade) =>
          trade.periodIndex === periodIndex && trade.market === "RDB" && trade.actor === "manual"
      );
      const scriptPeriodTrades = scriptTrades.filter(
        (trade) => trade.periodIndex === periodIndex && trade.market === "RDB"
      );
      const manualSettlement = buildExpectedSettlement(
        scenario,
        contracts,
        [...setupTrades, ...manualPeriodTrades],
        currentPeriod,
        periodIndex
      );
      const scriptSettlement = buildExpectedSettlement(
        scenario,
        contracts,
        [...setupTrades, ...scriptPeriodTrades],
        currentPeriod,
        periodIndex
      );
      const opportunityPln = round(scriptSettlement.periodPnl - manualSettlement.periodPnl);
      const manual = manualByPeriod.get(periodIndex);
      const script = scriptByPeriod.get(periodIndex);
      const category = insightCategory(manual, script);
      const copy = insightCopy(category, manual, script);

      return {
        id: `duel-${periodIndex}`,
        periodIndex,
        label: scenario.periods[periodIndex]?.label ?? `${periodIndex + 1}`,
        category,
        title: copy.title,
        description: copy.description,
        manualPnl: manualSettlement.periodPnl,
        scriptPnl: scriptSettlement.periodPnl,
        opportunityPln,
      };
    })
    .filter((insight) => insight.opportunityPln > 50)
    .sort((left, right) => right.opportunityPln - left.opportunityPln)
    .slice(0, limit);
}

export function buildScenarioDecisionReport(
  decisionLog: DecisionLogEntry[],
  insights: StrategyDuelInsight[],
  manualSettlement: { totalPnl: number; imbalancePnl: number },
  scriptSettlement?: { totalPnl: number; imbalancePnl: number }
): ScenarioDecisionReport {
  const accepted = decisionLog.filter((entry) => entry.accepted);
  const rejected = decisionLog.filter((entry) => !entry.accepted);
  const sortedByImpact = [...accepted].sort((left, right) => left.pnlImpact - right.pnlImpact);

  return {
    acceptedDecisionCount: accepted.length,
    rejectedDecisionCount: rejected.length,
    totalDecisionPnlImpact: round(
      accepted.reduce((sum, entry) => sum + entry.pnlImpact, 0)
    ),
    totalRiskCutMwh: round(
      accepted.reduce((sum, entry) => sum + Math.max(entry.imbalanceReductionMwh, 0), 0)
    ),
    avoidableImbalanceCost: scriptSettlement
      ? round(Math.max(scriptSettlement.imbalancePnl - manualSettlement.imbalancePnl, 0))
      : 0,
    totalPnlGapToScript: scriptSettlement
      ? round(scriptSettlement.totalPnl - manualSettlement.totalPnl)
      : 0,
    missedOpportunityCount: insights.length,
    bestDecision: sortedByImpact.at(-1),
    worstDecision: sortedByImpact[0],
  };
}
