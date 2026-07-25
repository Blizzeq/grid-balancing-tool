import {
  scenarioConfigSchema,
  type PeriodSnapshot,
  type Scenario,
  type ScenarioConfig,
  type ScenarioDefinition,
  type ScenarioId,
} from "./types";

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
  priceVolatility: number;
  liquidityStress: number;
  priceShift: number;
  middayPriceDip: number;
  eveningScarcity: number;
  windDropAfter?: number;
  outageWindow?: [number, number];
}

const SCENARIO_TUNING: Record<ScenarioId, ScenarioTuning> = {
  "sunny-negative": {
    pvScale: 1.62,
    windScale: 0.9,
    loadScale: 0.92,
    volatility: 0.7,
    priceVolatility: 1,
    liquidityStress: 0,
    priceShift: -70,
    middayPriceDip: 350,
    eveningScarcity: 75,
  },
  "wind-drop": {
    pvScale: 0.95,
    windScale: 1.35,
    loadScale: 1.0,
    volatility: 1.1,
    priceVolatility: 1,
    liquidityStress: 0,
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
    priceVolatility: 1,
    liquidityStress: 0,
    priceShift: 95,
    middayPriceDip: 20,
    eveningScarcity: 230,
  },
  "unit-outage": {
    pvScale: 0.85,
    windScale: 0.85,
    loadScale: 1.05,
    volatility: 1.25,
    priceVolatility: 1,
    liquidityStress: 0,
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
    priceVolatility: 1,
    liquidityStress: 0,
    priceShift: -60,
    middayPriceDip: 280,
    eveningScarcity: 70,
  },
  "chaos-hard-mode": {
    pvScale: 1.1,
    windScale: 1.05,
    loadScale: 1.12,
    volatility: 1.75,
    priceVolatility: 1,
    liquidityStress: 0,
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

export function createDefaultScenarioConfig(id: ScenarioId): ScenarioConfig {
  const definition = SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0];
  const tuning = SCENARIO_TUNING[definition.id];

  return {
    seed: definition.seed,
    pvIntensity: 1,
    windVolatility: 1,
    loadStress: 1,
    liquidityStress: tuning.liquidityStress,
    priceVolatility: tuning.priceVolatility,
    outageProbability: tuning.outageWindow ? 1 : 0,
  };
}

function buildGeneratedOutageWindow(
  definition: ScenarioDefinition,
  seed: number
): [number, number] {
  const rng = createRng(seed ^ definition.seed ^ 0x9e3779b9);
  const start = 44 + Math.floor(rng() * 32);
  const duration = 6 + Math.floor(rng() * 12);

  return [start, Math.min(start + duration, 88)];
}

function resolveOutageWindow(
  definition: ScenarioDefinition,
  baseTuning: ScenarioTuning,
  config: ScenarioConfig
): [number, number] | undefined {
  if (config.outageProbability <= 0) {
    return undefined;
  }

  if (baseTuning.outageWindow && config.outageProbability >= 1) {
    return baseTuning.outageWindow;
  }

  const outageRng = createRng(config.seed ^ definition.seed ^ 0x7f4a7c15);
  const outageHappens = outageRng() <= config.outageProbability;

  return outageHappens
    ? baseTuning.outageWindow ?? buildGeneratedOutageWindow(definition, config.seed)
    : undefined;
}

function buildScenarioTuning(
  definition: ScenarioDefinition,
  config: ScenarioConfig
): ScenarioTuning {
  const baseTuning = SCENARIO_TUNING[definition.id];

  return {
    ...baseTuning,
    pvScale: baseTuning.pvScale * config.pvIntensity,
    loadScale: baseTuning.loadScale * config.loadStress,
    volatility: baseTuning.volatility * config.windVolatility,
    liquidityStress: config.liquidityStress,
    priceVolatility: config.priceVolatility,
    outageWindow: resolveOutageWindow(definition, baseTuning, config),
  };
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

  // Forecast and actual share the same cloud response. They used to differ
  // (0.55 vs 0.72), which made actual PV fall short of forecast in almost
  // every daylight period — a one-directional bias an operational forecaster
  // would have corrected out within a week. The error now comes only from the
  // noise terms, so it is centred and the day is not solvable by a standing
  // rule.
  const pvExpected = daylight * tuning.pvScale * 22 * (1 - cloudCover * 0.72);
  const pvForecast = pvExpected + (rng() - 0.5) * 1.1;
  const pvActual = pvExpected + (rng() - 0.5) * 2.4 * tuning.volatility;

  // Same wind speed drives both. The forecast used to be built from
  // (windSpeedMs + 0.8), which meant it systematically over-predicted output.
  const windExpected = tuning.windScale * clamp((windSpeedMs / 13) ** 2 * 12, 1.2, 20);
  const windForecast = clamp(windExpected + (rng() - 0.5) * 1.6, 0.4, 21);
  const windActual = clamp(
    windExpected + (rng() - 0.5) * 3.2 * tuning.volatility,
    0.4,
    21
  );

  const peakLoad =
    22 +
    (hour >= 7 && hour <= 10 ? 7 : 0) +
    (isEveningPeak(index) ? 12 : 0) +
    (definition.id === "winter-peak" ? 8 : 0);
  const tempLoad = temperatureC < 2 ? Math.abs(temperatureC - 2) * 0.55 : 0;
  const forecastLoad =
    tuning.loadScale * (peakLoad + tempLoad + 2.2 * wave(index, 3));
  // (rng() - 0.35) has mean +0.15, so actual load used to run above forecast
  // roughly two periods in three. Centred on 0.5 the error is symmetric.
  const actualLoad =
    forecastLoad +
    (rng() - 0.5) * 3.6 * tuning.volatility +
    (definition.id === "chaos-hard-mode" ? 2.6 * Math.sin(index / 2.5) : 0);

  const priceVolatility = tuning.priceVolatility;
  const middayDip = daylight > 0.55 ? tuning.middayPriceDip * daylight : 0;
  const eveningScarcity = isEveningPeak(index) ? tuning.eveningScarcity : 0;
  const outagePremium =
    tuning.outageWindow && index >= tuning.outageWindow[0] && index <= tuning.outageWindow[1]
      ? 130 + (rng() - 0.5) * 45 * priceVolatility
      : 0;

  // --- system level -------------------------------------------------------
  // A book of this size is a price taker. The day-ahead fixing is set by the
  // whole system against D-1 forecasts, so it must not be derived from this
  // portfolio's own outturn — doing that put the realised result into the
  // price before the trader had made a single decision.
  const systemRenewableShape =
    daylight * tuning.pvScale * 20 * (1 - cloudCover * 0.72) +
    tuning.windScale * clamp((windSpeedMs / 13) ** 2 * 11, 1.2, 20);
  const systemForecastResidual = tuning.loadScale * (peakLoad + tempLoad) - systemRenewableShape;
  // The system's forecast error is its own, independent of the portfolio's.
  const systemErrorMw = (rng() - 0.5) * 6.5 * tuning.volatility * priceVolatility;

  const scarcity =
    Math.max(systemForecastResidual, 0) * (9 + tuning.volatility * 2 * priceVolatility);
  const spotPrice =
    290 +
    tuning.priceShift +
    scarcity -
    middayDip +
    eveningScarcity +
    outagePremium +
    (rng() - 0.5) * 45 * tuning.volatility * priceVolatility;
  const rdnPrice = round(spotPrice, 2);

  // Positive when the system ends up long. This sign, not the participant's,
  // is what selects the imbalance price.
  const systemImbalanceMw = round(-systemErrorMw * 150, 1);

  // Balancing energy price: the ex-post cost of the balancing stack. It tracks
  // how short the system is and has genuinely fat tails — Poland saw evening
  // CEN above 1,000 PLN/MWh in 2025 and a record -36,932.50 PLN/MWh on
  // 30 July 2025, so a bounded affine function of the day-ahead price carried
  // no risk at all.
  const stress = -systemImbalanceMw / 400;
  const tail = rng();
  const spike =
    tail > 0.985
      ? (900 + rng() * 2600) * priceVolatility
      : tail < 0.015
        ? -(700 + rng() * 2200) * priceVolatility
        : 0;
  const balancingEnergyPrice = round(
    spotPrice +
      stress * (95 + tuning.volatility * 40 * priceVolatility) +
      (rng() - 0.5) * 70 * priceVolatility +
      spike,
    2
  );

  // Single price, both directions (see PeriodSnapshot.imbalancePrice).
  const imbalancePrice = round(
    systemImbalanceMw > 0
      ? Math.min(balancingEnergyPrice, rdnPrice)
      : Math.max(balancingEnergyPrice, rdnPrice),
    2
  );

  const spread = clamp(
    12 +
      tuning.volatility * 11 * priceVolatility +
      Math.abs(spotPrice - 320) * 0.018 * priceVolatility,
    8,
    68 + Math.max(priceVolatility - 1, 0) * 24
  );

  return {
    index,
    label: formatPeriodLabel(index),
    hour,
    forecastGeneration: round(Math.max(pvForecast + windForecast, 0)),
    actualGeneration: round(Math.max(pvActual + windActual, 0)),
    forecastLoad: round(Math.max(forecastLoad, 0)),
    actualLoad: round(Math.max(actualLoad, 0)),
    rdnPrice,
    spotPrice: rdnPrice,
    intradayBid: round(spotPrice - spread / 2, 2),
    intradayAsk: round(spotPrice + spread / 2, 2),
    systemImbalanceMw,
    balancingEnergyPrice,
    imbalancePrice,
    liquidityMwh: round(
      clamp(
        32 -
          tuning.volatility * 5 -
          (isEveningPeak(index) ? 7 : 0) -
          tuning.liquidityStress * 18,
        tuning.liquidityStress > 0 ? 4 : 8,
        45
      ),
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

export function createScenario(
  id: ScenarioId = "sunny-negative",
  config?: ScenarioConfig
): Scenario {
  const definition = SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0];
  const scenarioConfig = scenarioConfigSchema.parse(
    config ?? createDefaultScenarioConfig(definition.id)
  );
  const tuning = buildScenarioTuning(definition, scenarioConfig);
  const rng = createRng(scenarioConfig.seed);
  const periods = Array.from({ length: PERIODS_PER_DAY }, (_, index) =>
    createPeriod(definition, tuning, index, rng)
  );

  return {
    definition,
    metadata: {
      source: "synthetic-calibrated",
      seed: scenarioConfig.seed,
      deliveryDate: "2025-05-13",
      marketArea: "PL Market",
      currency: "PLN",
      generatedAtLabel: "2025-05-12 14:30",
      config: scenarioConfig,
    },
    periods,
  };
}

export function getScenarioDefinition(id: ScenarioId): ScenarioDefinition {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0];
}
