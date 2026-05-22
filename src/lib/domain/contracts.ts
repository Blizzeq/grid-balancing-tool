import type {
  Contract,
  ContractSettlement,
  ContractTemplate,
  PeriodSnapshot,
} from "./types";

export const CONTRACT_TEMPLATES: ContractTemplate[] = [
  {
    templateId: "ppa-pv-pay-as-produced",
    name: "PV PPA pay-as-produced",
    type: "ppa-pay-as-produced",
    side: "buy",
    counterparty: "Renewable SPV",
    deliveryStart: 0,
    deliveryEnd: 95,
    granularity: "15m",
    volumeFormula: { kind: "generation-indexed", factor: 1 },
    priceFormula: { kind: "fixed", plnPerMwh: 285 },
    imbalanceResponsibility: "portfolio",
    nominationDeadline: "D-1 14:30",
    penaltyRule: "No penalty; production profile risk remains with portfolio.",
    settlementRule: "Actual metered generation settles at fixed PPA price.",
    serviceFeePerMwh: 2.5,
    rationale:
      "Adds renewable volume and imbalance risk, especially when PV forecast misses cloud ramps.",
    risk: "Long surplus risk during low or negative price periods.",
  },
  {
    templateId: "industrial-retail-load",
    name: "Industrial retail supply",
    type: "retail-load",
    side: "sell",
    counterparty: "Industrial LoadCo",
    deliveryStart: 0,
    deliveryEnd: 95,
    granularity: "15m",
    volumeFormula: { kind: "load-indexed", factor: 0.85 },
    priceFormula: { kind: "spot-indexed", premium: 34 },
    imbalanceResponsibility: "portfolio",
    nominationDeadline: "D-1 13:00",
    penaltyRule: "Load deviation is carried into balancing settlement.",
    settlementRule: "Actual consumption settles spot plus supply margin.",
    serviceFeePerMwh: 1.8,
    rationale:
      "Creates natural demand against OZE but load forecast errors can make the book short.",
    risk: "Short exposure during evening peaks and colder-than-forecast periods.",
  },
  {
    templateId: "base-forward-buy",
    name: "BASE forward hedge",
    type: "forward-otc",
    side: "buy",
    counterparty: "OTC Trader",
    deliveryStart: 0,
    deliveryEnd: 95,
    granularity: "block",
    volumeFormula: { kind: "fixed", mwh: 7 },
    priceFormula: { kind: "fixed", plnPerMwh: 318 },
    imbalanceResponsibility: "portfolio",
    nominationDeadline: "D-1 12:00",
    penaltyRule: "Firm nomination; no shape optionality.",
    settlementRule: "Fixed BASE energy profile.",
    serviceFeePerMwh: 0,
    rationale: "Stabilizes a structurally short book across the whole day.",
    risk: "Can become excess supply in midday PV oversupply scenarios.",
  },
  {
    templateId: "peak-shaped-sell",
    name: "PEAK shaped sell",
    type: "shaped-profile",
    side: "sell",
    counterparty: "Utility Buyer",
    deliveryStart: 28,
    deliveryEnd: 84,
    granularity: "hourly",
    volumeFormula: { kind: "fixed", mwh: 8.5, peakOnly: true },
    priceFormula: { kind: "fixed", plnPerMwh: 466 },
    imbalanceResponsibility: "portfolio",
    nominationDeadline: "D-1 15:00",
    penaltyRule: "Firm shape; missing volume is settled at imbalance.",
    settlementRule: "Peak-hours shaped delivery.",
    serviceFeePerMwh: 0,
    rationale: "Monetizes high-price hours when generation and hedges cover load.",
    risk: "Dangerous if wind fades or evening load is underestimated.",
  },
  {
    templateId: "swing-flex-buy",
    name: "Flexible swing buy",
    type: "flexible-swing",
    side: "buy",
    counterparty: "Flex Provider",
    deliveryStart: 44,
    deliveryEnd: 88,
    granularity: "15m",
    volumeFormula: { kind: "swing", nominatedMwh: 5, minMwh: 0, maxMwh: 12 },
    priceFormula: { kind: "spot-indexed", premium: 18 },
    imbalanceResponsibility: "counterparty",
    nominationDeadline: "D intraday - 60 min",
    penaltyRule: "Nominations outside min/max are clipped and charged at premium.",
    settlementRule: "Nominated flexible profile within min/max band.",
    serviceFeePerMwh: -1.2,
    rationale: "Buys optionality against short evening periods.",
    risk: "Premium erodes PnL when the book is already balanced.",
  },
];

export function createDefaultContracts(): Contract[] {
  return ["ppa-pv-pay-as-produced", "industrial-retail-load", "base-forward-buy"].map(
    (templateId, index) => createContractFromTemplate(templateId, `seed-${index + 1}`)
  );
}

export function createContractFromTemplate(templateId: string, suffix: string): Contract {
  const template =
    CONTRACT_TEMPLATES.find((candidate) => candidate.templateId === templateId) ??
    CONTRACT_TEMPLATES[0];

  return {
    ...template,
    id: `${template.templateId}-${suffix}`,
  };
}

export function evaluateContractVolume(
  contract: Contract,
  period: PeriodSnapshot,
  basis: "forecast" | "actual"
): number {
  if (period.index < contract.deliveryStart || period.index > contract.deliveryEnd) {
    return 0;
  }

  const hour = period.hour;
  const isPeak = hour >= 7 && hour < 22;
  const formula = contract.volumeFormula;

  if ("peakOnly" in formula && formula.peakOnly && !isPeak) {
    return 0;
  }

  switch (formula.kind) {
    case "fixed":
      return formula.mwh;
    case "generation-indexed":
      return (
        (basis === "actual" ? period.actualGeneration : period.forecastGeneration) *
        formula.factor
      );
    case "load-indexed":
      return (basis === "actual" ? period.actualLoad : period.forecastLoad) * formula.factor;
    case "swing":
      return Math.min(Math.max(formula.nominatedMwh, formula.minMwh), formula.maxMwh);
    default:
      return 0;
  }
}

export function evaluateContractPrice(contract: Contract, period: PeriodSnapshot): number {
  const formula = contract.priceFormula;

  if (formula.kind === "fixed") {
    return formula.plnPerMwh;
  }

  return period.rdnPrice + formula.premium;
}

export function settleContractsForPeriod(
  period: PeriodSnapshot,
  contracts: Contract[],
  basis: "forecast" | "actual" = "actual"
): ContractSettlement {
  return contracts.reduce<ContractSettlement>(
    (accumulator, contract) => {
      const volumeMwh = evaluateContractVolume(contract, period, basis);

      if (volumeMwh === 0) {
        return accumulator;
      }

      const price = evaluateContractPrice(contract, period);
      const cashflow = volumeMwh * price;
      const serviceFee = volumeMwh * contract.serviceFeePerMwh;
      const isGeneration = contract.type === "ppa-pay-as-produced";
      const isLoad = contract.type === "retail-load";

      if (contract.side === "buy") {
        accumulator.boughtMwh += volumeMwh;
        accumulator.purchaseCost += cashflow;
      } else {
        accumulator.soldMwh += volumeMwh;
        accumulator.salesRevenue += cashflow;
      }

      if (isGeneration) {
        accumulator.generationMwh += volumeMwh;
      }

      if (isLoad) {
        accumulator.loadMwh += volumeMwh;
      }

      accumulator.serviceFees += serviceFee;
      accumulator.pnl =
        accumulator.salesRevenue +
        accumulator.serviceFees -
        accumulator.purchaseCost -
        accumulator.penalties;

      return accumulator;
    },
    {
      boughtMwh: 0,
      soldMwh: 0,
      generationMwh: 0,
      loadMwh: 0,
      purchaseCost: 0,
      salesRevenue: 0,
      serviceFees: 0,
      penalties: 0,
      pnl: 0,
    }
  );
}
