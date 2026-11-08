import { LANES } from "./config";
import type { Ev } from "@/state/data";

export interface EpochCheck {
  epoch: number;
  budget: bigint;
  peak: bigint; // highest slices + spent + in flight ever seen in this epoch
  steps: number;
}
export interface ReplayResult {
  ok: boolean;
  checked: number;
  epochs: EpochCheck[];
  violation?: string;
}

const RANK: Record<string, number> = { reset: 0, spent: 1, released: 2, granted: 3 };

/**
 * Re-plays every vault event in order and checks, after each one, that
 * sum(slices) + spent + in-flight never went above that epoch's budget.
 * Only chain logs are used. A grant is ordered after its own release even if the two chains'
 * one-second timestamps disagree.
 */
export function replay(events: Ev[]): ReplayResult {
  const vaultEvs = events.filter((e) => ["reset", "spent", "released", "granted"].includes(e.kind));
  const releasedTs = new Map<string, number>();
  for (const e of vaultEvs) if (e.kind === "released") releasedTs.set(e.args.transferId, e.ts);
  const eff = (e: Ev) => (e.kind === "granted" ? Math.max(e.ts, releasedTs.get(e.args.transferId) ?? 0) : e.ts);
  const sorted = [...vaultEvs].sort((a, b) => eff(a) - eff(b) || RANK[a.kind] - RANK[b.kind] || Number(a.block - b.block));

  interface St { slice: Record<string, bigint>; spent: Record<string, bigint>; transit: bigint; budget: bigint; peak: bigint; steps: number }
  const epochs = new Map<number, St>();
  const get = (n: number): St => {
    let s = epochs.get(n);
    if (!s) {
      s = { slice: {}, spent: {}, transit: 0n, budget: 0n, peak: 0n, steps: 0 };
      for (const l of LANES) { s.slice[l.key] = 0n; s.spent[l.key] = 0n; }
      epochs.set(n, s);
    }
    return s;
  };
  let violation: string | undefined;
  let checked = 0;

  for (const e of sorted) {
    const n = Number(e.args.epochId);
    const s = get(n);
    const k = e.chain;
    if (e.kind === "reset") {
      s.slice[k] = e.args.slice; s.spent[k] = 0n;
      if (e.args.budget > s.budget) s.budget = e.args.budget;
    } else if (e.kind === "spent") {
      s.slice[k] -= e.args.amount; s.spent[k] += e.args.amount;
    } else if (e.kind === "released") {
      s.slice[k] -= e.args.actual; s.transit += e.args.actual;
    } else if (e.kind === "granted") {
      s.slice[k] += e.args.amount; s.transit = s.transit > e.args.amount ? s.transit - e.args.amount : 0n;
    }
    const total = LANES.reduce((a, l) => a + s.slice[l.key] + s.spent[l.key], 0n) + s.transit;
    if (total > s.peak) s.peak = total;
    s.steps++;
    checked++;
    if (s.budget > 0n && total > s.budget && !violation) violation = `Epoch ${n}: ${total} went above the budget of ${s.budget} at block ${e.block} on ${k}.`;
  }

  return {
    ok: !violation,
    checked,
    violation,
    epochs: [...epochs.entries()].sort((a, b) => a[0] - b[0]).map(([epoch, s]) => ({ epoch, budget: s.budget, peak: s.peak, steps: s.steps })),
  };
}
