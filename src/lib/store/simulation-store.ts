"use client";

import { create } from "zustand";

import { CONTRACT_TEMPLATES, createContractFromTemplate, createDefaultContracts } from "../domain/contracts";
import {
  buildDecisionLogEntry,
  buildOrderImpactPreview,
  type DecisionLogEntry,
} from "../domain/decisions";
import { buildDayAheadAuctionTrades, getScenarioSetupTrades } from "../domain/markets";
import { getTradablePeriods } from "../domain/metrics";
import { getPortfolioDefinition, parsePortfolioId } from "../domain/portfolios";
import { createDefaultScenarioConfig, createScenario } from "../domain/scenarios";
import { runAutopilot, type StrategyRunResult } from "../domain/strategy";
import {
  scenarioConfigSchema,
  type Contract,
  type GameMode,
  type MarketTrade,
  type OrderDraft,
  type PortfolioDefinition,
  type PortfolioId,
  type Scenario,
  type ScenarioConfig,
  type ScenarioId,
  type SimulationClockState,
} from "../domain/types";

export type AppView = "dashboard" | "contracts" | "market" | "forecast" | "duel" | "replay";

interface SimulationStore {
  activeView: AppView;
  portfolioId: PortfolioId;
  portfolio: PortfolioDefinition;
  scenarioId: ScenarioId;
  scenario: Scenario;
  scenarioConfig: ScenarioConfig;
  scenarioConfigDraft: ScenarioConfig;
  mode: GameMode;
  currentPeriod: number;
  isRunning: boolean;
  speed: number;
  isClosed: boolean;
  selectedPeriod: number;
  contracts: Contract[];
  trades: MarketTrade[];
  decisionLog: DecisionLogEntry[];
  orderDraft: OrderDraft;
  statusMessage: string;
  botResult?: StrategyRunResult;
  setView: (view: AppView) => void;
  setPortfolio: (portfolioId: string) => void;
  setScenario: (scenarioId: ScenarioId) => void;
  setMode: (mode: GameMode) => void;
  setSelectedPeriod: (periodIndex: number) => void;
  updateScenarioConfigDraft: (draft: Partial<ScenarioConfig>) => void;
  applyScenarioConfig: () => void;
  resetScenarioConfig: () => void;
  updateOrderDraft: (draft: Partial<OrderDraft>) => void;
  play: () => void;
  pause: () => void;
  toggleRun: () => void;
  setSpeed: (speed: number) => void;
  placeOrder: () => void;
  signContract: (templateId: string) => void;
  step: () => void;
  runToEnd: () => void;
  resetScenario: () => void;
  reset: () => void;
  runBotComparison: () => void;
}

function buildInitialOrderDraft(scenario: Scenario, periodIndex: number): OrderDraft {
  const period = scenario.periods[periodIndex] ?? scenario.periods[0];
  const volumeMwh = Math.min(25, Math.max(1, Math.floor(period.liquidityMwh)));

  return {
    side: "buy",
    market: "RDB",
    periodIndex,
    volumeMwh,
    limitPrice: Math.ceil(period.intradayAsk + 8),
  };
}

function buildInitialClock(): SimulationClockState {
  return {
    currentPeriod: 43,
    isRunning: false,
    speed: 1,
    isClosed: false,
  };
}

function buildInitialState(
  scenarioId: ScenarioId = "sunny-negative",
  scenarioConfig?: ScenarioConfig,
  portfolioId: PortfolioId = "alpha-power"
) {
  const scenario = createScenario(scenarioId, scenarioConfig);
  const portfolio = getPortfolioDefinition(portfolioId);
  const resolvedScenarioConfig = scenario.metadata.config;
  const clock = buildInitialClock();
  const tradablePeriod = getTradablePeriods(scenario, clock.currentPeriod)[0] ?? scenario.periods.at(-1);
  const selectedPeriod = tradablePeriod?.index ?? clock.currentPeriod;
  const contracts = createDefaultContracts(portfolio.defaultContractTemplateIds);

  return {
    portfolioId: portfolio.id,
    portfolio,
    scenarioId,
    scenario,
    scenarioConfig: resolvedScenarioConfig,
    scenarioConfigDraft: resolvedScenarioConfig,
    mode: "manual" as GameMode,
    ...clock,
    selectedPeriod,
    contracts,
    trades: buildDayAheadAuctionTrades(scenario, contracts),
    decisionLog: [],
    orderDraft: buildInitialOrderDraft(scenario, selectedPeriod),
    statusMessage: "Trading day opened. D-1 RDN setup is locked; RDB/SIDC is available.",
    botResult: undefined,
  };
}

export const useSimulationStore = create<SimulationStore>((set, get) => ({
  activeView: "dashboard",
  ...buildInitialState(),
  setView: (view) =>
    set((state) => ({
      activeView: view,
      mode: view === "replay" ? "replay" : state.mode === "replay" ? "manual" : state.mode,
    })),
  setPortfolio: (portfolioId) => {
    const state = get();
    const parsedPortfolioId = parsePortfolioId(portfolioId);

    if (!parsedPortfolioId) {
      set({ statusMessage: `Unknown portfolio id: ${portfolioId}. Portfolio was not changed.` });
      return;
    }

    const activeView = state.activeView;
    const initialState = buildInitialState(
      state.scenarioId,
      state.scenarioConfig,
      parsedPortfolioId
    );

    set({
      ...initialState,
      scenarioConfigDraft: state.scenarioConfigDraft,
      activeView,
      mode: activeView === "replay" ? "replay" : "manual",
      statusMessage: `Portfolio switched to ${initialState.portfolio.name}. RDN setup and contracts were rebuilt.`,
    });
  },
  setScenario: (scenarioId) => {
    const state = get();
    const activeView = state.activeView;
    const initialState = buildInitialState(scenarioId, undefined, state.portfolioId);

    set({
      ...initialState,
      activeView,
      mode: activeView === "replay" ? "replay" : "manual",
      statusMessage: `Scenario switched to ${initialState.scenario.definition.name}.`,
    });
  },
  setMode: (mode) =>
    set((state) => ({
      mode,
      activeView:
        mode === "replay" ? "replay" : state.activeView === "replay" ? "dashboard" : state.activeView,
    })),
  setSelectedPeriod: (periodIndex) =>
    set((state) => ({
      selectedPeriod: periodIndex,
      orderDraft: {
        ...state.orderDraft,
        periodIndex,
        limitPrice:
          state.orderDraft.side === "buy"
            ? (state.scenario.periods[periodIndex]?.intradayAsk ?? state.orderDraft.limitPrice) + 8
            : (state.scenario.periods[periodIndex]?.intradayBid ?? state.orderDraft.limitPrice) - 8,
      },
    })),
  updateScenarioConfigDraft: (draft) =>
    set((state) => {
      const parsed = scenarioConfigSchema.safeParse({
        ...state.scenarioConfigDraft,
        ...draft,
      });

      if (!parsed.success) {
        return {
          statusMessage: "Scenario editor value is outside the supported calibration range.",
        };
      }

      return {
        scenarioConfigDraft: parsed.data,
        statusMessage: "Scenario editor draft updated. Apply to rebuild the trading day.",
      };
    }),
  applyScenarioConfig: () => {
    const state = get();
    const activeView = state.activeView;
    const initialState = buildInitialState(
      state.scenarioId,
      state.scenarioConfigDraft,
      state.portfolioId
    );

    set({
      ...initialState,
      activeView,
      mode: activeView === "replay" ? "replay" : "manual",
      statusMessage: `Scenario reset with seed ${initialState.scenario.metadata.seed}. Calibration preview is now live.`,
    });
  },
  resetScenarioConfig: () => {
    const state = get();
    const activeView = state.activeView;
    const defaultConfig = createDefaultScenarioConfig(state.scenarioId);
    const initialState = buildInitialState(state.scenarioId, defaultConfig, state.portfolioId);

    set({
      ...initialState,
      activeView,
      mode: activeView === "replay" ? "replay" : "manual",
      statusMessage: `Scenario config reset to ${initialState.scenario.definition.shortName} defaults.`,
    });
  },
  updateOrderDraft: (draft) =>
    set((state) => ({
      orderDraft: {
        ...state.orderDraft,
        ...draft,
      },
    })),
  play: () =>
    set((state) => ({
      isRunning: !state.isClosed,
      statusMessage: state.isClosed
        ? "Trading day is closed. Reset the scenario to run it again."
        : "Simulation clock is running.",
    })),
  pause: () =>
    set({
      isRunning: false,
      statusMessage: "Simulation clock paused.",
    }),
  toggleRun: () => {
    const state = get();

    if (state.isRunning) {
      state.pause();
      return;
    }

    state.play();
  },
  setSpeed: (speed) =>
    set({
      speed: Math.min(Math.max(speed, 0.5), 8),
      statusMessage: `Simulation speed set to ${speed}x.`,
    }),
  placeOrder: () => {
    const state = get();
    const period = state.scenario.periods[state.orderDraft.periodIndex];

    if (state.isClosed) {
      set({ statusMessage: "Trading day is closed. Reset the scenario before trading again." });
      return;
    }

    if (!period) {
      set({ statusMessage: "Selected delivery period is not available." });
      return;
    }

    const preview = buildOrderImpactPreview(
      state.scenario,
      state.contracts,
      state.trades,
      state.currentPeriod,
      state.orderDraft
    );
    const decisionLogEntry = buildDecisionLogEntry(
      preview,
      state.scenario.periods[state.currentPeriod]?.label ?? "00:00",
      state.decisionLog.length
    );

    if (!preview.trade) {
      set({
        decisionLog: [decisionLogEntry, ...state.decisionLog],
        statusMessage: preview.reason,
      });
      return;
    }

    set({
      trades: [...state.trades, preview.trade],
      decisionLog: [decisionLogEntry, ...state.decisionLog],
      statusMessage: `${preview.trade.side.toUpperCase()} ${preview.trade.volumeMwh.toFixed(
        1
      )} MWh for ${period.label} matched at ${preview.trade.pricePlnMwh.toFixed(
        0
      )} ${state.scenario.metadata.currency}/MWh. ${decisionLogEntry.title}: ${preview.pnlImpact.toFixed(
        0
      )} ${state.scenario.metadata.currency}, risk cut ${Math.max(preview.imbalanceReductionMwh, 0).toFixed(1)} MWh.`,
      botResult: undefined,
    });
  },
  signContract: (templateId) => {
    const state = get();
    const alreadySigned = state.contracts.some((contract) => contract.templateId === templateId);
    const template = CONTRACT_TEMPLATES.find((candidate) => candidate.templateId === templateId);

    if (!template) {
      set({ statusMessage: "Unknown contract template." });
      return;
    }

    if (alreadySigned) {
      set({ statusMessage: `${template.name} is already in the book.` });
      return;
    }

    set({
      contracts: [
        ...state.contracts,
        createContractFromTemplate(templateId, `manual-${state.contracts.length + 1}`),
      ],
      statusMessage: `${template.name} signed. Recalculate your open imbalance before gate closure.`,
      botResult: undefined,
    });
  },
  step: () =>
    set((state) => {
      if (state.isClosed) {
        return {
          isRunning: false,
          statusMessage: "Trading day is already closed.",
        };
      }

      const nextPeriod = Math.min(state.currentPeriod + 1, state.scenario.periods.length - 1);
      const isClosed = nextPeriod >= state.scenario.periods.length - 1;
      const nextTradablePeriod =
        getTradablePeriods(state.scenario, nextPeriod)[0] ?? state.scenario.periods[nextPeriod];
      const shouldMoveOrderDraft = state.orderDraft.periodIndex <= nextPeriod;
      const nextLimitPrice =
        state.orderDraft.side === "buy"
          ? Math.ceil(nextTradablePeriod.intradayAsk + 8)
          : Math.floor(nextTradablePeriod.intradayBid - 8);

      return {
        currentPeriod: nextPeriod,
        isClosed,
        isRunning: isClosed ? false : state.isRunning,
        activeView: isClosed ? "replay" : state.activeView,
        mode: isClosed ? "replay" : state.mode,
        selectedPeriod:
          state.selectedPeriod > nextPeriod ? state.selectedPeriod : nextTradablePeriod.index,
        orderDraft: {
          ...state.orderDraft,
          periodIndex: shouldMoveOrderDraft
            ? nextTradablePeriod.index
            : state.orderDraft.periodIndex,
          limitPrice: shouldMoveOrderDraft ? nextLimitPrice : state.orderDraft.limitPrice,
          volumeMwh: Math.min(state.orderDraft.volumeMwh, nextTradablePeriod.liquidityMwh),
        },
        statusMessage: isClosed
          ? "Trading day closed. Final imbalance settlement is available."
          : `Advanced to ${state.scenario.periods[nextPeriod].label}. Period ${
              nextPeriod + 1
            }/96 is now visible.`,
      };
    }),
  runToEnd: () =>
    set((state) => ({
      currentPeriod: state.scenario.periods.length - 1,
      isRunning: false,
      isClosed: true,
      activeView: "replay",
      mode: "replay",
      selectedPeriod: state.scenario.periods.length - 1,
      statusMessage: "Trading day closed. Final imbalance settlement is available.",
    })),
  resetScenario: () =>
    set((state) => {
      const initialState = buildInitialState(
        state.scenarioId,
        state.scenarioConfig,
        state.portfolioId
      );

      return {
        ...initialState,
        scenarioConfigDraft: state.scenarioConfigDraft,
        activeView: state.activeView,
        mode: state.activeView === "replay" ? "replay" : "manual",
      };
    }),
  reset: () =>
    set((state) => {
      const initialState = buildInitialState(
        state.scenarioId,
        state.scenarioConfig,
        state.portfolioId
      );

      return {
        ...initialState,
        scenarioConfigDraft: state.scenarioConfigDraft,
        activeView: state.activeView,
        mode: state.activeView === "replay" ? "replay" : "manual",
      };
    }),
  runBotComparison: () => {
    const state = get();
    const botResult = runAutopilot(
      state.scenario,
      state.contracts,
      undefined,
      getScenarioSetupTrades(state.trades)
    );

    set({
      botResult,
      statusMessage: `Autopilot placed ${botResult.trades.length} RDB trades and avoided ${botResult.avoidedImbalanceMwh.toFixed(
        1
      )} MWh of absolute imbalance vs do-nothing.`,
    });
  },
}));
