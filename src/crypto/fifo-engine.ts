import { randomUUID } from "node:crypto";
import type { CryptoTransaction } from "./types.js";
import { PriceResolver } from "./price-resolver.js";

export type CryptoLot = {
  id: string;
  asset: string;
  acquired_at: string;
  quantity: number;
  cost_basis_eur: number;
  remaining_qty: number;
  source_tx_id?: string;
};

export type FifoMatch = {
  lot_id: string;
  quantity: number;
  cost_basis_eur: number;
  proceeds_eur: number;
  realized_pnl_eur: number;
};

export type FifoTxResult = {
  tx: CryptoTransaction;
  resolved_fiat_eur: number | null;
  matches: FifoMatch[];
  realized_pnl_eur: number;
};

export type FifoResult = {
  lots: CryptoLot[];
  tx_results: FifoTxResult[];
  total_realized_pnl_eur: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function resolveTxFiatEur(tx: CryptoTransaction, resolver: PriceResolver): Promise<number | null> {
  if (tx.fiat_amount_eur != null) return tx.fiat_amount_eur;
  const price = await resolver.resolveEur(tx.asset, tx.occurred_at);
  if (price == null) return null;
  return round2(Math.abs(tx.quantity) * price);
}

/** FIFO lot matching on sells/swaps; enriches missing EUR via shared `crypto_market_minute`. */
export async function applyFifo(
  txs: CryptoTransaction[],
  resolver: PriceResolver = new PriceResolver()
): Promise<FifoResult> {
  const sorted = [...txs].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const lotsByAsset = new Map<string, CryptoLot[]>();
  const txResults: FifoTxResult[] = [];
  let totalRealized = 0;

  for (const tx of sorted) {
    const asset = tx.asset.toUpperCase();
    const lots = lotsByAsset.get(asset) ?? [];
    const resolvedFiat = await resolveTxFiatEur(tx, resolver);
    const matches: FifoMatch[] = [];
    let realized = 0;

    if (tx.tx_type === "buy" || tx.tx_type === "transfer_in" || tx.tx_type === "staking_reward") {
      const qty = Math.abs(tx.quantity);
      if (qty > 0 && resolvedFiat != null && resolvedFiat > 0) {
        lots.push({
          id: randomUUID(),
          asset,
          acquired_at: tx.occurred_at,
          quantity: qty,
          cost_basis_eur: resolvedFiat,
          remaining_qty: qty,
          source_tx_id: tx.id,
        });
      }
    } else if (tx.tx_type === "sell" || tx.tx_type === "swap") {
      let sellQty = Math.abs(tx.quantity);
      const proceeds = resolvedFiat ?? 0;
      const proceedsPerUnit = sellQty > 0 ? proceeds / sellQty : 0;

      while (sellQty > 0 && lots.length) {
        const lot = lots[0]!;
        const take = Math.min(sellQty, lot.remaining_qty);
        const costSlice = round2((lot.cost_basis_eur / lot.quantity) * take);
        const proceedsSlice = round2(proceedsPerUnit * take);
        const pnl = round2(proceedsSlice - costSlice);
        realized += pnl;
        matches.push({
          lot_id: lot.id,
          quantity: take,
          cost_basis_eur: costSlice,
          proceeds_eur: proceedsSlice,
          realized_pnl_eur: pnl,
        });
        lot.remaining_qty -= take;
        sellQty -= take;
        if (lot.remaining_qty <= 0) lots.shift();
      }
    }

    lotsByAsset.set(
      asset,
      lots.filter((l) => l.remaining_qty > 0)
    );
    totalRealized += realized;
    txResults.push({
      tx: { ...tx, fiat_amount_eur: resolvedFiat ?? tx.fiat_amount_eur },
      resolved_fiat_eur: resolvedFiat,
      matches,
      realized_pnl_eur: round2(realized),
    });
  }

  const allLots = [...lotsByAsset.values()].flat();
  return {
    lots: allLots,
    tx_results: txResults,
    total_realized_pnl_eur: round2(totalRealized),
  };
}
