import {
  CONTRACT_TEMPLATES,
  createDefaultContracts,
  evaluateContractVolume,
} from "./contracts";
import { buildDayAheadAuctionTrades } from "./markets";
import { PORTFOLIOS } from "./portfolios";
import { SCENARIOS, createScenario } from "./scenarios";
import { settlePortfolio } from "./settlement";
import {
  scenarioConfigSchema,
  type ContractTemplate,
  type PeriodSnapshot,
  type PortfolioDefinition,
  type Scenario,
} from "./types";

export type DataIntegritySeverity = "error" | "warning";

export interface DataIntegrityIssue {
  severity: DataIntegritySeverity;
  area: "contracts" | "portfolios" | "scenarios" | "settlement";
  id: string;
  message: string;
}

export interface DataIntegrityReport {
  errors: DataIntegrityIssue[];
  warnings: DataIntegrityIssue[];
}

const PERIODS_PER_DAY = 96;
const MARKET_AREA = "PL Market";
const SETTLEMENT_CURRENCY = "PLN";

function expectedPeriodLabel(index: number): string {
  const minutes = index * 15;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;

  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function addIssue(
  issues: DataIntegrityIssue[],
  severity: DataIntegritySeverity,
  area: DataIntegrityIssue["area"],
  id: string,
  message: string
): void {
  issues.push({ severity, area, id, message });
}

function validateUniqueValues(
  issues: DataIntegrityIssue[],
  area: DataIntegrityIssue["area"],
  values: string[],
  id: string,
  label: string
): void {
  const seen = new Set<string>();

  values.forEach((value) => {
    if (seen.has(value)) {
      addIssue(issues, "error", area, id, `Duplicate ${label}: ${value}`);
      return;
    }

    seen.add(value);
  });
}

function validateContractTemplate(
  template: ContractTemplate,
  issues: DataIntegrityIssue[]
): void {
  const id = template.templateId;

  if (!template.name.trim()) {
    addIssue(issues, "error", "contracts", id, "Contract template name is empty.");
  }

  if (!template.counterparty.trim()) {
    addIssue(issues, "error", "contracts", id, "Contract counterparty is empty.");
  }

  if (
    !Number.isInteger(template.deliveryStart) ||
    !Number.isInteger(template.deliveryEnd) ||
    template.deliveryStart < 0 ||
    template.deliveryEnd >= PERIODS_PER_DAY ||
    template.deliveryStart > template.deliveryEnd
  ) {
    addIssue(
      issues,
      "error",
      "contracts",
      id,
      "Contract delivery window must be inside one 96-period day."
    );
  }

  if (!isFiniteNumber(template.serviceFeePerMwh)) {
    addIssue(issues, "error", "contracts", id, "Service fee must be finite.");
  }

  if (template.priceFormula.kind === "fixed") {
    if (
      !isFiniteNumber(template.priceFormula.plnPerMwh) ||
      template.priceFormula.plnPerMwh < -500 ||
      template.priceFormula.plnPerMwh > 3000
    ) {
      addIssue(
        issues,
        "error",
        "contracts",
        id,
        "Fixed contract price must stay inside the supported PLN/MWh range."
      );
    }
  } else if (!isFiniteNumber(template.priceFormula.premium)) {
    addIssue(issues, "error", "contracts", id, "Spot-indexed premium must be finite.");
  }

  if (template.volumeFormula.kind === "fixed" && template.volumeFormula.mwh <= 0) {
    addIssue(issues, "error", "contracts", id, "Fixed contract volume must be positive.");
  }

  if (
    (template.volumeFormula.kind === "generation-indexed" ||
      template.volumeFormula.kind === "load-indexed") &&
    template.volumeFormula.factor <= 0
  ) {
    addIssue(issues, "error", "contracts", id, "Indexed contract factor must be positive.");
  }

  if (template.volumeFormula.kind === "swing") {
    const { maxMwh, minMwh, nominatedMwh } = template.volumeFormula;

    if (minMwh < 0 || maxMwh <= 0 || minMwh > nominatedMwh || nominatedMwh > maxMwh) {
      addIssue(
        issues,
        "error",
        "contracts",
        id,
        "Swing nomination must be inside a positive min/max band."
      );
    }
  }
}

function validateContractCatalog(issues: DataIntegrityIssue[]): Set<string> {
  const templateIds = CONTRACT_TEMPLATES.map((template) => template.templateId);

  validateUniqueValues(issues, "contracts", templateIds, "contract-templates", "template id");
  CONTRACT_TEMPLATES.forEach((template) => validateContractTemplate(template, issues));

  return new Set(templateIds);
}

function validatePortfolioCatalog(
  templateIds: Set<string>,
  issues: DataIntegrityIssue[]
): void {
  validateUniqueValues(
    issues,
    "portfolios",
    PORTFOLIOS.map((portfolio) => portfolio.id),
    "portfolio-catalog",
    "portfolio id"
  );
  validateUniqueValues(
    issues,
    "portfolios",
    PORTFOLIOS.map((portfolio) => portfolio.name),
    "portfolio-catalog",
    "portfolio name"
  );

  PORTFOLIOS.forEach((portfolio) => {
    const id = portfolio.id;

    if (portfolio.marketArea !== MARKET_AREA) {
      addIssue(issues, "error", "portfolios", id, `Unsupported market area: ${portfolio.marketArea}`);
    }

    if (portfolio.baseCurrency !== SETTLEMENT_CURRENCY) {
      addIssue(
        issues,
        "error",
        "portfolios",
        id,
        `Unsupported settlement currency: ${portfolio.baseCurrency}`
      );
    }

    if (portfolio.defaultContractTemplateIds.length === 0) {
      addIssue(issues, "error", "portfolios", id, "Portfolio has no default contracts.");
    }

    validateUniqueValues(
      issues,
      "portfolios",
      portfolio.defaultContractTemplateIds,
      id,
      "default contract template id"
    );

    portfolio.defaultContractTemplateIds.forEach((templateId) => {
      if (!templateIds.has(templateId)) {
        addIssue(
          issues,
          "error",
          "portfolios",
          id,
          `Portfolio references missing contract template: ${templateId}`
        );
      }
    });
  });
}

function validatePeriod(
  scenario: Scenario,
  period: PeriodSnapshot,
  expectedIndex: number,
  issues: DataIntegrityIssue[]
): void {
  const id = `${scenario.definition.id}:${expectedIndex}`;

  if (period.index !== expectedIndex) {
    addIssue(issues, "error", "scenarios", id, `Expected period index ${expectedIndex}.`);
  }

  if (period.label !== expectedPeriodLabel(expectedIndex)) {
    addIssue(issues, "error", "scenarios", id, `Expected period label ${expectedPeriodLabel(expectedIndex)}.`);
  }

  if (period.hour < 0 || period.hour > 23.75) {
    addIssue(issues, "error", "scenarios", id, "Period hour must stay inside delivery day.");
  }

  const finiteFields = [
    period.forecastGeneration,
    period.actualGeneration,
    period.forecastLoad,
    period.actualLoad,
    period.rdnPrice,
    period.spotPrice,
    period.intradayBid,
    period.intradayAsk,
    period.imbalanceLongPrice,
    period.imbalanceShortPrice,
    period.liquidityMwh,
    period.weather.cloudCover,
    period.weather.irradiance,
    period.weather.temperatureC,
    period.weather.windSpeedMs,
  ];

  if (!finiteFields.every(isFiniteNumber)) {
    addIssue(issues, "error", "scenarios", id, "Period contains non-finite numeric data.");
  }

  if (
    period.forecastGeneration < 0 ||
    period.actualGeneration < 0 ||
    period.forecastLoad < 0 ||
    period.actualLoad < 0 ||
    period.liquidityMwh < 0
  ) {
    addIssue(issues, "error", "scenarios", id, "Generation, load and liquidity must be non-negative.");
  }

  if (period.intradayBid > period.intradayAsk) {
    addIssue(issues, "error", "scenarios", id, "Intraday bid must not exceed ask.");
  }

  if (period.imbalanceShortPrice <= period.imbalanceLongPrice) {
    addIssue(issues, "error", "scenarios", id, "Short imbalance price must exceed long imbalance price.");
  }
}

function validateScenario(scenario: Scenario, issues: DataIntegrityIssue[]): void {
  const id = scenario.definition.id;

  if (scenario.metadata.marketArea !== MARKET_AREA) {
    addIssue(issues, "error", "scenarios", id, `Unsupported market area: ${scenario.metadata.marketArea}`);
  }

  if (scenario.metadata.currency !== SETTLEMENT_CURRENCY) {
    addIssue(
      issues,
      "error",
      "scenarios",
      id,
      `Unsupported settlement currency: ${scenario.metadata.currency}`
    );
  }

  if (!scenarioConfigSchema.safeParse(scenario.metadata.config).success) {
    addIssue(issues, "error", "scenarios", id, "Scenario metadata config is invalid.");
  }

  if (scenario.periods.length !== PERIODS_PER_DAY) {
    addIssue(issues, "error", "scenarios", id, "Scenario must contain exactly 96 settlement periods.");
  }

  scenario.periods.forEach((period, index) => validatePeriod(scenario, period, index, issues));
}

function validateScenarioPortfolioSettlement(
  scenario: Scenario,
  portfolio: PortfolioDefinition,
  issues: DataIntegrityIssue[]
): void {
  const id = `${scenario.definition.id}:${portfolio.id}`;

  if (scenario.metadata.marketArea !== portfolio.marketArea) {
    addIssue(issues, "error", "settlement", id, "Scenario and portfolio market areas differ.");
  }

  if (scenario.metadata.currency !== portfolio.baseCurrency) {
    addIssue(issues, "error", "settlement", id, "Scenario and portfolio settlement currencies differ.");
  }

  let contracts: ReturnType<typeof createDefaultContracts>;

  try {
    contracts = createDefaultContracts(portfolio.defaultContractTemplateIds);
  } catch (error) {
    addIssue(
      issues,
      "error",
      "settlement",
      id,
      error instanceof Error ? error.message : "Default contract book could not be rebuilt."
    );
    return;
  }

  const trades = buildDayAheadAuctionTrades(scenario, contracts);
  const settlement = settlePortfolio(scenario.periods, contracts, trades);

  if (contracts.length !== portfolio.defaultContractTemplateIds.length) {
    addIssue(issues, "error", "settlement", id, "Default contract book was not rebuilt exactly.");
  }

  if (trades.some((trade) => !trade.accepted || trade.volumeMwh <= 0 || !isFiniteNumber(trade.pricePlnMwh))) {
    addIssue(issues, "error", "settlement", id, "Day-ahead setup contains invalid trades.");
  }

  if (settlement.periods.length !== PERIODS_PER_DAY) {
    addIssue(issues, "error", "settlement", id, "Settlement result does not cover all periods.");
  }

  if (
    ![
      settlement.totalPnl,
      settlement.contractPnl,
      settlement.marketPnl,
      settlement.imbalancePnl,
      settlement.serviceFees,
      settlement.transactionFees,
      settlement.totalImbalanceAbsMwh,
    ].every(isFiniteNumber)
  ) {
    addIssue(issues, "error", "settlement", id, "Settlement totals contain non-finite values.");
  }

  const hasEnergyExposure = contracts.some((contract) =>
    scenario.periods.some((period) => evaluateContractVolume(contract, period, "forecast") > 0)
  );

  if (!hasEnergyExposure) {
    addIssue(issues, "error", "settlement", id, "Portfolio has no forecast energy exposure.");
  }
}

export function validateBuiltInData(): DataIntegrityReport {
  const issues: DataIntegrityIssue[] = [];
  const templateIds = validateContractCatalog(issues);

  validatePortfolioCatalog(templateIds, issues);
  validateUniqueValues(
    issues,
    "scenarios",
    SCENARIOS.map((scenario) => scenario.id),
    "scenario-catalog",
    "scenario id"
  );

  SCENARIOS.forEach((definition) => {
    const scenario = createScenario(definition.id);

    validateScenario(scenario, issues);
    PORTFOLIOS.forEach((portfolio) =>
      validateScenarioPortfolioSettlement(scenario, portfolio, issues)
    );
  });

  return {
    errors: issues.filter((issue) => issue.severity === "error"),
    warnings: issues.filter((issue) => issue.severity === "warning"),
  };
}

export function assertBuiltInDataIntegrity(): void {
  const report = validateBuiltInData();

  if (report.errors.length === 0) {
    return;
  }

  const messages = report.errors
    .map((issue) => `[${issue.area}:${issue.id}] ${issue.message}`)
    .join("\n");

  throw new Error(`Built-in grid balancing data failed integrity checks:\n${messages}`);
}
