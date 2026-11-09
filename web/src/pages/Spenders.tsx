import { AnimatePresence, motion } from "framer-motion";
import { Bot, Plus, User, UserX } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { DEMO_ADDRESS } from "@/lib/demoAgent";
import { Addr, ChainBadge, Footnote, PageHead, Rise, Seg, Skeleton, Stagger, StateCard } from "@/components/kit";
import { vaultAbi } from "@/lib/abi";
import { clientFor } from "@/lib/chains";
import { LANES, SYMBOL } from "@/lib/config";
import { fmtAmt, toUnits } from "@/lib/format";
import { useEvents, useSnapshot } from "@/state/data";
import { useWallet } from "@/state/wallet";

type Kind = "person" | "agent";
const LS = "ration-labels";
const readLabels = (): Record<string, { name: string; kind: Kind }> => { try { return JSON.parse(localStorage.getItem(LS) ?? "{}"); } catch { return {}; } };

function useSpenderList() {
  const { events, isLoading } = useEvents();
  const addrs = useMemo(() => {
    const m = new Map<string, Address>();
    for (const e of events) if (e.kind === "spenderSet") m.set((e.args.spender as string).toLowerCase(), e.args.spender as Address);
    return [...m.values()];
  }, [events]);
  const q = useQuery({
    enabled: addrs.length > 0,
    queryKey: ["spenders", addrs.join(",")],
    refetchInterval: 8000,
    queryFn: async () => {
      return Promise.all(addrs.map(async (a) => ({
        address: a,
        lanes: await Promise.all(LANES.map(async (l) => {
          const c = clientFor(l.key);
          const [info, epoch] = await Promise.all([
            c.readContract({ address: l.vault, abi: vaultAbi, functionName: "spenders", args: [a] }),
            c.readContract({ address: l.vault, abi: vaultAbi, functionName: "epochId" }),
          ]);
          const used = await c.readContract({ address: l.vault, abi: vaultAbi, functionName: "spentBy", args: [epoch, a] });
          return { lane: l, allowed: info[0], cap: info[1], used };
        })),
      })));
    },
  });
  return { list: q.data ?? [], loading: isLoading || (addrs.length > 0 && q.isLoading), empty: !isLoading && addrs.length === 0 };
}

function AddForm({ ownerOk }: { ownerOk: boolean }) {
  const w = useWallet();
  const qc = useQueryClient();
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("agent");
  const [cap, setCap] = useState("");
  const [chains, setChains] = useState<string[]>(LANES.map((l) => l.key));
  const [busy, setBusy] = useState(false);
  const okAddr = /^0x[0-9a-fA-F]{40}$/.test(address);
  const capUnits = cap.trim() === "" ? 0n : toUnits(cap);
  const bad = !okAddr || capUnits === undefined || chains.length === 0;

  async function add() {
    setBusy(true);
    let all = true;
    for (const k of chains) {
      const l = LANES.find((x) => x.key === k)!;
      const ok = await w.write({ chain: k, laneName: l.name, address: l.vault, abi: vaultAbi, functionName: "setSpender", args: [address as Address, true, capUnits ?? 0n], title: `${name || "Spender"} can spend on ${l.short}` });
      if (!ok) { all = false; break; }
    }
    if (all || chains.length) {
      const labels = readLabels();
      if (name) labels[address.toLowerCase()] = { name, kind };
      try { localStorage.setItem(LS, JSON.stringify(labels)); } catch { /* private mode */ }
      if (all) { setAddress(""); setName(""); setCap(""); }
    }
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["events"] });
    qc.invalidateQueries({ queryKey: ["spenders"] });
  }

  return (
    <div className="card stack">
      <h2 className="h2">Add a spender</h2>
      <div className="field">
        <label htmlFor="sp-addr">Address</label>
        <div className={`input-block ${address && !okAddr ? "error" : ""}`}><input id="sp-addr" style={{ fontSize: 15 }} placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value.trim())} spellCheck={false} disabled={!ownerOk} /></div>
        <p className={`helper ${address && !okAddr ? "err" : ""}`}>{address && !okAddr ? "That doesn't look like a full address." : "The wallet or agent key that will make payments. It can only pay up to the slice and its own cap, and can't change any setting."}</p>
      </div>
      <div className="grid two">
        <div className="field">
          <label htmlFor="sp-name">Name (stays in your browser)</label>
          <div className="input-block"><input id="sp-name" style={{ fontSize: 17 }} placeholder="Research agent" value={name} onChange={(e) => setName(e.target.value)} disabled={!ownerOk} /></div>
        </div>
        <div className="field">
          <span className="label">Kind</span>
          <Seg label="Kind" value={kind} onChange={setKind} options={[{ v: "agent", label: "Agent" }, { v: "person", label: "Person" }]} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="sp-cap">Cap per chain, per period</label>
        <div className="input-block"><input id="sp-cap" inputMode="decimal" placeholder="No cap" value={cap} onChange={(e) => setCap(e.target.value)} disabled={!ownerOk} /><span className="token-chip"><span className="token-dot">{SYMBOL[0]}</span>{SYMBOL}</span></div>
        <p className="helper">Leave empty for no cap. They can still never spend more than the slice on that chain.</p>
      </div>
      <div className="field">
        <span className="label">Chains</span>
        <div className="grid two">
          {LANES.map((l) => (
            <button key={l.key} className="option" aria-pressed={chains.includes(l.key)} disabled={!ownerOk} onClick={() => setChains((c) => (c.includes(l.key) ? c.filter((x) => x !== l.key) : [...c, l.key]))}>
              <ChainBadge lane={l} /><span className="helper">{chains.includes(l.key) ? "Can spend here" : "Not allowed here"}</span>
            </button>
          ))}
        </div>
      </div>
      <button className="btn primary" disabled={!ownerOk || bad || busy} onClick={add}><Plus size={20} /> {busy ? "Waiting for your wallet…" : "Add spender"}</button>
    </div>
  );
}

export function Spenders() {
  const w = useWallet();
  const qc = useQueryClient();
  const snap = useSnapshot().data;
  const { list, loading, empty } = useSpenderList();
  const labels = readLabels();
  const ownerOk = w.isOwner(snap?.lanes[0]?.owner);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function revoke(a: Address) {
    setRevoking(a);
    for (const l of LANES) {
      const ok = await w.write({ chain: l.key, laneName: l.name, address: l.vault, abi: vaultAbi, functionName: "setSpender", args: [a, false, 0n], title: `Revoked on ${l.short}` });
      if (!ok) break;
    }
    setRevoking(null);
    qc.invalidateQueries({ queryKey: ["events"] });
    qc.invalidateQueries({ queryKey: ["spenders"] });
  }

  return (
    <>
      <PageHead help="spenders" eyebrow="Spenders" title="Who can spend." lede="People and agents you've allowed to spend from your vaults. Each one has a cap. Revoking takes effect on the next block." />
      <Stagger>
        <Rise>
          {loading ? <div className="stack"><Skeleton h={120} r={26} /><Skeleton h={120} r={26} /></div>
            : empty ? <StateCard title="No spenders yet">Nobody can spend from these vaults. Add a person or an agent below.</StateCard>
            : (
              <div className="stack">
                <AnimatePresence initial={false}>
                  {list.map((s) => {
                    const lbl = labels[s.address.toLowerCase()];
                    const active = s.lanes.some((x) => x.allowed);
                    const Icon = lbl?.kind === "person" ? User : Bot;
                    return (
                      <motion.div key={s.address} layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: active ? 1 : 0.6, y: 0 }} exit={{ opacity: 0 }} className="card stack">
                        <div className="row between wrap">
                          <div className="row" style={{ gap: 12 }}>
                            <span className="token-dot" style={{ width: 40, height: 40, background: active ? "var(--lime)" : "var(--card-2)", color: "#0E1411" }}><Icon size={20} /></span>
                            <div><div className="h2" style={{ fontSize: 20 }}>{s.address.toLowerCase() === DEMO_ADDRESS.toLowerCase() ? "Shared demo agent (public key)" : lbl?.name ?? (lbl?.kind === "person" ? "Person" : "Spender")}</div><Addr value={s.address} full /></div>
                          </div>
                          <div className="row" style={{ gap: 8 }}>
                            {!active && <span className="badge"><i />Revoked</span>}
                            {w.account && w.account.toLowerCase() === s.address.toLowerCase() && <span className="badge lime">You</span>}
                            {active && <button className="btn small auto danger" disabled={!ownerOk || revoking === s.address} onClick={() => revoke(s.address)}><UserX size={15} /> {revoking === s.address ? "Revoking…" : "Revoke"}</button>}
                          </div>
                        </div>
                        <div className="grid two" style={{ gap: 12 }}>
                          {s.lanes.map((x) => (
                            <div key={x.lane.key} className="option" style={{ cursor: "default" }} aria-pressed={x.allowed}>
                              <div className="row between"><ChainBadge lane={x.lane} /><span className={`badge ${x.allowed ? "ok" : ""}`}><i />{x.allowed ? "Can spend" : "No access"}</span></div>
                              {x.allowed && (
                                <>
                                  <span className="helper">Spent this period</span>
                                  <span className="num" style={{ fontWeight: 700 }}>{fmtAmt(x.used)} {x.cap > 0n ? <span className="muted">of {fmtAmt(x.cap)} cap</span> : <span className="muted">· no cap</span>}</span>
                                  {x.cap > 0n && <div className="bar"><i className={x.used >= x.cap ? "b-red" : "b-teal"} style={{ width: `${Math.min(100, Number((x.used * 100n) / x.cap))}%` }} /></div>}
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
        </Rise>
        <Rise>
          {!w.account ? <StateCard title="Connect the owner wallet to add spenders" action={<Link className="btn auto" to="/connect">Connect a wallet</Link>}>Anyone can read this list. Only the vault owner can change it.</StateCard>
            : !ownerOk ? <StateCard tone="warn" title="This wallet isn't the owner">Only the vault owner can add or revoke spenders.</StateCard>
            : <AddForm ownerOk={ownerOk} />}
        </Rise>
      </Stagger>
      <Footnote>A spender can only make payments, up to its slice and its own cap. It can't change any setting or touch the vault's other money. By default a payment can go to any address, so the owner can switch on an allowed-recipients list on the Vaults page. Names are kept in this browser only. One spender here, the shared demo agent, uses a deliberately public key so anyone can try a real spend without a wallet. The vaults cap it at a small amount per period, and it can't change any setting.</Footnote>
    </>
  );
}
