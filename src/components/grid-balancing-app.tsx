"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangleIcon,
  BellIcon,
  BotIcon,
  ChartCandlestickIcon,
  ChevronDownIcon,
  ChevronsLeftIcon,
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
  SettingsIcon,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CONTRACT_TEMPLATES } from "@/lib/domain/contracts";
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
import { buildKnownMarketTape, getScenarioSetupTrades } from "@/lib/domain/markets";
import { SCENARIOS } from "@/lib/domain/scenarios";
import { settleContractsForPeriod } from "@/lib/domain/contracts";
import { settlePortfolio } from "@/lib/domain/settlement";
import { runAutopilot } from "@/lib/domain/strategy";
import type { AppView } from "@/lib/store/simulation-store";
import { useSimulationStore } from "@/lib/store/simulation-store";
import type { MarketTrade, ScenarioId } from "@/lib/domain/types";
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
    <Card className={cn(dashboardPanelClass, "gap-0 py-0", className)}>
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
      <CardContent className={dashboardContentClass}>{children}</CardContent>
    </Card>
  );
}

function SmallSelectPill({ children }: { children: React.ReactNode }) {
  return (
    <button
      className="inline-flex h-7 items-center gap-2 rounded-md border border-[#2b4550] bg-[#0b171c] px-2.5 text-xs text-foreground"
      type="button"
    >
      {children}
      <ChevronDownIcon data-icon="inline-end" />
    </button>
  );
}

function StatusDivider() {
  return <div className="hidden h-8 w-px bg-[#2a414b] md:block" />;
}

function TopStatusBar() {
  const scenarioId = useSimulationStore((state) => state.scenarioId);
  const setScenario = useSimulationStore((state) => state.setScenario);
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
  const nextPeriod = scenario.periods[Math.min(currentPeriod + 1, scenario.periods.length - 1)];

  return (
    <header className="mx-2 mt-2 rounded-md border border-[#263f49] bg-[#0d1a20]/95 px-4 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="flex flex-wrap items-center gap-4 xl:flex-nowrap xl:gap-4">
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
              <span className="metric-tabular text-sm font-semibold">{period.label}</span>
              <Badge
                className={cn(
                  "h-5 border px-2 text-[11px]",
                  isClosed
                    ? "border-muted bg-muted/30 text-muted-foreground"
                    : isRunning
                      ? "border-primary/35 bg-primary/15 text-primary"
                      : "border-[var(--energy-warning)]/35 bg-[var(--energy-warning)]/10 text-[var(--energy-warning)]"
                )}
              >
                {isClosed ? "CLOSED" : isRunning ? "LIVE" : "PAUSED"}
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
            <span className="metric-tabular text-sm font-medium">
              {period.label} - {nextPeriod.label} (15 min)
            </span>
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
          <Button variant="ghost" size="icon-sm" aria-label="Notifications">
            <BellIcon data-icon="inline-start" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Help">
            <HelpCircleIcon data-icon="inline-start" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Settings">
            <SettingsIcon data-icon="inline-start" />
          </Button>
        </div>
      </div>
    </header>
  );
}

function TradingShell({ children }: { children: React.ReactNode }) {
  const activeView = useSimulationStore((state) => state.activeView);
  const setView = useSimulationStore((state) => state.setView);
  const scenario = useSimulationStore((state) => state.scenario);
  const currentPeriod = useSimulationStore((state) => state.currentPeriod);
  const speed = useSimulationStore((state) => state.speed);
  const statusMessage = useSimulationStore((state) => state.statusMessage);
  const isClosed = useSimulationStore((state) => state.isClosed);

  return (
    <div className="min-h-screen bg-[#071115] text-foreground xl:h-screen xl:overflow-hidden">
      <div className="flex min-h-screen flex-col lg:flex-row xl:h-screen">
        <aside className="flex border-b border-[#243b44] bg-[#081116]/98 lg:min-h-screen lg:w-[204px] lg:flex-col lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between gap-3 px-4 py-4 lg:flex-col lg:items-start lg:gap-5 lg:px-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center text-primary">
                <ZapIcon data-icon="inline-start" />
              </div>
              <div className="flex flex-col">
                <span className="text-base font-semibold leading-5">GridBalance</span>
                <span className="text-xs text-muted-foreground">Balancing Simulator</span>
              </div>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-2 pb-3 lg:flex-col lg:overflow-visible">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const selected = item.view === activeView;

              return (
                <Button
                  key={item.view}
                  variant="ghost"
                  className={cn(
                    "h-10 justify-start rounded-md border border-transparent px-3 text-sidebar-foreground",
                    selected &&
                      "border-[#273f48] bg-[#15232a] shadow-[inset_3px_0_0_var(--primary)]"
                  )}
                  onClick={() => setView(item.view)}
                >
                  <Icon data-icon="inline-start" />
                  {item.view === "replay" ? "Replay" : item.label}
                </Button>
              );
            })}
          </nav>
          <div className="mt-auto hidden flex-col gap-2 p-3 lg:flex">
            <div className="rounded-md border border-[#263f49] bg-[#0d1a20] p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Portfolio</span>
                <ChevronDownIcon data-icon="inline-end" />
              </div>
              <div className="mt-1 text-sm font-medium">Alpha Power</div>
            </div>
            <div className="rounded-md border border-[#263f49] bg-[#0d1a20] p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Currency</span>
                <ChevronDownIcon data-icon="inline-end" />
              </div>
              <div className="mt-1 text-sm font-medium">PLN</div>
            </div>
            <Button variant="outline" className="h-12 justify-between rounded-md">
              Collapse
              <ChevronsLeftIcon data-icon="inline-end" />
            </Button>
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col xl:h-screen">
          <TopStatusBar />
          <div className="min-h-0 flex-1 overflow-auto xl:overflow-hidden">{children}</div>
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

  return (
    <DashboardCard
      title="Intraday Order Ticket"
      action={
        <Badge className="h-5 border border-primary/30 bg-primary/10 px-2 text-[11px] text-primary">
          RDB/SIDC
        </Badge>
      }
      className="xl:h-[402px]"
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
            {[10, 25, 50, 100].map((volume) => (
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
          Price (PLN/MWh)
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
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md border border-[#2b4550] bg-[#0a1418] p-2">
            <span className="whitespace-nowrap text-[10px] text-muted-foreground">Best Bid (PLN/MWh)</span>
            <div className="metric-tabular text-lg font-semibold text-primary">
              {period.intradayBid.toFixed(2)}
            </div>
            <span className="text-[10px] text-muted-foreground">Volume (MWh)</span>
            <div className="metric-tabular text-xs">{period.liquidityMwh.toFixed(1)}</div>
          </div>
          <div className="rounded-md border border-[#2b4550] bg-[#0a1418] p-2">
            <span className="whitespace-nowrap text-[10px] text-muted-foreground">RDN Ref (PLN/MWh)</span>
            <div className="metric-tabular text-lg font-semibold">
              {period.rdnPrice.toFixed(2)}
            </div>
            <span className="text-[10px] text-muted-foreground">Volume (MWh)</span>
            <div className="metric-tabular text-xs">{Math.max(orderDraft.volumeMwh, 0).toFixed(1)}</div>
          </div>
          <div className="rounded-md border border-[#2b4550] bg-[#0a1418] p-2">
            <span className="whitespace-nowrap text-[10px] text-muted-foreground">Best Ask (PLN/MWh)</span>
            <div className="metric-tabular text-lg font-semibold text-[var(--energy-negative)]">
              {period.intradayAsk.toFixed(2)}
            </div>
            <span className="text-[10px] text-muted-foreground">Volume (MWh)</span>
            <div className="metric-tabular text-xs">{period.liquidityMwh.toFixed(1)}</div>
          </div>
        </div>
        <Button
          className="h-8 rounded-md bg-primary text-xs text-primary-foreground hover:bg-primary/90"
          disabled={!canTrade}
          onClick={placeOrder}
        >
          Place {orderDraft.side === "buy" ? "Buy" : "Sell"} Order
        </Button>
        <div className="grid grid-cols-3 gap-3 pt-1 text-xs">
          <div>
            <div className="text-muted-foreground">Available Capacity</div>
            <div className="metric-tabular text-sm">{formatMwh(period.liquidityMwh)}</div>
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
        <div className="truncate text-[10px] text-muted-foreground">
          {orderImpact.accepted
            ? `After order: ${formatSignedMwh(orderImpact.afterImbalanceMwh)} expected imbalance`
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
        className="absolute top-0 right-0 z-10 flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto border-l border-border bg-popover shadow-2xl"
        initial={{ x: 36 }}
        animate={{ x: 0 }}
        exit={{ x: 36 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4 p-4">
          <div className="flex flex-col gap-1">
            <h2 id="contract-drawer-title" className="text-base font-medium">
              Sign simulated contract
            </h2>
            <p className="text-sm text-muted-foreground">
            Contract templates are educational approximations of physical power positions.
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)}>
            <XIcon data-icon="inline-start" />
            <span className="sr-only">Close</span>
          </Button>
        </div>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {CONTRACT_TEMPLATES.map((template) => {
            const signed = contracts.some((contract) => contract.templateId === template.templateId);

            return (
              <Card key={template.templateId} className="rounded-lg">
                <CardHeader>
                  <CardTitle className="text-base">{template.name}</CardTitle>
                  <CardDescription>
                    {template.side.toUpperCase()} | {template.counterparty} |{" "}
                    {template.granularity}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">{template.rationale}</p>
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
                    {template.risk}
                  </div>
                  <Button
                    variant={signed ? "secondary" : "default"}
                    disabled={signed}
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
    <div className="flex flex-col gap-2 p-2 xl:h-full xl:min-h-0">
      <div className="grid gap-2 xl:h-[604px] xl:grid-cols-[484px_minmax(0,1fr)_438px]">
        <div className="flex min-h-0 flex-col gap-2">
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
                  <XAxis dataKey="label" interval={11} tickLine={false} axisLine={false} />
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
            action={<SmallSelectPill>PLN</SmallSelectPill>}
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
                    tickFormatter={(value) => `${Number(value) / 1000000}M`}
                    tickLine={false}
                    axisLine={false}
                    width={42}
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
        <div className="flex min-h-0 flex-col gap-2">
          <DashboardCard
            title="Forecast vs Actual (Generation/Load)"
            action={
              <div className="flex items-center gap-2">
                <SmallSelectPill>Today</SmallSelectPill>
                <SmallSelectPill>MWh</SmallSelectPill>
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
                  <XAxis dataKey="label" interval={15} tickLine={false} axisLine={false} />
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
            action={<Button variant="outline" size="sm" className="h-6 rounded-md text-xs">View all</Button>}
            className="xl:h-[280px]"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  {["Counterparty", "Product", "Delivery Period", "Volume (MWh)", "Price (PLN/MWh)", "Status", "MtM (PLN)"].map((head) => (
                    <TableHead key={head} className="h-7 px-1.5 text-[11px] text-muted-foreground">
                      {head}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.signedContracts.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell className="h-8 px-1.5 py-1 text-xs">{contract.counterparty}</TableCell>
                    <TableCell className="h-8 px-1.5 py-1 text-xs font-semibold">{contract.product}</TableCell>
                    <TableCell className="h-8 px-1.5 py-1 text-xs">{contract.deliveryPeriod}</TableCell>
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
                    <TableCell className={cn("metric-tabular h-8 px-1.5 py-1 text-xs", colorForPnl(contract.mtmPln))}>
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
                  <TableCell className={cn("metric-tabular h-8 px-1.5 py-1 text-xs", colorForPnl(signedTotals.mtmPln))}>
                    {formatPln(signedTotals.mtmPln)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </DashboardCard>
        </div>
        <div className="flex min-h-0 flex-col gap-2">
          <OrderTicket />
          <DashboardCard
            title="Risk & Alerts (Real-time)"
            action={<Button variant="outline" size="sm" className="h-6 rounded-md text-xs">View all</Button>}
            className="xl:h-[192px]"
          >
            <div className="flex flex-col gap-1">
              {metrics.riskAlerts.map((alert) => (
                <div key={alert.id} className="grid grid-cols-[16px_112px_minmax(0,1fr)_52px] items-center gap-2 rounded-sm px-1 py-0.5 text-[10px] hover:bg-muted/25">
                  <AlertTriangleIcon
                    className={cn(
                      "size-4",
                      alert.tone === "danger" && "text-[var(--energy-negative)]",
                      alert.tone === "warning" && "text-[var(--energy-warning)]",
                      alert.tone === "info" && "text-[var(--energy-cyan)]"
                    )}
                    data-icon="inline-start"
                  />
                  <span
                    className={cn(
                      "font-medium",
                      alert.tone === "danger" && "text-[var(--energy-negative)]",
                      alert.tone === "warning" && "text-[var(--energy-warning)]",
                      alert.tone === "info" && "text-[var(--energy-cyan)]"
                    )}
                  >
                    {alert.title}
                  </span>
                  <span className="truncate text-muted-foreground">{alert.description}</span>
                  <span className="metric-tabular text-right text-muted-foreground">{alert.timeLabel}</span>
                </div>
              ))}
            </div>
          </DashboardCard>
        </div>
      </div>
      <DashboardCard
        title="Human vs Algorithm PnL Comparison (MTD)"
        action={
          <div className="flex items-center gap-3">
            <SmallSelectPill>PLN</SmallSelectPill>
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
                <XAxis dataKey="label" interval={1} tickLine={false} axisLine={false} />
                <YAxis
                  tickFormatter={(value) => `${Number(value) / 1000000}M`}
                  tickLine={false}
                  axisLine={false}
                  width={36}
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
      <Card className="rounded-lg border-border/70 bg-card/80">
        <CardContent>
          <Table>
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
                      {contract.priceFormula.kind === "fixed"
                        ? formatPrice(contract.priceFormula.plnPerMwh)
                        : `Spot ${contract.priceFormula.premium >= 0 ? "+" : ""}${
                            contract.priceFormula.premium
                          }`}
                    </TableCell>
                    <TableCell>{contract.imbalanceResponsibility}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <ContractDrawer open={contractDrawerOpen} onOpenChange={setContractDrawerOpen} />
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
          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs"
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
              </div>
            ))}
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
          <ScrollArea className="h-[304px]">
            <Table>
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
                    <TableCell className="metric-tabular font-medium">{insight.label}</TableCell>
                    <TableCell>
                      <div className="font-medium">{insightCategoryLabel(insight.category)}</div>
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
        )}
      </CardContent>
    </Card>
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
    <Card className="rounded-lg border-border/70 bg-card/80">
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Net</TableHead>
                <TableHead>Imb. PnL</TableHead>
                <TableHead>RDB</TableHead>
                <TableHead>Decision</TableHead>
                <TableHead>Impact</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.map((candidate) => (
                <TableRow key={candidate.periodIndex}>
                  <TableCell className="metric-tabular font-medium">{candidate.label}</TableCell>
                  <TableCell className="metric-tabular">
                    {formatSignedMwh(candidate.expectedNetMwh)}
                  </TableCell>
                  <TableCell
                    className={cn("metric-tabular", colorForPnl(candidate.expectedImbalancePnl))}
                  >
                    {formatPln(candidate.expectedImbalancePnl)}
                  </TableCell>
                  <TableCell className="metric-tabular">
                    {formatPrice(
                      candidate.recommendation === "sell" ? candidate.rdbBid : candidate.rdbAsk
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={candidate.recommendation === "hold" ? "outline" : "secondary"}
                      className={cn(
                        "h-5 rounded-md px-2 text-[11px]",
                        candidate.recommendation === "buy" && "text-primary",
                        candidate.recommendation === "sell" && "text-[var(--energy-warning)]"
                      )}
                    >
                      {recommendationLabel(candidate)}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={cn("metric-tabular", colorForPnl(candidate.expectedPnlImpact))}
                  >
                    {formatPln(candidate.expectedPnlImpact)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!candidate.orderDraft}
                      onClick={() => loadCandidate(candidate)}
                    >
                      Load
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
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
    <div className="grid flex-1 gap-4 p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="rounded-lg border-border/70 bg-card/80">
        <CardHeader>
          <CardTitle>Intraday market board</CardTitle>
          <CardDescription>Locked RDN reference plus RDB/SIDC executable liquidity</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
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

function ForecastView() {
  const scenario = useSimulationStore((state) => state.scenario);
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

  return (
    <div className="grid flex-1 gap-4 p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-4">
        <Card className="rounded-lg border-border/70 bg-card/80">
          <CardHeader>
            <CardTitle>Weather-driven OZE and load forecast</CardTitle>
            <CardDescription>PV follows irradiance and cloud cover; load follows time and temperature</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 1, height: 1 }}>
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
                  <Line dataKey="forecastGeneration" name="Forecast OZE" stroke="var(--energy-cyan)" dot={false} />
                  <Line dataKey="actualGeneration" name="Actual OZE" stroke="var(--energy-positive)" dot={false} strokeWidth={2} />
                  <Line dataKey="forecastLoad" name="Forecast load" stroke="var(--energy-amber)" dot={false} />
                  <Line dataKey="actualLoad" name="Actual load" stroke="var(--energy-negative)" dot={false} strokeWidth={2} />
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
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 1, height: 1 }}>
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
                  <Area dataKey="irradiance" name="Irradiance index" stroke="var(--energy-warning)" fill="var(--energy-warning)" fillOpacity={0.18} />
                  <Area dataKey="wind" name="Wind m/s" stroke="var(--energy-cyan)" fill="var(--energy-cyan)" fillOpacity={0.12} />
                  <Area dataKey="temperature" name="Temp C" stroke="var(--energy-negative)" fill="var(--energy-negative)" fillOpacity={0.1} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card className="rounded-lg border-border/70 bg-card/80">
        <CardHeader>
          <CardTitle>Forecast rulebook</CardTitle>
          <CardDescription>What v1 intentionally models</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>PV production changes with irradiance and cloud cover, then actual metering applies a scenario-specific forecast error.</p>
          <p>Wind follows a smooth speed curve with sudden ramp shocks in selected scenarios.</p>
          <p>Load rises in morning and evening peaks, with winter temperature sensitivity.</p>
          <p>Prices react to scarcity, OZE surplus, evening peaks, outage shocks and intraday liquidity.</p>
        </CardContent>
      </Card>
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
          <CardContent>
            <Table>
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

function ReplayView() {
  const scenario = useSimulationStore((state) => state.scenario);
  const contracts = useSimulationStore((state) => state.contracts);
  const trades = useSimulationStore((state) => state.trades);
  const currentPeriod = useSimulationStore((state) => state.currentPeriod);
  const setSelectedPeriod = useSimulationStore((state) => state.setSelectedPeriod);
  const settlement = useMemo(
    () => settlePortfolio(scenario.periods, contracts, trades),
    [scenario.periods, contracts, trades]
  );
  const replayRows = settlement.periods.slice(0, Math.max(currentPeriod + 1, 16));

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <Card className="rounded-lg border-border/70 bg-card/80">
        <CardHeader>
          <CardTitle>Results replay</CardTitle>
          <CardDescription>Audit each settlement period and spot where PnL leaked</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[620px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Contracted</TableHead>
                  <TableHead>RDB net</TableHead>
                  <TableHead>Imbalance</TableHead>
                  <TableHead>Imbalance price</TableHead>
                  <TableHead>Contract PnL</TableHead>
                  <TableHead>Market PnL</TableHead>
                  <TableHead>Total PnL</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {replayRows.map((row) => (
                  <TableRow key={row.periodIndex}>
                    <TableCell className="metric-tabular font-medium">{row.label}</TableCell>
                    <TableCell className="metric-tabular">
                      {formatMwh(row.contractedPosition)}
                    </TableCell>
                    <TableCell className="metric-tabular">{formatMwh(row.marketPosition)}</TableCell>
                    <TableCell className="metric-tabular">{formatMwh(row.imbalanceMwh)}</TableCell>
                    <TableCell className="metric-tabular">{formatPrice(row.imbalancePrice)}</TableCell>
                    <TableCell className={cn("metric-tabular", colorForPnl(row.contractPnl))}>
                      {formatPln(row.contractPnl)}
                    </TableCell>
                    <TableCell className={cn("metric-tabular", colorForPnl(row.marketPnl))}>
                      {formatPln(row.marketPnl)}
                    </TableCell>
                    <TableCell className={cn("metric-tabular font-medium", colorForPnl(row.periodPnl))}>
                      {formatPln(row.periodPnl)}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedPeriod(row.periodIndex)}>
                        Inspect
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
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
