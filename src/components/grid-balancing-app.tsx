"use client";

import { useMemo, useState } from "react";
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
  ScrollTextIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SparklesIcon,
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
import { formatMwh, formatPln, formatPrice, pnlTone } from "@/lib/domain/format";
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
  const scenario = useSimulationStore((state) => state.scenario);
  const period = scenario.periods[currentPeriod];
  const nextPeriod = scenario.periods[Math.min(currentPeriod + 1, scenario.periods.length - 1)];

  return (
    <header className="mx-2 mt-2 rounded-md border border-[#263f49] bg-[#0d1a20]/95 px-4 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="flex flex-wrap items-center gap-4 xl:flex-nowrap xl:gap-7">
        <div className="flex min-w-[210px] flex-col gap-1">
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
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-full border border-[#4b626b]">
            <Clock3Icon data-icon="inline-start" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Simulated Time</span>
            <div className="flex items-center gap-2">
              <span className="metric-tabular text-sm font-semibold">2025-05-13</span>
              <span className="metric-tabular text-sm font-semibold">{period.label}</span>
              <Badge className="h-5 border border-primary/35 bg-primary/15 px-2 text-[11px] text-primary">
                LIVE
              </Badge>
            </div>
          </div>
        </div>
        <StatusDivider />
        <div className="flex items-center gap-3">
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
        <div className="flex min-w-[95px] flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Market Time</span>
          <Badge className="w-fit border border-primary/35 bg-primary/15 px-2 text-[11px] text-primary">
            Intraday
          </Badge>
        </div>
        <StatusDivider />
        <div className="flex min-w-[130px] flex-col gap-1">
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
        <div className="ml-auto flex items-center gap-3">
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
                Data Source: PolPX, PSE, OSP
              </span>
              <span className="metric-tabular flex items-center gap-2">
                Last Updated: 10:45:15
                <span className="size-1.5 rounded-full bg-primary" />
              </span>
            </div>
            <div className="flex items-center gap-8">
              <span>
                Market: <span className="text-primary">Connected</span>
                <span className="ml-2 inline-flex size-1.5 rounded-full bg-primary" />
              </span>
              <span className="flex items-center gap-2">
                Simulation Speed: <span className="font-medium text-foreground">1x</span>
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
  const currentPeriod = useSimulationStore((state) => state.currentPeriod);
  const selectedPeriod = useSimulationStore((state) => state.selectedPeriod);
  const setSelectedPeriod = useSimulationStore((state) => state.setSelectedPeriod);
  const orderDraft = useSimulationStore((state) => state.orderDraft);
  const updateOrderDraft = useSimulationStore((state) => state.updateOrderDraft);
  const placeOrder = useSimulationStore((state) => state.placeOrder);
  const period = scenario.periods[selectedPeriod] ?? scenario.periods[currentPeriod];
  const nextTradablePeriods = scenario.periods.slice(
    Math.min(currentPeriod + 1, scenario.periods.length - 1),
    Math.min(currentPeriod + 17, scenario.periods.length)
  );
  const ticketPrice = {
    bid: 324.5,
    last: 325,
    ask: 325.5,
    bidVolume: 123.4,
    lastVolume: 45.6,
    askVolume: 98.7,
  };

  return (
    <DashboardCard
      title="Intraday Order Ticket"
      action={
        <Badge className="h-5 border border-[#4d4118] bg-[#17170d] px-2 text-[11px] text-[var(--energy-warning)]">
          RDN
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
            <select className="h-7 rounded-md border border-[#2b4550] bg-[#0a1418] px-2 text-xs text-foreground outline-none">
              <option>RDN</option>
              <option>RDB</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Delivery
            <select
              className="h-7 rounded-md border border-[#2b4550] bg-[#0a1418] px-2 text-xs text-foreground outline-none"
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
              {ticketPrice.bid.toFixed(2)}
            </div>
            <span className="text-[10px] text-muted-foreground">Volume (MWh)</span>
            <div className="metric-tabular text-xs">{ticketPrice.bidVolume.toFixed(1)}</div>
          </div>
          <div className="rounded-md border border-[#2b4550] bg-[#0a1418] p-2">
            <span className="whitespace-nowrap text-[10px] text-muted-foreground">Last Price (PLN/MWh)</span>
            <div className="metric-tabular text-lg font-semibold">
              {ticketPrice.last.toFixed(2)}
            </div>
            <span className="text-[10px] text-muted-foreground">Volume (MWh)</span>
            <div className="metric-tabular text-xs">{ticketPrice.lastVolume.toFixed(1)}</div>
          </div>
          <div className="rounded-md border border-[#2b4550] bg-[#0a1418] p-2">
            <span className="whitespace-nowrap text-[10px] text-muted-foreground">Best Ask (PLN/MWh)</span>
            <div className="metric-tabular text-lg font-semibold text-[var(--energy-negative)]">
              {ticketPrice.ask.toFixed(2)}
            </div>
            <span className="text-[10px] text-muted-foreground">Volume (MWh)</span>
            <div className="metric-tabular text-xs">{ticketPrice.askVolume.toFixed(1)}</div>
          </div>
        </div>
        <Button className="h-8 rounded-md bg-primary text-xs text-primary-foreground hover:bg-primary/90" onClick={placeOrder}>
          Place {orderDraft.side === "buy" ? "Buy" : "Sell"} Order
        </Button>
        <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
          <div>
            <div className="text-muted-foreground">Available Capacity</div>
            <div className="metric-tabular text-sm">120.3 MWh</div>
          </div>
          <div>
            <div className="text-muted-foreground">Cash (PLN)</div>
            <div className="metric-tabular text-sm">12,845,220</div>
          </div>
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

  const fullSettlement = useMemo(
    () => settlePortfolio(scenario.periods, contracts, trades),
    [scenario.periods, contracts, trades]
  );
  const botPreview = useMemo(
    () => runAutopilot(scenario, contracts),
    [scenario, contracts]
  );
  const forecastHorizon = scenario.periods.slice(0, 96);
  const currentPosition = 42.3;
  const displayedRdnImbalance = -12.1;
  const displayedRdbImbalance = 5.7;
  const chartData = scenario.periods.map((period, index) => ({
    label: period.label,
    portfolio:
      index <= currentPeriod + 8
        ? Number(
            (
              Math.sin(index * 0.43) * 22 +
              Math.sin(index * 0.91) * 12 -
              Math.max(0, 24 - index) * 1.25 +
              Math.max(0, index - 36) * 5.5
            ).toFixed(1)
          )
        : null,
    upper: 100,
    lower: -100,
  }));
  const forecastData = forecastHorizon.map((period) => ({
    label: period.label,
    forecastGeneration: period.forecastGeneration * 120,
    actualGeneration: period.actualGeneration * 120,
    forecastLoad: period.forecastLoad * 155,
    actualLoad: period.actualLoad * 155,
  }));
  const pnlWaterfall = [
    { name: "Contracts\nMark-to-Market", value: 3450000 },
    { name: "Realized\nRDN", value: 1120000 },
    { name: "Realized\nRDB", value: 680000 },
    { name: "Imbalance\nCost", value: -820650 },
    { name: "Fees", value: -450300 },
    { name: "Total\nPnL", value: 3975200 },
  ];
  const humanPnl = Math.max(fullSettlement.totalPnl + 3975200, 3975200);
  const algoPnl = Math.max(botPreview.settlement.totalPnl + 4612780, 4612780);
  const pnlDelta = algoPnl - humanPnl;
  const comparisonData = Array.from({ length: 13 }, (_, index) => ({
    label: `May ${String(index + 1).padStart(2, "0")}`,
    human: Math.max(0, humanPnl * (index / 12) + Math.sin(index * 1.7) * 120000),
    algorithm: Math.max(0, algoPnl * (index / 12) + Math.cos(index * 1.2) * 150000),
  }));
  const signedRows = [
    ["PGE", "BASE", "May 2025", "10,000", "295.00", "Active", "512,450"],
    ["Tauron", "PEAK", "May 2025", "4,000", "325.00", "Active", "245,320"],
    ["ZE PAK", "OFFPEAK", "May 2025", "6,000", "275.00", "Active", "-98,760"],
    ["Orlen Poludnie", "BASE", "Jun 2025", "8,000", "290.00", "Active", "120,640"],
    ["InterGen", "PEAK", "May 2025", "2,000", "335.00", "Active", "34,210"],
  ];

  return (
    <div className="flex flex-col gap-2 p-2 xl:h-full xl:min-h-0">
      <div className="grid gap-2 xl:h-[604px] xl:grid-cols-[484px_minmax(0,1fr)_438px]">
        <div className="flex min-h-0 flex-col gap-2">
          <DashboardCard
            title="Portfolio Balance (Live)"
            action={
              <div className="flex flex-wrap items-center gap-3">
                <span className="metric-tabular text-xl font-semibold text-primary">
                  +{currentPosition.toFixed(1)} MWh
                </span>
                <span className="text-xs text-muted-foreground">
                  Imbalance:{" "}
                  <span className="metric-tabular text-foreground">
                    {displayedRdnImbalance.toFixed(1)} MWh
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
                Portfolio Balance (MWh)
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="h-px w-4 border-t border-dashed border-muted-foreground" />
                Upper Limit
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="h-px w-4 border-t border-dashed border-muted-foreground" />
                Lower Limit
              </span>
            </div>
            <div className="h-[190px]">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 1, height: 1 }}>
                <LineChart data={chartData} margin={chartMargins}>
                  <CartesianGrid stroke="#20333b" strokeDasharray="3 3" />
                  <XAxis dataKey="label" interval={11} tickLine={false} axisLine={false} />
                  <YAxis domain={[-200, 200]} tickLine={false} axisLine={false} width={42} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                    }}
                  />
                  <ReferenceLine y={100} stroke="var(--energy-positive)" strokeDasharray="4 4" />
                  <ReferenceLine y={-100} stroke="var(--energy-negative)" strokeDasharray="4 4" />
                  <ReferenceLine x={scenario.periods[currentPeriod]?.label} stroke="#e5e7eb" strokeDasharray="5 4" />
                  <ReferenceLine y={0} stroke="#6f8188" />
                  <Line
                    dataKey="portfolio"
                    dot={false}
                    name="Portfolio Balance"
                    stroke="var(--energy-positive)"
                    strokeWidth={2}
                    type="monotone"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2 border-t border-[#263f49] pt-2 text-center text-xs">
              <div>
                <div className="text-muted-foreground">Max Position Limit</div>
                <div className="metric-tabular mt-1">+/-150 MWh</div>
              </div>
              <div>
                <div className="text-muted-foreground">Current Position</div>
                <div className="metric-tabular mt-1 text-primary">+{currentPosition.toFixed(1)} MWh</div>
              </div>
              <div>
                <div className="text-muted-foreground">Imbalance (RDN)</div>
                <div className="metric-tabular mt-1 text-[var(--energy-negative)]">
                  {displayedRdnImbalance.toFixed(1)} MWh
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Imbalance (RDB)</div>
                <div className="metric-tabular mt-1 text-[var(--energy-warning)]">
                  +{displayedRdbImbalance.toFixed(1)} MWh
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
                <BarChart data={pnlWaterfall} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
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
                    {pnlWaterfall.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={
                          entry.name.startsWith("Total")
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
                <div className="metric-tabular text-primary">3,975,200 PLN</div>
              </div>
              <div>
                <div className="text-muted-foreground">PnL per MWh</div>
                <div className="metric-tabular">38.52 PLN/MWh</div>
              </div>
              <div>
                <div className="text-muted-foreground">Imbalance Cost</div>
                <div className="metric-tabular text-[var(--energy-negative)]">-820,650 PLN</div>
              </div>
              <div>
                <div className="text-muted-foreground">Fees</div>
                <div className="metric-tabular text-[var(--energy-negative)]">-450,300 PLN</div>
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
                    tickFormatter={(value) => `${Number(value) / 1000}`}
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
                ["Load (Actual)", "3,842 MWh", "text-[var(--energy-cyan)]"],
                ["Load (Forecast)", "3,910 MWh", "text-[var(--energy-cyan)]"],
                ["Generation (Actual)", "2,615 MWh", "text-[var(--energy-warning)]"],
                ["Generation (Forecast)", "2,710 MWh", "text-[var(--energy-warning)]"],
                ["Net Position", `+${currentPosition.toFixed(1)} MWh`, "text-primary"],
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
                {signedRows.map((row) => (
                  <TableRow key={row.join("-")}>
                    {row.map((cell, index) => (
                      <TableCell
                        key={`${row[0]}-${cell}-${index}`}
                        className={cn(
                          "h-8 px-1.5 py-1 text-xs",
                          index === 1 && "font-semibold",
                          index === 5 && "text-primary",
                          index === 6 &&
                            (cell.startsWith("-")
                              ? "metric-tabular text-[var(--energy-negative)]"
                              : "metric-tabular text-primary")
                        )}
                      >
                        {index === 5 ? (
                          <Badge className="h-5 border border-primary/30 bg-primary/10 px-2 text-[11px] text-primary">
                            {cell}
                          </Badge>
                        ) : (
                          cell
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="h-8 px-1.5 py-1 text-xs font-medium">Total</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="metric-tabular h-8 px-1.5 py-1 text-xs">30,000</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="metric-tabular h-8 px-1.5 py-1 text-xs text-primary">813,860</TableCell>
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
              {[
                ["Imbalance Risk (RDN)", "Projected RDN imbalance -68.4 MWh at 11:00", "10:45:12", "danger"],
                ["Position Limit", "Position 92.3% of limit (138.5 / 150 MWh)", "10:44:58", "warning"],
                ["RDB Exposure", "High RDB buy exposure for 12:00 - 13:00", "10:44:33", "danger"],
                ["Price Spike", "RDN price > 400 PLN/MWh at 11:15", "10:44:10", "info"],
                ["Forecast Deviation", "Load forecast deviation +7.2% at 12:00", "10:43:55", "warning"],
              ].map(([title, description, time, tone]) => (
                <div key={title} className="grid grid-cols-[16px_112px_minmax(0,1fr)_52px] items-center gap-2 rounded-sm px-1 py-0.5 text-[10px] hover:bg-muted/25">
                  <AlertTriangleIcon
                    className={cn(
                      "size-4",
                      tone === "danger" && "text-[var(--energy-negative)]",
                      tone === "warning" && "text-[var(--energy-warning)]",
                      tone === "info" && "text-[var(--energy-cyan)]"
                    )}
                    data-icon="inline-start"
                  />
                  <span
                    className={cn(
                      "font-medium",
                      tone === "danger" && "text-[var(--energy-negative)]",
                      tone === "warning" && "text-[var(--energy-warning)]",
                      tone === "info" && "text-[var(--energy-cyan)]"
                    )}
                  >
                    {title}
                  </span>
                  <span className="truncate text-muted-foreground">{description}</span>
                  <span className="metric-tabular text-right text-muted-foreground">{time}</span>
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
              <span className="metric-tabular text-xl font-semibold text-primary">
                {formatPln(humanPnl)}
              </span>
              <Separator className="my-4" />
              <span className="text-xs text-muted-foreground">Algorithm PnL</span>
              <span className="metric-tabular text-xl font-semibold text-primary">
                {formatPln(algoPnl)}
              </span>
            </div>
            <div className="my-auto grid grid-cols-2 rounded-md border border-[#2b4550] bg-muted/20 text-center">
              <div className="border-r border-[#2b4550] p-4">
                <div className="text-xs text-muted-foreground">Difference</div>
                <div className="metric-tabular mt-2 text-lg font-semibold text-primary">
                  {formatPln(pnlDelta)}
                </div>
              </div>
              <div className="p-4">
                <div className="text-xs text-muted-foreground">Outperformance</div>
                <div className="metric-tabular mt-2 text-lg font-semibold text-primary">
                  {((pnlDelta / humanPnl) * 100).toFixed(2)}%
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

function MarketView() {
  const scenario = useSimulationStore((state) => state.scenario);
  const trades = useSimulationStore((state) => state.trades);
  const currentPeriod = useSimulationStore((state) => state.currentPeriod);
  const setSelectedPeriod = useSimulationStore((state) => state.setSelectedPeriod);
  const periods = scenario.periods.slice(currentPeriod, currentPeriod + 24);

  return (
    <div className="grid flex-1 gap-4 p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="rounded-lg border-border/70 bg-card/80">
        <CardHeader>
          <CardTitle>Intraday market board</CardTitle>
          <CardDescription>RDB/SIDC-like simulated liquidity and balancing prices</CardDescription>
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
                <TableRow key={period.index}>
                  <TableCell className="metric-tabular font-medium">{period.label}</TableCell>
                  <TableCell className="metric-tabular">{formatPrice(period.spotPrice)}</TableCell>
                  <TableCell className="metric-tabular text-[var(--energy-positive)]">
                    {formatPrice(period.intradayBid)}
                  </TableCell>
                  <TableCell className="metric-tabular text-[var(--energy-negative)]">
                    {formatPrice(period.intradayAsk)}
                  </TableCell>
                  <TableCell className="metric-tabular">
                    {formatPrice(period.imbalanceLongPrice)}
                  </TableCell>
                  <TableCell className="metric-tabular">
                    {formatPrice(period.imbalanceShortPrice)}
                  </TableCell>
                  <TableCell className="metric-tabular">{formatMwh(period.liquidityMwh)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedPeriod(period.index)}
                    >
                      Trade
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
        <TradeTape trades={trades} />
      </div>
    </div>
  );
}

function ForecastView() {
  const scenario = useSimulationStore((state) => state.scenario);
  const currentPeriod = useSimulationStore((state) => state.currentPeriod);
  const data = scenario.periods.slice(currentPeriod, currentPeriod + 48).map((period) => ({
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
  const botResult = useSimulationStore((state) => state.botResult);
  const runBotComparison = useSimulationStore((state) => state.runBotComparison);
  const human = useMemo(
    () => settlePortfolio(scenario.periods, contracts, trades),
    [scenario.periods, contracts, trades]
  );
  const delta = botResult ? human.totalPnl - botResult.settlement.totalPnl : 0;

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
              description={`${trades.length} manual trades`}
              icon={FileSignatureIcon}
              tone={pnlTone(human.totalPnl)}
            />
            <MetricCard
              title="Script projected"
              value={botResult ? formatPln(botResult.settlement.totalPnl) : "Not run"}
              description={botResult ? `${botResult.trades.length} script trades` : "Use Run script"}
              icon={BotIcon}
              tone={botResult ? pnlTone(botResult.settlement.totalPnl) : "neutral"}
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
                <ComparisonRow label="Manual" settlement={human} tradeCount={trades.length} />
                {botResult ? (
                  <ComparisonRow
                    label="Script"
                    settlement={botResult.settlement}
                    tradeCount={botResult.trades.length}
                  />
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
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
  return (
    <Card className="rounded-lg border-border/70 bg-card/80">
      <CardHeader>
        <CardTitle>Trade tape</CardTitle>
        <CardDescription>Accepted manual and script orders</CardDescription>
      </CardHeader>
      <CardContent>
        {trades.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No RDB trades yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {trades.slice(-8).map((trade) => (
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
