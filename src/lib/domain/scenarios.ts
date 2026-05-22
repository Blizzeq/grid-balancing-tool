import type { PeriodSnapshot, Scenario, ScenarioDefinition, ScenarioId } from "./types";

const PERIODS_PER_DAY = 96;

export const SCENARIOS: ScenarioDefinition[] = [
  {
    id: "sunny-negative",
    name: "Sunny negative-price day",
    shortName: "Sunny negative",
    description:
      "Strong PV output pushes midday prices below zero while evening load still needs coverage.",
    seed: 12031,
    difficulty: "training",
  },
  {
    id: "wind-drop",
    name: "Sudden wind drop",
    shortName: "Wind drop",
    description:
      "A weather front fades faster than forecast, leaving the portfolio short in late afternoon.",
    seed: 88021,
    difficulty: "standard",
  },
  {
    id: "winter-peak",
    name: "Winter peak demand",
    shortName: "Winter peak",
    description:
      "Low temperature and evening demand create expensive scarcity periods with thin liquidity.",
    seed: 44290,
    difficulty: "standard",
  },
  {
    id: "unit-outage",
    name: "Conventional unit outage",
    shortName: "Unit outage",
    description:
      "An outage shock after noon lifts intraday and imbalance prices for several hours.",
    seed: 90110,
    difficulty: "hard",
  },
  {
    id: "pv-oversupply",
    name: "PV oversupply stress",
    shortName: "PV oversupply",
    description:
      "The market is long around noon, so surplus energy is expensive to dispose of.",
    seed: 73112,
    difficulty: "standard",
  },
  {
    id: "chaos-hard-mode",
    name: "Chaotic weather hard mode",
    shortName: "Chaos hard",
    description:
      "Cloud ramps, load error and volatile imbalance spreads test every weak hedge.",
    seed: 62219,
    difficulty: "hard",
  },
];

interface ScenarioTuning {
  pvScale: number;
  windScale: number;
  loadScale: number;
  volatility: number;
  priceShift: number;
  middayPriceDip: number;
  eveningScarcity: number;
  windDropAfter?: number;
  outageWindow?: [number, number];
}

const SCENARIO_TUNING: Record<ScenarioId, ScenarioTuning> = {
  "sunny-negative": {
    pvScale: 1.45,
    windScale: 0.9,
    loadScale: 0.95,
    volatility: 0.7,
    priceShift: -20,
    middayPriceDip: 210,
    eveningScarcity: 75,
  },
  "wind-drop": {
    pvScale: 0.95,
    windScale: 1.35,
    loadScale: 1.0,
    volatility: 1.1,
    priceShift: 10,
    middayPriceDip: 60,
    eveningScarcity: 115,
    windDropAfter: 54,
  },
  "winter-peak": {
    pvScale: 0.35,
    windScale: 0.9,
    loadScale: 1.3,
    volatility: 1.0,
    priceShift: 95,
    middayPriceDip: 20,
    eveningScarcity: 230,
  },
  "unit-outage": {
    pvScale: 0.85,
    windScale: 0.85,
    loadScale: 1.05,
    volatility: 1.25,
    priceShift: 70,
    middayPriceDip: 25,
    eveningScarcity: 180,
    outageWindow: [48, 66],
  },
  "pv-oversupply": {
    pvScale: 1.75,
    windScale: 0.75,
    loadScale: 0.88,
    volatility: 0.85,
    priceShift: -60,
    middayPriceDip: 280,
    eveningScarcity: 70,
  },
  "chaos-hard-mode": {
    pvScale: 1.1,
    windScale: 1.05,
    loadScale: 1.12,
    volatility: 1.75,
    priceShift: 35,
    middayPriceDip: 120,
    eveningScarcity: 210,
    windDropAfter: 42,
    outageWindow: [68, 76],
  },
};

function createRng(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function wave(index: number, phase = 0): number {
  return Math.sin(((index + phase) / PERIODS_PER_DAY) * Math.PI * 2);
}

function daylightShape(hour: number): number {
  return clamp(Math.sin(((hour - 5.8) / 13.4) * Math.PI), 0, 1);
}

function isEveningPeak(index: number): boolean {
  return index >= 68 && index <= 84;
}

function formatPeriodLabel(index: number): string {
  const minutes = index * 15;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour.toString().padStart(2, "0")}:${minute
    .toString()
    .padStart(2, "0")}`;
}

function round(value: number, precision = 2): number {
  return Number(value.toFixed(precision));
}

function createPeriod(
  definition: ScenarioDefinition,
  tuning: ScenarioTuning,
  index: number,
  rng: () => number
): PeriodSnapshot {
  const hour = index / 4;
  const daylight = daylightShape(hour);
  const cloudBase =
    definition.id === "chaos-hard-mode"
      ? 0.28 + 0.3 * Math.sin(index / 3) + (rng() - 0.5) * 0.45
      : 0.22 + 0.12 * wave(index, 8) + (rng() - 0.5) * 0.18;
  const cloudCover = clamp(cloudBase, 0.02, 0.92);
  const irradiance = round(daylight * (1 - cloudCover * 0.75) * 1000, 1);

  const windTrend = 7.5 + 2.4 * wave(index, -12) + 1.2 * Math.sin(index / 7);
  const windShock =
    tuning.windDropAfter && index >= tuning.windDropAfter
      ? -3.6 - 0.7 * Math.sin(index / 2)
      : 0;
  const windSpeedMs = clamp(
    windTrend + windShock + (rng() - 0.5) * 2.2 * tuning.volatility,
    1.2,
    17
  );

  const temperatureC = round(
    definition.id === "winter-peak"
      ? -5 + daylight * 5 + (rng() - 0.5) * 2
      : 13 + daylight * 10 - cloudCover * 2 + (rng() - 0.5) * 2.6,
    1
  );

  const pvForecast =
    daylight * tuning.pvScale * 22 * (1 - cloudCover * 0.55) +
    (rng() - 0.5) * 0.6;
  const pvActual =
    daylight * tuning.pvScale * 22 * (1 - cloudCover * 0.72) +
    (rng() - 0.5) * 1.8 * tuning.volatility;

  const windForecast =
    tuning.windScale *
    clamp(((windSpeedMs + 0.8) / 13) ** 2 * 12, 1.5, 20);
  const windActual =
    tuning.windScale *
    clamp((windSpeedMs / 13) ** 2 * 12 + (rng() - 0.5) * 2.8, 0.4, 21);

  const peakLoad =
    22 +
    (hour >= 7 && hour <= 10 ? 7 : 0) +
    (isEveningPeak(index) ? 12 : 0) +
    (definition.id === "winter-peak" ? 8 : 0);
  const tempLoad = temperatureC < 2 ? Math.abs(temperatureC - 2) * 0.55 : 0;
  const forecastLoad =
    tuning.loadScale * (peakLoad + tempLoad + 2.2 * wave(index, 3));
  const actualLoad =
    forecastLoad +
    (rng() - 0.35) * 3.2 * tuning.volatility +
    (definition.id === "chaos-hard-mode" ? 2.6 * Math.sin(index / 2.5) : 0);

  const renewablePressure = pvActual + windActual;
  const demandPressure = actualLoad;
  const middayDip = daylight > 0.55 ? tuning.middayPriceDip * daylight : 0;
  const eveningScarcity = isEveningPeak(index) ? tuning.eveningScarcity : 0;
  const outagePremium =
    tuning.outageWindow && index >= tuning.outageWindow[0] && index <= tuning.outageWindow[1]
      ? 130 + (rng() - 0.5) * 45
      : 0;
  const scarcity =
    Math.max(demandPressure - renewablePressure, 0) * (9 + tuning.volatility * 2);
  const spotPrice =
    290 +
    tuning.priceShift +
    scarcity -
    middayDip +
    eveningScarcity +
    outagePremium +
    (rng() - 0.5) * 45 * tuning.volatility;

  const spread = clamp(
    12 + tuning.volatility * 11 + Math.abs(spotPrice - 320) * 0.018,
    8,
    68
  );
  const imbalancePremium = 35 + tuning.volatility * 28 + (isEveningPeak(index) ? 45 : 0);
  const longDiscount = 28 + tuning.volatility * 18 + (daylight > 0.6 ? 24 : 0);

  return {
    index,
    label: formatPeriodLabel(index),
    hour,
    forecastGeneration: round(Math.max(pvForecast + windForecast, 0)),
    actualGeneration: round(Math.max(pvActual + windActual, 0)),
    forecastLoad: round(Math.max(forecastLoad, 0)),
    actualLoad: round(Math.max(actualLoad, 0)),
    spotPrice: round(spotPrice, 2),
    intradayBid: round(spotPrice - spread / 2, 2),
    intradayAsk: round(spotPrice + spread / 2, 2),
    imbalanceLongPrice: round(spotPrice - longDiscount, 2),
    imbalanceShortPrice: round(spotPrice + imbalancePremium, 2),
    liquidityMwh: round(
      clamp(32 - tuning.volatility * 5 - (isEveningPeak(index) ? 7 : 0), 8, 45),
      1
    ),
    weather: {
      cloudCover: round(cloudCover, 2),
      irradiance,
      temperatureC,
      windSpeedMs: round(windSpeedMs, 1),
    },
  };
}

export function createScenario(id: ScenarioId = "sunny-negative"): Scenario {
  const definition = SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0];
  const tuning = SCENARIO_TUNING[definition.id];
  const rng = createRng(definition.seed);
  const periods = Array.from({ length: PERIODS_PER_DAY }, (_, index) =>
    createPeriod(definition, tuning, index, rng)
  );

  return { definition, periods };
}

export function getScenarioDefinition(id: ScenarioId): ScenarioDefinition {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0];
}
