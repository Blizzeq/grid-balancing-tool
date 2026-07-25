import {
  buildStrategyDuelInsights,
  type DecisionLogEntry,
  type StrategyDuelInsight,
} from "./decisions";
import { buildKnownPeriodView, getScenarioSetupTrades } from "./markets";
import { settlePeriod } from "./settlement";
import type { Contract, CurrencyCode, MarketTrade, PeriodSettlement, Scenario } from "./types";

export type ReplayTimelineKind =
  | "manual-decision"
  | "bot-edge"
  | "imbalance-leak"
  | "good-hedge"
  | "human-edge";

export type ReplayTone = "positive" | "warning" | "negative" | "neutral";

export interface ReplayAnalysisInput {
  scenario: Scenario;
  contracts: Contract[];
  manualTrades: MarketTrade[];
  scriptTrades: MarketTrade[];
  decisionLog: DecisionLogEntry[];
  currentPeriod: number;
}

export interface ReplayTimelineEvent {
  id: string;
  periodIndex: number;
  label: string;
  kind: ReplayTimelineKind;
  title: string;
  description: string;
  pnlImpact: number;
  riskImpactMwh: number;
  tone: ReplayTone;
}

export interface ReplayPeriodInsight {
  periodIndex: number;
  label: string;
  manualPnl: number;
  scriptPnl?: number;
  baselinePnl: number;
  manualImbalanceMwh: number;
  scriptImbalanceMwh?: number;
  baselineImbalanceMwh: number;
  manualMarketPosition: number;
  scriptMarketPosition?: number;
  baselineMarketPosition: number;
  pnlGapToScript?: number;
  pnlGapToBaseline: number;
  imbalanceCost: number;
  manualTradeCount: number;
  scriptTradeCount: number;
  recommendation: string;
}

export interface ScenarioLesson {
  id: string;
  title: string;
  reason: string;
  periodIndex: number;
  label: string;
  pnlImpact: number;
  tone: ReplayTone;
  recommendation: string;
}

function round(value: number, precision = 2): number {
  return Number(value.toFixed(precision));
}

function clampCurrentPeriod(scenario: Scenario, currentPeriod: number): number {
  return Math.min(Math.max(currentPeriod, 0), scenario.periods.length - 1);
}

function expectedPriceOverride(
  scenario: Scenario,
  currentPeriod: number,
  periodIndex: number
) {
  const knownPeriod = buildKnownPeriodView(scenario, currentPeriod, periodIndex);

  return {
    imbalancePrice: knownPeriod.actualImbalancePrice ?? knownPeriod.expectedImbalancePrice,
  };
}

function replaySettlementForPeriod(
  scenario: Scenario,
  contracts: Contract[],
  trades: MarketTrade[],
  currentPeriod: number,
  periodIndex: number
): PeriodSettlement {
  const period = scenario.periods[periodIndex];
  const basis = period.index <= currentPeriod ? "actual" : "forecast";

  return settlePeriod(
    period,
    contracts,
    trades,
    basis,
    expectedPriceOverride(scenario, currentPeriod, periodIndex)
  );
}

function tradesForPeriod(
  trades: MarketTrade[],
  periodIndex: number,
  actor?: MarketTrade["actor"]
): MarketTrade[] {
  return trades.filter(
    (trade) =>
      trade.accepted &&
      trade.market === "RDB" &&
      trade.periodIndex === periodIndex &&
      (!actor || trade.actor === actor)
  );
}

function recommendationForInsight(insight: {
  pnlGapToScript?: number;
  manualImbalanceMwh: number;
  scriptImbalanceMwh?: number;
  pnlGapToBaseline: number;
}): string {
  if ((insight.pnlGapToScript ?? 0) > 100) {
    const scriptRisk = Math.abs(insight.scriptImbalanceMwh ?? insight.manualImbalanceMwh);
    const manualRisk = Math.abs(insight.manualImbalanceMwh);

    if (scriptRisk < manualRisk) {
      return "Close the exposure earlier when RDB beats expected imbalance settlement.";
    }

    return "Use the script period as a price benchmark before submitting a manual order.";
  }

  if (insight.pnlGapToBaseline > 100) {
    return "The manual hedge added value versus the locked day-ahead baseline.";
  }

  if (Math.abs(insight.manualImbalanceMwh) > 8) {
    return "Reduce absolute imbalance before gate closure or accept a high settlement swing.";
  }

  return "Keep the position inside the operating buffer.";
}

export function buildReplayPeriodInsights({
  scenario,
  contracts,
  manualTrades,
  scriptTrades,
  currentPeriod,
}: ReplayAnalysisInput): ReplayPeriodInsight[] {
  const visibleCurrentPeriod = clampCurrentPeriod(scenario, currentPeriod);
  const setupTrades = getScenarioSetupTrades(manualTrades);
  const scriptTape = [...setupTrades, ...scriptTrades];
  const hasScript = scriptTrades.length > 0;

  return scenario.periods.slice(0, visibleCurrentPeriod + 1).map((period) => {
    const manual = replaySettlementForPeriod(
      scenario,
      contracts,
      manualTrades,
      visibleCurrentPeriod,
      period.index
    );
    const baseline = replaySettlementForPeriod(
      scenario,
      contracts,
      setupTrades,
      visibleCurrentPeriod,
      period.index
    );
    const script = hasScript
      ? replaySettlementForPeriod(
          scenario,
          contracts,
          scriptTape,
          visibleCurrentPeriod,
          period.index
        )
      : undefined;
    const pnlGapToScript = script ? round(script.periodPnl - manual.periodPnl) : undefined;
    const insight = {
      periodIndex: period.index,
      label: period.label,
      manualPnl: manual.periodPnl,
      scriptPnl: script?.periodPnl,
      baselinePnl: baseline.periodPnl,
      manualImbalanceMwh: manual.imbalanceMwh,
      scriptImbalanceMwh: script?.imbalanceMwh,
      baselineImbalanceMwh: baseline.imbalanceMwh,
      manualMarketPosition: manual.marketPosition,
      scriptMarketPosition: script?.marketPosition,
      baselineMarketPosition: baseline.marketPosition,
      pnlGapToScript,
      pnlGapToBaseline: round(manual.periodPnl - baseline.periodPnl),
      imbalanceCost: manual.imbalancePnl,
      manualTradeCount: tradesForPeriod(manualTrades, period.index, "manual").length,
      scriptTradeCount: tradesForPeriod(scriptTrades, period.index).length,
      recommendation: "",
    };

    return {
      ...insight,
      recommendation: recommendationForInsight(insight),
    };
  });
}

function eventToneFromDecision(entry: DecisionLogEntry): ReplayTone {
  if (entry.tone === "positive") {
    return "positive";
  }

  if (entry.tone === "warning") {
    return "warning";
  }

  if (entry.tone === "negative") {
    return "negative";
  }

  return "neutral";
}

function decisionEvents(
  decisionLog: DecisionLogEntry[],
  currentPeriod: number
): ReplayTimelineEvent[] {
  return decisionLog
    .filter((entry) => entry.periodIndex <= currentPeriod)
    .map((entry) => ({
      id: `decision-${entry.id}`,
      periodIndex: entry.periodIndex,
      label: entry.label,
      kind:
        entry.accepted && entry.pnlImpact > 0 && entry.imbalanceReductionMwh > 0
          ? "good-hedge"
          : "manual-decision",
      title: entry.title,
      description: entry.summary,
      pnlImpact: entry.pnlImpact,
      riskImpactMwh: entry.imbalanceReductionMwh,
      tone: eventToneFromDecision(entry),
    }));
}

function botEdgeTitle(category: StrategyDuelInsight["category"]): string {
  if (category === "wrong-side") {
    return "Wrong side";
  }

  if (category === "too-late") {
    return "Too late";
  }

  if (category === "too-much-volume") {
    return "Oversize hedge";
  }

  return "Missed trade";
}

function botEdgeEvents(
  insights: ReplayPeriodInsight[],
  duelInsights: StrategyDuelInsight[]
): ReplayTimelineEvent[] {
  const duelByPeriod = new Map(
    duelInsights.map((insight) => [insight.periodIndex, insight])
  );

  return insights
    .filter((insight) => (insight.pnlGapToScript ?? 0) > 100)
    .sort((left, right) => (right.pnlGapToScript ?? 0) - (left.pnlGapToScript ?? 0))
    .slice(0, 5)
    .map((insight) => {
      const duelInsight = duelByPeriod.get(insight.periodIndex);

      return {
        id: `bot-edge-${insight.periodIndex}`,
        periodIndex: insight.periodIndex,
        label: insight.label,
        kind: "bot-edge",
        title: duelInsight ? botEdgeTitle(duelInsight.category) : "Script edge",
        description: duelInsight?.description ?? insight.recommendation,
        pnlImpact: insight.pnlGapToScript ?? 0,
        riskImpactMwh: round(
          Math.abs(insight.manualImbalanceMwh) -
            Math.abs(insight.scriptImbalanceMwh ?? insight.manualImbalanceMwh)
        ),
        tone: "warning",
      };
    });
}

/**
 * Periods where the player beat the script.
 *
 * The timeline only ever surfaced the script's wins, and the headline number
 * summed only those, clamped at zero. That is a max-over-noise statistic — it
 * stays positive even against a coin-flip opponent — so the panel could not be
 * won and the player never saw the calls they got right.
 */
function humanEdgeEvents(insights: ReplayPeriodInsight[]): ReplayTimelineEvent[] {
  return insights
    .filter((insight) => (insight.pnlGapToScript ?? 0) < -100)
    .sort((left, right) => (left.pnlGapToScript ?? 0) - (right.pnlGapToScript ?? 0))
    .slice(0, 5)
    .map((insight) => ({
      id: `human-edge-${insight.periodIndex}`,
      periodIndex: insight.periodIndex,
      label: insight.label,
      kind: "human-edge",
      title: "You beat the script",
      description: insight.recommendation,
      pnlImpact: Math.abs(insight.pnlGapToScript ?? 0),
      riskImpactMwh: 0,
      tone: "positive",
    }));
}

function imbalanceLeakEvents(
  insights: ReplayPeriodInsight[],
  currency: CurrencyCode
): ReplayTimelineEvent[] {
  return insights
    .filter((insight) => insight.imbalanceCost < -100 || Math.abs(insight.manualImbalanceMwh) > 8)
    .sort(
      (left, right) =>
        Math.abs(right.manualImbalanceMwh) * Math.max(-right.imbalanceCost, 0) -
        Math.abs(left.manualImbalanceMwh) * Math.max(-left.imbalanceCost, 0)
    )
    .slice(0, 5)
    .map((insight) => ({
      id: `imbalance-leak-${insight.periodIndex}`,
      periodIndex: insight.periodIndex,
      label: insight.label,
      kind: "imbalance-leak",
      title: "Open imbalance cost",
      description: `${round(insight.manualImbalanceMwh, 1)} MWh open position settled for ${round(
        insight.imbalanceCost,
        0
      )} ${currency}.`,
      pnlImpact: insight.imbalanceCost,
      riskImpactMwh: -Math.abs(insight.manualImbalanceMwh),
      tone: insight.imbalanceCost < 0 ? "negative" : "warning",
    }));
}

export function buildReplayTimeline(input: ReplayAnalysisInput): ReplayTimelineEvent[] {
  const visibleCurrentPeriod = clampCurrentPeriod(input.scenario, input.currentPeriod);
  const insights = buildReplayPeriodInsights({
    ...input,
    currentPeriod: visibleCurrentPeriod,
  });
  const duelInsights = buildStrategyDuelInsights(
    input.scenario,
    input.contracts,
    input.manualTrades,
    input.scriptTrades,
    visibleCurrentPeriod
  );

  return [
    ...decisionEvents(input.decisionLog, visibleCurrentPeriod),
    ...botEdgeEvents(insights, duelInsights),
    ...humanEdgeEvents(insights),
    ...imbalanceLeakEvents(insights, input.scenario.metadata.currency),
  ]
    .sort((left, right) => {
      if (left.periodIndex !== right.periodIndex) {
        return left.periodIndex - right.periodIndex;
      }

      return left.kind.localeCompare(right.kind);
    })
    .map((event, index) => ({
      ...event,
      id: `${event.id}-${index}`,
    }));
}

function lessonFromEvent(event: ReplayTimelineEvent): ScenarioLesson {
  if (event.kind === "good-hedge") {
    return {
      id: `lesson-${event.id}`,
      title: "Best hedge",
      reason: event.description,
      periodIndex: event.periodIndex,
      label: event.label,
      pnlImpact: event.pnlImpact,
      tone: "positive",
      recommendation: "Repeat this pattern: trade before gate closure when risk and price align.",
    };
  }

  if (event.kind === "bot-edge") {
    return {
      id: `lesson-${event.id}`,
      title: "Largest missed edge",
      reason: event.description,
      periodIndex: event.periodIndex,
      label: event.label,
      pnlImpact: event.pnlImpact,
      tone: "warning",
      recommendation: "Compare RDB execution against expected imbalance before holding risk.",
    };
  }

  if (event.kind === "imbalance-leak") {
    return {
      id: `lesson-${event.id}`,
      title: "Costliest imbalance",
      reason: event.description,
      periodIndex: event.periodIndex,
      label: event.label,
      pnlImpact: event.pnlImpact,
      tone: "negative",
      recommendation: "Cut large open MWh positions before the delivery period locks.",
    };
  }

  return {
    id: `lesson-${event.id}`,
    title: event.title,
    reason: event.description,
    periodIndex: event.periodIndex,
    label: event.label,
    pnlImpact: event.pnlImpact,
    tone: event.tone,
    recommendation: "Use the decision log to tune the next order size and side.",
  };
}

function rankLessonsByImpact(events: ReplayTimelineEvent[]): ReplayTimelineEvent[] {
  return [
    ...events
      .filter((event) => event.kind === "imbalance-leak")
      .sort((left, right) => left.pnlImpact - right.pnlImpact)
      .slice(0, 2),
    ...events
      .filter((event) => event.kind === "bot-edge")
      .sort((left, right) => right.pnlImpact - left.pnlImpact)
      .slice(0, 2),
    ...events
      .filter((event) => event.kind === "good-hedge")
      .sort((left, right) => right.pnlImpact - left.pnlImpact)
      .slice(0, 1),
    ...events
      .filter((event) => event.kind === "manual-decision")
      .sort((left, right) => Math.abs(right.pnlImpact) - Math.abs(left.pnlImpact))
      .slice(0, 1),
    ...events,
  ];
}

export function buildScenarioLessons(
  input: ReplayAnalysisInput,
  limit = 5
): ScenarioLesson[] {
  const timeline = buildReplayTimeline(input);
  const selected = rankLessonsByImpact(timeline);
  const lessons = new Map<string, ScenarioLesson>();

  for (const event of selected) {
    if (lessons.size >= limit) {
      break;
    }

    lessons.set(`${event.kind}-${event.periodIndex}`, lessonFromEvent(event));
  }

  return Array.from(lessons.values());
}
