"use client";

import { create } from "zustand";

import { CONTRACT_TEMPLATES, createContractFromTemplate, createDefaultContracts } from "../domain/contracts";
import { buildDayAheadAuctionTrades, executeOrder, getScenarioSetupTrades } from "../domain/markets";
import { getTradablePeriods } from "../domain/metrics";
import { createScenario } from "../domain/scenarios";
import { runAutopilot, type StrategyRunResult } from "../domain/strategy";
import type {
  Contract,
  GameMode,
  MarketTrade,
  OrderDraft,
  Scenario,
  ScenarioId,
  SimulationClockState,
} from "../domain/types";

export type AppView = "dashboard" | "contracts" | "market" | "forecast" | "duel" | "replay";

interface SimulationStore {
  activeView: AppView;
  scenarioId: ScenarioId;
  scenario: Scenario;
  mode: GameMode;
  currentPeriod: number;
  isRunning: boolean;
  speed: number;
  isClosed: boolean;
  selectedPeriod: number;
  contracts: Contract[];
  trades: MarketTrade[];
  orderDraft: OrderDraft;
  statusMessage: string;
  botResult?: StrategyRunResult;
  setView: (view: AppView) => void;
  setScenario: (scenarioId: ScenarioId) => void;
  setMode: (mode: GameMode) => void;
  setSelectedPeriod: (periodIndex: number) => void;
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

function buildInitialState(scenarioId: ScenarioId = "sunny-negative") {
  const scenario = createScenario(scenarioId);
  const clock = buildInitialClock();
  const tradablePeriod = getTradablePeriods(scenario, clock.currentPeriod)[0] ?? scenario.periods.at(-1);
  const selectedPeriod = tradablePeriod?.index ?? clock.currentPeriod;
  const contracts = createDefaultContracts();

  return {
    scenarioId,
    scenario,
    mode: "manual" as GameMode,
    ...clock,
    selectedPeriod,
    contracts,
    trades: buildDayAheadAuctionTrades(scenario, contracts),
    orderDraft: buildInitialOrderDraft(scenario, selectedPeriod),
    statusMessage: "Trading day opened. D-1 RDN setup is locked; RDB/SIDC is available.",
    botResult: undefined,
  };
}

export const useSimulationStore = create<SimulationStore>((set, get) => ({
  activeView: "dashboard",
  ...buildInitialState(),
  setView: (view) => set({ activeView: view }),
  setScenario: (scenarioId) =>
    set({
      ...buildInitialState(scenarioId),
      activeView: get().activeView,
      statusMessage: `Scenario switched to ${createScenario(scenarioId).definition.name}.`,
    }),
  setMode: (mode) => set({ mode }),
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

    const execution = executeOrder(
      state.orderDraft,
      period,
      state.currentPeriod,
      "manual",
      state.trades.length
    );

    if (!execution.trade) {
      set({ statusMessage: execution.reason });
      return;
    }

    set({
      trades: [...state.trades, execution.trade],
      statusMessage: `${execution.trade.side.toUpperCase()} ${execution.trade.volumeMwh.toFixed(
        1
      )} MWh for ${period.label} matched at ${execution.trade.pricePlnMwh.toFixed(
        0
      )} PLN/MWh.`,
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
      selectedPeriod: state.scenario.periods.length - 1,
      statusMessage: "Trading day closed. Final imbalance settlement is available.",
    })),
  resetScenario: () =>
    set((state) => ({ ...buildInitialState(state.scenarioId), activeView: state.activeView })),
  reset: () =>
    set((state) => ({ ...buildInitialState(state.scenarioId), activeView: state.activeView })),
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
