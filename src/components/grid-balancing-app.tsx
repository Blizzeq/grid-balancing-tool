"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangleIcon,
  BellIcon,
  BotIcon,
  ChartCandlestickIcon,
  ChevronDownIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  Clock3Icon,
  CloudSunIcon,
  FileSignatureIcon,
  GaugeIcon,
  HelpCircleIcon,
  InfoIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  SparklesIcon,
  StepForwardIcon,
  XIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CONTRACT_TEMPLATES,
  createContractFromTemplate,
  evaluateContractPrice,
  evaluateContractVolume,
  settleContractsForPeriod,
} from "@/lib/domain/contracts";
import {
  buildDecisionCandidates,
  buildOrderImpactPreview,
  buildScenarioDecisionReport,
  buildStrategyDuelInsights,
  pickBestDecisionCandidate,
  type DecisionLogEntry,
  type DecisionCandidate,
  type ScenarioDecisionReport,
  type StrategyDuelInsight,
} from "@/lib/domain/decisions";
import { formatMwh, formatPln, formatPrice, pnlTone } from "@/lib/domain/format";
import { buildDashboardMetrics, getTradablePeriods } from "@/lib/domain/metrics";
import {
  buildKnownMarketTape,
  buildRdbDepth,
  buildScenarioCalibrationReport,
  getScenarioSetupTrades,
} from "@/lib/domain/markets";
import {
  buildReplayPeriodInsights,
  buildReplayTimeline,
  buildScenarioLessons,
  type ReplayPeriodInsight,
  type ReplayTimelineEvent,
  type ReplayTimelineKind,
} from "@/lib/domain/replay";
import { PORTFOLIOS } from "@/lib/domain/portfolios";
import { createDefaultScenarioConfig, createScenario, SCENARIOS } from "@/lib/domain/scenarios";
import { settlePortfolio } from "@/lib/domain/settlement";
import { runAutopilot } from "@/lib/domain/strategy";
import type { AppView } from "@/lib/store/simulation-store";
import { useSimulationStore } from "@/lib/store/simulation-store";
import type {
  Contract,
  CurrencyCode,
  KnownPeriodView,
  MarketTrade,
  PeriodSnapshot,
  RiskAlert,
  ScenarioCalibrationReport,
  ScenarioConfig,
  ScenarioId,
} from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const NAV_ITEMS: Array<{
  view: AppView;
  label: string;
  icon: LucideIcon;
}> = [
  { view: "dashboard", label: "Dashboard", icon: GaugeIcon },
  { view: "contracts", label: "Contracts", icon: FileSignatureIcon },
  { view: "market", label: "Market", icon: ChartCandlestickIcon },
  { view: "forecast", label: "Forecast", icon: CloudSunIcon },
  { view: "duel", label: "Strategy Duel", icon: BotIcon },
  { view: "replay", label: "Results Replay", icon: ScrollTextIcon },
];

const chartMargins = { left: 2, right: 10, top: 8, bottom: 0 };

const dashboardPanelClass =
  "rounded-md border border-[#24404a] bg-[#0d1a20]/92 shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_10px_24px_rgba(0,0,0,0.18)]";

const dashboardHeaderClass = "px-3 py-2.5";

const dashboardContentClass = "px-3 pb-3";

type ScenarioRangeKey = Exclude<keyof ScenarioConfig, "seed">;
type DashboardSignedContract = ReturnType<typeof buildDashboardMetrics>["signedContracts"][number];

const scenarioConfigKeys: Array<keyof ScenarioConfig> = [
  "seed",
  "pvIntensity",
  "windVolatility",
  "loadStress",
  "liquidityStress",
  "priceVolatility",
  "outageProbability",
];

const scenarioRangeControls: Array<{
  key: ScenarioRangeKey;
  label: string;
  min: number;
  max: number;
  step: number;
  formatValue: (value: number) => string;
}> = [
  {
    key: "pvIntensity",
    label: "PV intensity",
    min: 0.4,
    max: 2.2,
    step: 0.05,
    formatValue: (value) => `${value.toFixed(2)}x`,
  },
  {
    key: "windVolatility",
    label: "Wind volatility",
    min: 0.4,
    max: 2.2,
    step: 0.05,
    formatValue: (value) => `${value.toFixed(2)}x`,
  },
  {
    key: "loadStress",
    label: "Load stress",
    min: 0.6,
    max: 1.8,
    step: 0.05,
    formatValue: (value) => `${value.toFixed(2)}x`,
  },
  {
    key: "liquidityStress",
    label: "Liquidity stress",
    min: 0,
    max: 1,
    step: 0.05,
    formatValue: (value) => `${Math.round(value * 100)}%`,
  },
  {
    key: "priceVolatility",
    label: "Price volatility",
    min: 0.5,
    max: 2.2,
    step: 0.05,
    formatValue: (value) => `${value.toFixed(2)}x`,
  },
  {
    key: "outageProbability",
    label: "Outage probability",
    min: 0,
    max: 1,
    step: 0.05,
    formatValue: (value) => `${Math.round(value * 100)}%`,
  },
];

function configsEqual(left: ScenarioConfig, right: ScenarioConfig): boolean {
  return scenarioConfigKeys.every((key) => left[key] === right[key]);
}

function formatSignedDelta(value: number, unit: string, precision = 0): string {
  const formatted = Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: precision,
    minimumFractionDigits: precision,
  });

  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${formatted}${unit}`;
}

function formatHourTick(value: string | number): string {
  const label = String(value);

  return label.endsWith(":00") ? `${label.slice(0, 2)}h` : label;
}

function formatCompactPnlAxis(value: string | number): string {
  const numericValue = Number(value);
  const absoluteValue = Math.abs(numericValue);

  if (absoluteValue >= 1_000_000) {
    const millions = numericValue / 1_000_000;
    return `${millions.toFixed(absoluteValue >= 10_000_000 ? 0 : 1)}M`;
  }

  if (absoluteValue >= 1_000) {
    return `${Math.round(numericValue / 1_000)}k`;
  }

  return numericValue.toFixed(0);
}

function priceUnitLabel(currency: string): string {
  return `${currency}/MWh`;
}

function getSimulationStatusBadge({
  isClosed,
  isRunning,
}: {
  isClosed: boolean;
  isRunning: boolean;
}) {
  if (isClosed) {
    return {
      label: "CLOSED",
      className:
        "border-[var(--energy-negative)]/55 bg-[var(--energy-negative)]/12 text-[var(--energy-negative)]",
    };
  }

  if (isRunning) {
    return {
      label: "LIVE",
      className: "border-primary/45 bg-primary/15 text-primary",
    };
  }

  return {
    label: "PAUSED",
    className: "border-[#8a6a00] bg-[#392c00] text-[#f6d250]",
  };
}

function colorForPnl(value: number): string {
  const tone = pnlTone(value);

  if (tone === "positive") {
    return "text-[var(--energy-positive)]";
  }

  if (tone === "negative") {
    return "text-[var(--energy-negative)]";
  }

  return "text-muted-foreground";
}

function formatSignedMwh(value: number): string {
  return `${value > 0 ? "+" : ""}${formatMwh(value)}`;
}

function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  tone = "neutral",
}: {
  title: string;
  value: string;
  description: string;
  icon: LucideIcon;
  tone?: "positive" | "negative" | "neutral" | "warning";
}) {
  return (
    <Card className="rounded-lg border-border/70 bg-card/80 shadow-sm shadow-black/20">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon data-icon="inline-start" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <div
          className={cn(
            "metric-tabular text-2xl font-semibold tracking-normal",
            tone === "positive" && "text-[var(--energy-positive)]",
            tone === "negative" && "text-[var(--energy-negative)]",
            tone === "warning" && "text-[var(--energy-warning)]"
          )}
        >
          {value}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function DashboardCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn(dashboardPanelClass, "min-w-0 gap-0 py-0", className)}>
      <CardHeader
        className={cn(
          dashboardHeaderClass,
          "grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_auto]"
        )}
      >
        <CardTitle className="min-w-0 text-sm font-semibold tracking-normal text-foreground">
          {title}
        </CardTitle>
        {action ? <div className="min-w-0 sm:justify-self-end">{action}</div> : null}
      </CardHeader>
      <CardContent className={cn(dashboardContentClass, "min-w-0")}>{children}</CardContent>
    </Card>
  );
}

function SmallInfoPill({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex h-7 items-center gap-2 rounded-md border border-[#2b4550] bg-[#0b171c] px-2.5 text-xs text-foreground"
    >
      {children}
    </span>
  );
}

function StatusDivider() {
  return <div className="hidden h-8 w-px bg-[#2a414b] md:block" />;
}

function TimePulse({
  children,
  className,
  pulseKey,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  pulseKey: number | string;
  testId: string;
}) {
  return (
    <motion.span
      key={pulseKey}
      data-testid={testId}
      className={cn("inline-block", className)}
      initial={{
        color: "var(--primary)",
        scale: 1.04,
        textShadow: "0 0 16px rgba(93, 232, 154, 0.36)",
      }}
      animate={{
        color: "var(--foreground)",
        scale: 1,
        textShadow: "0 0 0 rgba(93, 232, 154, 0)",
      }}
      transition={{ duration: 0.42, ease: "easeOut" }}
    >
      {children}
    </motion.span>
  );
}

function getStatusMessagePresentation({
  isClosed,
  message,
}: {
  isClosed: boolean;
  message: string;
}) {
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("not available") ||
    normalizedMessage.includes("outside") ||
    normalizedMessage.includes("unknown") ||
    normalizedMessage.includes("already in the book")
  ) {
    return {
      label: "Check",
      Icon: AlertTriangleIcon,
      className:
        "border-[var(--energy-warning)]/45 bg-[var(--energy-warning)]/10 text-[var(--energy-warning)]",
    };
  }

  if (isClosed || normalizedMessage.includes("closed")) {
    return {
      label: "Closed",
      Icon: AlertTriangleIcon,
      className:
        "border-[var(--energy-negative)]/45 bg-[var(--energy-negative)]/10 text-[var(--energy-negative)]",
    };
  }

  if (
    normalizedMessage.includes("advanced") ||
    normalizedMessage.includes("matched") ||
    normalizedMessage.includes("signed") ||
    normalizedMessage.includes("reset") ||
    normalizedMessage.includes("switched")
  ) {
    return {
      label: "Updated",
      Icon: SparklesIcon,
      className: "border-primary/40 bg-primary/10 text-primary",
    };
  }

  return {
    label: "Status",
    Icon: InfoIcon,
    className: "border-[#2b4550] bg-[#0a1418] text-muted-foreground",
  };
}

function StatusMessageStrip({
  isClosed,
  message,
}: {
  isClosed: boolean;
  message: string;
}) {
  const status = getStatusMessagePresentation({ isClosed, message });
  const Icon = status.Icon;

  return (
    <motion.div
      key={message}
      aria-live="polite"
      className={cn(
        "mx-2 mt-2 grid min-h-10 grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-md border px-3 py-2 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] xl:hidden",
        status.className
      )}
      data-testid="status-message-strip"
      initial={{ opacity: 0.86, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <Icon className="mt-0.5 size-4" aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em]">
          {status.label}
        </div>
        <div className="max-h-10 overflow-hidden break-words text-foreground">
          {message}
        </div>
      </div>
    </motion.div>
  );
}

function getRiskAlertPresentation(tone: RiskAlert["tone"]) {
  if (tone === "danger") {
    return {
      label: "High",
      Icon: AlertTriangleIcon,
      className:
        "border-[var(--energy-negative)]/45 bg-[var(--energy-negative)]/8 text-[var(--energy-negative)]",
      badgeClassName:
        "border-[var(--energy-negative)]/40 bg-[var(--energy-negative)]/10 text-[var(--energy-negative)]",
    };
  }

  if (tone === "warning") {
    return {
      label: "Watch",
      Icon: AlertTriangleIcon,
      className:
        "border-[var(--energy-warning)]/45 bg-[var(--energy-warning)]/8 text-[var(--energy-warning)]",
      badgeClassName:
        "border-[var(--energy-warning)]/40 bg-[var(--energy-warning)]/10 text-[var(--energy-warning)]",
    };
  }

  return {
    label: "Info",
    Icon: InfoIcon,
    className: "border-[#264753] bg-[#0a1418] text-[var(--energy-cyan)]",
    badgeClassName: "border-[var(--energy-cyan)]/35 bg-[var(--energy-cyan)]/10 text-[var(--energy-cyan)]",
  };
}

function RiskAlertRow({ alert }: { alert: RiskAlert }) {
  const presentation = getRiskAlertPresentation(alert.tone);
  const Icon = presentation.Icon;

  return (
    <div
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-md border px-2 py-1.5 text-[11px] md:grid-cols-[16px_112px_minmax(0,1fr)_52px] md:items-center md:px-1.5 md:py-1",
        presentation.className
      )}
      data-testid="risk-alert-row"
      data-tone={alert.tone}
    >
      <Icon className="mt-0.5 size-4 md:mt-0" aria-hidden="true" />
      <div className="min-w-0 md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold">{alert.title}</span>
          <Badge className={cn("h-5 border px-1.5 text-[10px]", presentation.badgeClassName)}>
            {presentation.label}
          </Badge>
        </div>
        <div className="mt-1 break-words text-muted-foreground">{alert.description}</div>
      </div>
      <span className="hidden font-semibold md:block">{alert.title}</span>
      <span className="hidden truncate text-muted-foreground md:block">{alert.description}</span>
      <div className="metric-tabular text-right text-muted-foreground">
        {alert.timeLabel}
      </div>
    </div>
  );
}

function TopStatusBar() {
  const scenarioId = useSimulationStore((state) => state.scenarioId);
  const setScenario = useSimulationStore((state) => state.setScenario);
  const portfolio = useSimulationStore((state) => state.portfolio);
  const portfolioId = useSimulationStore((state) => state.portfolioId);
  const setPortfolio = useSimulationStore((state) => state.setPortfolio);
  const mode = useSimulationStore((state) => state.mode);
  const setMode = useSimulationStore((state) => state.setMode);
  const currentPeriod = useSimulationStore((state) => state.currentPeriod);
  const isRunning = useSimulationStore((state) => state.isRunning);
  const isClosed = useSimulationStore((state) => state.isClosed);
  const speed = useSimulationStore((state) => state.speed);
  const toggleRun = useSimulationStore((state) => state.toggleRun);
  const step = useSimulationStore((state) => state.step);
  const runToEnd = useSimulationStore((state) => state.runToEnd);
  const resetScenario = useSimulationStore((state) => state.resetScenario);
  const setSpeed = useSimulationStore((state) => state.setSpeed);
  const scenario = useSimulationStore((state) => state.scenario);
  const period = scenario.periods[currentPeriod];
  const nextPeriodEndLabel =
    currentPeriod >= scenario.periods.length - 1
      ? "00:00"
      : scenario.periods[currentPeriod + 1]?.label ?? "00:00";
  const simulationStatus = getSimulationStatusBadge({ isClosed, isRunning });

  return (
    <header className="mx-2 mt-2 rounded-md border border-[#263f49] bg-[#0d1a20]/95 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] md:px-4">
      <div className="grid gap-2 md:hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0">
            <span className="text-[11px] text-muted-foreground">Scenario</span>
            <select
              aria-label="Scenario"
              className="mt-1 h-7 w-full rounded-md border-0 bg-transparent p-0 text-sm font-medium text-foreground outline-none"
              value={scenarioId}
              onChange={(event) => setScenario(event.target.value as ScenarioId)}
            >
              {SCENARIOS.map((scenarioOption) => (
                <option key={scenarioOption.id} value={scenarioOption.id}>
                  {scenarioOption.shortName}
                </option>
              ))}
            </select>
          </div>
          <Badge className="w-fit border border-primary/35 bg-primary/15 px-2 text-[11px] text-primary">
            Intraday
          </Badge>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
          <div className="min-w-0">
            <span className="text-[10px] text-muted-foreground">Portfolio</span>
            <select
              aria-label="Portfolio"
              className="mt-1 h-7 w-full rounded-md border border-[#2b4550] bg-[#0a1418] px-2 text-sm font-medium text-foreground outline-none"
              value={portfolioId}
              onChange={(event) => setPortfolio(event.target.value)}
            >
              {PORTFOLIOS.map((portfolioOption) => (
                <option key={portfolioOption.id} value={portfolioOption.id}>
                  {portfolioOption.shortName}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-md border border-[#2b4550] bg-[#0a1418] px-2 py-1.5 text-right">
            <div className="text-[10px] text-muted-foreground">Currency</div>
            <div className="text-sm font-semibold">{portfolio.baseCurrency}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-[#2b4550] bg-[#0a1418] p-2">
            <span className="text-[10px] text-muted-foreground">Simulated Time</span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <TimePulse
                className="metric-tabular text-sm font-semibold"
                pulseKey={`mobile-time-${currentPeriod}`}
                testId="simulated-time-tick"
              >
                {scenario.metadata.deliveryDate} {period.label}
              </TimePulse>
              <Badge
                className={cn(
                  "border px-1.5 text-[10px]",
                  simulationStatus.className
                )}
              >
                {simulationStatus.label}
              </Badge>
            </div>
          </div>
          <div className="rounded-md border border-[#2b4550] bg-[#0a1418] p-2">
            <span className="text-[10px] text-muted-foreground">Settlement</span>
            <TimePulse
              className="metric-tabular mt-1 text-sm font-semibold"
              pulseKey={`mobile-settlement-${currentPeriod}`}
              testId="settlement-period-tick"
            >
              {period.label} - {nextPeriodEndLabel}
            </TimePulse>
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-2">
          <div className="min-w-0">
            <span className="text-[10px] text-muted-foreground">Mode</span>
            <select
              aria-label="Game mode"
              className="mt-1 h-8 w-full rounded-md border border-[#2b4550] bg-[#0a1418] px-2 text-sm font-medium text-foreground outline-none"
              value={mode}
              onChange={(event) => setMode(event.target.value as typeof mode)}
            >
              <option value="manual">Simulation</option>
              <option value="manual-with-advice">Assisted</option>
              <option value="autopilot">Autopilot</option>
              <option value="replay">Replay</option>
            </select>
          </div>
          <Button
            aria-label={isRunning ? "Pause simulation" : "Play simulation"}
            className="h-8 rounded-md px-3 text-xs"
            disabled={isClosed && !isRunning}
            variant="outline"
            onClick={toggleRun}
          >
            {isRunning ? (
              <PauseIcon data-icon="inline-start" />
            ) : (
              <PlayIcon data-icon="inline-start" />
            )}
            {isRunning ? "Pause" : "Play"}
          </Button>
          <select
            aria-label="Simulation speed"
            className="h-8 rounded-md border border-[#2b4550] bg-[#0a1418] px-2 text-xs text-foreground outline-none"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            {[0.5, 1, 2, 4, 8].map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}x
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
          <Button
            aria-label="Step 15 minutes"
            className="h-8 rounded-md px-2 text-xs"
            disabled={isClosed}
            variant="outline"
            onClick={step}
          >
            <StepForwardIcon data-icon="inline-start" />
            Step
          </Button>
          <Button
            aria-label="Run to end"
            className="h-8 rounded-md px-2 text-xs"
            disabled={isClosed}
            variant="outline"
            onClick={runToEnd}
          >
            End
          </Button>
          <Button
            aria-label="Reset scenario"
            className="h-8 rounded-md px-2 text-xs"
            variant="outline"
            onClick={resetScenario}
          >
            <RotateCcwIcon data-icon="inline-start" />
            Reset
          </Button>
          <div className="flex items-center gap-1">
            <AlertsButton />
            <HelpButton />
          </div>
        </div>
      </div>
      <div className="hidden flex-wrap items-center gap-4 md:flex 2xl:flex-nowrap 2xl:gap-4">
        <div className="flex min-w-[190px] flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Scenario</span>
          <select
            aria-label="Scenario"
            className="h-6 max-w-[210px] rounded-md border-0 bg-transparent p-0 text-sm font-medium text-foreground outline-none"
            value={scenarioId}
            onChange={(event) => setScenario(event.target.value as ScenarioId)}
          >
            {SCENARIOS.map((scenarioOption) => (
              <option key={scenarioOption.id} value={scenarioOption.id}>
                {scenarioOption.id === "sunny-negative"
                  ? "PL Market - Spring 2025"
                  : scenarioOption.name}
              </option>
            ))}
          </select>
        </div>
        <StatusDivider />
        <div className="flex min-w-[250px] items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-full border border-[#4b626b]">
            <Clock3Icon data-icon="inline-start" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Simulated Time</span>
            <div className="flex items-center gap-2">
              <span className="metric-tabular whitespace-nowrap text-sm font-semibold">
                2025-05-13
              </span>
              <TimePulse
                className="metric-tabular text-sm font-semibold"
                pulseKey={`desktop-time-${currentPeriod}`}
                testId="simulated-time-tick"
              >
                {period.label}
              </TimePulse>
              <Badge
                className={cn(
                  "h-5 border px-2 text-[11px]",
                  simulationStatus.className
                )}
              >
                {simulationStatus.label}
              </Badge>
            </div>
          </div>
        </div>
        <StatusDivider />
        <div className="flex min-w-[185px] items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-full border border-[#4b626b]">
            <Clock3Icon data-icon="inline-start" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Settlement Period</span>
            <TimePulse
              className="metric-tabular text-sm font-medium"
              pulseKey={`desktop-settlement-${currentPeriod}`}
              testId="settlement-period-tick"
            >
              {period.label} - {nextPeriodEndLabel} (15 min)
            </TimePulse>
          </div>
        </div>
        <StatusDivider />
        <div className="flex min-w-[90px] flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Market Time</span>
          <Badge className="w-fit border border-primary/35 bg-primary/15 px-2 text-[11px] text-primary">
            Intraday
          </Badge>
        </div>
        <StatusDivider />
        <div className="flex min-w-[112px] flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Mode</span>
          <select
            aria-label="Game mode"
            className="h-6 rounded-md border-0 bg-transparent p-0 text-sm font-medium text-foreground outline-none"
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="manual">Simulation</option>
            <option value="manual-with-advice">Assisted</option>
            <option value="autopilot">Autopilot</option>
            <option value="replay">Replay</option>
          </select>
        </div>
        <StatusDivider />
        <div className="flex min-w-[360px] items-center gap-2">
          <Button
            aria-label={isRunning ? "Pause simulation" : "Play simulation"}
            className="h-8 rounded-md px-3 text-xs"
            disabled={isClosed && !isRunning}
            variant="outline"
            onClick={toggleRun}
          >
            {isRunning ? (
              <PauseIcon data-icon="inline-start" />
            ) : (
              <PlayIcon data-icon="inline-start" />
            )}
            {isRunning ? "Pause" : "Play"}
          </Button>
          <Button
            aria-label="Step 15 minutes"
            className="h-8 rounded-md px-3 text-xs"
            disabled={isClosed}
            variant="outline"
            onClick={step}
          >
            <StepForwardIcon data-icon="inline-start" />
            Step
          </Button>
          <Button
            className="h-8 rounded-md px-3 text-xs"
            disabled={isClosed}
            variant="outline"
            onClick={runToEnd}
          >
            Run to end
          </Button>
          <Button
            aria-label="Reset scenario"
            className="h-8 rounded-md px-2"
            variant="outline"
            onClick={resetScenario}
          >
            <RotateCcwIcon data-icon="inline-start" />
          </Button>
          <select
            aria-label="Simulation speed"
            className="h-8 rounded-md border border-[#2b4550] bg-[#0a1418] px-2 text-xs text-foreground outline-none"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            {[0.5, 1, 2, 4, 8].map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}x
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <AlertsButton />
          <HelpButton />
        </div>
      </div>
    </header>
  );
}

/** Live risk alerts, rebuilt from the same metrics the dashboard card uses. */
function useRiskAlerts() {
  const scenario = useSimulationStore((state) => state.scenario);
  const contracts = useSimulationStore((state) => state.contracts);
  const trades = useSimulationStore((state) => state.trades);
  const currentPeriod = useSimulationStore((state) => state.currentPeriod);

  return useMemo(
    () => buildDashboardMetrics(scenario, contracts, trades, currentPeriod).riskAlerts,
    [scenario, contracts, trades, currentPeriod]
  );
}

const HELP_SECTIONS: Array<{ title: string; body: string }> = [
  {
    title: "What this is",
    body: "A deterministic training simulator for a 15-minute Polish power trading day. Every run is reproducible from the scenario seed. It is not connected to any market API, exchange, or company system, and no money moves.",
  },
  {
    title: "The trading day",
    body: "You start with a physical contract book and the D-1 day-ahead (RDN) setup already locked in — you cannot change it. From there the day runs in 15-minute periods and you trade the intraday market (RDB/SIDC) to close the gap between what you contracted and what your portfolio actually does.",
  },
  {
    title: "How you are scored",
    body: "Anything you fail to balance settles as imbalance at the imbalance price, which is deliberately worse than the market price in both directions. Being long into a negative-price hour costs you, and so does being short into a peak. Your result is the settled cash position at the end of the day.",
  },
  {
    title: "Execution is not free",
    body: "Intraday liquidity is finite. Orders walk the depth levels, so a large order fills at a worse average price than the top of book. Spread, fees and slippage all apply, and an order larger than the available depth fills partially.",
  },
  {
    title: "Modes",
    body: "Simulation is manual trading. Assisted adds suggestions but leaves the decisions to you. Autopilot runs a scripted strategy that never sees future actuals, so it is a fair benchmark rather than a perfect one. Replay steps back through a finished day.",
  },
  {
    title: "Controls",
    body: "Step advances one 15-minute period. Play runs the clock at the selected speed. Run to end settles the whole remaining day at once. Reset rebuilds the scenario from its seed — same seed, same day, every time.",
  },
];

function HelpSheet() {
  const isOpen = useSimulationStore((state) => state.isHelpOpen);
  const setHelpOpen = useSimulationStore((state) => state.setHelpOpen);

  return (
    <Sheet open={isOpen} onOpenChange={setHelpOpen}>
      <SheetContent className="w-full sm:max-w-md" side="right">
        <SheetHeader>
          <SheetTitle>How the simulator works</SheetTitle>
          <SheetDescription>
            Balancing a power portfolio across a 15-minute trading day.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-8rem)] px-4">
          <div className="flex flex-col gap-5 pb-8">
            {HELP_SECTIONS.map((section) => (
              <section key={section.title}>
                <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {section.body}
                </p>
              </section>
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function AlertsSheet() {
  const isOpen = useSimulationStore((state) => state.isAlertsOpen);
  const setAlertsOpen = useSimulationStore((state) => state.setAlertsOpen);
  const alerts = useRiskAlerts();

  return (
    <Sheet open={isOpen} onOpenChange={setAlertsOpen}>
      <SheetContent className="w-full sm:max-w-md" side="right">
        <SheetHeader>
          <SheetTitle>Risk &amp; alerts</SheetTitle>
          <SheetDescription>
            {alerts.length === 0
              ? "Nothing flagged for the current period."
              : `${alerts.length} active for the current period.`}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-8rem)] px-4">
          <div className="flex flex-col gap-2 pb-8">
            {alerts.map((alert) => (
              <RiskAlertRow alert={alert} key={alert.id} />
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

/** The bell, with a live count of what is currently flagged. */
function AlertsButton() {
  const setAlertsOpen = useSimulationStore((state) => state.setAlertsOpen);
  const alerts = useRiskAlerts();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Notifications, ${alerts.length} active`}
      className="relative"
      onClick={() => setAlertsOpen(true)}
    >
      <BellIcon data-icon="inline-start" />
      {alerts.length > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
          {alerts.length}
        </span>
      ) : null}
    </Button>
  );
}

function HelpButton() {
  const setHelpOpen = useSimulationStore((state) => state.setHelpOpen);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Help"
      onClick={() => setHelpOpen(true)}
    >
      <HelpCircleIcon data-icon="inline-start" />
    </Button>
  );
}

function TradingShell({ children }: { children: React.ReactNode }) {
  const activeView = useSimulationStore((state) => state.activeView);
  const setView = useSimulationStore((state) => state.setView);
  const portfolio = useSimulationStore((state) => state.portfolio);
  const portfolioId = useSimulationStore((state) => state.portfolioId);
  const setPortfolio = useSimulationStore((state) => state.setPortfolio);
  const scenario = useSimulationStore((state) => state.scenario);
  const currentPeriod = useSimulationStore((state) => state.currentPeriod);
  const speed = useSimulationStore((state) => state.speed);
  const statusMessage = useSimulationStore((state) => state.statusMessage);
  const isClosed = useSimulationStore((state) => state.isClosed);
  const isSidebarCollapsed = useSimulationStore((state) => state.isSidebarCollapsed);
  const toggleSidebar = useSimulationStore((state) => state.toggleSidebar);

  return (
    <div className="min-h-screen bg-[#071115] text-foreground xl:h-screen xl:overflow-hidden">
      <div className="flex min-h-screen flex-col lg:flex-row xl:h-screen">
        <aside
          className={cn(
            "flex border-b border-[#243b44] bg-[#081116]/98 transition-[width] duration-200 lg:min-h-screen lg:flex-col lg:border-r lg:border-b-0",
            // Collapsing only applies from lg up; below that the sidebar is a
            // horizontal bar and there is no width to reclaim.
            isSidebarCollapsed ? "lg:w-[68px]" : "lg:w-[204px]"
          )}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-4 lg:flex-col lg:items-start lg:gap-5 lg:px-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center text-primary">
                <ZapIcon data-icon="inline-start" />
              </div>
              <div className={cn("flex flex-col", isSidebarCollapsed && "lg:hidden")}>
                <span className="text-base font-semibold leading-5">GridBalance</span>
                <span className="text-xs text-muted-foreground">Balancing Simulator</span>
              </div>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-2 pb-3 lg:flex-col lg:overflow-visible">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const selected = item.view === activeView;
              // The replay entry renders shorter than its configured label, and
              // an aria-label overrides visible text as the accessible name —
              // so both have to come from the same string, or the button stops
              // being findable by what it actually says.
              const navLabel = item.view === "replay" ? "Replay" : item.label;

              return (
                <Button
                  key={item.view}
                  variant="ghost"
                  aria-label={navLabel}
                  title={isSidebarCollapsed ? navLabel : undefined}
                  className={cn(
                    "h-10 justify-start rounded-md border border-transparent px-3 text-sidebar-foreground",
                    selected &&
                      "border-[#273f48] bg-[#15232a] shadow-[inset_3px_0_0_var(--primary)]",
                    isSidebarCollapsed && "lg:justify-center lg:px-0"
                  )}
                  onClick={() => setView(item.view)}
                >
                  <Icon data-icon="inline-start" />
                  <span className={cn(isSidebarCollapsed && "lg:hidden")}>{navLabel}</span>
                </Button>
              );
            })}
          </nav>
          <div className="mt-auto hidden flex-col gap-2 p-3 lg:flex">
            <div
              className={cn(
                "flex flex-col gap-2",
                isSidebarCollapsed && "lg:hidden"
              )}
            >
            <div className="rounded-md border border-[#263f49] bg-[#0d1a20] p-3">
              <label className="text-xs text-muted-foreground" htmlFor="sidebar-portfolio">
                Portfolio
              </label>
              <select
                aria-label="Portfolio book"
                className="mt-1 h-7 w-full rounded-md border-0 bg-transparent p-0 text-sm font-medium text-foreground outline-none"
                id="sidebar-portfolio"
                value={portfolioId}
                onChange={(event) => setPortfolio(event.target.value)}
              >
                {PORTFOLIOS.map((portfolioOption) => (
                  <option key={portfolioOption.id} value={portfolioOption.id}>
                    {portfolioOption.name}
                  </option>
                ))}
              </select>
              <div className="mt-1 max-h-8 overflow-hidden text-[11px] text-muted-foreground">
                {portfolio.description}
              </div>
            </div>
            <div className="rounded-md border border-[#263f49] bg-[#0d1a20] p-3">
              <div className="text-xs text-muted-foreground">Settlement currency</div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{portfolio.baseCurrency}</span>
                <Badge className="h-5 border border-primary/30 bg-primary/10 px-2 text-[10px] text-primary">
                  {portfolio.marketArea}
                </Badge>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {portfolio.balancingParty}
              </div>
            </div>
            </div>
            <Button
              variant="outline"
              aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!isSidebarCollapsed}
              className={cn(
                "h-12 rounded-md",
                isSidebarCollapsed ? "justify-center px-0" : "justify-between"
              )}
              onClick={toggleSidebar}
            >
              <span className={cn(isSidebarCollapsed && "hidden")}>Collapse</span>
              {isSidebarCollapsed ? (
                <ChevronsRightIcon data-icon="inline-start" />
              ) : (
                <ChevronsLeftIcon data-icon="inline-end" />
              )}
            </Button>
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col xl:h-screen">
          <TopStatusBar />
          <StatusMessageStrip isClosed={isClosed} message={statusMessage} />
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
          <footer className="hidden h-12 items-center justify-between border-t border-[#263f49] bg-[#0d1a20] px-5 text-xs text-muted-foreground xl:flex">
            <div className="flex items-center gap-8">
              <span className="flex items-center gap-2">
                <InfoIcon data-icon="inline-start" />
                Data Source: {scenario.metadata.source}
              </span>
              <span className="metric-tabular flex items-center gap-2">
                Last Updated: {scenario.metadata.deliveryDate}{" "}
                {scenario.periods[currentPeriod]?.label ?? "00:00"}
                <span className="size-1.5 rounded-full bg-primary" />
              </span>
              <span className="max-w-[260px] truncate">Portfolio: {portfolio.name}</span>
              <span className="max-w-[520px] truncate">Status: {statusMessage}</span>
            </div>
            <div className="flex items-center gap-8">
              <span>
                Market:{" "}
                <span className={isClosed ? "text-muted-foreground" : "text-primary"}>
                  {isClosed ? "Closed" : "Connected"}
                </span>
                <span
                  className={cn(
                    "ml-2 inline-flex size-1.5 rounded-full",
                    isClosed ? "bg-muted-foreground" : "bg-primary"
                  )}
                />
              </span>
              <span className="flex items-center gap-2">
                Simulation Speed: <span className="font-medium text-foreground">{speed}x</span>
                <ChevronDownIcon data-icon="inline-end" />
              </span>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

function OrderTicket() {
  const scenario = useSimulationStore((state) => state.scenario);
  const contracts = useSimulationStore((state) => state.contracts);
  const trades = useSimulationStore((state) => state.trades);
  const currentPeriod = useSimulationStore((state) => state.currentPeriod);
  const selectedPeriod = useSimulationStore((state) => state.selectedPeriod);
  const setSelectedPeriod = useSimulationStore((state) => state.setSelectedPeriod);
  const orderDraft = useSimulationStore((state) => state.orderDraft);
  const updateOrderDraft = useSimulationStore((state) => state.updateOrderDraft);
  const placeOrder = useSimulationStore((state) => state.placeOrder);
  const isClosed = useSimulationStore((state) => state.isClosed);
  const period = scenario.periods[selectedPeriod] ?? scenario.periods[currentPeriod];
  const nextTradablePeriods = getTradablePeriods(scenario, currentPeriod).slice(0, 16);
  const canTrade = !isClosed && nextTradablePeriods.length > 0;
  const orderImpact = useMemo(
    () => buildOrderImpactPreview(scenario, contracts, trades, currentPeriod, orderDraft),
    [scenario, contracts, trades, currentPeriod, orderDraft]
  );
  const rdbDepth = useMemo(() => buildRdbDepth(period), [period]);

  return (
    <DashboardCard
      title="Intraday Order Ticket"
      action={
        <Badge className="h-5 border border-primary/30 bg-primary/10 px-2 text-[11px] text-primary">
          RDB/SIDC
        </Badge>
      }
      className="xl:h-[560px]"
    >
      <div className="flex flex-col gap-2">
        <div className="grid h-8 grid-cols-2 overflow-hidden rounded-md border border-[#2b4550] bg-[#0a1418]">
          <Button
            variant="ghost"
            className={cn(
              "h-full rounded-none text-xs font-semibold uppercase",
              orderDraft.side === "buy" && "bg-primary text-primary-foreground hover:bg-primary"
            )}
            onClick={() =>
              updateOrderDraft({
                side: "buy",
                limitPrice: period.intradayAsk + 8,
              })
            }
          >
            BUY
          </Button>
          <Button
            variant="ghost"
            className={cn(
              "h-full rounded-none text-xs font-semibold uppercase",
              orderDraft.side === "sell" && "bg-primary text-primary-foreground hover:bg-primary"
            )}
            onClick={() =>
              updateOrderDraft({
                side: "sell",
                limitPrice: period.intradayBid - 8,
              })
            }
          >
            SELL
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Product
            <div className="flex h-7 items-center rounded-md border border-[#2b4550] bg-[#0a1418] px-2 text-xs text-foreground">
              RDB continuous
            </div>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Delivery
            <select
              aria-label="Delivery period"
              className="h-7 rounded-md border border-[#2b4550] bg-[#0a1418] px-2 text-xs text-foreground outline-none"
              disabled={!canTrade}
              value={selectedPeriod}
              onChange={(event) => setSelectedPeriod(Number(event.target.value))}
            >
              {nextTradablePeriods.map((candidate) => {
                const displayStart =
                  scenario.periods[Math.max(candidate.index - 1, 0)] ?? candidate;
                const displayEnd = scenario.periods[candidate.index] ?? candidate;

                return (
                  <option key={candidate.index} value={candidate.index}>
                    {displayStart.label} - {displayEnd.label}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          Volume (MWh)
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,44px)] gap-2">
            <Input
              className="h-7 rounded-md text-xs"
              type="number"
              min={0.1}
              max={80}
              step={0.5}
              value={orderDraft.volumeMwh}
              onChange={(event) =>
                updateOrderDraft({ volumeMwh: Number(event.target.value) })
              }
            />
            {[10, 25, 50, 80].map((volume) => (
              <Button
                key={volume}
                variant={orderDraft.volumeMwh === volume ? "default" : "outline"}
                className={cn(
                  "h-7 rounded-md text-xs",
                  orderDraft.volumeMwh === volume &&
                    "bg-primary text-primary-foreground hover:bg-primary"
                )}
                onClick={() => updateOrderDraft({ volumeMwh: volume })}
              >
                {volume}
              </Button>
            ))}
          </div>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          Price ({priceUnitLabel(scenario.metadata.currency)})
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,44px)] gap-2">
            <Input
              className="h-7 rounded-md text-xs"
              type="number"
              step={1}
              value={orderDraft.limitPrice}
              onChange={(event) =>
                updateOrderDraft({ limitPrice: Number(event.target.value) })
              }
            />
            {[-1, -0.1, 0.1, 1].map((delta) => (
              <Button
                key={delta}
                variant="outline"
                className="h-7 rounded-md text-xs"
                onClick={() =>
                  updateOrderDraft({
                    limitPrice: Number((orderDraft.limitPrice + delta).toFixed(1)),
                  })
                }
              >
                {delta > 0 ? `+${delta}` : delta}
              </Button>
            ))}
          </div>
        </label>
        <div className="rounded-md border border-[#2b4550] bg-[#0a1418] p-2">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px]">
            <span className="font-medium text-foreground">RDB depth</span>
            <span className="metric-tabular text-muted-foreground">
              Mid {formatPrice((period.intradayBid + period.intradayAsk) / 2)}
            </span>
          </div>
          <div className="grid grid-cols-[32px_1fr_1fr_1fr] gap-1 text-[10px]">
            <span className="text-muted-foreground">Lvl</span>
            <span className="text-right text-muted-foreground">Bid</span>
            <span className="text-right text-muted-foreground">Vol</span>
            <span className="text-right text-muted-foreground">Ask</span>
            {rdbDepth.map((level) => (
              <div key={level.level} className="contents">
                <span className="metric-tabular text-muted-foreground">L{level.level}</span>
                <span className="metric-tabular text-right text-primary">
                  {level.bidPrice.toFixed(2)}
                </span>
                <span className="metric-tabular text-right text-foreground">
                  {level.volumeMwh.toFixed(1)}
                </span>
                <span className="metric-tabular text-right text-[var(--energy-negative)]">
                  {level.askPrice.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <Button
          className="h-8 rounded-md bg-primary text-xs text-primary-foreground hover:bg-primary/90"
          disabled={!canTrade}
          onClick={placeOrder}
        >
          Place {orderDraft.side === "buy" ? "Buy" : "Sell"} Order
        </Button>
        <div className="grid grid-cols-2 gap-3 pt-1 text-xs sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground">Expected Fill</div>
            <div className="metric-tabular text-sm">
              {orderImpact.accepted ? formatMwh(orderImpact.volumeMwh) : formatMwh(0)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">VWAP Price</div>
            <div className="metric-tabular text-sm">
              {orderImpact.accepted && orderImpact.executionPrice
                ? formatPrice(orderImpact.executionPrice)
                : "n/a"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Spread Cost</div>
            <div className="metric-tabular text-sm text-[var(--energy-negative)]">
              {formatPln(-orderImpact.spreadCostPln)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Fees</div>
            <div className="metric-tabular text-sm text-[var(--energy-negative)]">
              {formatPln(-orderImpact.transactionFeePln)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Available Capacity</div>
            <div className="metric-tabular text-sm">{formatMwh(period.liquidityMwh)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Slippage</div>
            <div className="metric-tabular text-sm text-muted-foreground">
              {formatPrice(orderImpact.vwapSlippagePlnMwh)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Impact</div>
            <div className={cn("metric-tabular text-sm", colorForPnl(orderImpact.pnlImpact))}>
              {formatPln(orderImpact.pnlImpact)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Risk Cut</div>
            <div
              className={cn(
                "metric-tabular text-sm",
                orderImpact.imbalanceReductionMwh > 0
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
            >
              {formatMwh(Math.max(orderImpact.imbalanceReductionMwh, 0))}
            </div>
          </div>
        </div>
        <div className="text-[10px] leading-4 text-muted-foreground">
          {orderImpact.accepted
            ? `${orderImpact.reason} After order: ${formatSignedMwh(
                orderImpact.afterImbalanceMwh
              )} expected imbalance`
            : orderImpact.reason}
        </div>
      </div>
    </DashboardCard>
  );
}

function ContractDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const signContract = useSimulationStore((state) => state.signContract);
  const contracts = useSimulationStore((state) => state.contracts);
  const scenario = useSimulationStore((state) => state.scenario);
  const trades = useSimulationStore((state) => state.trades);
  const currentPeriod = useSimulationStore((state) => state.currentPeriod);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange, open]);

  const contractPreviews = useMemo(() => {
    const baseMetrics = buildDashboardMetrics(scenario, contracts, trades, currentPeriod);

    return new Map(
      CONTRACT_TEMPLATES.map((template) => {
        const alreadySigned = contracts.some(
          (contract) => contract.templateId === template.templateId
        );
        const previewContract = createContractFromTemplate(template.templateId, "preview");
        const previewContracts = alreadySigned ? contracts : [...contracts, previewContract];
        const previewMetrics = buildDashboardMetrics(
          scenario,
          previewContracts,
          trades,
          currentPeriod
        );
        const activePeriods = scenario.periods.filter(
          (period) =>
            period.index >= previewContract.deliveryStart &&
            period.index <= previewContract.deliveryEnd
        );
        const dayVolumeMwh = activePeriods.reduce(
          (sum, period) => sum + evaluateContractVolume(previewContract, period, "forecast"),
          0
        );
        const weightedPrice = activePeriods.reduce((sum, period) => {
          const volume = evaluateContractVolume(previewContract, period, "forecast");

          return sum + volume * evaluateContractPrice(previewContract, period);
        }, 0);
        const averagePrice = dayVolumeMwh > 0 ? weightedPrice / dayVolumeMwh : 0;
        const startLabel = scenario.periods[previewContract.deliveryStart]?.label ?? "00:00";
        const endLabel =
          previewContract.deliveryEnd >= scenario.periods.length - 1
            ? "00:00"
            : scenario.periods[previewContract.deliveryEnd + 1]?.label ??
              scenario.periods[previewContract.deliveryEnd]?.label ??
              "23:45";
        const periodDeltas = previewMetrics.projectedSettlement.periods.map(
          (period, index) =>
            period.imbalanceMwh -
            (baseMetrics.projectedSettlement.periods[index]?.imbalanceMwh ?? 0)
        );
        const profileBuckets = Array.from({ length: 8 }, (_, bucketIndex) => {
          const start = bucketIndex * 12;
          const bucketDeltas = periodDeltas.slice(start, start + 12);
          const averageDeltaMwh =
            bucketDeltas.reduce((sum, delta) => sum + delta, 0) / bucketDeltas.length;

          return {
            label: `${scenario.periods[start]?.label ?? "00:00"}-${
              scenario.periods[start + 12]?.label ?? "00:00"
            }`,
            deltaMwh: alreadySigned ? 0 : averageDeltaMwh,
          };
        });
        const peakDeltaMwh = alreadySigned
          ? 0
          : periodDeltas.reduce(
              (peak, delta) => (Math.abs(delta) > Math.abs(peak) ? delta : peak),
              0
            );
        const worsenedPeriodCount = alreadySigned
          ? 0
          : previewMetrics.projectedSettlement.periods.filter((period, index) => {
              const basePeriod = baseMetrics.projectedSettlement.periods[index];

              return basePeriod
                ? Math.abs(period.imbalanceMwh) > Math.abs(basePeriod.imbalanceMwh) + 0.1
                : false;
            }).length;

        return [
          template.templateId,
          {
            currentNetMwh: alreadySigned
              ? 0
              : previewMetrics.currentPositionMwh - baseMetrics.currentPositionMwh,
            dayVolumeMwh,
            averagePrice,
            pnlImpact: alreadySigned
              ? 0
              : previewMetrics.projectedSettlement.totalPnl -
                baseMetrics.projectedSettlement.totalPnl,
            deliveryWindow: `${startLabel}-${endLabel}`,
            profileBuckets,
            peakDeltaMwh,
            worsenedPeriodCount,
          },
        ] as const;
      })
    );
  }, [scenario, contracts, trades, currentPeriod]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        aria-label="Close contract drawer"
        className="absolute inset-0 z-0 bg-background/60 backdrop-blur-sm"
        type="button"
        onClick={() => onOpenChange(false)}
      />
      <motion.aside
        aria-labelledby="contract-drawer-title"
        aria-modal="true"
        className="absolute top-0 right-0 z-10 flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-border bg-popover shadow-2xl"
        initial={{ x: 36 }}
        animate={{ x: 0 }}
        exit={{ x: 36 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        role="dialog"
      >
        <div className="sticky top-0 z-20 flex items-start justify-between gap-4 border-b border-border/70 bg-popover/95 p-4 backdrop-blur">
          <div className="flex flex-col gap-1">
            <h2 id="contract-drawer-title" className="text-base font-medium">
              Sign simulated contract
            </h2>
            <p className="text-sm text-muted-foreground">
              Contract templates are educational approximations of physical power positions.
            </p>
          </div>
          <Button
            aria-label="Close contract drawer"
            variant="ghost"
            size="icon-sm"
            type="button"
            onClick={() => onOpenChange(false)}
          >
            <XIcon data-icon="inline-start" />
            <span className="sr-only">Close</span>
          </Button>
        </div>
        <div className="flex flex-col gap-3 px-4 py-4">
          {CONTRACT_TEMPLATES.map((template) => {
            const signed = contracts.some((contract) => contract.templateId === template.templateId);
            const preview = contractPreviews.get(template.templateId);

            return (
              <Card
                key={template.templateId}
                className="rounded-lg"
                data-testid={`contract-template-${template.templateId}`}
              >
                <CardHeader>
                  <CardTitle className="text-base">{template.name}</CardTitle>
                  <CardDescription>
                    {template.side.toUpperCase()} | {template.counterparty} |{" "}
                    {template.granularity}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">{template.rationale}</p>
                  {preview ? (
                    <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-xs">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div>
                          <div className="text-muted-foreground">Current net</div>
                          <div className="metric-tabular text-sm font-medium text-foreground">
                            {formatSignedMwh(preview.currentNetMwh)}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Day volume</div>
                          <div className="metric-tabular text-sm font-medium text-foreground">
                            {formatMwh(preview.dayVolumeMwh)}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Average price</div>
                          <div className="metric-tabular text-sm font-medium text-foreground">
                            {formatPrice(preview.averagePrice)}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">PnL impact</div>
                          <div
                            className={cn(
                              "metric-tabular text-sm font-medium",
                              colorForPnl(preview.pnlImpact)
                            )}
                          >
                            {formatPln(preview.pnlImpact)}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Delivery</div>
                          <div className="metric-tabular text-sm font-medium text-foreground">
                            {preview.deliveryWindow}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Imbalance owner</div>
                          <div className="text-sm font-medium text-foreground">
                            {template.imbalanceResponsibility}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 border-t border-border/70 pt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium text-foreground">Profile impact</div>
                          <div className="metric-tabular text-muted-foreground">
                            Peak {formatSignedMwh(preview.peakDeltaMwh)} | worsens{" "}
                            {preview.worsenedPeriodCount} periods
                          </div>
                        </div>
                        <div className="mt-2 grid h-10 grid-cols-8 items-end gap-1">
                          {preview.profileBuckets.map((bucket) => (
                            <div
                              key={bucket.label}
                              aria-label={`${bucket.label}: ${formatSignedMwh(bucket.deltaMwh)}`}
                              className={cn(
                                "min-h-1 rounded-sm border border-border/60",
                                bucket.deltaMwh > 0.1 && "bg-[var(--energy-positive)]/70",
                                bucket.deltaMwh < -0.1 && "bg-[var(--energy-negative)]/70",
                                Math.abs(bucket.deltaMwh) <= 0.1 && "bg-muted"
                              )}
                              style={{
                                height: `${Math.min(
                                  36,
                                  Math.max(4, Math.abs(bucket.deltaMwh) * 1.3 + 4)
                                )}px`,
                              }}
                              title={`${bucket.label}: ${formatSignedMwh(bucket.deltaMwh)}`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-2 rounded-lg border border-border/70 bg-background/40 p-3 text-xs text-muted-foreground sm:grid-cols-2">
                    <div>
                      <div className="font-medium text-foreground">Nomination</div>
                      <div>{template.nominationDeadline}</div>
                    </div>
                    <div>
                      <div className="font-medium text-foreground">Penalty rule</div>
                      <div>{template.penaltyRule}</div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
                    {template.risk}
                  </div>
                  <Button
                    variant={signed ? "secondary" : "default"}
                    disabled={signed}
                    data-testid={`sign-contract-${template.templateId}`}
                    onClick={() => signContract(template.templateId)}
                  >
                    <FileSignatureIcon data-icon="inline-start" />
                    {signed ? "Already signed" : "Sign contract"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </motion.aside>
    </div>
  );
}

function DashboardView() {
  const scenario = useSimulationStore((state) => state.scenario);
  const contracts = useSimulationStore((state) => state.contracts);
  const trades = useSimulationStore((state) => state.trades);
  const currentPeriod = useSimulationStore((state) => state.currentPeriod);

  const metrics = useMemo(
    () => buildDashboardMetrics(scenario, contracts, trades, currentPeriod),
    [scenario, contracts, trades, currentPeriod]
  );
  const scenarioSetupTrades = useMemo(() => getScenarioSetupTrades(trades), [trades]);
  const botPreview = useMemo(
    () => runAutopilot(scenario, contracts, undefined, scenarioSetupTrades),
    [scenario, contracts, scenarioSetupTrades]
  );
  const botProjectedSettlement = useMemo(
    () =>
      buildDashboardMetrics(
        scenario,
        contracts,
        [...scenarioSetupTrades, ...botPreview.trades],
        currentPeriod
      ).projectedSettlement,
    [scenario, contracts, scenarioSetupTrades, botPreview.trades, currentPeriod]
  );
  const currentPeriodSnapshot = scenario.periods[currentPeriod];
  const forecastData = metrics.loadSeries.map((loadPoint, index) => ({
    label: loadPoint.label,
    forecastLoad: loadPoint.forecast,
    actualLoad: loadPoint.actual,
    forecastGeneration: metrics.generationSeries[index]?.forecast ?? null,
    actualGeneration: metrics.generationSeries[index]?.actual ?? null,
  }));
  const humanPnl = metrics.projectedSettlement.totalPnl;
  const algoPnl = botProjectedSettlement.totalPnl;
  const pnlDelta = algoPnl - humanPnl;
  const comparisonData = metrics.projectedSettlement.periods.reduce<{
    rows: Array<{ label: string; human: number; algorithm: number }>;
    human: number;
    algorithm: number;
  }>(
    (accumulator, period, index) => {
      const human = accumulator.human + period.periodPnl;
      const algorithm =
        accumulator.algorithm + (botProjectedSettlement.periods[index]?.periodPnl ?? 0);

      if (index % 8 === 0 || index === metrics.projectedSettlement.periods.length - 1) {
        accumulator.rows.push({
          label: period.label,
          human,
          algorithm,
        });
      }

      return {
        rows: accumulator.rows,
        human,
        algorithm,
      };
    },
    { rows: [], human: 0, algorithm: 0 }
  ).rows;
  const signedTotals = metrics.signedContracts.reduce(
    (accumulator, contract) => {
      accumulator.volumeMwh += contract.volumeMwh;
      accumulator.mtmPln += contract.mtmPln;
      return accumulator;
    },
    { volumeMwh: 0, mtmPln: 0 }
  );
  const outperformance =
    Math.abs(humanPnl) > 0.01 ? (pnlDelta / Math.abs(humanPnl)) * 100 : 0;

  return (
    <div className="flex min-w-0 flex-col gap-2 overflow-x-hidden p-2 xl:h-full xl:min-h-0">
      <div className="grid min-w-0 gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(360px,438px)] 2xl:h-[604px] 2xl:grid-cols-[484px_minmax(320px,1fr)_438px]">
        <div className="flex min-h-0 min-w-0 flex-col gap-2 xl:col-start-1 xl:row-start-1 2xl:col-auto 2xl:row-auto">
          <DashboardCard
            title="Portfolio Balance (Live)"
            action={
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={cn(
                    "metric-tabular text-xl font-semibold",
                    metrics.currentPositionMwh >= 0
                      ? "text-primary"
                      : "text-[var(--energy-negative)]"
                  )}
                >
                  {formatSignedMwh(metrics.currentPositionMwh)}
                </span>
                <span className="text-xs text-muted-foreground">
                  Imbalance:{" "}
                  <span className="metric-tabular text-foreground">
                    {formatSignedMwh(metrics.currentImbalanceMwh)}
                  </span>
                </span>
                <InfoIcon data-icon="inline-end" />
              </div>
            }
            className="xl:h-[314px]"
          >
            <div className="mb-2 flex flex-wrap gap-5 text-[11px]">
              <span className="flex items-center gap-2">
                <span className="h-0.5 w-4 bg-primary" />
                Realized Balance (MWh)
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="h-px w-4 border-t border-dashed border-muted-foreground" />
                Projected Balance
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="h-px w-4 border-t border-dashed border-muted-foreground" />
                Risk Limits
              </span>
            </div>
            <div className="h-[190px]">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 1, height: 1 }}>
                <LineChart data={metrics.balanceSeries} margin={chartMargins}>
                  <CartesianGrid stroke="#20333b" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    fontSize={11}
                    interval={23}
                    tickFormatter={formatHourTick}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis domain={[-150, 150]} tickLine={false} axisLine={false} width={42} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                    }}
                  />
                  <ReferenceLine y={metrics.maxPositionLimitMwh} stroke="var(--energy-positive)" strokeDasharray="4 4" />
                  <ReferenceLine y={-metrics.maxPositionLimitMwh} stroke="var(--energy-negative)" strokeDasharray="4 4" />
                  <ReferenceLine x={scenario.periods[currentPeriod]?.label} stroke="#e5e7eb" strokeDasharray="5 4" />
                  <ReferenceLine y={0} stroke="#6f8188" />
                  <Line
                    dataKey="portfolio"
                    dot={false}
                    name="Realized Balance"
                    stroke="var(--energy-positive)"
                    strokeWidth={2}
                    type="monotone"
                  />
                  <Line
                    dataKey="projected"
                    dot={false}
                    name="Projected Balance"
                    stroke="var(--energy-cyan)"
                    strokeDasharray="5 4"
                    strokeWidth={1.5}
                    type="monotone"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2 border-t border-[#263f49] pt-2 text-center text-xs">
              <div>
                <div className="text-muted-foreground">Max Position Limit</div>
                <div className="metric-tabular mt-1">+/-{metrics.maxPositionLimitMwh} MWh</div>
              </div>
              <div>
                <div className="text-muted-foreground">Current Position</div>
                <div className={cn("metric-tabular mt-1", metrics.currentPositionMwh >= 0 ? "text-primary" : "text-[var(--energy-negative)]")}>
                  {formatSignedMwh(metrics.currentPositionMwh)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Contracted</div>
                <div className={cn("metric-tabular mt-1", metrics.currentContractedMwh >= 0 ? "text-primary" : "text-[var(--energy-negative)]")}>
                  {formatSignedMwh(metrics.currentContractedMwh)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Market Trades</div>
                <div className={cn("metric-tabular mt-1", metrics.currentMarketMwh >= 0 ? "text-primary" : "text-[var(--energy-warning)]")}>
                  {formatSignedMwh(metrics.currentMarketMwh)}
                </div>
              </div>
            </div>
          </DashboardCard>
          <DashboardCard
            title="PnL Waterfall (MTD)"
            action={<SmallInfoPill>{scenario.metadata.currency}</SmallInfoPill>}
            className="xl:h-[280px]"
          >
            <div className="h-[178px]">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 1, height: 1 }}>
                <BarChart data={metrics.pnlWaterfall} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#20333b" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tickFormatter={(value) => String(value).replace("\n", " ")}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    fontSize={10}
                  />
                  <YAxis
                    tickFormatter={formatCompactPnlAxis}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                  />
                  <Tooltip
                    formatter={(value) => formatPln(Number(value))}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                    }}
                  />
                  <ReferenceLine y={0} stroke="#6f8188" />
                  <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                    {metrics.pnlWaterfall.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={
                          entry.kind === "total"
                            ? "var(--energy-cyan)"
                            : entry.value >= 0
                              ? "var(--energy-positive)"
                              : "var(--energy-negative)"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-4 gap-2 border-t border-[#263f49] pt-2 text-xs">
              <div>
                <div className="text-muted-foreground">Total PnL (MTD)</div>
                <div className={cn("metric-tabular", colorForPnl(metrics.projectedSettlement.totalPnl))}>
                  {formatPln(metrics.projectedSettlement.totalPnl)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">PnL per MWh</div>
                <div className="metric-tabular">
                  {formatPrice(
                    metrics.projectedSettlement.totalPnl /
                      Math.max(metrics.projectedSettlement.totalImbalanceAbsMwh, 1)
                  )}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Imbalance Cost</div>
                <div className={cn("metric-tabular", colorForPnl(metrics.projectedSettlement.imbalancePnl))}>
                  {formatPln(metrics.projectedSettlement.imbalancePnl)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Fees</div>
                <div className="metric-tabular text-[var(--energy-negative)]">
                  {formatPln(-metrics.projectedSettlement.transactionFees)}
                </div>
              </div>
            </div>
          </DashboardCard>
        </div>
        <div className="flex min-h-0 min-w-0 flex-col gap-2 xl:col-span-2 xl:row-start-2 2xl:col-auto 2xl:row-auto 2xl:col-span-1">
          <DashboardCard
            title="Forecast vs Actual (Generation/Load)"
            action={
              <div className="flex items-center gap-2">
                <SmallInfoPill>Today</SmallInfoPill>
                <SmallInfoPill>MWh</SmallInfoPill>
              </div>
            }
            className="xl:h-[314px]"
          >
            <div className="mb-2 flex flex-wrap gap-5 text-[11px]">
              <span className="flex items-center gap-2 text-[var(--energy-cyan)]">
                <span className="h-0.5 w-4 border-t border-dashed border-[var(--energy-cyan)]" />
                Forecast Load
              </span>
              <span className="flex items-center gap-2 text-[var(--energy-cyan)]">
                <span className="h-0.5 w-4 bg-[var(--energy-cyan)]" />
                Actual Load
              </span>
              <span className="flex items-center gap-2 text-[var(--energy-warning)]">
                <span className="h-0.5 w-4 border-t border-dashed border-[var(--energy-warning)]" />
                Forecast Generation
              </span>
              <span className="flex items-center gap-2 text-[var(--energy-warning)]">
                <span className="h-0.5 w-4 bg-[var(--energy-warning)]" />
                Actual Generation
              </span>
            </div>
            <div className="h-[190px]">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 1, height: 1 }}>
                <LineChart data={forecastData} margin={chartMargins}>
                  <CartesianGrid stroke="#20333b" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    fontSize={11}
                    interval={15}
                    tickFormatter={formatHourTick}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tickFormatter={(value) => Number(value).toFixed(0)}
                    tickLine={false}
                    axisLine={false}
                    width={42}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                    }}
                  />
                  <ReferenceLine x={scenario.periods[currentPeriod]?.label} stroke="#e5e7eb" strokeDasharray="5 4" />
                  <Line dataKey="forecastLoad" stroke="var(--energy-cyan)" strokeDasharray="5 5" dot={false} type="monotone" />
                  <Line dataKey="actualLoad" stroke="var(--energy-cyan)" strokeWidth={2} dot={false} type="monotone" />
                  <Line dataKey="forecastGeneration" stroke="var(--energy-warning)" strokeDasharray="5 5" dot={false} type="monotone" />
                  <Line dataKey="actualGeneration" stroke="var(--energy-warning)" strokeWidth={2} dot={false} type="monotone" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 grid grid-cols-5 gap-2 border-t border-[#263f49] pt-2 text-xs">
              {[
                ["Load (Actual)", formatMwh(currentPeriodSnapshot.actualLoad), "text-[var(--energy-cyan)]"],
                ["Load (Forecast)", formatMwh(currentPeriodSnapshot.forecastLoad), "text-[var(--energy-cyan)]"],
                ["Generation (Actual)", formatMwh(currentPeriodSnapshot.actualGeneration), "text-[var(--energy-warning)]"],
                ["Generation (Forecast)", formatMwh(currentPeriodSnapshot.forecastGeneration), "text-[var(--energy-warning)]"],
                ["Net Position", formatSignedMwh(metrics.currentPositionMwh), metrics.currentPositionMwh >= 0 ? "text-primary" : "text-[var(--energy-negative)]"],
              ].map(([label, value, className]) => (
                <div key={label}>
                  <div className="text-muted-foreground">{label}</div>
                  <div className={cn("metric-tabular mt-1", className)}>{value}</div>
                </div>
              ))}
            </div>
          </DashboardCard>
          <DashboardCard
            title="Signed Contracts"
            className="xl:h-[280px]"
          >
            <div className="flex flex-col gap-3 md:hidden">
              {metrics.signedContracts.map((contract) => (
                <DashboardContractExposureCard contract={contract} key={contract.id} />
              ))}
              <div
                className="min-w-0 rounded-md border border-[#263f49] bg-[#0a1418] p-3"
                data-testid="mobile-dashboard-contract-total"
              >
                <div className="text-xs text-muted-foreground">Total exposure</div>
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 text-xs">
                  <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
                    <div className="text-muted-foreground">Volume</div>
                    <div className="metric-tabular mt-1 break-words font-medium">
                      {formatMwh(signedTotals.volumeMwh)}
                    </div>
                  </div>
                  <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
                    <div className="text-muted-foreground">MtM</div>
                    <div
                      className={cn(
                        "metric-tabular mt-1 break-words font-medium",
                        colorForPnl(signedTotals.mtmPln)
                      )}
                    >
                      {formatPln(signedTotals.mtmPln)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="hidden -mx-3 overflow-x-auto px-3 md:block">
              <Table className="min-w-[620px]">
                <TableHeader>
                  <TableRow>
                    {[
                      "Counterparty",
                      "Product",
                      "Delivery Period",
                      "Volume (MWh)",
                      `Price (${priceUnitLabel(scenario.metadata.currency)})`,
                      "Status",
                      `MtM (${scenario.metadata.currency})`,
                    ].map((head) => (
                      <TableHead
                        key={head}
                        className="h-7 px-1.5 text-[11px] text-muted-foreground"
                      >
                        {head}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.signedContracts.map((contract) => (
                    <TableRow key={contract.id}>
                      <TableCell className="h-8 px-1.5 py-1 text-xs">
                        {contract.counterparty}
                      </TableCell>
                      <TableCell className="h-8 px-1.5 py-1 text-xs font-semibold">
                        {contract.product}
                      </TableCell>
                      <TableCell className="h-8 px-1.5 py-1 text-xs">
                        {contract.deliveryPeriod}
                      </TableCell>
                      <TableCell className="metric-tabular h-8 px-1.5 py-1 text-xs">
                        {formatMwh(contract.volumeMwh)}
                      </TableCell>
                      <TableCell className="metric-tabular h-8 px-1.5 py-1 text-xs">
                        {contract.pricePlnMwh.toFixed(2)}
                      </TableCell>
                      <TableCell className="h-8 px-1.5 py-1 text-xs">
                        <Badge className="h-5 border border-primary/30 bg-primary/10 px-2 text-[11px] text-primary">
                          {contract.status}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "metric-tabular h-8 px-1.5 py-1 text-xs",
                          colorForPnl(contract.mtmPln)
                        )}
                      >
                        {formatPln(contract.mtmPln)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="h-8 px-1.5 py-1 text-xs font-medium">Total</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="metric-tabular h-8 px-1.5 py-1 text-xs">
                      {formatMwh(signedTotals.volumeMwh)}
                    </TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell
                      className={cn(
                        "metric-tabular h-8 px-1.5 py-1 text-xs",
                        colorForPnl(signedTotals.mtmPln)
                      )}
                    >
                      {formatPln(signedTotals.mtmPln)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </DashboardCard>
        </div>
        <div className="flex min-h-0 min-w-0 flex-col gap-2 xl:col-start-2 xl:row-start-1 2xl:col-auto 2xl:row-auto">
          <OrderTicket />
          <DashboardCard
            title="Risk & Alerts (Real-time)"
            className="xl:h-[192px]"
          >
            <div className="flex flex-col gap-1.5">
              {metrics.riskAlerts.map((alert) => (
                <RiskAlertRow alert={alert} key={alert.id} />
              ))}
            </div>
          </DashboardCard>
        </div>
      </div>
      <DashboardCard
        title="Human vs Algorithm PnL Comparison (MTD)"
        action={
          <div className="flex items-center gap-3">
            <SmallInfoPill>{scenario.metadata.currency}</SmallInfoPill>
            <div className="grid h-7 grid-cols-4 overflow-hidden rounded-md border border-[#2b4550] bg-[#0a1418] text-xs">
              {["MTD", "WTD", "7D", "30D"].map((range, index) => (
                <button
                  key={range}
                  className={cn("px-4", index === 0 && "bg-muted text-foreground")}
                  type="button"
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
        }
        className="xl:h-[192px]"
      >
        <div className="grid h-full gap-5 xl:grid-cols-[0.95fr_1.35fr]">
          <div className="grid grid-cols-[1fr_1.1fr] gap-4">
            <div className="flex flex-col justify-center border-r border-[#2b4550] pr-4">
              <span className="text-xs text-muted-foreground">Human PnL</span>
              <span className={cn("metric-tabular text-xl font-semibold", colorForPnl(humanPnl))}>
                {formatPln(humanPnl)}
              </span>
              <Separator className="my-4" />
              <span className="text-xs text-muted-foreground">Algorithm PnL</span>
              <span className={cn("metric-tabular text-xl font-semibold", colorForPnl(algoPnl))}>
                {formatPln(algoPnl)}
              </span>
            </div>
            <div className="my-auto grid grid-cols-2 rounded-md border border-[#2b4550] bg-muted/20 text-center">
              <div className="border-r border-[#2b4550] p-4">
                <div className="text-xs text-muted-foreground">Difference</div>
                <div className={cn("metric-tabular mt-2 text-lg font-semibold", colorForPnl(pnlDelta))}>
                  {formatPln(pnlDelta)}
                </div>
              </div>
              <div className="p-4">
                <div className="text-xs text-muted-foreground">Outperformance</div>
                <div className={cn("metric-tabular mt-2 text-lg font-semibold", colorForPnl(pnlDelta))}>
                  {outperformance.toFixed(2)}%
                </div>
              </div>
            </div>
          </div>
          <div className="h-[116px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 1, height: 1 }}>
              <LineChart data={comparisonData} margin={{ left: 0, right: 20, top: 6, bottom: 0 }}>
                <CartesianGrid stroke="#20333b" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  fontSize={11}
                  interval={1}
                  tickFormatter={formatHourTick}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={formatCompactPnlAxis}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip
                  formatter={(value) => formatPln(Number(value))}
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                  }}
                />
                <Line dataKey="human" name="Human PnL" dot={false} stroke="var(--energy-cyan)" strokeWidth={2} type="monotone" />
                <Line dataKey="algorithm" name="Algorithm PnL" dot={false} stroke="var(--energy-positive)" strokeWidth={2} type="monotone" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </DashboardCard>
    </div>
  );
}

function DashboardContractExposureCard({ contract }: { contract: DashboardSignedContract }) {
  return (
    <div
      className="min-w-0 rounded-md border border-[#263f49] bg-[#0a1418] p-3"
      data-testid="mobile-dashboard-contract-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words text-sm font-semibold">{contract.product}</div>
          <div className="mt-1 break-words text-xs text-muted-foreground">
            {contract.counterparty}
          </div>
        </div>
        <Badge className="h-5 shrink-0 border border-primary/30 bg-primary/10 px-2 text-[11px] text-primary">
          {contract.status}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 text-xs">
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Delivery</div>
          <div className="metric-tabular mt-1 break-words font-medium">
            {contract.deliveryPeriod}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Volume</div>
          <div className="metric-tabular mt-1 break-words font-medium">
            {formatMwh(contract.volumeMwh)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Price</div>
          <div className="metric-tabular mt-1 break-words font-medium">
            {contract.pricePlnMwh.toFixed(2)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">MtM</div>
          <div
            className={cn(
              "metric-tabular mt-1 break-words font-medium",
              colorForPnl(contract.mtmPln)
            )}
          >
            {formatPln(contract.mtmPln)}
          </div>
        </div>
      </div>
    </div>
  );
}

function ContractsView() {
  const contracts = useSimulationStore((state) => state.contracts);
  const scenario = useSimulationStore((state) => state.scenario);
  const currentPeriod = useSimulationStore((state) => state.currentPeriod);
  const [contractDrawerOpen, setContractDrawerOpen] = useState(false);
  const period = scenario.periods[currentPeriod];

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Signed contracts</h2>
          <p className="text-sm text-muted-foreground">
            Physical positions feeding the 15-minute balancing book.
          </p>
        </div>
        <Button onClick={() => setContractDrawerOpen(true)}>
          <FileSignatureIcon data-icon="inline-start" />
          Sign contract
        </Button>
      </div>
      <Card className="min-w-0 rounded-lg border-border/70 bg-card/80">
        <CardContent className="min-w-0 overflow-hidden">
          <div className="flex flex-col gap-3 md:hidden">
            {contracts.map((contract) => (
              <MobileContractCard contract={contract} key={contract.id} period={period} />
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Counterparty</TableHead>
                  <TableHead>Now MWh</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Risk owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((contract) => {
                  const current = settleContractsForPeriod(period, [contract], "actual");
                  const volume = contract.side === "buy" ? current.boughtMwh : current.soldMwh;

                  return (
                    <TableRow key={contract.id}>
                      <TableCell className="font-medium">{contract.name}</TableCell>
                      <TableCell>
                        <Badge variant={contract.side === "buy" ? "secondary" : "outline"}>
                          {contract.side.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>{contract.type}</TableCell>
                      <TableCell>{contract.counterparty}</TableCell>
                      <TableCell className="metric-tabular">{formatMwh(volume)}</TableCell>
                      <TableCell className="metric-tabular">
                        {formatContractPriceLabel(contract)}
                      </TableCell>
                      <TableCell>{contract.imbalanceResponsibility}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <ContractDrawer open={contractDrawerOpen} onOpenChange={setContractDrawerOpen} />
    </div>
  );
}

function formatContractPriceLabel(contract: Contract): string {
  if (contract.priceFormula.kind === "fixed") {
    return formatPrice(contract.priceFormula.plnPerMwh);
  }

  return `Spot ${contract.priceFormula.premium >= 0 ? "+" : ""}${contract.priceFormula.premium}`;
}

function MobileContractCard({
  contract,
  period,
}: {
  contract: Contract;
  period: PeriodSnapshot;
}) {
  const current = settleContractsForPeriod(period, [contract], "actual");
  const volume = contract.side === "buy" ? current.boughtMwh : current.soldMwh;

  return (
    <div
      className="min-w-0 rounded-md border border-[#263f49] bg-[#0a1418] p-3"
      data-testid="mobile-contract-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words text-sm font-semibold text-foreground">{contract.name}</div>
          <div className="mt-1 break-words text-xs text-muted-foreground">
            {contract.counterparty}
          </div>
        </div>
        <Badge
          className={cn(
            "h-5 shrink-0 rounded-md px-2 text-[11px]",
            contract.side === "buy"
              ? "border-primary/35 bg-primary/10 text-primary"
              : "border-[var(--energy-warning)]/35 bg-[var(--energy-warning)]/10 text-[var(--energy-warning)]"
          )}
          variant="outline"
        >
          {contract.side.toUpperCase()}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 text-xs">
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Type</div>
          <div className="mt-1 break-words text-[12px] font-medium">{contract.type}</div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Now MWh</div>
          <div className="metric-tabular mt-1 break-words text-[12px] font-medium">
            {formatMwh(volume)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Price</div>
          <div className="metric-tabular mt-1 break-words text-[12px] font-medium">
            {formatContractPriceLabel(contract)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Risk owner</div>
          <div className="mt-1 break-words text-[12px] font-medium">
            {contract.imbalanceResponsibility}
          </div>
        </div>
      </div>
    </div>
  );
}

function recommendationLabel(candidate: DecisionCandidate): string {
  if (candidate.recommendation === "hold") {
    return "HOLD";
  }

  return `${candidate.recommendation.toUpperCase()} ${formatMwh(
    candidate.recommendedVolumeMwh
  )}`;
}

function decisionToneClass(tone: DecisionLogEntry["tone"]): string {
  if (tone === "positive") {
    return "text-[var(--energy-positive)]";
  }

  if (tone === "warning") {
    return "text-[var(--energy-warning)]";
  }

  if (tone === "negative") {
    return "text-[var(--energy-negative)]";
  }

  return "text-muted-foreground";
}

function replayToneClass(tone: ReplayTimelineEvent["tone"]): string {
  if (tone === "positive") {
    return "text-[var(--energy-positive)]";
  }

  if (tone === "warning") {
    return "text-[var(--energy-warning)]";
  }

  if (tone === "negative") {
    return "text-[var(--energy-negative)]";
  }

  return "text-muted-foreground";
}

function replayKindLabel(kind: ReplayTimelineKind | "all"): string {
  if (kind === "manual-decision") {
    return "Decisions";
  }

  if (kind === "bot-edge") {
    return "Bot edge";
  }

  if (kind === "imbalance-leak") {
    return "Imbalance leak";
  }

  if (kind === "good-hedge") {
    return "Good hedge";
  }

  return "All";
}

function replayEventIcon(kind: ReplayTimelineKind): LucideIcon {
  if (kind === "bot-edge") {
    return BotIcon;
  }

  if (kind === "imbalance-leak") {
    return AlertTriangleIcon;
  }

  if (kind === "good-hedge") {
    return ShieldCheckIcon;
  }

  return FileSignatureIcon;
}

function formatMaybePln(value?: number): string {
  return value === undefined ? "n/a" : formatPln(value);
}

function formatMaybeMwh(value?: number): string {
  return value === undefined ? "n/a" : formatMwh(value);
}

function insightCategoryLabel(category: StrategyDuelInsight["category"]): string {
  if (category === "wrong-side") {
    return "Wrong side";
  }

  if (category === "too-late") {
    return "Too late";
  }

  if (category === "too-much-volume") {
    return "Too much volume";
  }

  return "Missed trade";
}

function decisionSummary(entry?: DecisionLogEntry): string {
  if (!entry) {
    return "n/a";
  }

  return `${entry.label} | ${entry.side.toUpperCase()} ${formatMwh(
    entry.volumeMwh
  )} | ${formatPln(entry.pnlImpact)}`;
}

function DecisionLogPanel({ decisionLog }: { decisionLog: DecisionLogEntry[] }) {
  const entries = decisionLog.slice(0, 6);

  return (
    <Card className="rounded-lg border-border/70 bg-card/80">
      <CardHeader>
        <CardTitle>Decision log</CardTitle>
        <CardDescription>Post-trade feedback for manual RDB decisions</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No manual decisions yet.
          </div>
        ) : (
          <div aria-live="polite" className="flex flex-col gap-2">
            {entries.map((entry, index) => {
              const isLatest = index === 0;

              return (
                <motion.div
                  key={entry.id}
                  data-latest={isLatest ? "true" : "false"}
                  data-testid="decision-log-entry"
                  className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs"
                  initial={
                    isLatest
                      ? {
                          borderColor: "var(--primary)",
                          boxShadow: "0 0 0 1px rgba(93, 232, 154, 0.36)",
                          scale: 1.01,
                        }
                      : false
                  }
                  animate={
                    isLatest
                      ? {
                          borderColor: "var(--border)",
                          boxShadow: "0 0 0 0 rgba(93, 232, 154, 0)",
                          scale: 1,
                        }
                      : undefined
                  }
                  transition={{ duration: 0.7, ease: "easeOut" }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className={cn("font-medium", decisionToneClass(entry.tone))}>
                        {entry.title}
                      </div>
                      <div className="mt-1 text-muted-foreground">{entry.summary}</div>
                    </div>
                    <div className="metric-tabular shrink-0 text-muted-foreground">
                      {entry.createdAtLabel}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/70 pt-2">
                    <div>
                      <div className="text-muted-foreground">Impact</div>
                      <div className={cn("metric-tabular font-medium", colorForPnl(entry.pnlImpact))}>
                        {formatPln(entry.pnlImpact)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Risk cut</div>
                      <div
                        className={cn(
                          "metric-tabular font-medium",
                          entry.imbalanceReductionMwh > 0
                            ? "text-[var(--energy-positive)]"
                            : entry.imbalanceReductionMwh < 0
                              ? "text-[var(--energy-negative)]"
                              : "text-muted-foreground"
                        )}
                      >
                        {formatSignedMwh(entry.imbalanceReductionMwh)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Price</div>
                      <div className="font-medium capitalize">{entry.priceQuality}</div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DuelInsightsTable({
  insights,
  hasBotResult,
}: {
  insights: StrategyDuelInsight[];
  hasBotResult: boolean;
}) {
  return (
    <Card className="rounded-lg border-border/70 bg-card/80">
      <CardHeader>
        <CardTitle>Bot edge diagnostics</CardTitle>
        <CardDescription>Periods where the script found better RDB action</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasBotResult ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            Run script to populate diagnostics.
          </div>
        ) : insights.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No material bot edge found for the current manual book.
          </div>
        ) : (
          <>
            <ScrollArea className="h-[304px] md:hidden">
              <div className="flex flex-col gap-3 pr-3">
                {insights.map((insight) => (
                  <MobileDuelInsightCard insight={insight} key={insight.id} />
                ))}
              </div>
            </ScrollArea>
            <div className="hidden overflow-x-auto md:block">
              <ScrollArea className="h-[304px]">
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead>Finding</TableHead>
                      <TableHead>Manual PnL</TableHead>
                      <TableHead>Script PnL</TableHead>
                      <TableHead>Opportunity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {insights.map((insight) => (
                      <TableRow key={insight.id}>
                        <TableCell className="metric-tabular font-medium">
                          {insight.label}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">
                            {insightCategoryLabel(insight.category)}
                          </div>
                          <div className="max-w-[260px] text-xs text-muted-foreground">
                            {insight.description}
                          </div>
                        </TableCell>
                        <TableCell className={cn("metric-tabular", colorForPnl(insight.manualPnl))}>
                          {formatPln(insight.manualPnl)}
                        </TableCell>
                        <TableCell className={cn("metric-tabular", colorForPnl(insight.scriptPnl))}>
                          {formatPln(insight.scriptPnl)}
                        </TableCell>
                        <TableCell className="metric-tabular text-[var(--energy-positive)]">
                          {formatPln(insight.opportunityPln)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MobileDuelInsightCard({ insight }: { insight: StrategyDuelInsight }) {
  return (
    <div
      className="min-w-0 rounded-md border border-[#263f49] bg-[#0a1418] p-3"
      data-testid="mobile-duel-insight-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="metric-tabular text-sm font-semibold">{insight.label}</div>
          <div className="mt-1 break-words text-xs font-medium">
            {insightCategoryLabel(insight.category)}
          </div>
        </div>
        <Badge
          variant="outline"
          className="h-5 shrink-0 rounded-md border-primary/35 bg-primary/10 px-2 text-[11px] text-primary"
        >
          Edge
        </Badge>
      </div>
      <p className="mt-2 break-words text-xs text-muted-foreground">{insight.description}</p>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 text-xs">
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Manual PnL</div>
          <div className={cn("metric-tabular mt-1 break-words font-medium", colorForPnl(insight.manualPnl))}>
            {formatPln(insight.manualPnl)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Script PnL</div>
          <div className={cn("metric-tabular mt-1 break-words font-medium", colorForPnl(insight.scriptPnl))}>
            {formatPln(insight.scriptPnl)}
          </div>
        </div>
        <div className="col-span-2 min-w-0 rounded-md border border-primary/30 bg-primary/10 p-2">
          <div className="text-primary/80">Opportunity</div>
          <div className="metric-tabular mt-1 break-words font-medium text-primary">
            {formatPln(insight.opportunityPln)}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScenarioReportCard({
  report,
  hasBotResult,
}: {
  report: ScenarioDecisionReport;
  hasBotResult: boolean;
}) {
  return (
    <Card className="rounded-lg border-border/70 bg-card/80">
      <CardHeader>
        <CardTitle>Scenario report</CardTitle>
        <CardDescription>Final feedback from manual decisions and script comparison</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-border/70 bg-muted/25 p-3">
            <div className="text-xs text-muted-foreground">Accepted / rejected</div>
            <div className="metric-tabular mt-1 font-medium">
              {report.acceptedDecisionCount} / {report.rejectedDecisionCount}
            </div>
          </div>
          <div className="rounded-md border border-border/70 bg-muted/25 p-3">
            <div className="text-xs text-muted-foreground">Risk cut</div>
            <div className="metric-tabular mt-1 font-medium text-[var(--energy-positive)]">
              {formatMwh(report.totalRiskCutMwh)}
            </div>
          </div>
          <div className="rounded-md border border-border/70 bg-muted/25 p-3">
            <div className="text-xs text-muted-foreground">Decision impact</div>
            <div
              className={cn(
                "metric-tabular mt-1 font-medium",
                colorForPnl(report.totalDecisionPnlImpact)
              )}
            >
              {formatPln(report.totalDecisionPnlImpact)}
            </div>
          </div>
          <div className="rounded-md border border-border/70 bg-muted/25 p-3">
            <div className="text-xs text-muted-foreground">Missed opportunities</div>
            <div className="metric-tabular mt-1 font-medium">
              {hasBotResult ? report.missedOpportunityCount : "Pending"}
            </div>
          </div>
        </div>
        <Separator />
        <div className="grid gap-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Gap to script</span>
            <span className={cn("metric-tabular font-medium", colorForPnl(-report.totalPnlGapToScript))}>
              {hasBotResult ? formatPln(report.totalPnlGapToScript) : "Pending"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Avoidable imbalance cost</span>
            <span className="metric-tabular font-medium text-[var(--energy-negative)]">
              {hasBotResult ? formatPln(report.avoidableImbalanceCost) : "Pending"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Best decision</span>
            <span className="metric-tabular text-right">{decisionSummary(report.bestDecision)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Worst decision</span>
            <span className="metric-tabular text-right">
              {decisionSummary(report.worstDecision)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DecisionWorkbench() {
  const scenario = useSimulationStore((state) => state.scenario);
  const contracts = useSimulationStore((state) => state.contracts);
  const trades = useSimulationStore((state) => state.trades);
  const currentPeriod = useSimulationStore((state) => state.currentPeriod);
  const setSelectedPeriod = useSimulationStore((state) => state.setSelectedPeriod);
  const updateOrderDraft = useSimulationStore((state) => state.updateOrderDraft);
  const candidates = useMemo(
    () => buildDecisionCandidates(scenario, contracts, trades, currentPeriod, 12),
    [scenario, contracts, trades, currentPeriod]
  );
  const bestCandidate = pickBestDecisionCandidate(candidates);

  function loadCandidate(candidate: DecisionCandidate) {
    if (!candidate.orderDraft) {
      return;
    }

    setSelectedPeriod(candidate.periodIndex);
    updateOrderDraft(candidate.orderDraft);
  }

  return (
    <Card className="rounded-lg border-border/70 bg-card/80" data-testid="decision-workbench">
      <CardHeader>
        <CardTitle>Decision workbench</CardTitle>
        <CardDescription>Next 12 periods by expected imbalance and RDB impact</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {bestCandidate ? (
          <div className="grid gap-3 rounded-md border border-[#2b4550] bg-muted/20 p-3 text-xs md:grid-cols-3">
            <div>
              <div className="text-muted-foreground">Best period</div>
              <div className="metric-tabular mt-1 font-medium">{bestCandidate.label}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Recommendation</div>
              <div
                className={cn(
                  "metric-tabular mt-1 font-medium",
                  bestCandidate.recommendation === "buy" && "text-primary",
                  bestCandidate.recommendation === "sell" && "text-[var(--energy-warning)]"
                )}
              >
                {recommendationLabel(bestCandidate)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Expected impact</div>
              <div
                className={cn(
                  "metric-tabular mt-1 font-medium",
                  colorForPnl(bestCandidate.expectedPnlImpact)
                )}
              >
                {formatPln(bestCandidate.expectedPnlImpact)}
              </div>
            </div>
          </div>
        ) : null}
        <ScrollArea className="h-[294px]">
          <div className="flex flex-col gap-3 pr-3">
            {candidates.map((candidate) => (
              <DecisionCandidateCard
                candidate={candidate}
                key={candidate.periodIndex}
                onLoad={loadCandidate}
              />
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function DecisionCandidateCard({
  candidate,
  onLoad,
}: {
  candidate: DecisionCandidate;
  onLoad: (candidate: DecisionCandidate) => void;
}) {
  return (
    <div
      className="min-w-0 rounded-md border border-[#263f49] bg-[#0a1418] p-2.5"
      data-testid="decision-candidate-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Period</div>
          <div className="metric-tabular mt-1 text-sm font-semibold">{candidate.label}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge
            variant={candidate.recommendation === "hold" ? "outline" : "secondary"}
            className={cn(
              "h-5 shrink-0 rounded-md px-2 text-[11px]",
              candidate.recommendation === "buy" && "text-primary",
              candidate.recommendation === "sell" && "text-[var(--energy-warning)]"
            )}
          >
            {recommendationLabel(candidate)}
          </Badge>
          <Button
            className="h-7 px-3"
            disabled={!candidate.orderDraft}
            size="sm"
            variant="secondary"
            onClick={() => onLoad(candidate)}
          >
            Load
          </Button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 text-xs">
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Net</div>
          <div className="metric-tabular mt-1 break-words font-medium">
            {formatSignedMwh(candidate.expectedNetMwh)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Imb. PnL</div>
          <div
            className={cn(
              "metric-tabular mt-1 break-words font-medium",
              colorForPnl(candidate.expectedImbalancePnl)
            )}
          >
            {formatPln(candidate.expectedImbalancePnl)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">RDB</div>
          <div className="metric-tabular mt-1 break-words font-medium">
            {formatPrice(candidate.recommendation === "sell" ? candidate.rdbBid : candidate.rdbAsk)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Impact</div>
          <div
            className={cn(
              "metric-tabular mt-1 break-words font-medium",
              colorForPnl(candidate.expectedPnlImpact)
            )}
          >
            {formatPln(candidate.expectedPnlImpact)}
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileMarketPeriodCard({
  currentPeriod,
  onSelectPeriod,
  period,
}: {
  currentPeriod: number;
  onSelectPeriod: (periodIndex: number) => void;
  period: KnownPeriodView;
}) {
  const isLocked = period.periodIndex <= currentPeriod;

  return (
    <div
      className="min-w-0 max-w-full rounded-md border border-[#263f49] bg-[#0a1418] p-3"
      data-testid="mobile-market-period-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="metric-tabular text-base font-semibold">{period.label}</div>
          <div className="metric-tabular mt-1 text-xs text-muted-foreground">
            RDN {formatPrice(period.rdnPrice)}
          </div>
        </div>
        <Badge
          className={cn(
            "h-5 rounded-md px-2 text-[11px]",
            isLocked
              ? "border-muted bg-muted/20 text-muted-foreground"
              : "border-primary/35 bg-primary/10 text-primary"
          )}
          variant="outline"
        >
          {isLocked ? "Locked" : "Tradable"}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 text-xs">
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Bid</div>
          <div className="metric-tabular mt-1 break-words text-[12px] font-semibold text-[var(--energy-positive)]">
            {formatPrice(period.intradayBid)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Ask</div>
          <div className="metric-tabular mt-1 break-words text-[12px] font-semibold text-[var(--energy-negative)]">
            {formatPrice(period.intradayAsk)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Long imb.</div>
          <div className="metric-tabular mt-1 break-words text-[12px]">
            {formatPrice(period.actualImbalanceLongPrice ?? period.expectedImbalanceLongPrice)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Short imb.</div>
          <div className="metric-tabular mt-1 break-words text-[12px]">
            {formatPrice(period.actualImbalanceShortPrice ?? period.expectedImbalanceShortPrice)}
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Liquidity</div>
          <div className="metric-tabular text-sm font-semibold">{formatMwh(period.liquidityMwh)}</div>
        </div>
        <Button
          disabled={isLocked}
          onClick={() => onSelectPeriod(period.periodIndex)}
          size="sm"
          type="button"
          variant={isLocked ? "outline" : "secondary"}
        >
          {isLocked ? "Locked" : "Load ticket"}
        </Button>
      </div>
    </div>
  );
}

function MarketView() {
  const scenario = useSimulationStore((state) => state.scenario);
  const trades = useSimulationStore((state) => state.trades);
  const decisionLog = useSimulationStore((state) => state.decisionLog);
  const currentPeriod = useSimulationStore((state) => state.currentPeriod);
  const setSelectedPeriod = useSimulationStore((state) => state.setSelectedPeriod);
  const periods = buildKnownMarketTape(scenario, currentPeriod).slice(
    currentPeriod,
    currentPeriod + 24
  );

  return (
    <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-4 overflow-x-hidden p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="w-full min-w-0 max-w-full rounded-lg border-border/70 bg-card/80">
        <CardHeader>
          <CardTitle>Intraday market board</CardTitle>
          <CardDescription>Locked RDN reference plus RDB/SIDC executable liquidity</CardDescription>
        </CardHeader>
        <CardContent className="w-full min-w-0 max-w-full overflow-hidden">
          <div className="md:hidden">
            <ScrollArea className="h-[520px] w-full max-w-full overflow-hidden pr-3">
              <div className="flex w-full min-w-0 max-w-full flex-col gap-3">
                {periods.map((period) => (
                  <MobileMarketPeriodCard
                    currentPeriod={currentPeriod}
                    key={period.periodIndex}
                    onSelectPeriod={setSelectedPeriod}
                    period={period}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>
          <div className="hidden overflow-x-auto md:block">
            <Table className="min-w-[920px]">
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>RDN</TableHead>
                <TableHead>Bid</TableHead>
                <TableHead>Ask</TableHead>
                <TableHead>Long imbalance</TableHead>
                <TableHead>Short imbalance</TableHead>
                <TableHead>Liquidity</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {periods.map((period) => (
                <TableRow key={period.periodIndex}>
                  <TableCell className="metric-tabular font-medium">{period.label}</TableCell>
                  <TableCell className="metric-tabular">{formatPrice(period.rdnPrice)}</TableCell>
                  <TableCell className="metric-tabular text-[var(--energy-positive)]">
                    {formatPrice(period.intradayBid)}
                  </TableCell>
                  <TableCell className="metric-tabular text-[var(--energy-negative)]">
                    {formatPrice(period.intradayAsk)}
                  </TableCell>
                  <TableCell className="metric-tabular">
                    {formatPrice(
                      period.actualImbalanceLongPrice ?? period.expectedImbalanceLongPrice
                    )}
                  </TableCell>
                  <TableCell className="metric-tabular">
                    {formatPrice(
                      period.actualImbalanceShortPrice ?? period.expectedImbalanceShortPrice
                    )}
                  </TableCell>
                  <TableCell className="metric-tabular">{formatMwh(period.liquidityMwh)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={period.periodIndex <= currentPeriod}
                      onClick={() => setSelectedPeriod(period.periodIndex)}
                    >
                      {period.periodIndex <= currentPeriod ? "Locked" : "Trade"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
      <div className="flex flex-col gap-4">
        <OrderTicket />
        <DecisionWorkbench />
        <DecisionLogPanel decisionLog={decisionLog} />
        <TradeTape trades={trades} />
      </div>
    </div>
  );
}

function ScenarioRangeControl({
  control,
  value,
  onChange,
}: {
  control: (typeof scenarioRangeControls)[number];
  value: number;
  onChange: (value: number) => void;
}) {
  const controlId = `scenario-${control.key}`;

  return (
    <div className="rounded-md border border-border/60 bg-background/35 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="text-xs font-medium text-muted-foreground" htmlFor={controlId}>
          {control.label}
        </label>
        <span className="metric-tabular text-xs font-semibold text-foreground">
          {control.formatValue(value)}
        </span>
      </div>
      <input
        aria-label={control.label}
        className="h-2 w-full accent-[var(--energy-cyan)]"
        id={controlId}
        max={control.max}
        min={control.min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={control.step}
        type="range"
        value={value}
      />
    </div>
  );
}

function CalibrationMetric({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background/35 p-3">
      <div className="text-[11px] uppercase tracking-normal text-muted-foreground">{label}</div>
      <div className="mt-1 metric-tabular text-sm font-semibold text-foreground">{value}</div>
      <div className="mt-1 metric-tabular text-[11px] text-muted-foreground">{delta}</div>
    </div>
  );
}

function buildCalibrationRows(
  activeReport: ScenarioCalibrationReport,
  previewReport: ScenarioCalibrationReport,
  currency: CurrencyCode
) {
  return [
    {
      label: "Avg RDN",
      value: formatPrice(previewReport.averageRdnPrice, currency),
      delta: formatSignedDelta(
        previewReport.averageRdnPrice - activeReport.averageRdnPrice,
        ` ${priceUnitLabel(currency)}`
      ),
    },
    {
      label: "RDN sigma",
      value: formatPrice(previewReport.rdnPriceStdDev, currency),
      delta: formatSignedDelta(
        previewReport.rdnPriceStdDev - activeReport.rdnPriceStdDev,
        ` ${priceUnitLabel(currency)}`
      ),
    },
    {
      label: "Negative 15m",
      value: `${previewReport.negativeRdnPeriods}`,
      delta: formatSignedDelta(
        previewReport.negativeRdnPeriods - activeReport.negativeRdnPeriods,
        " periods"
      ),
    },
    {
      label: "Avg liquidity",
      value: formatMwh(previewReport.averageLiquidityMwh),
      delta: formatSignedDelta(
        previewReport.averageLiquidityMwh - activeReport.averageLiquidityMwh,
        " MWh",
        1
      ),
    },
    {
      label: "Max spread",
      value: formatPrice(previewReport.maxBidAskSpread, currency),
      delta: formatSignedDelta(
        previewReport.maxBidAskSpread - activeReport.maxBidAskSpread,
        ` ${priceUnitLabel(currency)}`
      ),
    },
    {
      label: "Spike trigger",
      value: formatPrice(previewReport.priceSpikeThreshold, currency),
      delta: formatSignedDelta(
        previewReport.priceSpikeThreshold - activeReport.priceSpikeThreshold,
        ` ${priceUnitLabel(currency)}`
      ),
    },
  ];
}

function ForecastView() {
  const scenarioId = useSimulationStore((state) => state.scenarioId);
  const scenario = useSimulationStore((state) => state.scenario);
  const scenarioConfig = useSimulationStore((state) => state.scenarioConfig);
  const scenarioConfigDraft = useSimulationStore((state) => state.scenarioConfigDraft);
  const updateScenarioConfigDraft = useSimulationStore(
    (state) => state.updateScenarioConfigDraft
  );
  const applyScenarioConfig = useSimulationStore((state) => state.applyScenarioConfig);
  const resetScenarioConfig = useSimulationStore((state) => state.resetScenarioConfig);
  const currentPeriod = useSimulationStore((state) => state.currentPeriod);
  const data = buildKnownMarketTape(scenario, currentPeriod)
    .slice(currentPeriod, currentPeriod + 48)
    .map((period) => ({
      label: period.label,
      forecastGeneration: period.forecastGeneration,
      actualGeneration: period.actualGeneration,
      forecastLoad: period.forecastLoad,
      actualLoad: period.actualLoad,
      wind: period.weather.windSpeedMs,
      irradiance: period.weather.irradiance / 50,
      temperature: period.weather.temperatureC,
    }));
  const activeReport = useMemo(
    () => buildScenarioCalibrationReport(scenario),
    [scenario]
  );
  const previewScenario = useMemo(
    () => createScenario(scenarioId, scenarioConfigDraft),
    [scenarioId, scenarioConfigDraft]
  );
  const previewReport = useMemo(
    () => buildScenarioCalibrationReport(previewScenario),
    [previewScenario]
  );
  const calibrationRows = useMemo(
    () => buildCalibrationRows(activeReport, previewReport, scenario.metadata.currency),
    [activeReport, previewReport, scenario.metadata.currency]
  );
  const defaultConfig = useMemo(
    () => createDefaultScenarioConfig(scenarioId),
    [scenarioId]
  );
  const hasDraftChanges = !configsEqual(scenarioConfig, scenarioConfigDraft);
  const isDefaultConfig =
    configsEqual(scenarioConfig, defaultConfig) &&
    configsEqual(scenarioConfigDraft, defaultConfig);

  return (
    <div className="grid flex-1 gap-4 p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_390px]">
      <div className="flex flex-col gap-4">
        <Card className="rounded-lg border-border/70 bg-card/80">
          <CardHeader>
            <CardTitle>Weather-driven OZE and load forecast</CardTitle>
            <CardDescription>
              PV follows irradiance and cloud cover; load follows time and temperature
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
                minHeight={0}
                initialDimension={{ width: 1, height: 1 }}
              >
                <LineChart data={data} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} width={42} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                    }}
                  />
                  <Line
                    dataKey="forecastGeneration"
                    name="Forecast OZE"
                    stroke="var(--energy-cyan)"
                    dot={false}
                  />
                  <Line
                    dataKey="actualGeneration"
                    name="Actual OZE"
                    stroke="var(--energy-positive)"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    dataKey="forecastLoad"
                    name="Forecast load"
                    stroke="var(--energy-amber)"
                    dot={false}
                  />
                  <Line
                    dataKey="actualLoad"
                    name="Actual load"
                    stroke="var(--energy-negative)"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-lg border-border/70 bg-card/80">
          <CardHeader>
            <CardTitle>Weather signals</CardTitle>
            <CardDescription>Inputs that drive forecast error in the simulation</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
                minHeight={0}
                initialDimension={{ width: 1, height: 1 }}
              >
                <AreaChart data={data} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} width={42} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                    }}
                  />
                  <Area
                    dataKey="irradiance"
                    name="Irradiance index"
                    stroke="var(--energy-warning)"
                    fill="var(--energy-warning)"
                    fillOpacity={0.18}
                  />
                  <Area
                    dataKey="wind"
                    name="Wind m/s"
                    stroke="var(--energy-cyan)"
                    fill="var(--energy-cyan)"
                    fillOpacity={0.12}
                  />
                  <Area
                    dataKey="temperature"
                    name="Temp C"
                    stroke="var(--energy-negative)"
                    fill="var(--energy-negative)"
                    fillOpacity={0.1}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Card className="rounded-lg border-border/70 bg-card/80" data-testid="scenario-editor">
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>Scenario editor</CardTitle>
                <CardDescription>
                  Seed {scenarioConfig.seed} · {scenario.definition.shortName}
                </CardDescription>
              </div>
              <Badge
                className={cn(
                  "shrink-0",
                  hasDraftChanges
                    ? "border-[var(--energy-warning)] text-[var(--energy-warning)]"
                    : "border-[var(--energy-positive)] text-[var(--energy-positive)]"
                )}
                variant="outline"
              >
                {hasDraftChanges ? "Draft" : "Live"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="rounded-md border border-border/60 bg-background/35 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="scenario-seed">
                  Seed
                </label>
                <span className="metric-tabular text-xs text-muted-foreground">
                  active {scenarioConfig.seed}
                </span>
              </div>
              <Input
                aria-label="Scenario seed"
                id="scenario-seed"
                max={999999}
                min={1}
                onChange={(event) =>
                  updateScenarioConfigDraft({ seed: Math.trunc(Number(event.target.value)) })
                }
                type="number"
                value={scenarioConfigDraft.seed}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {scenarioRangeControls.map((control) => (
                <ScenarioRangeControl
                  control={control}
                  key={control.key}
                  onChange={(value) =>
                    updateScenarioConfigDraft({
                      [control.key]: value,
                    } as Partial<ScenarioConfig>)
                  }
                  value={scenarioConfigDraft[control.key]}
                />
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                disabled={!hasDraftChanges}
                onClick={applyScenarioConfig}
                type="button"
                variant={hasDraftChanges ? "default" : "outline"}
              >
                {hasDraftChanges ? (
                  <SparklesIcon data-icon="inline-start" />
                ) : (
                  <ShieldCheckIcon data-icon="inline-start" />
                )}
                {hasDraftChanges ? "Apply scenario" : "Applied"}
              </Button>
              <Button
                disabled={isDefaultConfig}
                onClick={resetScenarioConfig}
                type="button"
                variant="outline"
              >
                <RotateCcwIcon data-icon="inline-start" />
                Reset defaults
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-lg border-border/70 bg-card/80">
          <CardHeader>
            <CardTitle>Calibration preview</CardTitle>
            <CardDescription>Draft tape vs active tape</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {calibrationRows.map((row) => (
                <CalibrationMetric
                  delta={row.delta}
                  key={row.label}
                  label={row.label}
                  value={row.value}
                />
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-lg border-border/70 bg-card/80">
          <CardHeader>
            <CardTitle>Forecast rulebook</CardTitle>
            <CardDescription>What v1 intentionally models</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>
              PV production changes with irradiance and cloud cover, then actual metering applies
              a scenario-specific forecast error.
            </p>
            <p>Wind follows a smooth speed curve with sudden ramp shocks in selected scenarios.</p>
            <p>Load rises in morning and evening peaks, with winter temperature sensitivity.</p>
            <p>
              Prices react to scarcity, OZE surplus, evening peaks, outage shocks and intraday
              liquidity.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DuelView() {
  const scenario = useSimulationStore((state) => state.scenario);
  const contracts = useSimulationStore((state) => state.contracts);
  const trades = useSimulationStore((state) => state.trades);
  const decisionLog = useSimulationStore((state) => state.decisionLog);
  const currentPeriod = useSimulationStore((state) => state.currentPeriod);
  const botResult = useSimulationStore((state) => state.botResult);
  const runBotComparison = useSimulationStore((state) => state.runBotComparison);
  const human = useMemo(
    () => buildDashboardMetrics(scenario, contracts, trades, currentPeriod).projectedSettlement,
    [scenario, contracts, trades, currentPeriod]
  );
  const manualRdbTrades = useMemo(
    () => trades.filter((trade) => trade.market === "RDB" && trade.actor === "manual"),
    [trades]
  );
  const scenarioSetupTrades = useMemo(() => getScenarioSetupTrades(trades), [trades]);
  const botProjectedSettlement = useMemo(
    () =>
      botResult
        ? buildDashboardMetrics(
            scenario,
            contracts,
            [...scenarioSetupTrades, ...botResult.trades],
            currentPeriod
          ).projectedSettlement
        : undefined,
    [botResult, scenario, contracts, scenarioSetupTrades, currentPeriod]
  );
  const duelInsights = useMemo(
    () =>
      botResult
        ? buildStrategyDuelInsights(
            scenario,
            contracts,
            trades,
            botResult.trades,
            currentPeriod
          )
        : [],
    [botResult, scenario, contracts, trades, currentPeriod]
  );
  const scenarioReport = useMemo(
    () => buildScenarioDecisionReport(decisionLog, duelInsights, human, botProjectedSettlement),
    [decisionLog, duelInsights, human, botProjectedSettlement]
  );
  const delta = botProjectedSettlement ? human.totalPnl - botProjectedSettlement.totalPnl : 0;

  return (
    <div className="grid flex-1 gap-4 p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-4">
        <Card className="rounded-lg border-border/70 bg-card/80">
          <CardHeader>
            <CardTitle>Human vs script PnL</CardTitle>
            <CardDescription>Same seed, same contracts, no future actuals for the script</CardDescription>
            <CardAction>
              <Button onClick={runBotComparison}>
                <BotIcon data-icon="inline-start" />
                Run script
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <MetricCard
              title="Manual projected"
              value={formatPln(human.totalPnl)}
              description={`${manualRdbTrades.length} manual RDB trades`}
              icon={FileSignatureIcon}
              tone={pnlTone(human.totalPnl)}
            />
            <MetricCard
              title="Script projected"
              value={botProjectedSettlement ? formatPln(botProjectedSettlement.totalPnl) : "Not run"}
              description={botResult ? `${botResult.trades.length} script trades` : "Use Run script"}
              icon={BotIcon}
              tone={botProjectedSettlement ? pnlTone(botProjectedSettlement.totalPnl) : "neutral"}
            />
            <MetricCard
              title="Your edge"
              value={botResult ? formatPln(delta) : "Pending"}
              description={botResult ? "Positive means manual beat the script" : "Run a comparison"}
              icon={SparklesIcon}
              tone={botResult ? pnlTone(delta) : "neutral"}
            />
          </CardContent>
        </Card>
        <Card className="rounded-lg border-border/70 bg-card/80">
          <CardHeader>
            <CardTitle>Decision quality</CardTitle>
            <CardDescription>Imbalance cost and risk mistakes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:hidden">
              <ComparisonSummaryCard
                label="Manual"
                settlement={human}
                tradeCount={manualRdbTrades.length}
              />
              {botProjectedSettlement ? (
                <ComparisonSummaryCard
                  label="Script"
                  settlement={botProjectedSettlement}
                  tradeCount={botResult?.trades.length ?? 0}
                />
              ) : null}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead>Total PnL</TableHead>
                    <TableHead>Imbalance PnL</TableHead>
                    <TableHead>Abs imbalance</TableHead>
                    <TableHead>Risk periods</TableHead>
                    <TableHead>Worst period</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <ComparisonRow
                    label="Manual"
                    settlement={human}
                    tradeCount={manualRdbTrades.length}
                  />
                  {botProjectedSettlement ? (
                    <ComparisonRow
                      label="Script"
                      settlement={botProjectedSettlement}
                      tradeCount={botResult?.trades.length ?? 0}
                    />
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        <DuelInsightsTable insights={duelInsights} hasBotResult={Boolean(botResult)} />
      </div>
      <div className="flex flex-col gap-4">
        <Card className="rounded-lg border-border/70 bg-card/80">
          <CardHeader>
            <CardTitle>Script strategy</CardTitle>
            <CardDescription>Transparent v1 logic</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>Every tick, the script sees only forecasts, signed contracts, existing trades and public market prices for future periods.</p>
            <p>It closes expected net positions when intraday bid/ask beats the expected imbalance settlement after transaction cost.</p>
            <p>It keeps a small MWh buffer, avoids current-period gate closure, and caps trades by liquidity and risk limit.</p>
            {botResult ? (
              <Alert>
                <ShieldCheckIcon data-icon="inline-start" />
                <AlertTitle>Run complete</AlertTitle>
                <AlertDescription>
                  Avoided {formatMwh(botResult.avoidedImbalanceMwh)} absolute imbalance vs do-nothing.
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
        <ScenarioReportCard report={scenarioReport} hasBotResult={Boolean(botResult)} />
      </div>
    </div>
  );
}

function ComparisonRow({
  label,
  settlement,
  tradeCount,
}: {
  label: string;
  settlement: ReturnType<typeof settlePortfolio>;
  tradeCount: number;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        {label}
        <span className="ml-2 text-xs text-muted-foreground">({tradeCount} trades)</span>
      </TableCell>
      <TableCell className={cn("metric-tabular", colorForPnl(settlement.totalPnl))}>
        {formatPln(settlement.totalPnl)}
      </TableCell>
      <TableCell className={cn("metric-tabular", colorForPnl(settlement.imbalancePnl))}>
        {formatPln(settlement.imbalancePnl)}
      </TableCell>
      <TableCell className="metric-tabular">
        {formatMwh(settlement.totalImbalanceAbsMwh)}
      </TableCell>
      <TableCell className="metric-tabular">{settlement.errorCount}</TableCell>
      <TableCell>
        {settlement.worstPeriod
          ? `${settlement.worstPeriod.label} | ${formatPln(settlement.worstPeriod.periodPnl)}`
          : "n/a"}
      </TableCell>
    </TableRow>
  );
}

function ComparisonSummaryCard({
  label,
  settlement,
  tradeCount,
}: {
  label: string;
  settlement: ReturnType<typeof settlePortfolio>;
  tradeCount: number;
}) {
  return (
    <div
      className="min-w-0 rounded-md border border-[#263f49] bg-[#0a1418] p-3"
      data-testid="mobile-duel-comparison-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{label}</div>
          <div className="mt-1 text-xs text-muted-foreground">{tradeCount} trades</div>
        </div>
        <Badge variant="outline" className="h-5 shrink-0 rounded-md px-2 text-[11px]">
          {settlement.errorCount} risk periods
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 text-xs">
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Total PnL</div>
          <div className={cn("metric-tabular mt-1 break-words font-medium", colorForPnl(settlement.totalPnl))}>
            {formatPln(settlement.totalPnl)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Imb. PnL</div>
          <div className={cn("metric-tabular mt-1 break-words font-medium", colorForPnl(settlement.imbalancePnl))}>
            {formatPln(settlement.imbalancePnl)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Abs imbalance</div>
          <div className="metric-tabular mt-1 break-words font-medium">
            {formatMwh(settlement.totalImbalanceAbsMwh)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Worst period</div>
          <div className="metric-tabular mt-1 break-words font-medium">
            {settlement.worstPeriod
              ? `${settlement.worstPeriod.label} | ${formatPln(settlement.worstPeriod.periodPnl)}`
              : "n/a"}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReplayView() {
  const scenario = useSimulationStore((state) => state.scenario);
  const contracts = useSimulationStore((state) => state.contracts);
  const trades = useSimulationStore((state) => state.trades);
  const decisionLog = useSimulationStore((state) => state.decisionLog);
  const currentPeriod = useSimulationStore((state) => state.currentPeriod);
  const selectedPeriod = useSimulationStore((state) => state.selectedPeriod);
  const botResult = useSimulationStore((state) => state.botResult);
  const setSelectedPeriod = useSimulationStore((state) => state.setSelectedPeriod);
  const [activeFilter, setActiveFilter] = useState<ReplayTimelineKind | "all">("all");
  const replayBotResult = useMemo(
    () =>
      botResult ??
      runAutopilot(
        scenario,
        contracts,
        undefined,
        getScenarioSetupTrades(trades)
      ),
    [botResult, scenario, contracts, trades]
  );
  const replayInput = useMemo(
    () => ({
      scenario,
      contracts,
      manualTrades: trades,
      scriptTrades: replayBotResult.trades,
      decisionLog,
      currentPeriod,
    }),
    [scenario, contracts, trades, replayBotResult.trades, decisionLog, currentPeriod]
  );
  const periodInsights = useMemo(
    () => buildReplayPeriodInsights(replayInput),
    [replayInput]
  );
  const timeline = useMemo(() => buildReplayTimeline(replayInput), [replayInput]);
  const lessons = useMemo(() => buildScenarioLessons(replayInput), [replayInput]);
  const filteredTimeline = useMemo(
    () =>
      activeFilter === "all"
        ? timeline
        : timeline.filter((event) => event.kind === activeFilter),
    [activeFilter, timeline]
  );
  const activeInsight =
    periodInsights.find((insight) => insight.periodIndex === selectedPeriod) ??
    periodInsights.at(-1);
  const visibleManualPnl = periodInsights.reduce((sum, insight) => sum + insight.manualPnl, 0);
  const visibleScriptPnl = periodInsights.reduce(
    (sum, insight) => sum + (insight.scriptPnl ?? insight.manualPnl),
    0
  );
  const scriptGap = visibleScriptPnl - visibleManualPnl;
  const avoidableCost = periodInsights.reduce(
    (sum, insight) => sum + Math.max(insight.pnlGapToScript ?? 0, 0),
    0
  );
  const worstInsight = [...periodInsights].sort(
    (left, right) => left.manualPnl - right.manualPnl
  )[0];
  const replayRows = periodInsights.slice(0, Math.max(currentPeriod + 1, 16));
  const filters: Array<ReplayTimelineKind | "all"> = [
    "all",
    "manual-decision",
    "bot-edge",
    "imbalance-leak",
    "good-hedge",
  ];

  function inspectPeriod(periodIndex: number) {
    setSelectedPeriod(periodIndex);
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Replay PnL"
          value={formatPln(visibleManualPnl)}
          description={`Visible through ${scenario.periods[currentPeriod]?.label ?? "day close"}`}
          icon={ScrollTextIcon}
          tone={pnlTone(visibleManualPnl)}
        />
        <MetricCard
          title="Gap to script"
          value={formatPln(scriptGap)}
          description={scriptGap > 0 ? "Script found better execution" : "Manual is ahead"}
          icon={BotIcon}
          tone={scriptGap > 0 ? "warning" : pnlTone(-scriptGap)}
        />
        <MetricCard
          title="Avoidable cost"
          value={formatPln(avoidableCost)}
          description={`${timeline.filter((event) => event.kind === "bot-edge").length} script edge periods`}
          icon={AlertTriangleIcon}
          tone={avoidableCost > 0 ? "negative" : "neutral"}
        />
        <MetricCard
          title="Worst period"
          value={worstInsight ? `${worstInsight.label} | ${formatPln(worstInsight.manualPnl)}` : "n/a"}
          description={
            worstInsight
              ? `${formatMwh(worstInsight.manualImbalanceMwh)} manual imbalance`
              : "No periods visible"
          }
          icon={GaugeIcon}
          tone={worstInsight ? pnlTone(worstInsight.manualPnl) : "neutral"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <Card className="rounded-lg border-border/70 bg-card/80">
          <CardHeader>
            <CardTitle>Replay timeline</CardTitle>
            <CardDescription>Manual decisions, script edges and imbalance leaks</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {filters.map((filter) => (
                <Button
                  key={filter}
                  size="sm"
                  variant={activeFilter === filter ? "default" : "outline"}
                  onClick={() => setActiveFilter(filter)}
                >
                  {replayKindLabel(filter)}
                </Button>
              ))}
            </div>
            {filteredTimeline.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No events in this filter for the visible settlement window.
              </div>
            ) : (
              <ScrollArea className="h-[380px] pr-3">
                <div className="flex flex-col gap-2">
                  {filteredTimeline.map((event) => {
                    const Icon = replayEventIcon(event.kind);

                    return (
                      <button
                        key={event.id}
                        className={cn(
                          "grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-lg border border-border/70 bg-muted/25 p-3 text-left transition hover:border-primary/60 hover:bg-muted/40",
                          selectedPeriod === event.periodIndex && "border-primary/70 bg-primary/10"
                        )}
                        type="button"
                        onClick={() => inspectPeriod(event.periodIndex)}
                      >
                        <span className="mt-0.5 flex size-8 items-center justify-center rounded-md border border-border/70 bg-background/70">
                          <Icon data-icon="inline-start" />
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="metric-tabular text-xs text-muted-foreground">
                              {event.label}
                            </span>
                            <Badge variant="outline">{replayKindLabel(event.kind)}</Badge>
                          </span>
                          <span className={cn("mt-1 block font-medium", replayToneClass(event.tone))}>
                            {event.title}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                            {event.description}
                          </span>
                        </span>
                        <span className={cn("metric-tabular text-sm font-medium", colorForPnl(event.pnlImpact))}>
                          {formatPln(event.pnlImpact)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-lg border-border/70 bg-card/80">
          <CardHeader>
            <CardTitle>Period drilldown</CardTitle>
            <CardDescription>
              {activeInsight
                ? `${activeInsight.label} settlement comparison`
                : "Select a replay event"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activeInsight ? (
              <div className="flex flex-col gap-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-md border border-border/70 bg-muted/25 p-3">
                    <div className="text-xs text-muted-foreground">Manual</div>
                    <div className={cn("metric-tabular mt-1 font-medium", colorForPnl(activeInsight.manualPnl))}>
                      {formatPln(activeInsight.manualPnl)}
                    </div>
                    <div className="metric-tabular mt-1 text-xs text-muted-foreground">
                      {formatMwh(activeInsight.manualImbalanceMwh)}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/70 bg-muted/25 p-3">
                    <div className="text-xs text-muted-foreground">Script</div>
                    <div className={cn("metric-tabular mt-1 font-medium", colorForPnl(activeInsight.scriptPnl ?? 0))}>
                      {formatMaybePln(activeInsight.scriptPnl)}
                    </div>
                    <div className="metric-tabular mt-1 text-xs text-muted-foreground">
                      {formatMaybeMwh(activeInsight.scriptImbalanceMwh)}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/70 bg-muted/25 p-3">
                    <div className="text-xs text-muted-foreground">Baseline</div>
                    <div className={cn("metric-tabular mt-1 font-medium", colorForPnl(activeInsight.baselinePnl))}>
                      {formatPln(activeInsight.baselinePnl)}
                    </div>
                    <div className="metric-tabular mt-1 text-xs text-muted-foreground">
                      {formatMwh(activeInsight.baselineImbalanceMwh)}
                    </div>
                  </div>
                </div>
                <div className="grid gap-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Gap to script</span>
                    <span className={cn("metric-tabular font-medium", colorForPnl(activeInsight.pnlGapToScript ?? 0))}>
                      {formatMaybePln(activeInsight.pnlGapToScript)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Manual vs baseline</span>
                    <span className={cn("metric-tabular font-medium", colorForPnl(activeInsight.pnlGapToBaseline))}>
                      {formatPln(activeInsight.pnlGapToBaseline)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">RDB trades</span>
                    <span className="metric-tabular">
                      {activeInsight.manualTradeCount} manual / {activeInsight.scriptTradeCount} script
                    </span>
                  </div>
                </div>
                <Alert>
                  <InfoIcon data-icon="inline-start" />
                  <AlertTitle>Replay note</AlertTitle>
                  <AlertDescription>{activeInsight.recommendation}</AlertDescription>
                </Alert>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No settlement periods are visible yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card className="rounded-lg border-border/70 bg-card/80">
          <CardHeader>
            <CardTitle>Lesson learned</CardTitle>
            <CardDescription>Highest-value takeaways from this scenario</CardDescription>
          </CardHeader>
          <CardContent>
            {lessons.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No lessons generated for the visible settlement window.
              </div>
            ) : (
              <div className="grid gap-2">
                {lessons.map((lesson) => (
                  <div
                    key={lesson.id}
                    className="rounded-lg border border-border/70 bg-muted/25 p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className={cn("font-medium", replayToneClass(lesson.tone))}>
                          {lesson.title}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {lesson.label}: {lesson.reason}
                        </div>
                      </div>
                      <div className={cn("metric-tabular shrink-0 font-medium", colorForPnl(lesson.pnlImpact))}>
                        {formatPln(lesson.pnlImpact)}
                      </div>
                    </div>
                    <div className="mt-2 border-t border-border/70 pt-2 text-xs text-muted-foreground">
                      {lesson.recommendation}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-lg border-border/70 bg-card/80">
          <CardHeader>
            <CardTitle>Settlement audit</CardTitle>
            <CardDescription>Manual, script and no-action baseline by 15-minute period</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[420px] md:hidden">
              <div className="flex flex-col gap-3 pr-3">
                {replayRows.map((row: ReplayPeriodInsight) => (
                  <MobileReplayAuditCard
                    key={row.periodIndex}
                    row={row}
                    onInspect={inspectPeriod}
                  />
                ))}
              </div>
            </ScrollArea>
            <div className="hidden overflow-x-auto md:block">
              <ScrollArea className="h-[420px]">
                <Table className="min-w-[660px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[72px]">Period</TableHead>
                      <TableHead>Manual PnL</TableHead>
                      <TableHead>Script PnL</TableHead>
                      <TableHead>Baseline</TableHead>
                      <TableHead>Manual MWh</TableHead>
                      <TableHead>Script MWh</TableHead>
                      <TableHead className="w-[64px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {replayRows.map((row: ReplayPeriodInsight) => (
                      <TableRow key={row.periodIndex}>
                        <TableCell className="metric-tabular font-medium">{row.label}</TableCell>
                        <TableCell className={cn("metric-tabular", colorForPnl(row.manualPnl))}>
                          {formatPln(row.manualPnl)}
                        </TableCell>
                        <TableCell
                          className={cn("metric-tabular", colorForPnl(row.scriptPnl ?? 0))}
                        >
                          {formatMaybePln(row.scriptPnl)}
                        </TableCell>
                        <TableCell className={cn("metric-tabular", colorForPnl(row.baselinePnl))}>
                          {formatPln(row.baselinePnl)}
                        </TableCell>
                        <TableCell className="metric-tabular">
                          {formatMwh(row.manualImbalanceMwh)}
                        </TableCell>
                        <TableCell className="metric-tabular">
                          {formatMaybeMwh(row.scriptImbalanceMwh)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => inspectPeriod(row.periodIndex)}
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MobileReplayAuditCard({
  row,
  onInspect,
}: {
  row: ReplayPeriodInsight;
  onInspect: (periodIndex: number) => void;
}) {
  return (
    <div
      className="min-w-0 rounded-md border border-[#263f49] bg-[#0a1418] p-3"
      data-testid="mobile-replay-audit-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Period</div>
          <div className="metric-tabular mt-1 text-sm font-semibold">{row.label}</div>
        </div>
        <Button size="sm" variant="secondary" onClick={() => onInspect(row.periodIndex)}>
          View
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 text-xs">
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Manual PnL</div>
          <div className={cn("metric-tabular mt-1 break-words font-medium", colorForPnl(row.manualPnl))}>
            {formatPln(row.manualPnl)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Script PnL</div>
          <div className={cn("metric-tabular mt-1 break-words font-medium", colorForPnl(row.scriptPnl ?? 0))}>
            {formatMaybePln(row.scriptPnl)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Baseline</div>
          <div className={cn("metric-tabular mt-1 break-words font-medium", colorForPnl(row.baselinePnl))}>
            {formatPln(row.baselinePnl)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Manual MWh</div>
          <div className="metric-tabular mt-1 break-words font-medium">
            {formatMwh(row.manualImbalanceMwh)}
          </div>
        </div>
        <div className="col-span-2 min-w-0 rounded-md border border-border/50 bg-background/30 p-2">
          <div className="text-muted-foreground">Script MWh</div>
          <div className="metric-tabular mt-1 break-words font-medium">
            {formatMaybeMwh(row.scriptImbalanceMwh)}
          </div>
        </div>
      </div>
    </div>
  );
}

function TradeTape({ trades }: { trades: MarketTrade[] }) {
  const rdbTrades = trades.filter((trade) => trade.market === "RDB");

  return (
    <Card className="rounded-lg border-border/70 bg-card/80">
      <CardHeader>
        <CardTitle>Trade tape</CardTitle>
        <CardDescription>Accepted manual and script orders</CardDescription>
      </CardHeader>
      <CardContent>
        {rdbTrades.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No RDB trades yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {rdbTrades.slice(-8).map((trade) => (
              <div
                key={trade.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/30 p-3 text-sm"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-medium">
                    {trade.side.toUpperCase()} {formatMwh(trade.volumeMwh)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Period {trade.periodIndex + 1} | {trade.market} | {trade.actor}
                  </span>
                </div>
                <span className="metric-tabular">{formatPrice(trade.pricePlnMwh)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SimulationTicker() {
  const isRunning = useSimulationStore((state) => state.isRunning);
  const speed = useSimulationStore((state) => state.speed);
  const step = useSimulationStore((state) => state.step);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const intervalId = window.setInterval(() => {
      step();
    }, Math.max(250, 1400 / speed));

    return () => window.clearInterval(intervalId);
  }, [isRunning, speed, step]);

  return null;
}

function ActiveView() {
  const activeView = useSimulationStore((state) => state.activeView);

  switch (activeView) {
    case "contracts":
      return <ContractsView />;
    case "market":
      return <MarketView />;
    case "forecast":
      return <ForecastView />;
    case "duel":
      return <DuelView />;
    case "replay":
      return <ReplayView />;
    case "dashboard":
    default:
      return <DashboardView />;
  }
}

export function GridBalancingApp() {
  return (
    <TradingShell>
      <SimulationTicker />
      <HelpSheet />
      <AlertsSheet />
      <motion.div
        className="flex min-h-0 flex-1 flex-col"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <ActiveView />
      </motion.div>
    </TradingShell>
  );
}
