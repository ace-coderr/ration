import { motion } from "framer-motion";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import evidence from "@evidence";
import { Addr, Footnote, PageHead, Rise, Skeleton, Stagger, Stamp, Ticker } from "@/components/kit";
import { HUB, LANES, LASNA, SYMBOL, txUrl } from "@/lib/config";
import { fmtAmt, num, short } from "@/lib/format";
import { replay, type ReplayResult } from "@/lib/verify";
import { useEvents, useSnapshot } from "@/state/data";
import { useBudgetMath } from "./Live";

function median(xs: number[]) { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; }

export function Proof() {
  const { events, transfers, isLoading } = useEvents();
  const snap = useSnapshot();
  const m = useBudgetMath();
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);

  const run = useCallback(() => {
    setScanning(true); setProgress(0); setResult(null);
    const total = events.length || 1;
    let i = 0;
    const t = setInterval(() => {
      i += Math.max(1, Math.ceil(total / 18));
      setProgress(Math.min(1, i / total));
      if (i >= total) { clearInterval(t); setResult(replay(events)); setScanning(false); }
    }, 55);
    return () => clearInterval(t);
  }, [events]);

  useEffect(() => { if (events.length && !result && !scanning) return run(); }, [events.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const lat = useMemo(() => transfers.filter((t) => t.latency !== undefined).map((t) => t.latency as number), [transfers]);
  const nowOk = !!m?.verified;
  const allOk = nowOk && !!result?.ok;
  const loops = (evidence as any).loops as any[];

  return (
    <>
      <PageHead help="proof" eyebrow="Proof" title="Check it yourself." lede="Nothing here is a claim. It's all read from the chains right now, and every number links to a transaction you can open." />
      <Stagger>
        <Rise>
          <div className="card grid two" style={{ alignItems: "center" }}>
            <div className="stack">
              <h2 className="h2">The budget was never exceeded</h2>
              <p className="muted">After every spend, release and grant ever recorded, the slices on all chains plus what was spent plus what was in flight stayed at or under the budget.</p>
              <div className="stat"><span className="k">Right now</span><span className="v sm">{m ? <><Ticker value={num(m.slices + m.spent + m.flight)} format={(n) => Math.round(n).toLocaleString("en-US")} /> <span className="muted" style={{ fontSize: 14 }}>of {fmtAmt(m.budget, 0)} {SYMBOL}</span></> : "–"}</span></div>
              <div className="row wrap" style={{ gap: 10 }}>
                <button className="btn small auto" onClick={run} disabled={scanning || !events.length}><RefreshCw size={15} className={scanning ? "spin" : ""} /> Check again</button>
                <span className="helper">{scanning ? `Replaying ${events.length} events…` : result ? `Replayed ${result.checked} events from ${LANES.length + 1} logs` : ""}</span>
              </div>
              {scanning && <div className="bar"><i className="b-slice" style={{ width: `${progress * 100}%`, transition: "width .05s linear" }} /></div>}
            </div>
            <div style={{ display: "grid", placeItems: "center", minHeight: 150 }}>
              {isLoading || scanning || !result ? <Skeleton w={220} h={96} r={12} /> : (
                <>
                  <Stamp show={allOk} sub="verified from chain data" />
                  {!allOk && <Stamp show label="Check failed" tone="bad" sub={result.violation ?? "see below"} />}
                </>
              )}
            </div>
          </div>
        </Rise>

        {result && (
          <Rise>
            <div className="card scroll-x">
              <h2 className="h2" style={{ marginBottom: 14 }}>Highest total ever seen, per period</h2>
              <table className="tbl"><thead><tr><th>Period</th><th>Budget</th><th>Peak total</th><th>Events checked</th><th>Result</th></tr></thead>
                <tbody>{result.epochs.map((e) => (
                  <tr key={e.epoch}><td className="num">{e.epoch}</td><td className="num">{fmtAmt(e.budget)}</td><td className="num"><b>{fmtAmt(e.peak)}</b></td><td className="num">{e.steps}</td>
                    <td><span className={`badge ${e.peak <= e.budget ? "ok" : "bad"}`}><i />{e.peak <= e.budget ? "Within budget" : "Over budget"}</span></td></tr>
                ))}</tbody></table>
            </div>
          </Rise>
        )}

        <Rise>
          <div className="grid three">
            {[
              ["Transfers completed", String(transfers.filter((t) => t.state === "done").length)],
              ["Median spend to grant", lat.length ? `${median(lat)}s` : "–"],
              ["Fastest / slowest", lat.length ? `${Math.min(...lat)}s / ${Math.max(...lat)}s` : "–"],
            ].map(([k, v]) => (
              <motion.div key={k} className="card stat" whileHover={{ y: -3 }}><span className="k">{k}</span><span className="v">{v}</span></motion.div>
            ))}
          </div>
        </Rise>

        <Rise>
          <div className="card stack">
            <h2 className="h2">Deployed contracts</h2>
            <table className="tbl"><thead><tr><th>Contract</th><th>Chain</th><th>Address</th></tr></thead><tbody>
              <tr><td>Hub</td><td>{LASNA.name}</td><td><Addr value={HUB} chain="lasna" full /></td></tr>
              {LANES.map((l) => (<tr key={l.key}><td>Vault</td><td>{l.name}</td><td><Addr value={l.vault} chain={l.key} full /></td></tr>))}
              {LANES.map((l) => (<tr key={l.key + "t"}><td>Mock {SYMBOL} (no value)</td><td>{l.name}</td><td><Addr value={l.token} chain={l.key} full /></td></tr>))}
            </tbody></table>
          </div>
        </Rise>

        {loops?.map((lp, i) => (
          <Rise key={lp.transferId}>
            <div className="card stack">
              <div className="row between wrap"><h2 className="h2">Full loop {i + 1}: {lp.direction}</h2><span className="latency-chip">{lp.latency.totalSpendToGrant}s spend to grant</span></div>
              <p className="helper">Moved {lp.amountMoved} {SYMBOL}. Transfer <span className="mono">{short(lp.transferId, 10, 6)}</span>.</p>
              <div className="scroll-x"><table className="tbl"><tbody>
                {lp.steps.map((s: any) => (
                  <tr key={s.tx}><td>{s.step}</td><td>{s.chain}</td><td><a className="mono helper" href={s.url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 4 }}>{short(s.tx, 10, 6)}<ArrowUpRight size={13} /></a></td></tr>
                ))}
              </tbody></table></div>
            </div>
          </Rise>
        ))}

        {transfers.length > 0 && (
          <Rise>
            <div className="card stack">
              <h2 className="h2">Every transfer so far</h2>
              <div className="scroll-x"><table className="tbl"><thead><tr><th>Moved</th><th>Direction</th><th>Speed</th><th>Hub confirmation</th></tr></thead><tbody>
                {transfers.slice(0, 15).map((t) => (
                  <tr key={t.id}>
                    <td className="num">{fmtAmt(t.actual ?? t.requested)}</td>
                    <td>{LANES.find((l) => l.key === t.fromKey)?.short} → {LANES.find((l) => l.key === t.toKey)?.short}</td>
                    <td>{t.latency !== undefined ? <span className="latency-chip">{t.latency}s</span> : <span className="badge"><i />{t.state}</span>}</td>
                    <td>{t.tx.done ? <a className="mono helper" href={txUrl("lasna", t.tx.done)} target="_blank" rel="noreferrer">{short(t.tx.done, 8, 6)} ↗</a> : "–"}</td>
                  </tr>
                ))}
              </tbody></table></div>
            </div>
          </Rise>
        )}
      </Stagger>
      <Footnote>The check trusts the vaults' own event logs, which anyone can read on the explorers. It does not prove the contracts are bug-free; the code, tests and audit notes are in the repository. {snap.isError ? "Live read failed just now." : ""}</Footnote>
    </>
  );
}
