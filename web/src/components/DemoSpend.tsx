import { ArrowRight, Fuel as FuelIcon, ShieldCheck, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChainBadge, Skeleton } from "./kit";
import { vaultAbi } from "@/lib/abi";
import { clientFor } from "@/lib/chains";
import { DECIMALS, LANES, SYMBOL, laneByKey, txUrl } from "@/lib/config";
import {
  DEMO_ADDRESS, DEMO_AMOUNTS, DEMO_COOLDOWN_MS, GAS_PER_SPEND_ETH, MIN_SPENDS_OF_GAS, cooldownLeftMs, demoSpend, type DemoAmount,
} from "@/lib/demoAgent";
import { fmtAmt, fmtNative } from "@/lib/format";
import { refreshEvents, useSnapshot } from "@/state/data";
import { useUi } from "@/state/ui";
import { parseUnits } from "viem";

export interface DemoLaneStatus {
  key: string;
  allowed: boolean;
  cap: bigint;
  used: bigint;
  capLeft: bigint;
  eth: bigint;
  spendsOfGas: number;
}

/** Live status of the shared demo agent, read straight from each vault and chain. */
export function useDemoStatus() {
  return useQuery({
    queryKey: ["demo-status"],
    refetchInterval: 6000,
    staleTime: 3000,
    retry: 1,
    placeholderData: (p) => p,
    queryFn: async (): Promise<DemoLaneStatus[]> =>
      Promise.all(
        LANES.map(async (l) => {
          const c = clientFor(l.key);
          const v = { address: l.vault, abi: vaultAbi } as const;
          const [info, epoch, eth] = await Promise.all([
            c.readContract({ ...v, functionName: "spenders", args: [DEMO_ADDRESS] }),
            c.readContract({ ...v, functionName: "epochId" }),
            c.getBalance({ address: DEMO_ADDRESS }),
          ]);
          const used = await c.readContract({ ...v, functionName: "spentBy", args: [epoch, DEMO_ADDRESS] });
          const cap = info[1];
          const capLeft = !info[0] ? 0n : cap === 0n ? BigInt(Number.MAX_SAFE_INTEGER) : used >= cap ? 0n : cap - used;
          return { key: l.key, allowed: info[0], cap, used, capLeft, eth, spendsOfGas: Math.floor(Number(eth) / 1e18 / GAS_PER_SPEND_ETH[l.key]) };
        }),
      ),
  });
}

function useCooldownMs(): number {
  const [left, setLeft] = useState(cooldownLeftMs());
  useEffect(() => {
    const t = setInterval(() => setLeft(cooldownLeftMs()), 400);
    return () => clearInterval(t);
  }, []);
  return left;
}

export function DemoSpend() {
  const { data } = useSnapshot();
  const status = useDemoStatus();
  const qc = useQueryClient();
  const { toast } = useUi();
  const [laneKey, setLaneKey] = useState(LANES[0].key);
  const [amount, setAmount] = useState<DemoAmount>(5);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "bad"; text: string; hash?: string } | null>(null);
  const cool = useCooldownMs();
  const inFlight = useRef(false);

  const lane = laneByKey(laneKey)!;
  const snap = data?.lanes.find((l) => l.cfg.key === laneKey);
  const st = status.data?.find((s) => s.key === laneKey);
  const units = parseUnits(String(amount), DECIMALS);
  const capNote = st && st.cap > 0n ? fmtAmt(st.cap, 0) : "100";

  // The first reason, in plain words, why the button can't be used right now. null means it can.
  const blocked = ((): string | null => {
    if (!st || !snap) return status.isError ? "Couldn't read the chain just now. Retrying…" : "Checking the chain…";
    if (!st.allowed) return `The demo agent isn't approved on ${lane.short} right now.`;
    if (st.capLeft < units) return st.capLeft === 0n ? "Demo cap reached for this period. It resets with the next period, or connect an approved wallet." : `Only ${fmtAmt(st.capLeft)} ${SYMBOL} of the demo cap is left on ${lane.short}. Pick a smaller amount.`;
    if (st.spendsOfGas < MIN_SPENDS_OF_GAS) return `The demo agent is low on gas on ${lane.short}, so spending is paused there until the owner tops it up.`;
    if (snap.paused) return `Spending is paused on ${lane.short}.`;
    if (BigInt(snap.chainTime) >= snap.epochEnd || BigInt(snap.chainTime) < snap.epochStart) return `The budget period on ${lane.short} isn't open for spending right now.`;
    if (snap.slice < units) return `${lane.short} has only ${fmtAmt(snap.slice)} ${SYMBOL} left in its slice.`;
    return null;
  })();

  async function go() {
    if (inFlight.current || busy || blocked || cool > 0) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    const r = await demoSpend(laneKey, amount);
    inFlight.current = false;
    setBusy(false);
    if (r.ok) {
      toast({ tone: "ok", title: `Spent ${amount} ${SYMBOL} on ${lane.short} as the demo agent`, body: `${fmtAmt(r.newSlice)} ${SYMBOL} left on this chain.`, link: { href: txUrl(laneKey, r.hash), label: "View transaction" } });
      refreshEvents().catch(() => undefined);
    } else {
      setNotice({ tone: r.kind === "pending" ? "info" : "bad", text: r.message, hash: r.hash });
      if (r.kind !== "cooldown") toast({ tone: r.kind === "pending" ? "info" : "bad", title: r.kind === "pending" ? "Waiting for confirmation" : "Nothing was spent", body: r.message, link: r.hash ? { href: txUrl(laneKey, r.hash), label: "View transaction" } : undefined });
    }
    for (const k of ["snapshot", "events", "demo-status"]) qc.invalidateQueries({ queryKey: [k] });
  }

  const label = busy ? "Waiting for the network…" : cool > 0 ? `Wait ${Math.ceil(cool / 1000)}s` : `Spend ${amount} ${SYMBOL} on ${lane.short} as the demo agent`;
  const disabled = busy || !!blocked || cool > 0;

  return (
    <div className="card stack">
      <div className="row between wrap" style={{ gap: 8 }}>
        <h2 className="h2">Spend as the demo agent</h2>
        <span className="badge lime"><Zap size={13} aria-hidden /> Real transaction</span>
      </div>

      <div className="grid two">
        {LANES.map((l) => {
          const s = data?.lanes.find((x) => x.cfg.key === l.key);
          const d = status.data?.find((x) => x.key === l.key);
          const pct = d && d.cap > 0n ? Math.max(0, Math.min(100, Number((d.capLeft * 100n) / d.cap))) : 0;
          return (
            <button key={l.key} className="option" aria-pressed={laneKey === l.key} onClick={() => setLaneKey(l.key)}>
              <ChainBadge lane={l} />
              <span className="num" style={{ fontWeight: 700, fontSize: 22 }}>{fmtAmt(s?.slice)} <span className="muted" style={{ fontSize: 13 }}>left on this chain</span></span>
              {d ? (
                <>
                  <span className="helper">Demo cap left: <b className="num">{d.capLeft > 10n ** 15n ? "no cap" : fmtAmt(d.capLeft)}</b> of {fmtAmt(d.cap, 0)} {SYMBOL}</span>
                  <div className="bar" aria-hidden><i className={pct === 0 ? "b-red" : "b-teal"} style={{ width: `${Math.max(2, pct)}%` }} /></div>
                </>
              ) : <Skeleton h={34} r={8} />}
            </button>
          );
        })}
      </div>

      <div className="field">
        <span className="label">Amount</span>
        <div className="row wrap" style={{ gap: 8 }} role="group" aria-label="Amount">
          {DEMO_AMOUNTS.map((a) => (
            <button key={a} className="chip" aria-pressed={amount === a} onClick={() => setAmount(a)}>{a} {SYMBOL}</button>
          ))}
        </div>
        <p className="helper">Paid to the demo merchant, a dead address, so the test tokens are simply gone. Going under the watermark makes the hub move allowance here.</p>
      </div>

      <button className="btn primary" disabled={disabled} onClick={go} aria-describedby="demo-why">
        {label} {!busy && cool === 0 && !blocked && <ArrowRight size={20} aria-hidden />}
      </button>
      <p id="demo-why" className={`helper ${blocked || notice?.tone === "bad" ? "err" : ""}`} role="status" aria-live="polite">
        {notice ? <>{notice.text}{notice.hash && <> <a href={txUrl(laneKey, notice.hash)} target="_blank" rel="noreferrer">View transaction ↗</a></>}</> : blocked ?? `Anyone can do this once every ${DEMO_COOLDOWN_MS / 1000} seconds. No wallet needed.`}
      </p>

      <div className="state" style={{ padding: 16, gap: 10 }}>
        <div className="row" style={{ gap: 8 }}><ShieldCheck size={18} aria-hidden /><b>Shared demo key</b></div>
        <p style={{ margin: 0 }}>
          Public and capped at {capNote} {SYMBOL} per period per chain. The token is a play-money test token. This key can only spend inside its slice and cap. It can't change any setting.
        </p>
        <div className="grid two" style={{ gap: 10 }}>
          {LANES.map((l) => {
            const d = status.data?.find((x) => x.key === l.key);
            const low = d ? d.spendsOfGas < MIN_SPENDS_OF_GAS : false;
            return (
              <span key={l.key} className="helper row" style={{ gap: 6 }}>
                <FuelIcon size={14} aria-hidden /> Gas on {l.short}:{" "}
                {d ? <b className="num" style={low ? { color: "var(--red-ink)" } : undefined}>{fmtNative(d.eth, 5)} ETH{low ? " (low)" : `, about ${d.spendsOfGas.toLocaleString("en-US")} spends`}</b> : "…"}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
