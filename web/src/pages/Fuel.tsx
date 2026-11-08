import { motion } from "framer-motion";
import { AlertTriangle, Flame } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { parseEther, type Address } from "viem";
import { ChainBadge, Footnote, PageHead, Rise, Skeleton, Stagger, StateCard, Ticker } from "@/components/kit";
import { payableAbi } from "@/lib/abi";
import { HUB, LASNA, SYSTEM, laneByKey } from "@/lib/config";
import { fmtNative } from "@/lib/format";
import { useSnapshot } from "@/state/data";
import { useWallet } from "@/state/wallet";

// Measured on the live testnets (see docs/EVIDENCE.md): about 0.0276 lREACT per reactive
// transaction and about 0.000003 ETH per callback. Used only to estimate runway.
const COST_HUB = 0.0276;
const COST_CALLBACK = 0.000003;
const WARN_BELOW_OPS = 40;

interface Item {
  id: string;
  title: string;
  chainKey: string;
  chainLabel: string;
  lasna: boolean;
  target: Address; // contract being funded
  payTo: Address; // system contract or callback proxy
  unit: string;
  reserve: bigint;
  debt: bigint;
  balance: bigint;
  healthy: number; // reserve considered "full" for the gauge
  cost: number; // per operation
  chips: string[];
  what: string;
}

function FuelCard({ it }: { it: Item }) {
  const w = useWallet();
  const qc = useQueryClient();
  const [amount, setAmount] = useState(it.chips[1]);
  const [busy, setBusy] = useState(false);
  const reserve = Number(it.reserve) / 1e18;
  const ops = Math.floor(reserve / it.cost);
  const state: "bad" | "warn" | "ok" = it.debt > 0n ? "bad" : ops < WARN_BELOW_OPS ? "warn" : "ok";
  const pct = Math.min(100, (reserve / it.healthy) * 100);
  let wei: bigint | undefined;
  try { wei = parseEther(amount || "0"); } catch { wei = undefined; }

  async function topUp() {
    if (!wei || wei === 0n) return;
    setBusy(true);
    await w.write({
      chain: it.chainKey, address: it.payTo, abi: payableAbi, functionName: "depositTo", args: [it.target], value: wei,
      laneName: it.chainLabel, title: it.debt > 0n ? "Debt cleared first, then fuel added" : `Added ${amount} ${it.unit} of fuel`,
    });
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["snapshot"] });
  }

  return (
    <motion.section className={`card stack ${state === "bad" ? "" : ""}`} layout style={state === "bad" ? { borderColor: "var(--red)" } : state === "warn" ? { borderColor: "var(--amber)" } : undefined} aria-label={`${it.title} fuel`}>
      <div className="row between wrap">
        <div className="row" style={{ gap: 12 }}><h2 className="h2">{it.title}</h2>{it.lasna ? <span className="badge"><i style={{ background: "var(--lime)" }} />Lasna</span> : <ChainBadge lane={laneByKey(it.chainKey)} />}</div>
        <span className={`badge ${state}`}><i />{state === "bad" ? "Out of fuel" : state === "warn" ? "Running low" : "Healthy"}</span>
      </div>
      <p className="helper">{it.what}</p>
      <div className="grid three" style={{ gap: 14 }}>
        <div className="stat"><span className="k">Reserve</span><span className="v sm"><Ticker value={reserve} format={(n) => (n < 1 ? n.toFixed(4) : n.toFixed(2))} /> <span className="muted" style={{ fontSize: 13 }}>{it.unit}</span></span></div>
        <div className="stat"><span className="k">Debt</span><span className="v sm" style={{ color: it.debt > 0n ? "var(--red-ink)" : undefined }}>{it.debt > 0n ? fmtNative(it.debt, 6) : "0"}</span></div>
        <div className="stat"><span className="k">About</span><span className="v sm">{ops.toLocaleString("en-US")} <span className="muted" style={{ fontSize: 13 }}>{it.lasna ? "reactions" : "callbacks"}</span></span></div>
      </div>
      <div className="bar" role="img" aria-label={`Reserve ${Math.round(pct)}% of a healthy level`}><i className={state === "bad" ? "b-red" : state === "warn" ? "b-amber" : "b-teal"} style={{ width: `${Math.max(2, pct)}%` }} /></div>

      {state === "bad" && (
        <div className="state bad"><h3 className="h2"><AlertTriangle size={18} style={{ verticalAlign: -3 }} /> Execution is blocked</h3><p>{it.lasna ? "The hub can't react until its debt is paid. No allowance moves." : "This vault can't receive callbacks until its debt is paid. Spending of its current slice still works. Nothing can be overspent."} A top-up pays the debt first.</p></div>
      )}
      {state === "warn" && (
        <div className="state warn"><h3 className="h2"><Flame size={18} style={{ verticalAlign: -3 }} /> Top up soon</h3><p>About {ops} {it.lasna ? "reactions" : "callbacks"} left. If this runs out, debt builds up and execution stops until it is paid.</p></div>
      )}

      <div className="field">
        <label htmlFor={`f-${it.id}`}>Add fuel ({it.unit})</label>
        <div className="input-block">
          <input id={`f-${it.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className="token-chip">{it.unit}</span>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>{it.chips.map((c) => <button key={c} className="chip" aria-pressed={amount === c} onClick={() => setAmount(c)}>{c}</button>)}</div>
        <p className="helper">Anyone can top this up. It pays the debt first, then adds to the reserve.</p>
      </div>
      <button className="btn primary" disabled={!w.account || !wei || wei === 0n || busy} onClick={topUp}>
        {!w.account ? "Connect a wallet to top up" : busy ? "Waiting for your wallet…" : `Add ${amount || 0} ${it.unit}`}
      </button>
    </motion.section>
  );
}

export function Fuel() {
  const { data, isLoading, isError, refetch } = useSnapshot();
  const items: Item[] = data
    ? [
        { id: "hub", title: "Hub", chainKey: "lasna", chainLabel: LASNA.name, lasna: true, target: HUB, payTo: SYSTEM, unit: "lREACT", reserve: data.hub.reserve, debt: data.hub.debt, balance: data.hub.native, healthy: 10, cost: COST_HUB, chips: ["1", "5", "10"], what: "The hub pays lREACT every time it reacts to a spend or sends a callback. Without it, nothing moves." },
        ...data.lanes.map((l): Item => ({ id: l.cfg.key, title: `${l.cfg.short} vault`, chainKey: l.cfg.key, chainLabel: l.cfg.name, lasna: false, target: l.cfg.vault, payTo: l.cfg.callbackProxy, unit: "ETH", reserve: l.reserve, debt: l.debt, balance: l.native, healthy: 0.005, cost: COST_CALLBACK, chips: ["0.001", "0.005", "0.01"], what: `Each allowance move costs this vault a little ETH to receive its callback on ${l.cfg.name}.` })),
      ]
    : [];
  const worst = items.some((i) => i.debt > 0n) ? "bad" : items.some((i) => Number(i.reserve) / 1e18 / i.cost < WARN_BELOW_OPS) ? "warn" : "ok";
  return (
    <>
      <PageHead eyebrow="Fuel" title="Keep it running." lede="The hub and every vault pay small fees to do their work. If one runs dry, it stops until you top it up. Your budget stays safe either way." />
      {isLoading ? <div className="stack"><Skeleton h={260} r={26} /><Skeleton h={260} r={26} /></div>
        : isError && !data ? <StateCard tone="bad" title="Can't read the fuel levels" action={<button className="btn auto" onClick={() => refetch()}>Try again</button>}>The chains did not answer.</StateCard>
        : (
          <Stagger>
            <Rise>
              <div className={`state ${worst === "ok" ? "" : worst}`} style={worst === "ok" ? { borderStyle: "solid", borderColor: "var(--teal)" } : undefined}>
                <h2 className="h2">{worst === "ok" ? "Everything has enough fuel" : worst === "warn" ? "Something is running low" : "Something is out of fuel"}</h2>
                <p>{worst === "ok" ? "All reserves are above the warning level and no debt is owed." : "Top up the highlighted card below. Nothing is overspent while it waits."}</p>
              </div>
            </Rise>
            <div className="grid two" style={{ alignItems: "start" }}>{items.map((it) => <Rise key={it.id}><FuelCard it={it} /></Rise>)}</div>
          </Stagger>
        )}
      <Footnote>Runway numbers are estimates from the costs measured on the testnet. The hub also pays for a periodic wake-up, about every 17 minutes, even when idle.</Footnote>
    </>
  );
}
