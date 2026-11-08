import { motion } from "framer-motion";
import { Droplets, Pause, Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { Addr, ChainBadge, Footnote, PageHead, Rise, Seg, Skeleton, Stagger, StateCard, Ticker } from "@/components/kit";
import { erc20Abi, hubAbi, vaultAbi } from "@/lib/abi";
import { clientFor } from "@/lib/chains";
import { HUB, SYMBOL } from "@/lib/config";
import { fmtAmt, num, toUnits } from "@/lib/format";
import { useSnapshot, type LaneSnap } from "@/state/data";
import { useWallet } from "@/state/wallet";

function VaultCard({ s }: { s: LaneSnap }) {
  const w = useWallet();
  const qc = useQueryClient();
  const lane = s.cfg;
  const owner = w.isOwner(s.owner);
  const [mode, setMode] = useState<"fund" | "withdraw">("fund");
  const [amount, setAmount] = useState("100");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const units = toUnits(amount);
  const unallocated = s.tokenBalance > s.slice ? s.tokenBalance - s.slice : 0n;
  const mine = useQuery({
    enabled: !!w.account,
    queryKey: ["mybal", lane.key, w.account],
    queryFn: () => clientFor(lane.key).readContract({ address: lane.token, abi: erc20Abi, functionName: "balanceOf", args: [w.account!] }),
    refetchInterval: 8000,
  });
  const expired = s.epochEnd > 0n && BigInt(s.chainTime) >= s.epochEnd;
  const done = () => qc.invalidateQueries({ queryKey: ["snapshot"] });

  const over = units !== undefined && (mode === "withdraw" ? units > unallocated : mine.data !== undefined && units > mine.data);
  const helper =
    mode === "fund"
      ? `Moves ${SYMBOL} from your wallet into this vault. It stays yours: only the owner can take it back.`
      : `Only ${fmtAmt(unallocated)} ${SYMBOL} is free to take out. The rest backs this chain's current slice.`;

  async function run(label: string, fn: () => Promise<unknown>) { setBusy(label); await fn(); setBusy(null); done(); }

  async function submit() {
    if (units === undefined || units === 0n) return;
    if (mode === "withdraw") {
      await run("withdraw", () => w.write({ chain: lane.key, laneName: lane.name, address: lane.vault, abi: vaultAbi, functionName: "withdraw", args: [lane.token, units], title: `Withdrew ${amount} ${SYMBOL}` }));
      return;
    }
    await run("fund", async () => {
      const allowance = await clientFor(lane.key).readContract({ address: lane.token, abi: erc20Abi, functionName: "allowance", args: [w.account!, lane.vault] });
      if (allowance < units) {
        const ok = await w.write({ chain: lane.key, laneName: lane.name, address: lane.token, abi: erc20Abi, functionName: "approve", args: [lane.vault, units], title: "Approved. Now moving the funds." });
        if (!ok) return;
      }
      await w.write({ chain: lane.key, laneName: lane.name, address: lane.vault, abi: vaultAbi, functionName: "deposit", args: [lane.token, units], title: `Funded ${amount} ${SYMBOL}` });
    });
  }

  const flag = (on: boolean) => on ? "ok" : "warn";
  return (
    <motion.section className="card stack" aria-label={`${lane.name} vault`} layout>
      <div className="row between wrap">
        <div className="row" style={{ gap: 12 }}><ChainBadge lane={lane} /><h2 className="h2">{lane.name}</h2></div>
        <div className="row wrap" style={{ gap: 8 }}>
          {s.paused ? <span className="badge warn"><i />Paused</span> : expired ? <span className="badge warn"><i />Slice expired</span> : <span className="badge ok"><i />Active</span>}
          {s.debt > 0n && <span className="badge bad"><i />Out of fuel</span>}
        </div>
      </div>
      <Addr value={lane.vault} chain={lane.key} full />

      <div className="grid three" style={{ gap: 14 }}>
        <div className="stat"><span className="k">Held in vault</span><span className="v sm"><Ticker value={num(s.tokenBalance)} format={(n) => Math.round(n).toLocaleString("en-US")} /></span></div>
        <div className="stat"><span className="k">Slice to spend</span><span className="v sm"><Ticker value={num(s.slice)} format={(n) => Math.round(n).toLocaleString("en-US")} /></span></div>
        <div className="stat"><span className="k">Free to withdraw</span><span className="v sm"><Ticker value={num(unallocated)} format={(n) => Math.round(n).toLocaleString("en-US")} /></span></div>
      </div>
      {s.tokenBalance < s.slice && <StateCard tone="warn" title="Underfunded">This vault holds less than its slice. Spending past what it holds will fail. Fund it to match.</StateCard>}

      {!w.account ? (
        <StateCard title="Connect to fund or change this vault" action={<Link className="btn auto" to="/connect">Connect a wallet</Link>}>Reading is open. Changes need the vault owner.</StateCard>
      ) : !owner ? (
        <StateCard tone="warn" title="This wallet isn't the owner">Only <span className="mono">{s.owner.slice(0, 8)}…</span> can fund, withdraw or pause this vault.</StateCard>
      ) : (
        <>
          <div className="stack" style={{ gap: 14 }}>
            <div className="row between wrap">
              <Seg label="Fund or withdraw" value={mode} onChange={setMode} options={[{ v: "fund", label: "Fund" }, { v: "withdraw", label: "Withdraw" }]} />
              <span className="helper">In your wallet: <span className="num">{fmtAmt(mine.data)}</span> {SYMBOL}</span>
            </div>
            <div className="field">
              <div className={`input-block ${over ? "error" : ""}`}>
                <input aria-label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" />
                <span className="token-chip"><span className="token-dot">{SYMBOL[0]}</span>{SYMBOL}</span>
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                {["50", "100", "500"].map((c) => <button key={c} className="chip" aria-pressed={amount === c} onClick={() => setAmount(c)}>{c}</button>)}
                {mode === "withdraw" && <button className="chip" onClick={() => setAmount(String(num(unallocated)))}>All free</button>}
              </div>
              <p className={`helper ${over ? "err" : ""}`}>{over ? (mode === "fund" ? "Your wallet doesn't hold that much. Get test tokens below." : "That's more than is free to withdraw.") : helper}</p>
            </div>
            <button className="btn primary" disabled={!units || over || !!busy} onClick={submit}>{busy === "fund" || busy === "withdraw" ? "Waiting for your wallet…" : mode === "fund" ? `Fund ${amount || 0} ${SYMBOL}` : `Withdraw ${amount || 0} ${SYMBOL}`}</button>
          </div>

          <hr style={{ border: 0, borderTop: "1px solid var(--line)", width: "100%" }} />
          <div className="grid two" style={{ gap: 14 }}>
            <div className="stack" style={{ gap: 8 }}>
              <span className="label mono helper" style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}>Token allowlist</span>
              <div className="row between wrap"><span className="addr">{lane.token.slice(0, 10)}…{lane.token.slice(-6)} · {SYMBOL}</span><span className={`badge ${flag(s.tokenAllowed)}`}><i />{s.tokenAllowed ? "Allowed" : "Blocked"}</span></div>
              <button className="btn small auto" disabled={!!busy} onClick={() => run("tok", () => w.write({ chain: lane.key, laneName: lane.name, address: lane.vault, abi: vaultAbi, functionName: "setToken", args: [lane.token, !s.tokenAllowed], title: s.tokenAllowed ? "Token blocked" : "Token allowed" }))}>{s.tokenAllowed ? "Block this token" : "Allow this token"}</button>
              <p className="helper">Only allowlisted tokens with the same decimals as the budget can be spent.</p>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <span className="label mono helper" style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}>Pause</span>
              <button className={`btn small auto ${s.paused ? "" : "danger"}`} disabled={!!busy} onClick={() => run("pause", () => w.write({ chain: lane.key, laneName: lane.name, address: lane.vault, abi: vaultAbi, functionName: "setPaused", args: [!s.paused], title: s.paused ? "Spending resumed" : "Spending paused" }))}>
                {s.paused ? <><Play size={15} /> Resume spending</> : <><Pause size={15} /> Pause spending</>}
              </button>
              <p className="helper">Paused vaults refuse every spend. The hub can still move allowance in and out.</p>
            </div>
          </div>

          <details>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>Limit who can be paid</summary>
            <div className="stack" style={{ marginTop: 14, gap: 12 }}>
              <div className="row between wrap">
                <span className="helper">{s.restrict ? "Only listed recipients can be paid." : "Anyone can be paid."}</span>
                <button className="btn small auto" onClick={() => run("rr", () => w.write({ chain: lane.key, laneName: lane.name, address: lane.vault, abi: vaultAbi, functionName: "setRestrictRecipients", args: [!s.restrict], title: s.restrict ? "Anyone can be paid" : "Recipient list is on" }))}>{s.restrict ? "Turn list off" : "Turn list on"}</button>
              </div>
              <div className="input-block"><input style={{ fontSize: 14 }} placeholder="0x… recipient to allow" value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} spellCheck={false} /></div>
              <button className="btn small auto" disabled={!/^0x[0-9a-fA-F]{40}$/.test(recipient)} onClick={() => run("rcp", () => w.write({ chain: lane.key, laneName: lane.name, address: lane.vault, abi: vaultAbi, functionName: "setRecipient", args: [recipient as Address, true], title: "Recipient allowed" }))}>Allow this recipient</button>
            </div>
          </details>
        </>
      )}

      {w.account && (
        <div className="row between wrap">
          <span className="helper">Need test tokens? The mock token has a public faucet.</span>
          <button className="btn small auto" disabled={!!busy} onClick={() => run("faucet", () => w.write({ chain: lane.key, laneName: lane.name, address: lane.token, abi: erc20Abi, functionName: "faucet", args: [w.account!, 1000n * 10n ** 6n], title: `Minted 1,000 ${SYMBOL} to your wallet` }))}><Droplets size={15} /> Get 1,000 {SYMBOL}</button>
        </div>
      )}
    </motion.section>
  );
}

function ResendNotice() {
  const w = useWallet();
  const qc = useQueryClient();
  const { data } = useSnapshot();
  const [busy, setBusy] = useState(false);
  if (!data || data.hub.closing || data.hub.epochId === 0n) return null;
  const behind = data.lanes.filter((l) => l.epochId < data.hub.epochId);
  if (!behind.length) return null;
  const owner = w.isOwner(data.hub.owner);
  return (
    <StateCard
      tone="warn"
      title="A chain has not joined the new period"
      action={
        owner ? (
          <button
            className="btn auto"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await w.write({ chain: "lasna", address: HUB, abi: hubAbi, functionName: "reissueEpoch", title: "New period re-sent to the chains that missed it" });
              setBusy(false);
              qc.invalidateQueries({ queryKey: ["snapshot"] });
            }}
          >
            {busy ? "Waiting for your wallet…" : "Re-send the new period now"}
          </button>
        ) : undefined
      }
    >
      {behind.map((l) => l.cfg.name).join(", ")} still shows the old period, so it can't be spent there yet. The hub re-sends on its own every few minutes. {owner ? "You can also do it now." : "The owner can re-send it now."}
    </StateCard>
  );
}

export function Vaults() {
  const { data, isLoading, isError, refetch } = useSnapshot();
  return (
    <>
      <PageHead help="vaults" eyebrow="Vaults" title="Where the money sits." lede="One vault per chain. Each one holds real tokens and a slice of the limit. Only the owner can move funds out." />
      {isLoading ? <div className="stack"><Skeleton h={300} r={26} /><Skeleton h={300} r={26} /></div>
        : isError && !data ? <StateCard tone="bad" title="Can't read the vaults" action={<button className="btn auto" onClick={() => refetch()}>Try again</button>}>The chains did not answer.</StateCard>
        : (
          <Stagger>
            <Rise><ResendNotice /></Rise>
            {data!.lanes.map((s) => <Rise key={s.cfg.key}><VaultCard s={s} /></Rise>)}</Stagger>
        )}
      <Footnote>Funds never cross chains. If one chain needs more real tokens, you fund that vault yourself. Ration only moves how much of the limit each chain may spend.</Footnote>
    </>
  );
}
