import { orderDraftSchema, type MarketTrade, type OrderDraft, type PeriodSnapshot } from "./types";

const TRANSACTION_FEE_PLN_MWH = 0.75;

export interface OrderExecution {
  accepted: boolean;
  trade?: MarketTrade;
  reason: string;
}

function round(value: number, precision = 2): number {
  return Number(value.toFixed(precision));
}

export function createTradeId(actor: MarketTrade["actor"], periodIndex: number, count: number) {
  return `${actor}-${periodIndex}-${count + 1}`;
}

export function executeOrder(
  draft: OrderDraft,
  period: PeriodSnapshot,
  submittedAtPeriod: number,
  actor: MarketTrade["actor"],
  tradeCount: number
): OrderExecution {
  const parsed = orderDraftSchema.safeParse(draft);

  if (!parsed.success) {
    return {
      accepted: false,
      reason: parsed.error.issues[0]?.message ?? "Invalid order.",
    };
  }

  if (draft.periodIndex <= submittedAtPeriod) {
    return {
      accepted: false,
      reason: "Gate closure: current and past 15-minute periods are already locked.",
    };
  }

  if (draft.volumeMwh > period.liquidityMwh) {
    return {
      accepted: false,
      reason: `Insufficient RDB liquidity: ${period.liquidityMwh.toFixed(1)} MWh available.`,
    };
  }

  const liquidityRatio = draft.volumeMwh / Math.max(period.liquidityMwh, 1);
  const slippage = liquidityRatio * 5.5;
  const executablePrice =
    draft.side === "buy" ? period.intradayAsk + slippage : period.intradayBid - slippage;

  if (draft.side === "buy" && draft.limitPrice < executablePrice) {
    return {
      accepted: false,
      reason: `Buy limit below best executable ask (${round(executablePrice)} PLN/MWh).`,
    };
  }

  if (draft.side === "sell" && draft.limitPrice > executablePrice) {
    return {
      accepted: false,
      reason: `Sell limit above best executable bid (${round(executablePrice)} PLN/MWh).`,
    };
  }

  return {
    accepted: true,
    reason: "Order matched on the simulated intraday book.",
    trade: {
      id: createTradeId(actor, draft.periodIndex, tradeCount),
      actor,
      side: draft.side,
      market: draft.market,
      periodIndex: draft.periodIndex,
      volumeMwh: round(draft.volumeMwh),
      pricePlnMwh: round(executablePrice),
      submittedAtPeriod,
      accepted: true,
    },
  };
}

export function getTransactionFeePlnMwh(): number {
  return TRANSACTION_FEE_PLN_MWH;
}
