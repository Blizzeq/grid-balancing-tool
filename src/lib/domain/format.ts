import type { CurrencyCode } from "./types";

export function formatMwh(value: number): string {
  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })} MWh`;
}

export function formatCurrency(value: number, currency: CurrencyCode = "PLN"): string {
  const absValue = Math.abs(value);
  const formatted = absValue.toLocaleString("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });

  return `${value < 0 ? "-" : ""}${formatted} ${currency}`;
}

export function formatPln(value: number): string {
  return formatCurrency(value, "PLN");
}

export function formatPrice(value: number, currency: CurrencyCode = "PLN"): string {
  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  })} ${currency}/MWh`;
}

export function pnlTone(value: number): "positive" | "negative" | "neutral" {
  if (value > 0) {
    return "positive";
  }

  if (value < 0) {
    return "negative";
  }

  return "neutral";
}
