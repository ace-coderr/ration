import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight, Minus, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import evidence from "@evidence";
import { LaneBoard } from "@/components/LaneBoard";
import { Addr, Rise, Stagger, Ticker } from "@/components/kit";
import { HUB, LANES, SYMBOL } from "@/lib/config";
import { num } from "@/lib/format";
import { useSnapshot } from "@/state/data";

const FAQ = [
  ["Does Ration hold my money?", "No. Each chain has its own vault, and only the owner can withdraw from it. Ration moves the right to spend, never the funds themselves."],
  ["What stops it from overspending?", "A slice is removed from one chain before it is added to the next. The sum of all slices plus what has been spent can't go above the budget, even while a message is in flight. If a message is lost, the budget goes unused. It never goes over."],
  ["Who runs the bot that moves the slices?", "Nobody. A reactive contract on Reactive Network watches every vault and sends the callbacks. There is no server and no keeper to keep alive."],
  ["Can funds move between chains?", "No. You fund each vault yourself. If one chain needs more real money, you top it up. Ration only decides how much of the limit each chain may spend."],
  ["Is this real money?", "No. This is a testnet build. The token is a mock with no value."],
];

export function Landing() {
  const { data } = useSnapshot();
  const budget = data?.hub.epochBudget ?? 0n;
  const loop = (evidence as any).loops?.[0];
  return (
    <>
      <section className="hero">
        <div>
          <motion.span className="eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Testnet · Live on 3 chains</motion.span>
          <motion.h1 className="title" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
            One limit. Every chain.
          </motion.h1>
          <motion.p className="lede" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
            Set a spending limit once. Ration moves the right to spend to the chain where the spending happens. No bot. No custody. Your funds stay in your vaults.
          </motion.p>
          <motion.div className="row wrap" style={{ marginTop: 28, gap: 14 }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
            <Link to="/live" className="btn primary auto" style={{ width: "auto", padding: "0 30px" }}>Open the live budget <ArrowRight size={20} /></Link>
            <Link to="/proof" className="btn auto">See the proof</Link>
          </motion.div>
        </div>

        <Stagger className="stack">
          <Rise>
            <div className="card stack">
              <div className="row between wrap">
                <h2 className="h2">The real vaults, right now</h2>
                <span className="badge ok"><i />Live data</span>
              </div>
              <LaneBoard compact />
              <div className="row wrap" style={{ gap: 28 }}>
                <div className="stat"><span className="k">Budget this period</span><span className="v sm">{budget > 0n ? <Ticker value={num(budget)} format={(n) => Math.round(n).toLocaleString("en-US")} /> : "–"} <span className="muted" style={{ fontSize: 14 }}>{SYMBOL}</span></span></div>
                <div className="stat"><span className="k">Chains watched</span><span className="v sm">{LANES.length}</span></div>
                <div className="stat"><span className="k">Keeper servers</span><span className="v sm">0</span></div>
              </div>
            </div>
          </Rise>
        </Stagger>
      </section>

      <section className="landing-strip" aria-labelledby="hiw3">
        <div className="row between wrap" style={{ marginBottom: 14, gap: 12 }}>
          <h2 id="hiw3" className="h2">How it works in 3 steps</h2>
          <Link to="/how-it-works" className="btn small auto">Read the full explainer <ArrowRight size={16} /></Link>
        </div>
        <div className="hw-strip" role="list">
          {[
            ["1", "Set one budget", "Pick an amount and a period.", "/how-it-works#idea"],
            ["2", "Allow who can spend", "Add people or AI agents, with caps.", "/how-it-works#who"],
            ["3", "Spend anywhere, never over", "The limit follows the spending.", "/how-it-works#spending"],
          ].map(([n, t, d, to], i) => (
            <div className="hw-strip-item" role="listitem" key={n}>
              <Link to={to} className="card hw-step">
                <span className="hw-n">{n}</span>
                <b>{t}</b>
                <span className="muted">{d}</span>
              </Link>
              {i < 2 && <ArrowRight className="hw-arrow" size={22} aria-hidden />}
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 72 }} aria-labelledby="how">
        <span className="eyebrow">How it moves</span>
        <h2 id="how" className="title" style={{ fontSize: "clamp(32px,4.6vw,54px)" }}>Three steps. No one in the middle.</h2>
        <div className="grid three steps" style={{ marginTop: 28 }}>
          {[
            ["A chain spends", "A spender pays out from one vault. The vault shrinks its slice and logs the spend. If the slice is now low, that's the signal."],
            ["The hub moves a slice", "A reactive contract sees the log. It tells the richest vault to give up some allowance first, then tells the low one to take exactly that much."],
            ["Spending continues", "The low chain can spend again in seconds. At no point does the total allowance go above your limit."],
          ].map(([t, b], i) => (
            <motion.div key={t} className="card step" initial={{ opacity: 0, y: 26 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ delay: i * 0.09, duration: 0.5 }}>
              <h3 className="h2">{t}</h3>
              <p className="muted">{b}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 72 }} aria-labelledby="proof">
        <span className="eyebrow">Proof</span>
        <h2 id="proof" className="title" style={{ fontSize: "clamp(32px,4.6vw,54px)" }}>Check it yourself.</h2>
        <div className="card ink" style={{ marginTop: 28 }}>
          <div className="grid two" style={{ gap: 28 }}>
            <div className="stack" style={{ gap: 12 }}>
              <div className="stat"><span className="k" style={{ color: "#98a59d" }}>Hub, on Reactive Lasna</span></div>
              <Addr value={HUB} chain="lasna" full />
              {LANES.map((l) => (
                <div key={l.key} className="stack" style={{ gap: 6 }}>
                  <span className="k mono" style={{ color: "#98a59d", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em" }}>Vault, {l.name}</span>
                  <Addr value={l.vault} chain={l.key} full />
                </div>
              ))}
            </div>
            <div className="stack" style={{ gap: 10 }}>
              <div className="stat"><span className="k" style={{ color: "#98a59d" }}>One full loop, on-chain</span></div>
              {loop?.steps?.map((s: any) => (
                <a key={s.tx} href={s.url} target="_blank" rel="noreferrer" className="row between" style={{ textDecoration: "none", color: "#eaf0ec", padding: "8px 0", borderTop: "1px solid #26322b", fontSize: 14 }}>
                  <span>{s.step}</span><span className="mono row" style={{ gap: 4, color: "#B8F23A" }}>{s.chain.replace(" Sepolia", "").replace("Reactive ", "")} <ArrowUpRight size={14} /></span>
                </a>
              ))}
              <Link to="/proof" className="btn small auto" style={{ borderColor: "#eaf0ec", color: "#eaf0ec", alignSelf: "flex-start", marginTop: 8 }}>All hashes and latency</Link>
            </div>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 72, marginBottom: 20 }} aria-labelledby="faq">
        <span className="eyebrow">Questions</span>
        <h2 id="faq" className="title" style={{ fontSize: "clamp(32px,4.6vw,54px)", marginBottom: 20 }}>Short answers.</h2>
        {FAQ.map(([q, a]) => (
          <details className="faq" key={q}>
            <summary>{q}<Plus size={20} className="faq-plus" /><Minus size={20} className="faq-minus" style={{ display: "none" }} /></summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
    </>
  );
}
