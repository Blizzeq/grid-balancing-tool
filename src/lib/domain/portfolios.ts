import { portfolioIdSchema, type PortfolioDefinition, type PortfolioId } from "./types";

export const PORTFOLIOS: PortfolioDefinition[] = [
  {
    id: "alpha-power",
    name: "Alpha Power",
    shortName: "Alpha",
    description: "Balanced RES-plus-load book used as the default training portfolio.",
    marketArea: "PL Market",
    baseCurrency: "PLN",
    balancingParty: "BRP Alpha",
    defaultContractTemplateIds: [
      "ppa-pv-pay-as-produced",
      "industrial-retail-load",
      "base-forward-buy",
    ],
  },
  {
    id: "renewables-ppa",
    name: "Renewables PPA Book",
    shortName: "RES PPA",
    description: "Generation-heavy book with merchant and shaped-sale exposure.",
    marketArea: "PL Market",
    baseCurrency: "PLN",
    balancingParty: "BRP Renewables",
    defaultContractTemplateIds: [
      "ppa-pv-pay-as-produced",
      "peak-shaped-sell",
      "swing-flex-buy",
    ],
  },
  {
    id: "industrial-supply",
    name: "Industrial Supply Desk",
    shortName: "Supply",
    description: "Load-serving book hedged with BASE and flexible intraday optionality.",
    marketArea: "PL Market",
    baseCurrency: "PLN",
    balancingParty: "BRP Supply",
    defaultContractTemplateIds: [
      "industrial-retail-load",
      "base-forward-buy",
      "swing-flex-buy",
    ],
  },
];

export function parsePortfolioId(value: string): PortfolioId | undefined {
  const parsed = portfolioIdSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

export function getPortfolioDefinition(portfolioId: PortfolioId): PortfolioDefinition {
  const portfolio = PORTFOLIOS.find((candidate) => candidate.id === portfolioId);

  if (!portfolio) {
    throw new Error(`Unknown portfolio id: ${portfolioId}`);
  }

  return portfolio;
}
