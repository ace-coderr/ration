import { AnimatePresence, motion } from "framer-motion";
import { Bot, CheckCircle2, PlugZap, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { checkSpend, type SpendVerdict } from "@core";
import { CopyBtn, Footnote, PageHead, Rise, Stagger, StateCard, ChainBadge } from "@/components/kit";
import { vaultAbi } from "@/lib/abi";
import { clientFor } from "@/lib/chains";
import { LANES, SYMBOL } from "@/lib/config";
import { ago, fmtAmt, short, toUnits } from "@/lib/format";
import { useEvents, useSnapshot } from "@/state/data";
import { useWallet } from "@/state/wallet";

const MCP_URL = "http://127.0.0.1:7373";

const CONFIG_JSON = `{
  "mcpServers": {
    "ration": {
      "command": "node",
      "args": ["/path/to/ration/packages/mcp/dist/mcp/src/index.js"],
      "env": {
        "AGENT_PRIVATE_KEY": "0x… (the agent's own testnet key)"
      }
    }
  }
}`;

function Code({ text }: { text: string }) {
  return <div className="codeblock">{text}<CopyBtn text={text} label="Copy" /></div>;
}

interface Call { t: number; tool: string; input: unknown; ok: boolean; summary: string }

function ToolLog() {
  const q = useQuery({
    queryKey: ["mcp-log"],
    queryFn: async () => {
      const r = await fetch(`${MCP_URL}/calls`, { cache: "no-store" });
      if (!r.ok) throw new Error("bad");
      return (await r.json()) as { calls: Call[] };
    },
    refetchInterval: 2000,
    retry: false,
  });
  const connected = !q.isError && !!q.data;
  return (
    <div className="card stack">
      <div className="row between wrap">
        <h2 className="h2">Live tool calls</h2>
        <span className={`badge ${connected ? "ok" : ""}`}><i />{connected ? "MCP server connected" : "Waiting for the MCP server"}</span>
      </div>
      {!connected ? (
        <StateCard title="No agent connected yet" >
          Run the Ration MCP server on your computer and every call your agent makes shows up here as it happens. This page talks to it at <span className="mono">127.0.0.1:7373</span>. If your browser asks to allow local network access, allow it.
        </StateCard>
      ) : q.data!.calls.length === 0 ? (
        <StateCard title="Connected. Waiting for the first call">Ask your agent: "How much of the Ration budget is left?"</StateCard>
      ) : (
        <div className="log">
          <AnimatePresence initial={false}>
            {[...q.data!.calls].reverse().slice(0, 30).map((c) => (
              <motion.div key={`${c.t}-${c.tool}`} layout initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="log-item">
                <span className={`badge ${c.ok ? "ok" : "bad"}`}><i />{c.tool}</span>
                <span>{c.summary}</span>
                <span className="mono helper">{ago(c.t / 1000)}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function Sandbox() {
  const w = useWallet();
  const snap = useSnapshot().data;
  const { events } = useEvents();
  const known = useMemo(() => [...new Set(events.filter((e) => e.kind === "spenderSet").map((e) => e.args.spender as string))], [events]);
  const [spender, setSpender] = useState("");
  const [laneKey, setLaneKey] = useState(LANES[0].key);
  const [amount, setAmount] = useState("500");
  const [to, setTo] = useState("0x000000000000000000000000000000000000dEaD");
  const [verdict, setVerdict] = useState<SpendVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!spender) setSpender(w.account ?? known[0] ?? ""); }, [w.account, known, spender]);
  useEffect(() => setVerdict(null), [spender, laneKey, amount, to]);

  const lane = LANES.find((l) => l.key === laneKey)!;
  const units = toUnits(amount);
  const valid = /^0x[0-9a-fA-F]{40}$/.test(spender) && /^0x[0-9a-fA-F]{40}$/.test(to) && units !== undefined;
  const remaining = snap?.lanes.reduce((a, l) => a + l.slice, 0n);
  const asYou = !!w.account && spender.toLowerCase() === w.account.toLowerCase();

  async function check() {
    if (!valid) return;
    setBusy(true);
    try {
      setVerdict(await checkSpend({ client: clientFor(laneKey), laneName: lane.name, vault: lane.vault, token: lane.token, spender: spender as Address, to: to as Address, amount: units!, remainingTotal: remaining, symbol: SYMBOL }));
    } catch {
      setVerdict({ ok: false, code: "paused", reason: "Couldn't reach the chain to check. Nothing was sent. Try again." });
    }
    setBusy(false);
  }

  return (
    <div className="card stack">
      <div className="row between wrap"><h2 className="h2">Try a spend</h2><span className="badge"><i />Dry run: sends nothing</span></div>
      <p className="muted">See what an agent would hear back. This runs the same check as the MCP tool <span className="mono">request_spend</span>.</p>
      <div className="field">
        <label htmlFor="sb-sp">Spender</label>
        <div className="input-block"><input id="sb-sp" style={{ fontSize: 14 }} value={spender} onChange={(e) => setSpender(e.target.value.trim())} placeholder="0x… agent or person" spellCheck={false} /></div>
        {known.length > 0 && <div className="row wrap" style={{ gap: 8 }}>{known.map((a) => <button key={a} className="chip" aria-pressed={spender.toLowerCase() === a.toLowerCase()} onClick={() => setSpender(a)}>{short(a)}</button>)}</div>}
      </div>
      <div className="grid two">
        {LANES.map((l) => (<button key={l.key} className="option" aria-pressed={laneKey === l.key} onClick={() => setLaneKey(l.key)}><ChainBadge lane={l} /><span className="num" style={{ fontWeight: 700 }}>{fmtAmt(snap?.lanes.find((x) => x.cfg.key === l.key)?.slice)} <span className="muted">left</span></span></button>))}
      </div>
      <div className="field">
        <label htmlFor="sb-amt">Amount</label>
        <div className="input-block"><input id="sb-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /><span className="token-chip"><span className="token-dot">{SYMBOL[0]}</span>{SYMBOL}</span></div>
        <div className="row wrap" style={{ gap: 8 }}>{["25", "100", "500", "5000"].map((c) => <button key={c} className="chip" aria-pressed={amount === c} onClick={() => setAmount(c)}>{c}</button>)}</div>
        <p className="helper">Try an amount above the slice to see how a denial reads.</p>
      </div>
      <div className="field"><label htmlFor="sb-to">Pay to</label><div className="input-block"><input id="sb-to" style={{ fontSize: 14 }} value={to} onChange={(e) => setTo(e.target.value.trim())} spellCheck={false} /></div></div>
      <button className="btn primary" disabled={!valid || busy} onClick={check}>{busy ? "Checking the chain…" : "Check this spend"}</button>
      <AnimatePresence mode="wait">
        {verdict && (
          <motion.div key={verdict.code + verdict.reason} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`state ${verdict.ok ? "" : "bad"}`} style={verdict.ok ? { borderStyle: "solid", borderColor: "var(--teal)" } : undefined} role="status">
            <h3 className="h2">{verdict.ok ? <><CheckCircle2 size={18} style={{ verticalAlign: -3 }} /> Allowed</> : <><ShieldAlert size={18} style={{ verticalAlign: -3 }} /> Denied</>}</h3>
            <p style={{ color: "var(--ink)" }}>{verdict.reason}</p>
            {verdict.ok && asYou && (
              <button className="btn small auto" onClick={async () => { await w.write({ chain: laneKey, laneName: lane.name, address: lane.vault, abi: vaultAbi, functionName: "spend", args: [lane.token, to as Address, units!], title: `Spent ${amount} ${SYMBOL} on ${lane.short}` }); }}>Send it for real from my wallet</button>
            )}
            {verdict.ok && !asYou && <p className="helper">To send it for real, connect that spender's wallet. Agents send through the MCP server.</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Recent() {
  const { events, isLoading } = useEvents();
  const spends = events.filter((e) => e.kind === "spent").slice(-6).reverse();
  if (isLoading || !spends.length) return null;
  return (
    <div className="card stack">
      <h2 className="h2">Latest spends on-chain</h2>
      <p className="helper">Everything an agent spends lands here, whether or not this page was open.</p>
      {spends.map((e) => (
        <div key={e.id} className="row between wrap" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <span className="row" style={{ gap: 10 }}><Bot size={16} /><span className="mono">{short(e.args.spender)}</span><span className="muted">spent</span><b className="num">{fmtAmt(e.args.amount)}</b> on {LANES.find((l) => l.key === e.chain)?.short}</span>
          <span className="helper mono">{ago(e.ts)}</span>
        </div>
      ))}
    </div>
  );
}

export function Agents() {
  return (
    <>
      <PageHead help="agents" eyebrow="Agents" title="Let an AI spend within the rules." lede="Connect an agent through MCP. It can read the budget and ask to spend. The vaults decide, and say why when they refuse." />
      <Stagger>
        <Rise>
          <div className="card stack">
            <h2 className="h2"><PlugZap size={20} style={{ verticalAlign: -3 }} /> Set it up in four steps</h2>
            <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 22, gridTemplateColumns: "minmax(0, 1fr)" }}>
              <li className="stack" style={{ gap: 10 }}><b>1. Install and build</b><Code text={"pnpm install\npnpm --filter @ration/mcp build"} /></li>
              <li className="stack" style={{ gap: 10 }}><b>2. Give the agent its own key</b><p className="helper">Use a separate testnet key. Add its address on the Spenders page so it is allowed to spend, with a cap if you like. It can only make payments, up to its slice and its own cap. It can't change any setting or touch the vault's other money. By default a payment can go to any address, so the owner can switch on an allowed-recipients list on the Vaults page.</p></li>
              <li className="stack" style={{ gap: 10 }}><b>3. Add Ration to your MCP client</b><Code text={CONFIG_JSON} /></li>
              <li className="stack" style={{ gap: 10 }}><b>4. Ask something</b><Code text={'"How much of the Ration budget is left on each chain?"\n"Spend 20 mUSDC on Base to 0x…"'} /></li>
            </ol>
            <div className="row wrap" style={{ gap: 8 }}>
              {["get_budget", "get_slices", "get_remaining", "request_spend", "get_ledger"].map((t) => <span key={t} className="badge mono">{t}</span>)}
            </div>
          </div>
        </Rise>
        <Rise><ToolLog /></Rise>
        <Rise><Sandbox /></Rise>
        <Rise><Recent /></Rise>
      </Stagger>
      <Footnote>An agent holds only a spender key. It can spend inside its slice and cap on each chain, and nothing else. The tool log only shows calls made to an MCP server running on this computer.</Footnote>
    </>
  );
}
