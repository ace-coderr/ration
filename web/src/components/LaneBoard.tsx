import { LayoutGroup, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChainBadge, Skeleton, Ticker } from "./kit";
import { LANES, SYMBOL } from "@/lib/config";
import { fmtAmt, num } from "@/lib/format";
import { onNewEvents, useSnapshot, type Ev, type Snapshot } from "@/state/data";

const N = 20; // the budget is drawn as 20 equal blocks

type Bucket = string; // "slice:base" | "spent:base" | "transit"
interface Block { id: number; bucket: Bucket }
interface Virt { slice: Record<string, bigint>; spent: Record<string, bigint>; transit: bigint; budget: bigint }

const bucketsOf = () => [...LANES.flatMap((l) => [`slice:${l.key}`, `spent:${l.key}`]), "transit"];

function fromSnapshot(s: Snapshot): Virt {
  const slice: Record<string, bigint> = {};
  const spent: Record<string, bigint> = {};
  let inLanes = 0n;
  for (const l of s.lanes) { slice[l.cfg.key] = l.slice; spent[l.cfg.key] = l.spent; inLanes += l.slice + l.spent; }
  const budget = s.hub.epochBudget;
  return { slice, spent, transit: budget > inLanes ? budget - inLanes : 0n, budget };
}

/** Largest-remainder rounding so the 20 blocks always add up. */
function allocate(v: Virt): Record<Bucket, number> {
  const vals: [Bucket, number][] = [];
  for (const l of LANES) { vals.push([`slice:${l.key}`, num(v.slice[l.key] ?? 0n)], [`spent:${l.key}`, num(v.spent[l.key] ?? 0n)]); }
  vals.push(["transit", num(v.transit)]);
  const total = num(v.budget) || 1;
  const exact = vals.map(([b, x]) => [b, (x / total) * N] as [Bucket, number]);
  const out: Record<Bucket, number> = {};
  let used = 0;
  for (const [b, x] of exact) { out[b] = Math.floor(x); used += out[b]; }
  const rest = [...exact].sort((a, b) => (b[1] % 1) - (a[1] % 1));
  for (let i = 0; used < N && i < rest.length; i++, used++) out[rest[i][0]] += 1;
  return out;
}

function reconcile(prev: Block[], target: Record<Bucket, number>): Block[] {
  const counts: Record<Bucket, number> = {};
  for (const b of bucketsOf()) counts[b] = 0;
  for (const b of prev) counts[b.bucket] = (counts[b.bucket] ?? 0) + 1;
  const pool: number[] = [];
  const next = prev.map((b) => ({ ...b }));
  for (const bucket of bucketsOf()) {
    let extra = counts[bucket] - (target[bucket] ?? 0);
    for (let i = next.length - 1; extra > 0 && i >= 0; i--) if (next[i].bucket === bucket) { pool.push(next[i].id); next[i].bucket = ""; extra--; }
  }
  for (const bucket of bucketsOf()) {
    let need = (target[bucket] ?? 0) - counts[bucket];
    while (need > 0 && pool.length) { const id = pool.shift()!; next.find((b) => b.id === id)!.bucket = bucket; need--; }
  }
  return next.map((b) => (b.bucket === "" ? { ...b, bucket: "transit" } : b));
}

function apply(v: Virt, e: Ev): Virt {
  const k = e.chain;
  const n: Virt = { ...v, slice: { ...v.slice }, spent: { ...v.spent } };
  if (e.kind === "spent") { n.slice[k] = (n.slice[k] ?? 0n) - e.args.amount; n.spent[k] = (n.spent[k] ?? 0n) + e.args.amount; }
  else if (e.kind === "released") { n.slice[k] = (n.slice[k] ?? 0n) - e.args.actual; n.transit += e.args.actual; }
  else if (e.kind === "granted") { n.slice[k] = (n.slice[k] ?? 0n) + e.args.amount; n.transit = n.transit > e.args.amount ? n.transit - e.args.amount : 0n; }
  else if (e.kind === "reset") { n.slice[k] = e.args.slice; n.spent[k] = 0n; n.transit = 0n; n.budget = e.args.budget > n.budget ? e.args.budget : n.budget; }
  return n;
}

export function LaneBoard({ compact = false, onStep }: { compact?: boolean; onStep?: (e: Ev) => void }) {
  const { data, isLoading } = useSnapshot();
  const [virt, setVirt] = useState<Virt | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const queue = useRef<Ev[]>([]);
  const lastStep = useRef(0);
  const virtRef = useRef<Virt | null>(null);
  virtRef.current = virt;

  // first snapshot seeds the board; later snapshots re-sync once the event queue is quiet
  useEffect(() => {
    if (!data || data.hub.epochBudget === 0n) return;
    if (!virtRef.current || (queue.current.length === 0 && Date.now() - lastStep.current > 2600)) setVirt(fromSnapshot(data));
  }, [data]);

  // live events animate one at a time so the two-phase handoff is visible
  useEffect(
    () =>
      onNewEvents((fresh) => {
        const cutoff = Date.now() / 1000 - 20;
        const mine = fresh.filter((e) => ["spent", "released", "granted", "reset"].includes(e.kind) && e.ts >= cutoff);
        queue.current.push(...mine);
        queue.current.sort((a, b) => a.ts - b.ts || Number(a.block - b.block));
      }),
    [],
  );
  useEffect(() => {
    const t = setInterval(() => {
      const e = queue.current.shift();
      if (!e || !virtRef.current) return;
      lastStep.current = Date.now();
      setVirt((v) => (v ? apply(v, e) : v));
      onStep?.(e);
    }, 1150);
    return () => clearInterval(t);
  }, [onStep]);

  const target = useMemo(() => (virt ? allocate(virt) : null), [virt]);
  useEffect(() => {
    if (!target) return;
    setBlocks((prev) => {
      if (!prev.length) {
        const out: Block[] = [];
        let id = 0;
        for (const b of bucketsOf()) for (let i = 0; i < (target[b] ?? 0); i++) out.push({ id: id++, bucket: b });
        return out;
      }
      return reconcile(prev, target);
    });
  }, [target]);

  const laneState = useCallback((key: string) => data?.lanes.find((l) => l.cfg.key === key), [data]);

  if (isLoading || !virt) {
    return (
      <div className="board" aria-busy>
        {LANES.map((l) => (<div className="lane" key={l.key}><Skeleton h={70} /><Skeleton h={62} r={16} /></div>))}
      </div>
    );
  }

  const unit = num(virt.budget) / N;
  return (
    <LayoutGroup>
      <div className="board">
        {LANES.map((l, i) => {
          const st = laneState(l.key);
          const mine = blocks.filter((b) => b.bucket === `slice:${l.key}`);
          const gone = blocks.filter((b) => b.bucket === `spent:${l.key}`);
          return (
            <motion.section
              key={l.key} className="lane" aria-label={`${l.name} lane`}
              initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * i, duration: 0.45 }}
            >
              <div className="lane-meta">
                <div className="row" style={{ gap: 8 }}><ChainBadge lane={l} />{st?.paused && <span className="badge warn"><i />Paused</span>}{st && st.debt > 0n && <span className="badge bad"><i />Out of fuel</span>}</div>
                <div className="lane-name">{l.name}</div>
                <div className="lane-slice"><Ticker value={num(virt.slice[l.key] ?? 0n)} format={(n) => Math.round(n).toLocaleString("en-US")} /><span className="muted" style={{ fontSize: 14, marginLeft: 6 }}>{SYMBOL}</span></div>
                {!compact && <div className="helper">spent here this period: {fmtAmt(virt.spent[l.key])}</div>}
              </div>
              <div className={`track ${mine.length + gone.length === 0 ? "empty" : ""}`} aria-label={`${fmtAmt(virt.slice[l.key])} ${SYMBOL} spendable on ${l.name}`}>
                {mine.map((b) => (<motion.div key={b.id} layoutId={`blk-${b.id}`} className="blk slice" transition={{ type: "spring", stiffness: 190, damping: 24, mass: 1.1 }} />))}
                {gone.map((b) => (<motion.div key={b.id} layoutId={`blk-${b.id}`} className="blk spent" transition={{ type: "spring", stiffness: 190, damping: 24 }} title="Spent" />))}
              </div>
            </motion.section>
          );
        })}
        <div className="transit" aria-label="Allowance in flight">
          <div className="lane-meta">
            <span className="eyebrow" style={{ fontSize: 11 }}>In flight</span>
            <div className="num" style={{ fontWeight: 700, fontSize: 22 }}><Ticker value={num(virt.transit)} format={(n) => Math.round(n).toLocaleString("en-US")} /> <span className="muted" style={{ fontSize: 13 }}>{SYMBOL}</span></div>
          </div>
          <div className="track">
            {blocks.filter((b) => b.bucket === "transit").map((b) => (<motion.div key={b.id} layoutId={`blk-${b.id}`} className="blk flight" transition={{ type: "spring", stiffness: 190, damping: 24 }} />))}
            {!blocks.some((b) => b.bucket === "transit") && <span className="helper" style={{ padding: "10px 6px" }}>Nothing moving. A slice leaves one chain before it lands on the next, so it is never counted twice.</span>}
          </div>
        </div>
        {!compact && <p className="helper" style={{ marginTop: 2 }}>One block is about {Math.round(unit).toLocaleString("en-US")} {SYMBOL}. Lime blocks can be spent now. Dark blocks are spent.</p>}
      </div>
    </LayoutGroup>
  );
}
