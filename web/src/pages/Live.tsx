import { motion } from "framer-motion";
import { ArrowRight, Lock, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Gauge } from "@/components/Gauge";
import { LaneBoard } from "@/components/LaneBoard";
import { Footnote, PageHead, Rise, Skeleton, Stagger, Stamp, StateCard, ChainBadge, Ticker } from "@/components/kit";
import { LANES, SYMBOL, laneByKey, txUrl } from "@/lib/config";
import { clientFor } from "@/lib/chains";
import { vaultAbi } from "@/lib/abi";
import { duration, fmtAmt, num, toUnits } from "@/lib/format";
import { useEvents, useSnapshot } from "@/state/data";
import { useWallet } from "@/state/wallet";
import type { Address } from "viem";

const MERCHANT = "0x000000000000000000000000000000000000dEaD";

export function useBudgetMath() {
  const { data } = useSnapshot();
  return useMemo(() => {
    if (!data) return null;
    const budget = data.hub.epochBudget;
    const slices = data.lanes.reduce((a, l) => a + l.slice, 0n);
    const spent = data.lanes.reduce((a, l) => a + l.spent, 0n);
    const flight = budget > slices + spent ? budget - slices - spent : 0n;
    const verified = budget > 0n && slices + spent <= budget;
    return { budget, slices, spent, flight, verified, epochEnd: Number(data.hub.epochEnd), chainTime: data.hub.chainTime };
  }, [data]);
}

function SpendPanel() {
  const w = useWallet();
  const { data } = useSnapshot();
  const [laneKey, setLaneKey] = useState(LANES[0].key);
  const [amount, setAmount] = useState("25");
  const [to, setTo] = useState(MERCHANT);
  const [busy, setBusy] = useState(false);
  const lane = laneByKey(laneKey)!;
  const snap = data?.lanes.find((l) => l.cfg.key === laneKey);
  const role = useQuery({
    enabled: !!w.account,
    queryKey: ["role", w.account, laneKey],
    queryFn: () => clientFor(laneKey).readContract({ address: lane.vault, abi: vaultAbi, functionName: "spenders", args: [w.account!] }),
    refetchInterval: 10_000,
  });
  const units = toUnits(amount);
  const over = units !== undefined && snap ? units > snap.slice : false;
  const bad = units === undefined || units === 0n || over || !/^0x[0-9a-fA-F]{40}$/.test(to);

  if (!w.account) {
    return (
      <StateCard title="Connect to spend" action={<Link className="btn auto" to="/connect"><Lock size={16} /> Connect a wallet</Link>}>
        Watching is open to everyone. To spend, connect a wallet that the owner has approved as a spender. Connecting can't move any money.
      </StateCard>
    );
  }
  if (role.data && !role.data[0]) {
    return (
      <StateCard tone="warn" title="This wallet can't spend yet" action={<Link className="btn auto" to="/spenders">See who can spend</Link>}>
        Only approved spenders can spend from a vault. The owner adds spenders on the Spenders page.
      </StateCard>
    );
  }
  return (
    <div className="card stack">
      <div className="row between"><h2 className="h2">Spend</h2><span className="badge lime"><Zap size={13} /> Real transaction</span></div>
      <div className="grid two">
        {LANES.map((l) => {
          const s = data?.lanes.find((x) => x.cfg.key === l.key);
          return (
            <button key={l.key} className="option" aria-pressed={laneKey === l.key} onClick={() => setLaneKey(l.key)}>
              <ChainBadge lane={l} />
              <span className="num" style={{ fontWeight: 700, fontSize: 22 }}>{fmtAmt(s?.slice)} <span className="muted" style={{ fontSize: 13 }}>left</span></span>
            </button>
          );
        })}
      </div>
      <div className="field">
        <label htmlFor="spend-amt">Amount</label>
        <div className={`input-block ${over ? "error" : ""}`}>
          <input id="spend-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25" />
          <span className="token-chip"><span className="token-dot">{SYMBOL[0]}</span>{SYMBOL}</span>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {["10", "50", "100", "350"].map((c) => (<button key={c} className="chip" aria-pressed={amount === c} onClick={() => setAmount(c)}>{c}</button>))}
        </div>
        <p className={`helper ${over ? "err" : ""}`}>
          {over ? `That is more than the ${fmtAmt(snap?.slice)} left on ${lane.short}. It would be refused.` : "Agents can spend up to this slice. Nothing more. Going under the watermark makes the hub move allowance here."}
        </p>
      </div>
      <div className="field">
        <label htmlFor="spend-to">Pay to</label>
        <div className="input-block"><input id="spend-to" style={{ fontSize: 14 }} value={to} onChange={(e) => setTo(e.target.value.trim())} spellCheck={false} /></div>
        <p className="helper">Demo merchant by default. It's a dead address, so the test tokens are simply gone.</p>
      </div>
      <button
        className="btn primary"
        disabled={bad || busy}
        onClick={async () => {
          setBusy(true);
          await w.write({
            chain: laneKey, address: lane.vault, abi: vaultAbi, functionName: "spend", laneName: lane.name,
            args: [lane.token, to as Address, units!], title: `Spent ${amount} ${SYMBOL} on ${lane.short}`,
          });
          setBusy(false);
        }}
      >
        {busy ? "Waiting for your wallet…" : `Spend ${amount || "0"} ${SYMBOL} on ${lane.short}`} {!busy && <ArrowRight size={20} />}
      </button>
    </div>
  );
}

function Transfers() {
  const { transfers, isLoading } = useEvents();
  if (isLoading) return <Skeleton h={90} r={20} />;
  const rows = transfers.slice(0, 5);
  if (!rows.length) {
    return <StateCard title="No transfers yet">When one chain runs low, the hub moves allowance to it. The first transfer will show up here, with how long it took.</StateCard>;
  }
  return (
    <div className="card stack">
      <h2 className="h2">Recent transfers</h2>
      {rows.map((t) => {
        const a = laneByKey(t.fromKey), b = laneByKey(t.toKey);
        return (
          <motion.div key={t.id} layout initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} className="row wrap" style={{ gap: 12, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
            <span className="num" style={{ fontWeight: 700, minWidth: 74 }}>{fmtAmt(t.actual ?? t.requested)}</span>
            <span className="row" style={{ gap: 8 }}>{a && <ChainBadge lane={a} />}<ArrowRight size={14} />{b && <ChainBadge lane={b} />}</span>
            <span className="top-spacer" />
            {t.state === "done" && t.latency !== undefined ? <span className="latency-chip" title="From the spend to the grant landing"><Zap size={13} />{t.latency}s</span> : t.state === "expired" ? <span className="badge warn"><i />Timed out</span> : <span className="badge"><i />Moving…</span>}
            {t.tx.done && <a className="helper" href={txUrl("lasna", t.tx.done)} target="_blank" rel="noreferrer">tx ↗</a>}
          </motion.div>
        );
      })}
    </div>
  );
}

function PeriodNotice() {
  const { data } = useSnapshot();
  if (!data) return null;
  if (data.hub.closing) {
    return (
      <StateCard tone="warn" title="Starting a new period">
        Spending is stopping on every chain first. New slices are handed out only after each chain confirms it has stopped, so an old and a new slice are never spendable together. This takes a few seconds.
      </StateCard>
    );
  }
  const waiting = data.lanes.filter((l) => l.epochStart > 0n && BigInt(l.chainTime) < l.epochStart);
  if (waiting.length) {
    const secs = Math.max(...waiting.map((l) => Number(l.epochStart) - l.chainTime));
    return (
      <StateCard title={`New period opens in about ${secs} seconds`}>
        Slices are issued. Spending opens after a short safety delay, so chains with slightly different clocks can't overlap.
      </StateCard>
    );
  }
  const behind = data.lanes.filter((l) => l.epochId < data.hub.epochId);
  if (behind.length && data.hub.epochId > 0n) {
    return (
      <StateCard tone="warn" title="Waiting for a chain to join the new period" action={<Link className="btn auto" to="/vaults">Open Vaults</Link>}>
        {behind.map((l) => l.cfg.name).join(", ")} has not confirmed the new period yet. The hub re-sends it on its own; the owner can also re-send it now.
      </StateCard>
    );
  }
  return null;
}

export function Live() {
  const m = useBudgetMath();
  const snap = useSnapshot();
  const noEpoch = snap.data && snap.data.hub.epochId === 0n;
  const left = m ? Math.max(0, m.epochEnd - m.chainTime) : 0;
  return (
    <>
      <PageHead eyebrow="Live" title="One budget. Every chain." lede="Each chain holds a slice of one limit. When a chain runs low, the slice moves to it. Watch the blocks slide." />
      {snap.isError && !snap.data ? (
        <StateCard tone="bad" title="Can't reach the chains" action={<button className="btn auto" onClick={() => snap.refetch()}>Try again</button>}>
          The public RPCs did not answer. Nothing is wrong with your budget. This page retries on its own.
        </StateCard>
      ) : noEpoch ? (
        <StateCard title="No period is running" action={<Link className="btn auto" to="/budget">Set the budget</Link>}>The owner has not started a budget period yet.</StateCard>
      ) : (
        <Stagger>
          <Rise><PeriodNotice /></Rise>
          <Rise>
            <div className="card grid two" style={{ alignItems: "center" }}>
              <div style={{ display: "grid", placeItems: "center" }}>
                {m ? <Gauge slices={m.slices} flight={m.flight} spent={m.spent} total={m.budget} /> : <Skeleton h={190} r={20} />}
              </div>
              <div className="stack" style={{ gap: 14 }}>
                <div className="grid two keep" style={{ gap: 14 }}>
                  <div className="stat"><span className="k">Spent</span><span className="v sm">{m ? <Ticker value={num(m.spent)} format={(n) => Math.round(n).toLocaleString("en-US")} /> : "–"}</span></div>
                  <div className="stat"><span className="k">In flight</span><span className="v sm">{m ? <Ticker value={num(m.flight)} format={(n) => Math.round(n).toLocaleString("en-US")} /> : "–"}</span></div>
                  <div className="stat"><span className="k">Resets in</span><span className="v sm">{m ? duration(left) : "–"}</span></div>
                  <div className="stat"><span className="k">Chains</span><span className="v sm">{LANES.length}</span></div>
                </div>
                <div className="legend"><span><i style={{ background: "var(--lime)" }} />Can spend</span><span><i style={{ background: "repeating-linear-gradient(45deg,var(--lime) 0 3px,transparent 3px 6px)", border: "1px solid var(--line-strong)" }} />In flight</span><span><i style={{ background: "var(--spent)" }} />Spent</span></div>
                <div className="row" style={{ gap: 18 }}>
                  <Stamp show={!!m?.verified} sub="from chain data" />
                  {m && !m.verified && <span className="badge bad"><i />Check failed</span>}
                </div>
              </div>
            </div>
          </Rise>
          <Rise><LaneBoard /></Rise>
          <Rise><div className="grid two" style={{ alignItems: "start" }}><SpendPanel /><Transfers /></div></Rise>
        </Stagger>
      )}
      <Footnote>The hub updates slices about every second. Funds don't cross chains; only the right to spend them moves. If a message is lost, budget goes unused. It is never overspent.</Footnote>
    </>
  );
}
