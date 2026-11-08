import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { clientFor } from "@/lib/chains";
import { hubAbi, payableAbi, vaultAbi, erc20Abi } from "@/lib/abi";
import { HUB, HUB_DEPLOY_BLOCK, LANES, SYSTEM, laneByChain, type LaneCfg } from "@/lib/config";

// ---------------------------------------------------------------- snapshot

export interface LaneSnap {
  cfg: LaneCfg;
  ok: boolean;
  slice: bigint;
  spent: bigint;
  epochId: bigint;
  epochEnd: bigint;
  epochBudget: bigint;
  paused: boolean;
  restrict: boolean;
  owner: Address;
  tokenBalance: bigint;
  tokenAllowed: boolean;
  reserve: bigint;
  debt: bigint;
  native: bigint;
  chainTime: number;
}

export interface HubLane {
  chainId: number;
  vault: Address;
  weightBps: number;
  lowBps: number;
  active: boolean;
  slice: bigint;
  pendingOut: bigint;
  inbound: Hex;
}

export interface HubSnap {
  ok: boolean;
  owner: Address;
  cronInterval: bigint;
  budget: bigint;
  epochLength: bigint;
  refillBps: number;
  timeout: bigint;
  minTransfer: bigint;
  callbackGas: bigint;
  epochId: bigint;
  epochStart: bigint;
  epochEnd: bigint;
  epochBudget: bigint;
  lanes: HubLane[];
  reserve: bigint;
  debt: bigint;
  native: bigint;
  chainTime: number;
}

export interface Snapshot {
  hub: HubSnap;
  lanes: LaneSnap[];
  fetchedAt: number;
}

async function fetchLane(cfg: LaneCfg): Promise<LaneSnap> {
  const c = clientFor(cfg.key);
  const v = { address: cfg.vault, abi: vaultAbi } as const;
  const [slice, spent, epochId, epochEnd, epochBudget, paused, restrict, owner, tokenBalance, tokenAllowed, reserve, debt, native, block] =
    await Promise.all([
      c.readContract({ ...v, functionName: "slice" }),
      c.readContract({ ...v, functionName: "spentInEpoch" }),
      c.readContract({ ...v, functionName: "epochId" }),
      c.readContract({ ...v, functionName: "epochEnd" }),
      c.readContract({ ...v, functionName: "epochBudget" }),
      c.readContract({ ...v, functionName: "paused" }),
      c.readContract({ ...v, functionName: "restrictRecipients" }),
      c.readContract({ ...v, functionName: "owner" }),
      c.readContract({ address: cfg.token, abi: erc20Abi, functionName: "balanceOf", args: [cfg.vault] }),
      c.readContract({ ...v, functionName: "tokenAllowed", args: [cfg.token] }),
      c.readContract({ address: cfg.callbackProxy, abi: payableAbi, functionName: "reserves", args: [cfg.vault] }),
      c.readContract({ address: cfg.callbackProxy, abi: payableAbi, functionName: "debts", args: [cfg.vault] }),
      c.getBalance({ address: cfg.vault }),
      c.getBlock({ blockTag: "latest" }),
    ]);
  return {
    cfg, ok: true, slice, spent, epochId, epochEnd, epochBudget, paused, restrict, owner, tokenBalance, tokenAllowed,
    reserve, debt, native, chainTime: Number(block.timestamp),
  };
}

async function fetchHub(): Promise<HubSnap> {
  const c = clientFor("lasna");
  const h = { address: HUB, abi: hubAbi } as const;
  const [owner, cronInterval, budget, epochLength, refillBps, timeout, minTransfer, callbackGas, epochId, epochStart, epochEnd, epochBudget, laneCount, reserve, debt, native, block] =
    await Promise.all([
      c.readContract({ ...h, functionName: "OWNER" }),
      c.readContract({ ...h, functionName: "CRON_INTERVAL" }),
      c.readContract({ ...h, functionName: "budget" }),
      c.readContract({ ...h, functionName: "epochLength" }),
      c.readContract({ ...h, functionName: "refillBps" }),
      c.readContract({ ...h, functionName: "timeout" }),
      c.readContract({ ...h, functionName: "minTransfer" }),
      c.readContract({ ...h, functionName: "callbackGas" }),
      c.readContract({ ...h, functionName: "epochId" }),
      c.readContract({ ...h, functionName: "epochStart" }),
      c.readContract({ ...h, functionName: "epochEnd" }),
      c.readContract({ ...h, functionName: "epochBudget" }),
      c.readContract({ ...h, functionName: "laneCount" }),
      c.readContract({ address: SYSTEM, abi: payableAbi, functionName: "reserves", args: [HUB] }),
      c.readContract({ address: SYSTEM, abi: payableAbi, functionName: "debts", args: [HUB] }),
      c.getBalance({ address: HUB }),
      c.getBlock({ blockTag: "latest" }),
    ]);
  const lanes: HubLane[] = [];
  for (let i = 0n; i < laneCount; i++) {
    const l = await c.readContract({ ...h, functionName: "laneAt", args: [i] });
    lanes.push({
      chainId: Number(l.chainId), vault: l.vault, weightBps: l.weightBps, lowBps: l.lowBps, active: l.active,
      slice: l.slice, pendingOut: l.pendingOut, inbound: l.inbound,
    });
  }
  return {
    ok: true, owner, cronInterval, budget, epochLength, refillBps, timeout, minTransfer, callbackGas, epochId, epochStart,
    epochEnd, epochBudget, lanes, reserve, debt, native, chainTime: Number(block.timestamp),
  };
}

export async function fetchSnapshot(): Promise<Snapshot> {
  const [hub, ...lanes] = await Promise.all([fetchHub(), ...LANES.map(fetchLane)]);
  return { hub, lanes: lanes as LaneSnap[], fetchedAt: Date.now() };
}

export function useSnapshot() {
  return useQuery({
    queryKey: ["snapshot"],
    queryFn: fetchSnapshot,
    refetchInterval: 4000,
    staleTime: 2000,
    retry: 2,
    placeholderData: (prev) => prev,
  });
}

/** True when the last good read is old, or the latest refresh failed. */
export function useStale(): boolean {
  const q = useSnapshot();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(t);
  }, []);
  if (!q.data) return false;
  return q.isError || now - q.data.fetchedAt > 25_000;
}

// ---------------------------------------------------------------- events

export type EvKind =
  | "spent" | "released" | "granted" | "reset"
  | "spenderSet" | "requested" | "hubReleased" | "granting" | "done" | "expired" | "epochStarted";

export interface Ev {
  id: string;
  chain: string; // lane key or "lasna"
  kind: EvKind;
  block: bigint;
  tx: Hex;
  logIndex: number;
  ts: number;
  args: Record<string, any>;
}

interface Store {
  events: Map<string, Ev>;
  last: Map<string, bigint>; // chain -> last block scanned
  blockTs: Map<string, number>;
  listeners: Set<(fresh: Ev[]) => void>;
  loaded: boolean;
}

const store: Store = { events: new Map(), last: new Map(), blockTs: new Map(), listeners: new Set(), loaded: false };

async function scan(chain: string, address: Address, abi: any, from: bigint, normalize: (log: any) => Omit<Ev, "id" | "chain"> | null): Promise<Ev[]> {
  const c = clientFor(chain);
  const latest = await c.getBlockNumber();
  const start = store.last.has(chain) ? store.last.get(chain)! + 1n : from;
  if (start > latest) return [];
  const out: Ev[] = [];
  let step = chain === "lasna" ? 40_000n : 2_000n;
  let cur = start;
  while (cur <= latest) {
    const to = cur + step - 1n > latest ? latest : cur + step - 1n;
    try {
      const logs = await c.getContractEvents({ address, abi, fromBlock: cur, toBlock: to });
      for (const l of logs) {
        const n = normalize(l);
        if (n) out.push({ ...n, id: `${chain}:${l.transactionHash}:${l.logIndex}`, chain });
      }
      cur = to + 1n;
    } catch (e) {
      if (step <= 500n) throw e;
      step = step / 2n;
    }
  }
  store.last.set(chain, latest);
  return out;
}

async function hubTs(block: bigint): Promise<number> {
  const k = block.toString();
  const hit = store.blockTs.get(k);
  if (hit) return hit;
  const b = await clientFor("lasna").getBlock({ blockNumber: block });
  const t = Number(b.timestamp);
  store.blockTs.set(k, t);
  return t;
}

const VAULT_KINDS: Record<string, EvKind> = { Spent: "spent", Released: "released", Granted: "granted", EpochReset: "reset", SpenderSet: "spenderSet" };
const HUB_KINDS: Record<string, EvKind> = {
  TransferRequested: "requested", TransferReleased: "hubReleased", TransferGranting: "granting",
  TransferDone: "done", TransferExpired: "expired", EpochStarted: "epochStarted",
};

export async function refreshEvents(): Promise<Ev[]> {
  const fresh: Ev[] = [];
  const jobs = [
    ...LANES.map((lane) =>
      scan(lane.key, lane.vault, vaultAbi, BigInt(lane.deployBlock), (l) => {
        const kind = VAULT_KINDS[l.eventName as string];
        if (!kind) return null;
        return { kind, block: l.blockNumber!, tx: l.transactionHash!, logIndex: l.logIndex!, ts: l.args.timestamp !== undefined ? Number(l.args.timestamp) : 0, args: l.args };
      }),
    ),
    scan("lasna", HUB, hubAbi, BigInt(HUB_DEPLOY_BLOCK), (l) => {
      const kind = HUB_KINDS[l.eventName as string];
      if (!kind) return null;
      return { kind, block: l.blockNumber!, tx: l.transactionHash!, logIndex: l.logIndex!, ts: 0, args: l.args };
    }),
  ];
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === "fulfilled") fresh.push(...r.value);
  // hub events carry no timestamp: read their blocks
  const needTs = [...new Set(fresh.filter((e) => e.chain === "lasna").map((e) => e.block))];
  await Promise.all(needTs.map(async (b) => { try { await hubTs(b); } catch { /* retried next poll */ } }));
  for (const e of fresh) if (e.chain === "lasna") e.ts = store.blockTs.get(e.block.toString()) ?? 0;
  const added = fresh.filter((e) => !store.events.has(e.id) && (e.chain !== "lasna" || e.ts > 0));
  for (const e of added) store.events.set(e.id, e);
  store.loaded = true;
  if (added.length) store.listeners.forEach((fn) => fn(added));
  return added;
}

export function onNewEvents(fn: (fresh: Ev[]) => void): () => void {
  store.listeners.add(fn);
  return () => store.listeners.delete(fn);
}

export const sortEvents = (a: Ev, b: Ev) => (a.ts !== b.ts ? a.ts - b.ts : a.block !== b.block ? (a.block < b.block ? -1 : 1) : a.logIndex - b.logIndex);

export function useEvents() {
  const q = useQuery({
    queryKey: ["events"],
    queryFn: async () => {
      await refreshEvents();
      return [...store.events.values()].sort(sortEvents);
    },
    refetchInterval: 4000,
    retry: 2,
    placeholderData: (prev) => prev,
  });
  const events = q.data ?? [];
  return { events, transfers: deriveTransfers(events), isLoading: q.isLoading, isError: q.isError && !q.data };
}

// ---------------------------------------------------------------- transfers

export interface TransferView {
  id: Hex;
  fromKey: string; // donor lane
  toKey: string; // lane that asked for more
  requested: bigint;
  actual?: bigint;
  requestedTs: number;
  releasedTs?: number;
  grantedTs?: number;
  doneTs?: number;
  triggerTs?: number; // the spend that crossed the watermark
  state: "requested" | "granting" | "done" | "expired";
  latency?: number; // seconds, spend to grant landed
  tx: { requested?: Hex; released?: Hex; granting?: Hex; granted?: Hex; done?: Hex };
}

export function deriveTransfers(events: Ev[]): TransferView[] {
  const map = new Map<string, TransferView>();
  const get = (id: Hex) => map.get(id);
  for (const e of events) {
    const id = (e.args.transferId ?? "") as Hex;
    if (e.kind === "requested") {
      const from = laneByChain(Number(e.args.fromChain))?.key ?? "?";
      const to = laneByChain(Number(e.args.toChain))?.key ?? "?";
      map.set(id, { id, fromKey: from, toKey: to, requested: e.args.amount, requestedTs: e.ts, state: "requested", tx: { requested: e.tx } });
    } else if (e.kind === "released") {
      const t = get(id);
      if (t) { t.releasedTs = e.ts; t.actual = e.args.actual; t.tx.released = e.tx; }
    } else if (e.kind === "granting") {
      const t = get(id);
      if (t) { t.state = t.state === "done" ? "done" : "granting"; t.tx.granting = e.tx; }
    } else if (e.kind === "granted") {
      const t = get(id);
      if (t) { t.grantedTs = e.ts; t.tx.granted = e.tx; }
    } else if (e.kind === "done") {
      const t = get(id);
      if (t) { t.state = "done"; t.doneTs = e.ts; t.tx.done = e.tx; }
    } else if (e.kind === "expired") {
      const t = get(id);
      if (t && t.state !== "done") t.state = "expired";
    }
  }
  const spends = events.filter((e) => e.kind === "spent");
  for (const t of map.values()) {
    const trigger = [...spends].reverse().find((s) => s.chain === t.toKey && s.ts <= t.requestedTs + 1);
    t.triggerTs = trigger?.ts;
    if (t.grantedTs && t.triggerTs) t.latency = Math.max(0, t.grantedTs - t.triggerTs);
  }
  return [...map.values()].sort((a, b) => b.requestedTs - a.requestedTs);
}
