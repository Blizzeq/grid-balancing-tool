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
export type TradeActor = "manual" | "script" | "scenario";
export type TradeSide = "buy" | "sell";
export type GameMode = "manual" | "manual-with-advice" | "autopilot" | "replay";

export const currencyCodeSchema = z.enum(["PLN"]);
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

export const portfolioIdSchema = z.enum([
  "alpha-power",
  "renewables-ppa",
  "industrial-supply",
]);
export type PortfolioId = z.infer<typeof portfolioIdSchema>;

export const scenarioConfigSchema = z.object({
  seed: z.number().int().min(1).max(999999),
  pvIntensity: z.number().min(0.4).max(2.2),
  windVolatility: z.number().min(0.4).max(2.2),
  loadStress: z.number().min(0.6).max(1.8),
  liquidityStress: z.number().min(0).max(1),
  priceVolatility: z.number().min(0.5).max(2.2),
  outageProbability: z.number().min(0).max(1),
});

export type ScenarioConfig = z.infer<typeof scenarioConfigSchema>;

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
  rdnPrice: number;
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

export interface ScenarioMetadata {
  source: "synthetic-calibrated";
  seed: number;
  deliveryDate: string;
  marketArea: string;
  currency: CurrencyCode;
  generatedAtLabel: string;
  config: ScenarioConfig;
}

export interface Scenario {
  definition: ScenarioDefinition;
  metadata: ScenarioMetadata;
  periods: PeriodSnapshot[];
}

export interface KnownPeriodView {
  periodIndex: number;
  label: string;
  hour: number;
  forecastGeneration: number;
  forecastLoad: number;
  actualGeneration: number | null;
  actualLoad: number | null;
  rdnPrice: number;
  intradayBid: number;
  intradayAsk: number;
  liquidityMwh: number;
  expectedImbalanceLongPrice: number;
  expectedImbalanceShortPrice: number;
  actualImbalanceLongPrice: number | null;
  actualImbalanceShortPrice: number | null;
  isSettled: boolean;
  weather: WeatherPoint;
}

export interface ScenarioCalibrationReport {
  scenarioId: ScenarioId;
  averageRdnPrice: number;
  rdnPriceStdDev: number;
  minRdnPrice: number;
  maxRdnPrice: number;
  negativeRdnPeriods: number;
  minBidAskSpread: number;
  maxBidAskSpread: number;
  averageLiquidityMwh: number;
  priceSpikeThreshold: number;
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

export interface PortfolioDefinition {
  id: PortfolioId;
  name: string;
  shortName: string;
  description: string;
  marketArea: string;
  baseCurrency: CurrencyCode;
  balancingParty: string;
  defaultContractTemplateIds: string[];
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

export interface SimulationClockState {
  currentPeriod: number;
  isRunning: boolean;
  speed: number;
  isClosed: boolean;
}

export interface RiskAlert {
  id: string;
  title: string;
  description: string;
  timeLabel: string;
  tone: "danger" | "warning" | "info";
}

export interface PnlWaterfallEntry {
  name: string;
  value: number;
  kind: "component" | "total";
}

export interface DashboardSeriesPoint {
  label: string;
  actual?: number | null;
  forecast?: number | null;
  portfolio?: number | null;
  projected?: number | null;
  upper?: number;
  lower?: number;
}

export interface SignedContractMetric {
  id: string;
  counterparty: string;
  product: string;
  deliveryPeriod: string;
  volumeMwh: number;
  pricePlnMwh: number;
  status: "Active" | "Expired";
  mtmPln: number;
}

export interface DashboardMetrics {
  maxPositionLimitMwh: number;
  currentPositionMwh: number;
  currentContractedMwh: number;
  currentMarketMwh: number;
  currentImbalanceMwh: number;
  realizedSettlement: PortfolioSettlement;
  projectedSettlement: PortfolioSettlement;
  fullActualSettlement: PortfolioSettlement;
  balanceSeries: DashboardSeriesPoint[];
  loadSeries: DashboardSeriesPoint[];
  generationSeries: DashboardSeriesPoint[];
  pnlWaterfall: PnlWaterfallEntry[];
  riskAlerts: RiskAlert[];
  signedContracts: SignedContractMetric[];
}
