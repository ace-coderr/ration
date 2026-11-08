import { motion } from "framer-motion";
import { Check, Lock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChainBadge, Footnote, PageHead, Rise, Seg, Skeleton, Stagger, StateCard } from "@/components/kit";
import { hubAbi } from "@/lib/abi";
import { HUB, LANES, SYMBOL } from "@/lib/config";
import { fmtAmt, num, periodLabel, toUnits } from "@/lib/format";
import { useSnapshot } from "@/state/data";
import { useWallet } from "@/state/wallet";
import { formatUnits } from "viem";

const PERIODS = [
  { v: 3600, label: "Hour", note: "demo" },
  { v: 86400, label: "Day" },
  { v: 604800, label: "Week" },
  { v: 2592000, label: "Month" },
];

type Step = { label: string; state: "todo" | "doing" | "done" | "failed" };

export function SetBudget() {
  const w = useWallet();
  const { data, isLoading } = useSnapshot();
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState(604800);
  const [weights, setWeights] = useState<number[]>([]);
  const [low, setLow] = useState(20);
  const [refill, setRefill] = useState(25);
  const [when, setWhen] = useState<"next" | "now">("next");
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const seeded = useRef(false);

  useEffect(() => {
    if (!data || seeded.current) return;
    seeded.current = true;
    setAmount(formatUnits(data.hub.budget, 6));
    setPeriod(Number(data.hub.epochLength));
    setWeights(data.hub.lanes.map((l) => l.weightBps / 100));
    setLow(data.hub.lanes[0]?.lowBps ? data.hub.lanes[0].lowBps / 100 : 20);
    setRefill(data.hub.refillBps / 100);
  }, [data]);

  const units = toUnits(amount);
  const total = weights.reduce((a, b) => a + b, 0);
  const owner = data?.hub.owner;
  const isOwner = w.isOwner(owner);
  const valid = units !== undefined && units > 0n && Math.round(total) === 100 && period > 0;

  const preview = useMemo(() => {
    if (!units || !data) return "Enter an amount to see what it means.";
    const n = num(units);
    const per = weights.map((x) => `${Math.round((n * x) / 100).toLocaleString("en-US")}`);
    const lowAt = Math.round((n * low) / 100);
    const move = Math.round((n * refill) / 100);
    return `${fmtAmt(units, 0)} ${SYMBOL} per ${periodLabel(period)} across ${LANES.length} chains. Each starts with ${per.join(" and ")}. When a chain drops under ${lowAt.toLocaleString("en-US")}, the hub moves up to ${move.toLocaleString("en-US")} to it.`;
  }, [units, weights, low, refill, period, data]);

  const setWeight = (i: number, v: number) => {
    setWeights((prev) => {
      if (prev.length === 2) return i === 0 ? [v, 100 - v] : [100 - v, v];
      const n = [...prev]; n[i] = v; return n;
    });
  };

  async function apply() {
    if (!data || units === undefined) return;
    const plan: { label: string; run: () => Promise<unknown> }[] = [
      {
        label: "Save budget, period and refill size",
        run: () => w.write({ chain: "lasna", address: HUB, abi: hubAbi, functionName: "setConfig", title: "Budget saved",
          args: [units, BigInt(period), Math.round(refill * 100), data.hub.timeout, data.hub.minTransfer] }),
      },
      ...data.hub.lanes.map((l, i) => ({
        label: `Set ${LANES.find((x) => x.chainId === l.chainId)?.short} share and watermark`,
        run: () => w.write({ chain: "lasna", address: HUB, abi: hubAbi, functionName: "setLaneParams", title: "Chain settings saved",
          args: [BigInt(l.chainId), Math.round(weights[i] * 100), Math.round(low * 100)] }),
      })),
      ...(when === "now" ? [{ label: "Start a new period now", run: () => w.write({ chain: "lasna", address: HUB, abi: hubAbi, functionName: "startEpoch", title: "New period started" }) }] : []),
    ];
    setSteps(plan.map((p) => ({ label: p.label, state: "todo" })));
    setBusy(true);
    for (let i = 0; i < plan.length; i++) {
      setSteps((s) => s.map((x, j) => (j === i ? { ...x, state: "doing" } : x)));
      const ok = await plan[i].run();
      setSteps((s) => s.map((x, j) => (j === i ? { ...x, state: ok ? "done" : "failed" } : x)));
      if (!ok) break;
    }
    setBusy(false);
  }

  return (
    <>
      <PageHead eyebrow="Budget" title="Set the limit once." lede="Pick an amount and a period. Ration splits it across your chains and keeps it balanced as you spend." />
      {isLoading ? (
        <div className="stack"><Skeleton h={120} r={26} /><Skeleton h={200} r={26} /></div>
      ) : !data ? (
        <StateCard tone="bad" title="Can't read the hub">The Lasna network did not answer. Try again in a moment.</StateCard>
      ) : (
        <Stagger>
          {!w.account ? (
            <Rise><StateCard title="Connect the owner wallet to change this" action={<Link className="btn auto" to="/connect"><Lock size={16} />Connect a wallet</Link>}>You can read the current setup below. Only the hub owner can change it.</StateCard></Rise>
          ) : !isOwner ? (
            <Rise><StateCard tone="warn" title="This wallet isn't the owner">Only the hub owner can change the budget. The owner is <span className="mono">{owner}</span>.</StateCard></Rise>
          ) : null}

          <Rise>
            <div className="card stack">
              <div className="field">
                <label htmlFor="amt">Total budget</label>
                <div className="input-block">
                  <input id="amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" disabled={!isOwner} />
                  <span className="token-chip"><span className="token-dot">{SYMBOL[0]}</span>{SYMBOL}</span>
                </div>
                <p className="helper">This is the most that can ever be spent across all chains in one period.</p>
              </div>
              <div className="field">
                <span className="label">Period</span>
                <div className="row wrap" style={{ gap: 10 }}>
                  {PERIODS.map((p) => (
                    <button key={p.v} className="chip" aria-pressed={period === p.v} disabled={!isOwner} onClick={() => setPeriod(p.v)}>{p.label}{p.note ? ` · ${p.note}` : ""}</button>
                  ))}
                </div>
                <p className="helper">When a period ends, spending resets and every chain gets a fresh slice. A new period applies after the current one, unless you start it now.</p>
              </div>
            </div>
          </Rise>

          <Rise>
            <div className="card stack">
              <h2 className="h2">Chains</h2>
              <div className="grid two">
                {data.hub.lanes.map((l, i) => {
                  const lane = LANES.find((x) => x.chainId === l.chainId)!;
                  return (
                    <div key={l.chainId} className="option" aria-pressed="true" style={{ cursor: "default" }}>
                      <div className="row"><ChainBadge lane={lane} /><span className="check badge ok"><Check size={12} />Watching</span></div>
                      <span className="lane-name">{lane.name}</span>
                      <div className="field">
                        <label htmlFor={`w${i}`}>Share at the start of a period</label>
                        <div className="row"><span className="num" style={{ fontWeight: 700, fontSize: 24, minWidth: 64 }}>{Math.round(weights[i] ?? 0)}%</span><span className="helper">{units ? `${fmtAmt((units * BigInt(Math.round((weights[i] ?? 0) * 100))) / 10000n, 0)} ${SYMBOL}` : ""}</span></div>
                        {LANES.length === 2 && <input id={`w${i}`} type="range" min={10} max={90} step={5} value={weights[i] ?? 50} disabled={!isOwner} style={{ ["--fill" as string]: `${((weights[i] ?? 50) - 10) / 0.8}%` }} onChange={(e) => setWeight(i, Number(e.target.value))} />}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="helper">Chains are set when the vaults are registered with the hub. Shares must add up to 100%{Math.round(total) !== 100 ? ` (now ${Math.round(total)}%)` : ""}.</p>
            </div>
          </Rise>

          <Rise>
            <div className="card stack">
              <h2 className="h2">When to move allowance</h2>
              <div className="field">
                <label htmlFor="low">Ask for more when a chain is under</label>
                <div className="row"><span className="num" style={{ fontWeight: 700, fontSize: 28, minWidth: 74 }}>{low}%</span>
                  <input id="low" type="range" min={5} max={40} step={1} value={low} disabled={!isOwner} style={{ ["--fill" as string]: `${((low - 5) / 35) * 100}%` }} onChange={(e) => setLow(Number(e.target.value))} /></div>
                <p className="helper">Higher means chains refill earlier but hold more spare slice. A chain also keeps this much when it gives allowance away.</p>
              </div>
              <div className="field">
                <span className="label">How much to move at once</span>
                <div className="row wrap" style={{ gap: 10 }}>
                  {[10, 25, 50].map((r) => <button key={r} className="chip" aria-pressed={refill === r} disabled={!isOwner} onClick={() => setRefill(r)}>{r}% of budget</button>)}
                </div>
              </div>
            </div>
          </Rise>

          <Rise>
            <div className="card ink stack">
              <span className="eyebrow">What this means</span>
              <motion.p key={preview} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1.15 }}>{preview}</motion.p>
              <div className="row wrap" style={{ gap: 12 }}>
                <Seg label="When to apply" value={when} onChange={setWhen} options={[{ v: "next", label: "From next period" }, { v: "now", label: "Start a new period now" }]} />
              </div>
              {when === "now" && <p className="helper" style={{ color: "#98a59d" }}>Starting now ends the current period early. Anything spent so far stops counting.</p>}
              <button className="btn primary" disabled={!isOwner || !valid || busy} onClick={apply}>{busy ? "Saving…" : "Save budget"}</button>
              {steps.length > 0 && (
                <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                  {steps.map((s) => (
                    <li key={s.label} className="row" style={{ gap: 10, fontSize: 14 }}>
                      <span className={`badge ${s.state === "done" ? "ok" : s.state === "failed" ? "bad" : s.state === "doing" ? "warn" : ""}`}><i />{s.state}</span>{s.label}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Rise>
        </Stagger>
      )}
      <Footnote>Changes to the budget and period take effect when the next period starts. Moving allowance never moves funds between chains.</Footnote>
    </>
  );
}
