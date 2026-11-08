import { motion } from "framer-motion";
import { Check, Loader2, Plus, X } from "lucide-react";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { clientFor } from "@/lib/chains";
import { LANES, LASNA } from "@/lib/config";
import { useWallet } from "@/state/wallet";

const CHECKS = [...LANES.map((l) => ({ key: l.key, name: l.name })), { key: "lasna", name: LASNA.name }];

function BgLanes() {
  return (
    <div className="connect-bg" aria-hidden>
      {[0, 1, 2].map((r) => (
        <div key={r} className="bg-row" style={{ animationDuration: `${38 + r * 9}s`, animationDirection: r % 2 ? "reverse" : "normal" }}>
          {Array.from({ length: 44 }).map((_, i) => (
            <span key={i} className={`bg-blk ${(i * 7 + r * 3) % 5 === 0 ? "dark" : ""}`} style={{ opacity: (i * 13 + r) % 7 === 0 ? 0.25 : 1 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Check1({ k, name }: { k: string; name: string }) {
  const q = useQuery({ queryKey: ["ready", k], queryFn: () => clientFor(k).getBlockNumber(), retry: 1, refetchInterval: 15000 });
  const state = q.isLoading ? "load" : q.isError ? "bad" : "ok";
  return (
    <div className="check-row">
      <span className={`dot ${state === "ok" ? "ok" : state === "bad" ? "bad" : ""}`}>
        {state === "ok" ? <Check size={13} /> : state === "bad" ? <X size={13} /> : <Loader2 size={13} className="spin" />}
      </span>
      <span style={{ flex: 1 }}>{name} is reachable</span>
      <span className="mono helper">{state === "ok" ? `block ${q.data?.toString()}` : state === "bad" ? "no answer" : "checking"}</span>
    </div>
  );
}

export function Connect() {
  const w = useWallet();
  const nav = useNavigate();
  useEffect(() => { if (w.account) { const t = setTimeout(() => nav("/live"), 650); return () => clearTimeout(t); } }, [w.account, nav]);
  const hasWallet = w.wallets.length > 0;
  return (
    <div className="connect-wrap">
      <BgLanes />
      <motion.div className="card connect-card stack" initial={{ opacity: 0, y: 30, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 26 }}>
        <div className="row between"><span className="eyebrow">Connect</span><span className="badge test">Testnet only</span></div>
        <h1 className="h2" style={{ fontSize: 34, lineHeight: 1.02 }}>Connect a wallet. Connecting can't move any money.</h1>
        <p className="muted">It only lets this page see your address and ask you to sign. You approve every action yourself, one at a time.</p>

        {w.account ? (
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="state" style={{ borderStyle: "solid", borderColor: "var(--teal)" }}>
            <h3 className="h2">Connected</h3>
            <p className="mono">{w.account}</p>
          </motion.div>
        ) : hasWallet ? (
          <div className="stack" style={{ gap: 10 }}>
            {w.wallets.map((x) => (
              <button key={x.uuid} className="btn primary" disabled={w.connecting} onClick={() => w.connect(x)}>
                {x.icon && <img src={x.icon} alt="" width={26} height={26} />}
                {w.connecting ? "Check your wallet…" : `Connect ${x.name}`}
              </button>
            ))}
          </div>
        ) : (
          <div className="state warn">
            <h3 className="h2">No browser wallet found</h3>
            <p>Install a wallet such as MetaMask or Rabby, then reload this page. You can still watch everything without one.</p>
          </div>
        )}

        <div>
          <div className="eyebrow" style={{ marginBottom: 10, fontSize: 11 }}>Ready?</div>
          <div className="check-row">
            <span className={`dot ${hasWallet ? "ok" : "bad"}`}>{hasWallet ? <Check size={13} /> : <X size={13} />}</span>
            <span style={{ flex: 1 }}>A browser wallet is available</span>
            <span className="mono helper">{hasWallet ? w.wallets.length : 0} found</span>
          </div>
          {CHECKS.map((c) => <Check1 key={c.key} k={c.key} name={c.name} />)}
        </div>
        {hasWallet && (
          <button className="btn small" onClick={async () => { if (!w.account) await w.connect(w.wallets[0]); for (const k of ["lasna", ...LANES.map((l) => l.key)]) { try { await w.switchTo(k); } catch { break; } } }}>
            <Plus size={16} /> Add the three networks to my wallet
          </button>
        )}
        <p className="footnote" style={{ marginTop: 0 }}>Your wallet needs a little testnet ETH on Base and Unichain, and lREACT on Lasna, to pay gas. Nothing here uses real money.</p>
      </motion.div>
    </div>
  );
}
