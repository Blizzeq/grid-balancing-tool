"use client";

import { create } from "zustand";

import { CONTRACT_TEMPLATES, createContractFromTemplate, createDefaultContracts } from "@/lib/domain/contracts";
import { executeOrder } from "@/lib/domain/markets";
import { createScenario } from "@/lib/domain/scenarios";
import { runAutopilot, type StrategyRunResult } from "@/lib/domain/strategy";
import type {
  Contract,
  GameMode,
  MarketTrade,
  OrderDraft,
  Scenario,
  ScenarioId,
} from "@/lib/domain/types";

export type AppView = "dashboard" | "contracts" | "market" | "forecast" | "duel" | "replay";

interface SimulationStore {
  activeView: AppView;
  scenarioId: ScenarioId;
  scenario: Scenario;
  mode: GameMode;
  currentPeriod: number;
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
  placeOrder: () => void;
  signContract: (templateId: string) => void;
  step: () => void;
  runToEnd: () => void;
  reset: () => void;
  runBotComparison: () => void;
}

function buildInitialOrderDraft(periodIndex = 44): OrderDraft {
  return {
    side: "buy",
    market: "RDB",
    periodIndex,
    volumeMwh: 25,
    limitPrice: 325,
  };
}

function buildInitialState(scenarioId: ScenarioId = "sunny-negative") {
  const scenario = createScenario(scenarioId);

  return {
    scenarioId,
    scenario,
    mode: "manual" as GameMode,
    currentPeriod: 43,
    selectedPeriod: 44,
    contracts: createDefaultContracts(),
    trades: [],
    orderDraft: buildInitialOrderDraft(44),
    statusMessage: "Trading day opened. RDN nominations are loaded; RDB is available.",
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
  placeOrder: () => {
    const state = get();
    const period = state.scenario.periods[state.orderDraft.periodIndex];
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
      const nextPeriod = Math.min(state.currentPeriod + 1, state.scenario.periods.length - 1);

      return {
        currentPeriod: nextPeriod,
        selectedPeriod: Math.max(state.selectedPeriod, nextPeriod + 1),
        orderDraft: {
          ...state.orderDraft,
          periodIndex: Math.max(state.orderDraft.periodIndex, nextPeriod + 1),
        },
        statusMessage: `Advanced to ${state.scenario.periods[nextPeriod].label}. Period ${
          nextPeriod + 1
        }/96 is now visible.`,
      };
    }),
  runToEnd: () =>
    set((state) => ({
      currentPeriod: state.scenario.periods.length - 1,
      statusMessage: "Trading day closed. Final imbalance settlement is available.",
    })),
  reset: () => set((state) => ({ ...buildInitialState(state.scenarioId), activeView: state.activeView })),
  runBotComparison: () => {
    const state = get();
    const botResult = runAutopilot(state.scenario, state.contracts);

    set({
      botResult,
      statusMessage: `Autopilot placed ${botResult.trades.length} RDB trades and avoided ${botResult.avoidedImbalanceMwh.toFixed(
        1
      )} MWh of absolute imbalance vs do-nothing.`,
    });
  },
}));
