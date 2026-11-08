import { motion } from "framer-motion";
import { ArrowUpRight, Download, Zap } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ChainBadge, Footnote, PageHead, Skeleton, StateCard } from "@/components/kit";
import { LANES, SYMBOL, laneByChain, laneByKey, txUrl } from "@/lib/config";
import { fmtAmt, short } from "@/lib/format";
import { useEvents, type Ev, type TransferView } from "@/state/data";

type Group = "all" | "spend" | "move" | "period";
const GROUP: Record<string, Group> = {
  spent: "spend", closed: "period", epochClosing: "period", reissued: "period", released: "move", granted: "move", requested: "move", hubReleased: "move", granting: "move", done: "move", expired: "move", reset: "period", epochStarted: "period",
};

function describe(e: Ev): { text: string; amount?: bigint } {
  const lane = laneByKey(e.chain);
  const n = lane?.short ?? "Lasna";
  switch (e.kind) {
    case "spent": return { text: `Spent on ${n}, paid to ${short(e.args.to)} by ${short(e.args.spender)}`, amount: e.args.amount };
    case "released": return { text: `${n} gave up allowance`, amount: e.args.actual };
    case "granted": return { text: `${n} took on allowance`, amount: e.args.amount };
    case "closed": return { text: `${n} closed the period early, spending stopped here` };
    case "epochClosing": return { text: `Hub is closing period ${e.args.epochId} on every chain before starting a new one` };
    case "reissued": return { text: `Hub re-sent the new period to ${laneByChain(Number(e.args.chainId))?.short} (try ${e.args.attempt})` };
    case "reset": return { text: `New period on ${n}: starts with ${fmtAmt(e.args.slice)} ${SYMBOL}`, amount: e.args.slice };
    case "requested": return { text: `Hub asked ${laneByChain(Number(e.args.fromChain))?.short} to give ${laneByChain(Number(e.args.toChain))?.short} more`, amount: e.args.amount };
    case "hubReleased": return { text: `Hub saw the release go through`, amount: e.args.actual };
    case "granting": return { text: `Hub told the low chain to take it${e.args.attempt ? ` (retry ${e.args.attempt})` : ""}`, amount: e.args.amount };
    case "done": return { text: `Hub confirmed the transfer is done`, amount: e.args.amount };
    case "expired": return { text: `Hub gave up waiting and will try again` };
    case "epochStarted": return { text: `Hub started period ${e.args.epochId} with a budget of ${fmtAmt(e.args.budget, 0)} ${SYMBOL}`, amount: e.args.budget };
    default: return { text: e.kind };
  }
}

function latencyOf(e: Ev, transfers: Map<string, TransferView>): number | undefined {
  const id = e.args.transferId as string | undefined;
  if (!id) return undefined;
  const t = transfers.get(id);
  if (!t) return undefined;
  if (e.kind === "granted" || e.kind === "done") return t.latency;
  return undefined;
}

export function Ledger() {
  const { events, transfers, isLoading, isError } = useEvents();
  const [chain, setChain] = useState<string>("all");
  const [group, setGroup] = useState<Group>("all");
  const [limit, setLimit] = useState(40);
  const seen = useRef<Set<string> | null>(null);
  const tmap = useMemo(() => new Map(transfers.map((t) => [t.id as string, t])), [transfers]);

  const rows = useMemo(
    () => [...events].filter((e) => GROUP[e.kind]).reverse().filter((e) => (chain === "all" || e.chain === chain) && (group === "all" || GROUP[e.kind] === group)),
    [events, chain, group],
  );
  if (seen.current === null && events.length) seen.current = new Set(events.map((e) => e.id));
  const isNew = (id: string) => seen.current !== null && !seen.current.has(id);

  function exportCsv() {
    const head = ["time_utc", "chain", "event", "amount", "latency_s", "tx"];
    const lines = rows.map((e) => {
      const d = describe(e);
      return [new Date(e.ts * 1000).toISOString(), e.chain, `"${d.text.replace(/"/g, "'")}"`, d.amount !== undefined ? fmtAmt(d.amount, 6).replace(/,/g, "") : "", latencyOf(e, tmap) ?? "", e.tx].join(",");
    });
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ration-ledger.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <>
      <PageHead help="ledger" eyebrow="Ledger" title="Everything that happened." lede="Spends, releases, grants and period resets from every chain and the hub, in one list, with a link to each transaction." />
      <div className="row between wrap" style={{ marginBottom: 18, gap: 14 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          {[{ v: "all", l: "All chains" }, ...LANES.map((l) => ({ v: l.key, l: l.short })), { v: "lasna", l: "Lasna hub" }].map((c) => (
            <button key={c.v} className="chip" aria-pressed={chain === c.v} onClick={() => setChain(c.v)}>{c.l}</button>
          ))}
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {([["all", "Everything"], ["spend", "Spends"], ["move", "Allowance moves"], ["period", "Periods"]] as [Group, string][]).map(([v, l]) => (
            <button key={v} className="chip" aria-pressed={group === v} onClick={() => setGroup(v)}>{l}</button>
          ))}
          <button className="btn small auto" onClick={exportCsv} disabled={!rows.length}><Download size={15} /> CSV</button>
        </div>
      </div>

      {isLoading ? (
        <div className="card stack">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} h={28} />)}</div>
      ) : isError ? (
        <StateCard tone="bad" title="Can't read the history">The chains didn't answer. This page tries again on its own.</StateCard>
      ) : rows.length === 0 ? (
        <StateCard title={events.length ? "Nothing matches these filters" : "Nothing has happened yet"} action={events.length ? <button className="btn auto" onClick={() => { setChain("all"); setGroup("all"); }}>Clear filters</button> : undefined}>
          {events.length ? "Try a different chain or type." : "Spends and allowance moves will appear here as they happen."}
        </StateCard>
      ) : (
        <div className="card scroll-x" style={{ padding: "22px 22px 8px" }}>
          <table className="tbl">
            <thead><tr><th>When</th><th>Chain</th><th>What happened</th><th style={{ textAlign: "right" }}>{SYMBOL}</th><th>Speed</th><th>Tx</th></tr></thead>
            <tbody>
              {rows.slice(0, limit).map((e) => {
                const d = describe(e);
                const lat = latencyOf(e, tmap);
                const lane = laneByKey(e.chain);
                return (
                  <motion.tr key={e.id} className={isNew(e.id) ? "new" : ""} initial={isNew(e.id) ? { opacity: 0, x: -14 } : false} animate={{ opacity: 1, x: 0 }}>
                    <td className="mono helper" style={{ whiteSpace: "nowrap" }} title={new Date(e.ts * 1000).toISOString()}>{new Date(e.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}<br /><span className="muted">{new Date(e.ts * 1000).toLocaleDateString([], { month: "short", day: "numeric" })}</span></td>
                    <td><ChainBadge lane={lane} lasna={e.chain === "lasna"} /></td>
                    <td style={{ minWidth: 240 }}>{d.text}</td>
                    <td className="num" style={{ textAlign: "right", fontWeight: 700 }}>{d.amount !== undefined ? fmtAmt(d.amount) : ""}</td>
                    <td>{lat !== undefined ? <span className="latency-chip"><Zap size={12} />{lat}s</span> : ""}</td>
                    <td><a href={txUrl(e.chain, e.tx)} target="_blank" rel="noreferrer" aria-label="Open transaction" style={{ display: "inline-flex", gap: 4 }} className="mono helper">{short(e.tx, 6, 4)}<ArrowUpRight size={13} /></a></td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > limit && <div style={{ padding: "8px 0 18px" }}><button className="btn small" onClick={() => setLimit((l) => l + 40)}>Show more ({rows.length - limit} left)</button></div>}
        </div>
      )}
      <Footnote>The feed is read straight from the chains' logs. Times come from block timestamps and can be off by about a second between chains. "Speed" is from the spend to the grant landing.</Footnote>
    </>
  );
}
