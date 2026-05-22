import { z } from "zod";

export const scenarioIdSchema = z.enum([
  "sunny-negative",
  "wind-drop",
  "winter-peak",
  "unit-outage",
  "pv-oversupply",
  "chaos-hard-mode",
]);

export type ScenarioId = z.infer<typeof scenarioIdSchema>;

export type ContractSide = "buy" | "sell";
export type ContractGranularity = "15m" | "hourly" | "block";
export type MarketKind = "RDN" | "RDB";
export type TradeActor = "manual" | "script";
export type TradeSide = "buy" | "sell";
export type GameMode = "manual" | "manual-with-advice" | "autopilot" | "replay";

export interface WeatherPoint {
  cloudCover: number;
  irradiance: number;
  temperatureC: number;
  windSpeedMs: number;
}

export interface PeriodSnapshot {
  index: number;
  label: string;
  hour: number;
  forecastGeneration: number;
  actualGeneration: number;
  forecastLoad: number;
  actualLoad: number;
  spotPrice: number;
  intradayBid: number;
  intradayAsk: number;
  imbalanceLongPrice: number;
  imbalanceShortPrice: number;
  liquidityMwh: number;
  weather: WeatherPoint;
}

export interface ScenarioDefinition {
  id: ScenarioId;
  name: string;
  shortName: string;
  description: string;
  seed: number;
  difficulty: "training" | "standard" | "hard";
}

export interface Scenario {
  definition: ScenarioDefinition;
  periods: PeriodSnapshot[];
}

export type VolumeFormula =
  | {
      kind: "fixed";
      mwh: number;
      peakOnly?: boolean;
    }
  | {
      kind: "generation-indexed";
      factor: number;
    }
  | {
      kind: "load-indexed";
      factor: number;
    }
  | {
      kind: "swing";
      nominatedMwh: number;
      minMwh: number;
      maxMwh: number;
      peakOnly?: boolean;
    };

export type PriceFormula =
  | {
      kind: "fixed";
      plnPerMwh: number;
    }
  | {
      kind: "spot-indexed";
      premium: number;
    };

export interface Contract {
  id: string;
  templateId: string;
  name: string;
  type:
    | "forward-otc"
    | "ppa-pay-as-produced"
    | "shaped-profile"
    | "retail-load"
    | "flexible-swing";
  side: ContractSide;
  counterparty: string;
  deliveryStart: number;
  deliveryEnd: number;
  granularity: ContractGranularity;
  volumeFormula: VolumeFormula;
  priceFormula: PriceFormula;
  imbalanceResponsibility: "portfolio" | "counterparty";
  nominationDeadline: string;
  penaltyRule: string;
  settlementRule: string;
  serviceFeePerMwh: number;
}

export interface ContractTemplate extends Omit<Contract, "id"> {
  rationale: string;
  risk: string;
}

export interface MarketTrade {
  id: string;
  actor: TradeActor;
  side: TradeSide;
  market: MarketKind;
  periodIndex: number;
  volumeMwh: number;
  pricePlnMwh: number;
  submittedAtPeriod: number;
  accepted: boolean;
  reason?: string;
}

export const orderDraftSchema = z.object({
  side: z.enum(["buy", "sell"]),
  market: z.enum(["RDN", "RDB"]),
  periodIndex: z.number().int().min(0).max(95),
  volumeMwh: z.number().positive().max(80),
  limitPrice: z.number().min(-500).max(3000),
});

export type OrderDraft = z.infer<typeof orderDraftSchema>;

export interface ContractSettlement {
  boughtMwh: number;
  soldMwh: number;
  generationMwh: number;
  loadMwh: number;
  purchaseCost: number;
  salesRevenue: number;
  serviceFees: number;
  penalties: number;
  pnl: number;
}

export interface TradeSettlement {
  boughtMwh: number;
  soldMwh: number;
  purchaseCost: number;
  salesRevenue: number;
  transactionFees: number;
  pnl: number;
}

export interface PeriodSettlement {
  periodIndex: number;
  label: string;
  forecastGeneration: number;
  actualGeneration: number;
  forecastLoad: number;
  actualLoad: number;
  contractedPosition: number;
  marketPosition: number;
  imbalanceMwh: number;
  imbalancePrice: number;
  imbalancePnl: number;
  periodPnl: number;
  contractPnl: number;
  marketPnl: number;
  serviceFees: number;
  transactionFees: number;
}

export interface PortfolioSettlement {
  periods: PeriodSettlement[];
  totalPnl: number;
  contractPnl: number;
  marketPnl: number;
  imbalancePnl: number;
  serviceFees: number;
  transactionFees: number;
  totalImbalanceAbsMwh: number;
  worstPeriod?: PeriodSettlement;
  bestPeriod?: PeriodSettlement;
  errorCount: number;
}

export interface StrategyConfig {
  riskLimitMwh: number;
  bufferMwh: number;
  horizonPeriods: number;
  transactionCostPlnMwh: number;
  reactionDelayPeriods: number;
  aggressiveness: number;
}
