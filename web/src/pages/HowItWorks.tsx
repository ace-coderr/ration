import {
  AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll,
} from "framer-motion";
import { ArrowRight, ArrowUpRight, Bot, Cpu, Fuel as FuelIcon, KeyRound, Landmark, Minus, Plus, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CopyBtn, PageHead, Rise, Skeleton, Stagger, Ticker } from "@/components/kit";
import { HUB, LANES, SYMBOL, DECIMALS, addrUrl, laneByKey, txUrl } from "@/lib/config";
import { duration, fmtAmt, fmtNative, num } from "@/lib/format";
import { useEvents, useSnapshot } from "@/state/data";
import { useBudgetMath } from "./Live";

const REPO = "https://github.com/ace-coderr/ration";

/** "about 3 hours" from a number of seconds, for wake-up intervals. */
function approx(sec: number): string {
  if (sec < 90) return `${Math.round(sec)} seconds`;
  if (sec < 5400) return `${Math.round(sec / 60)} minutes`;
  return `${Math.round(sec / 3600)} hours`;
}

const TOC: [string, string][] = [
  ["idea", "The idea"],
  ["spending", "When someone spends"],
  ["live", "Live budget"],
  ["who", "Who does what"],
  ["words", "Words"],
  ["agents", "AI agents"],
  ["safe", "Is it safe?"],
  ["faq", "Questions"],
];

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <motion.section
      id={id}
      className="hw-section"
      aria-labelledby={`${id}-h`}
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className="eyebrow">{eyebrow}</span>
      <h2 id={`${id}-h`} className="title hw-h2">{title}</h2>
      {children}
    </motion.section>
  );
}

// ------------------------------------------------------------------ the walkthrough

interface StepDef { title: string; body: ReactNode }

/** A small diagram for each step: two chains (lanes), the hub above them, and what moves. */
function StepViz({ step }: { step: number }) {
  const reduce = useReducedMotion();
  const t = (delay = 0, d = 0.7) => (reduce ? { duration: 0 } : { duration: d, delay, ease: [0.22, 1, 0.36, 1] as const });
  const lime = "var(--lime)";
  const ink = "var(--spent)";
  const lane = (x: number, label: string, blocks: number, spentAt: number[]) => (
    <g>
      <rect x={x} y={112} width={132} height={52} rx={12} fill="var(--card-2)" stroke="var(--line-strong)" />
      <text x={x + 8} y={106} fontSize={10} fill="var(--muted)" fontFamily="var(--font-mono)" letterSpacing="0.08em">{label}</text>
      {Array.from({ length: blocks }).map((_, i) => (
        <rect key={i} x={x + 8 + i * 30} y={122} width={24} height={32} rx={6} fill={spentAt.includes(i) ? ink : lime} stroke="rgba(14,20,17,.25)" />
      ))}
    </g>
  );
  return (
    <svg viewBox="0 0 360 196" width="100%" role="img" aria-label={`Diagram for step ${step + 1}`} style={{ display: "block" }}>
      {/* hub */}
      <motion.circle cx={180} cy={38} r={24} fill="var(--card)" stroke={step === 2 || step === 3 ? lime : "var(--line-strong)"} strokeWidth={step === 2 || step === 3 ? 4 : 1.5}
        animate={step === 2 ? { scale: [1, 1.12, 1] } : { scale: 1 }} transition={reduce ? { duration: 0 } : { duration: 0.9, repeat: step === 2 ? 2 : 0 }} style={{ transformOrigin: "180px 38px" }} />
      <text x={180} y={42} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--ink)" fontFamily="var(--font-display)">Hub</text>
      {/* lanes: chain A gets low; chain B has spare */}
      {lane(18, "CHAIN A", step === 0 || step === 1 ? 4 : step >= 3 ? 4 : 3, step === 0 || step === 1 ? [3] : step >= 3 ? [3] : [])}
      {lane(210, "CHAIN B", step === 3 ? 3 : step === 4 ? 3 : 4, [])}

      {step === 0 && (
        <>
          <text x={18} y={26} fontSize={11} fill="var(--ink)" fontWeight={700}>Spender pays</text>
          <motion.circle r={7} fill={lime} stroke="var(--ink-fixed)" initial={{ cx: 120, cy: 138 }} animate={{ cx: 120, cy: 186 }} transition={t(0.3, 0.9)} />
          <motion.text x={132} y={190} fontSize={10} fill="var(--muted)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={t(0.9)}>to the shop</motion.text>
        </>
      )}
      {step === 1 && (
        <>
          <motion.rect x={14} y={108} width={140} height={60} rx={14} fill="none" stroke={lime} strokeWidth={4} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.4, 1] }} transition={t(0, 1.2)} />
          <motion.g initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={t(0.4, 0.5)}>
            <rect x={36} y={66} width={96} height={22} rx={11} fill="var(--ink-fixed)" />
            <text x={84} y={81} textAnchor="middle" fontSize={10} fill="#B8F23A" fontFamily="var(--font-mono)">Spent logged</text>
          </motion.g>
        </>
      )}
      {step === 2 && (
        <>
          <line x1={84} y1={108} x2={160} y2={58} stroke="var(--line-strong)" strokeDasharray="4 5" />
          <motion.circle r={6} fill={lime} stroke="var(--ink-fixed)" initial={{ cx: 84, cy: 108 }} animate={{ cx: 160, cy: 58 }} transition={t(0.2, 1)} />
          <motion.text x={196} y={84} fontSize={10} fill="var(--muted)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={t(0.9)}>sees the log</motion.text>
        </>
      )}
      {step === 3 && (
        <>
          <text x={226} y={26} fontSize={10} fill="var(--muted)">1 release</text>
          <text x={22} y={26} fontSize={10} fill="var(--muted)">2 grant</text>
          {/* a block leaves chain B first, then lands on chain A */}
          <motion.rect width={24} height={32} rx={6} fill={lime} stroke="var(--ink-fixed)"
            initial={{ x: 300, y: 122, opacity: 1 }}
            animate={{ x: [300, 300, 168, 168, 100], y: [122, 66, 66, 66, 122], opacity: 1 }}
            transition={reduce ? { duration: 0 } : { duration: 3.2, times: [0, 0.2, 0.55, 0.7, 1], ease: "easeInOut" }} />
          <line x1={196} y1={50} x2={270} y2={108} stroke="var(--line-strong)" strokeDasharray="4 5" />
          <line x1={164} y1={50} x2={90} y2={108} stroke="var(--line-strong)" strokeDasharray="4 5" />
        </>
      )}
      {step === 4 && (
        <>
          {[["Ledger", 106], ["Proof", 206]].map(([n, x], i) => (
            <motion.g key={n as string} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={t(0.15 + i * 0.3, 0.5)}>
              <rect x={x as number} y={72} width={88} height={34} rx={10} fill="var(--card)" stroke={lime} strokeWidth={3} />
              <text x={(x as number) + 44} y={93} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--ink)" fontFamily="var(--font-display)">{n}</text>
              <motion.text x={(x as number) + 76} y={87} fontSize={14} fill="var(--teal-ink)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={t(0.7 + i * 0.3)}>✓</motion.text>
            </motion.g>
          ))}
        </>
      )}
    </svg>
  );
}

function Walkthrough({ steps }: { steps: StepDef[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  // An explicit choice (focus, click) wins for a moment, so the scroll the browser performs to reveal it
  // cannot immediately overwrite it.
  const lockUntil = useRef(0);
  const choose = (i: number) => { lockUntil.current = Date.now() + 1200; setActive(i); };
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 62%", "end 58%"] });
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    if (Date.now() < lockUntil.current) return;
    setActive(Math.min(steps.length - 1, Math.max(0, Math.floor(v * steps.length))));
  });
  const go = (i: number) => {
    choose(i);
    document.getElementById(`step-${i}`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  };
  return (
    <div className="walk" ref={ref}>
      <div className="walk-viz card" aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.div key={active} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <StepViz step={active} />
          </motion.div>
        </AnimatePresence>
        <div className="row between wrap" style={{ marginTop: 6 }}>
          <span className="mono helper">STEP {active + 1} OF {steps.length}</span>
          <div className="row" style={{ gap: 6 }} role="group" aria-label="Choose a step">
            {steps.map((_, i) => (
              <button key={i} className="walk-dot" aria-label={`Go to step ${i + 1}`} aria-current={i === active ? "step" : undefined} onClick={() => go(i)} />
            ))}
          </div>
        </div>
      </div>
      <ol className="walk-steps">
        {steps.map((s, i) => (
          <li key={i} id={`step-${i}`} className={i === active ? "on" : ""} tabIndex={0} onFocus={() => choose(i)} aria-current={i === active ? "step" : undefined}>
            <span className="walk-n">{i + 1}</span>
            <div>
              <h3 className="h2" style={{ fontSize: 22 }}>{s.title}</h3>
              <div className="walk-body">{s.body}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ------------------------------------------------------------------ the page

const WORDS: [string, string][] = [
  ["Budget", "The most that can be spent in total, across every chain, in one period."],
  ["Period", "How long a budget lasts, such as a day or a week. When it ends, spending resets to the full budget. Unspent money does not carry over."],
  ["Slice", "The part of the budget that can be spent on one chain right now. Slices move between chains as spending happens."],
  ["Spender", "A person or an AI agent that is allowed to spend."],
  ["Cap", "An extra limit on one spender, per chain, per period. Leave it empty to limit them only by the slice."],
  ["Vault", "A program on a chain that holds the money and the slice, and checks every spend against the rules."],
  ["Hub", "The Reactive contract that watches the vaults and moves slices between chains. It never holds the budget's tokens, only its own fuel."],
  ["Fuel", "The small network fees (called gas) that keep the automation running."],
  ["Ledger", "The list of everything that happened, with a link to each transaction."],
  ["Proof", "A check, done in your browser from the chains' own records, that the budget was never exceeded."],
  ["Chain", "A blockchain: a shared public record that nobody can quietly edit. Ration uses Base Sepolia, Unichain Sepolia and Reactive Lasna."],
  ["Testnet", "A practice version of a chain. The money on it is play money. That is why the token here, mUSDC, has no value."],
];

const TOOLS: [string, string][] = [
  ["get_budget", "The total budget, how much is spent, how much is left, and when the period ends."],
  ["get_slices", "How much can be spent on each chain right now, and whether a chain is paused or expired."],
  ["get_remaining", "How much this agent can still spend, including its own cap on each chain."],
  ["request_spend", "Spend from a chain's vault. If the vault says no, the reason comes back in plain words."],
  ["get_ledger", "Recent activity: spends, allowance moves and period resets."],
];

function Faq({ q, children }: { q: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="faq" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        {q}
        {open ? <Minus size={20} /> : <Plus size={20} />}
      </summary>
      <div className="faq-a">{children}</div>
    </details>
  );
}

export function HowItWorks() {
  const { data, isLoading } = useSnapshot();
  const m = useBudgetMath();
  const { events, transfers, isLoading: evLoading } = useEvents();
  const hub = data?.hub;

  const lowPct = hub?.lanes[0] ? hub.lanes[0].lowBps / 100 : undefined;
  const refillPct = hub ? hub.refillBps / 100 : undefined;
  const lat = useMemo(() => transfers.filter((t) => t.latency !== undefined).map((t) => t.latency as number).sort((a, b) => a - b), [transfers]);
  const median = lat.length ? lat[Math.floor(lat.length / 2)] : undefined;
  const lastSpend = [...events].reverse().find((e) => e.kind === "spent");
  const lastDone = transfers.find((t) => t.state === "done" && t.tx.done);
  const wake = hub ? approx(Number(hub.cronInterval)) : undefined; // about one Lasna block per second
  const periodLen = hub ? duration(Number(hub.epochLength)) : undefined;
  const delay = hub ? Number(hub.startDelay) : undefined;
  const live = (v: ReactNode, fallback = "…") => (data ? v : <span className="muted">{fallback}</span>);

  useEffect(() => { document.title = "How it works · Ration"; return () => { document.title = "Ration: one budget, every chain"; }; }, []);

  const steps: StepDef[] = [
    {
      title: "Someone spends",
      body: <p>A spender (a person or an AI agent) pays someone from the slice on one chain. If the amount is more than that chain's slice, the chain says no and nothing moves.</p>,
    },
    {
      title: "The vault records it",
      body: <p>The vault is the program that holds the money on that chain. It takes the amount out of the slice, sends the payment, and writes a public record of it. Anyone can read that record.</p>,
    },
    {
      title: "A Reactive contract notices",
      body: (
        <p>
          The hub is a Reactive contract: a program that lives on the Reactive Network, a blockchain built for watching other chains and reacting to what it sees. No server and no person is involved. It sees the new record and checks whether that chain's slice has fallen below{" "}
          <b>{live(lowPct !== undefined ? `${lowPct}%` : "…")}</b> of the budget.
        </p>
      ),
    },
    {
      title: "Unused room moves to where it is needed",
      body: (
        <>
          <p>
            If the slice is low, the hub first asks the chain with the most spare room to <b>release</b> some of its slice, up to <b>{live(refillPct !== undefined ? `${refillPct}%` : "…")}</b> of the budget, and never so much that it drops below its own <b>{live(lowPct !== undefined ? `${lowPct}%` : "…")}</b> minimum. Only after that chain confirms does the hub tell the low chain to <b>take</b> exactly that much.
          </p>
          <p>Allowance is removed from one chain before it is added to the other, so it is never counted twice. No money crosses between chains. Only the right to spend moves.</p>
        </>
      ),
    },
    {
      title: "Everything is recorded",
      body: (
        <>
          <p>
            The <Link to="/ledger">Ledger</Link> lists every step with its transaction, and <Link to="/proof">Proof</Link> re-checks the totals.{" "}
            {evLoading ? "Reading the latest activity from the chains…" : median !== undefined ? <>On this deployment, new allowance arrives about <b>{median} seconds</b> after the spend (the median of {lat.length} real transfers).</> : "Once a transfer has happened, its speed shows up here."}
          </p>
          <p className="row wrap" style={{ gap: 12 }}>
            {evLoading ? <Skeleton w={220} h={38} r={19} /> : lastSpend ? (
              <a className="btn small auto" href={txUrl(lastSpend.chain, lastSpend.tx)} target="_blank" rel="noreferrer">
                Latest spend on {laneByKey(lastSpend.chain)?.short} <ArrowUpRight size={15} />
              </a>
            ) : <span className="helper">No spends yet. The first one will appear here.</span>}
            {lastDone?.tx.done && (
              <a className="btn small auto" href={txUrl("lasna", lastDone.tx.done)} target="_blank" rel="noreferrer">
                Latest hub confirmation <ArrowUpRight size={15} />
              </a>
            )}
          </p>
        </>
      ),
    },
  ];

  return (
    <div className="hw">
      <PageHead
        eyebrow="How it works"
        title="One budget. Spend anywhere. Never over."
        lede="Ration lets you set one spending limit that works across several blockchains, and it keeps that limit from ever being exceeded. Here is the whole idea in about a minute."
      />

      <Stagger>
        <Rise>
          <div className="hw-strip" role="list">
            {[
              ["1", "Set one budget", "Pick an amount and a period.", "/budget"],
              ["2", "Allow who can spend", "Add people or AI agents, with caps.", "/spenders"],
              ["3", "Spend anywhere, never over", "The limit follows the spending.", "/live"],
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
        </Rise>
        <Rise>
          <nav className="toc" aria-label="On this page">
            {TOC.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="chip" onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); history.replaceState(null, "", `#${id}`); }}>{label}</a>
            ))}
          </nav>
        </Rise>
      </Stagger>

      {/* 2 ------------------------------------------------------------ the idea */}
      <Section id="idea" eyebrow="The idea" title="One budget, split into slices.">
        <div className="hw-prose">
          <p>
            Say you allow <b>{m ? `${fmtAmt(m.budget, 0)} ${SYMBOL}` : "a budget"}</b> to be spent {periodLen ? <>in one period of {periodLen}</> : "in one period"}. A <b>blockchain</b> (a "chain") is a shared public record that nobody can quietly edit. Ration holds money on {LANES.length} of them and runs its automation on a third, the Reactive Network. It splits the budget into <b>slices</b>, one per chain that holds money.
          </p>
          <p>A slice is how much can be spent on that chain <i>right now</i>. When one chain runs low, the slice moves to it from a chain that has room to spare.</p>
          <p><b>The one rule that never changes:</b> all the slices, plus what is already spent, plus anything moving between chains, can never be more than the budget.</p>
        </div>
        <div className="card hw-eq" aria-label="The rule, with live numbers">
          {isLoading || !m ? <Skeleton h={64} r={16} /> : (
            <div className="hw-eq-row">
              <Eq k="Slices" v={num(m.slices)} tone="lime" />
              <span className="hw-op">+</span>
              <Eq k="Spent" v={num(m.spent)} tone="spent" />
              <span className="hw-op">+</span>
              <Eq k="Moving" v={num(m.flight)} tone="flight" />
              <span className="hw-op">{m.verified ? "≤" : ">"}</span>
              <Eq k="Budget" v={num(m.budget)} tone="ink" />
            </div>
          )}
          <p className="helper" style={{ marginTop: 10 }}>These are the real numbers right now, in {SYMBOL}. {SYMBOL} is a play-money test token.</p>
        </div>
      </Section>

      {/* 3 ------------------------------------------------------------ the walkthrough */}
      <Section id="spending" eyebrow="What happens when someone spends" title="Five steps, no one in the middle.">
        <Walkthrough steps={steps} />
      </Section>

      {/* 4 ------------------------------------------------------------ live panel */}
      <Section id="live" eyebrow="Your live budget right now" title="The real numbers.">
        <div className="card stack">
          {isLoading || !m || !data ? (
            <><Skeleton h={48} r={12} /><Skeleton h={90} r={16} /></>
          ) : (
            <>
              <div className="row between wrap" style={{ alignItems: "flex-end" }}>
                <div className="stat">
                  <span className="k">Left to spend, all chains</span>
                  <span className="v"><Ticker value={num(m.slices)} format={(n) => Math.round(n).toLocaleString("en-US")} /> <span className="muted" style={{ fontSize: 16 }}>of {fmtAmt(m.budget, 0)} {SYMBOL}</span></span>
                </div>
                <div className="stat">
                  <span className="k">Period ends in</span>
                  <span className="v sm">{duration(Math.max(0, m.epochEnd - m.chainTime))}</span>
                </div>
              </div>
              <div className="grid two">
                {data.lanes.map((l) => {
                  const pct = m.budget > 0n ? Number((l.slice * 100n) / m.budget) : 0;
                  return (
                    <div key={l.cfg.key} className="option" style={{ cursor: "default" }} aria-pressed="false">
                      <span className="lane-name" style={{ fontSize: 17 }}>{l.cfg.name}</span>
                      <span className="num" style={{ fontWeight: 700, fontSize: 26 }}>{fmtAmt(l.slice)} <span className="muted" style={{ fontSize: 13 }}>{SYMBOL} slice</span></span>
                      <div className="bar" aria-hidden><i className="b-slice" style={{ width: `${Math.max(2, pct)}%` }} /></div>
                      <span className="helper">{fmtAmt(l.spent)} already spent here this period</span>
                    </div>
                  );
                })}
              </div>
              <div className="row between wrap">
                <span className="helper">Same data as Live budget. It refreshes every few seconds.</span>
                <Link to="/live" className="btn auto small">Open Live budget <ArrowRight size={16} /></Link>
              </div>
            </>
          )}
        </div>
      </Section>

      {/* 5 ------------------------------------------------------------ roles */}
      <Section id="who" eyebrow="Who does what" title="Five parts, each with one job.">
        <div className="grid three hw-roles">
          {[
            { icon: KeyRound, name: "Owner", to: "/budget", cta: "Set budget", body: "Sets the budget and the period, approves spenders, and can revoke them. Only the owner can add money to a vault or take it out. One wallet (a single private key) controls this, so it has to be kept safe." },
            { icon: UserRound, name: "Spender", to: "/spenders", cta: "Spenders", body: "A person or an AI agent. A spender can only make payments, up to its slice and its own cap. It can't change any setting or touch the vault's other money. By default a payment can go to any address, so the owner can switch on an allowed-recipients list on the Vaults page." },
            { icon: Landmark, name: "Vault", to: "/vaults", cta: "Vaults", body: "A program on each chain that holds the money and the slice. It checks every spend against the rules and says why when it refuses." },
            { icon: Cpu, name: "Hub", href: addrUrl("lasna", HUB), cta: "See the hub", body: "The Reactive contract that moves slices between chains. It never holds the budget's tokens (only its own fuel), and it only moves allowance that a chain has already given up." },
            { icon: FuelIcon, name: "Fuel", to: "/fuel", cta: "Fuel", body: "The network fees that keep the automation running: lREACT (the Reactive Network's test coin) for the hub, and a little test ETH for each chain's vault. If one runs dry, it pauses until someone tops it up." },
          ].map((r) => (
            <motion.div key={r.name} className="card hw-role" whileHover={{ y: -3 }} transition={{ duration: 0.15 }}>
              <span className="token-dot" style={{ width: 40, height: 40, background: "var(--lime)", color: "#0E1411" }}><r.icon size={20} aria-hidden /></span>
              <h3 className="h2">{r.name}</h3>
              <p className="muted">{r.body}</p>
              {r.to ? <Link to={r.to} className="hw-link">{r.cta} <ArrowRight size={14} /></Link> : <a href={r.href} target="_blank" rel="noreferrer" className="hw-link">{r.cta} <ArrowUpRight size={14} /></a>}
            </motion.div>
          ))}
        </div>
      </Section>

      {/* 6 ------------------------------------------------------------ glossary */}
      <Section id="words" eyebrow="Words you'll see" title="A short glossary.">
        <dl className="gloss">
          {WORDS.map(([k, v]) => (
            <div key={k} className="gloss-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* 7 ------------------------------------------------------------ agents */}
      <Section id="agents" eyebrow="For AI agents" title="Let an AI spend inside the rules.">
        <div className="hw-prose">
          <p>
            <b>MCP</b> (Model Context Protocol) is a standard way to plug tools into AI assistants. Ration ships an MCP server, so an agent can read the budget and ask to spend. The vault decides, and it explains any refusal in one plain sentence.
          </p>
        </div>
        <div className="card stack">
          <ul className="hw-tools">
            {TOOLS.map(([n, d]) => (
              <li key={n}><span className="badge mono"><Bot size={12} aria-hidden />{n}</span><span>{d}</span></li>
            ))}
          </ul>
          <div className="codeblock">{`pnpm install\npnpm --filter @ration/mcp build\n# then point your MCP client at the built server, with the agent's own key in AGENT_PRIVATE_KEY:\nnode /absolute/path/to/ration/packages/mcp/dist/mcp/src/index.js`}<CopyBtn text={"pnpm install\npnpm --filter @ration/mcp build"} label="Copy the install commands" /></div>
          <div className="row between wrap">
            <span className="helper">The agent needs its own testnet key, and its address must be added as a spender. An agent can only make payments, up to its slice and its own cap. It can't change any setting or touch the vault's other money. By default a payment can go to any address, so the owner can switch on an allowed-recipients list on the Vaults page.</span>
            <Link to="/agents" className="btn auto small">Set up an agent <ArrowRight size={16} /></Link>
          </div>
        </div>
      </Section>

      {/* 8 ------------------------------------------------------------ safety */}
      <Section id="safe" eyebrow="Is it safe?" title="Honest answers.">
        <ul className="hw-safe">
          <li><b>A spender can only make payments, up to its slice and its own cap.</b> It can't change any setting or touch the vault's other money. By default a payment can go to any address, so the owner can switch on an allowed-recipients list on the Vaults page. Only the owner can add or remove money, set the budget, pause a vault, or change who may spend.</li>
          <li><b>If a message between chains is lost, budget goes unused. It is never overspent.</b> Allowance is removed from one chain before it is added to another. A lost message can leave some allowance idle until the period ends, but it can't create any.</li>
          <li><b>Revoking works within seconds.</b> It takes effect from the next block, which is how a chain groups transactions, a few seconds at most. After that, any spend from that address is refused.</li>
          <li><b>This is a testnet.</b> The token is a play-money mock, and the code has had a careful self-review but <b>no independent audit yet</b>. Do not use it with real money.</li>
          <li><b>The owner is a single key.</b> If it is lost, the money in the vaults cannot be taken out and settings cannot change. Use a shared wallet (a multisig) before real use.</li>
        </ul>
        <div className="row wrap" style={{ gap: 12, marginTop: 18 }}>
          <Link to="/proof" className="btn auto small">See the proof <ArrowRight size={16} /></Link>
          <a href={`${REPO}/blob/main/docs/AUDIT.md`} target="_blank" rel="noreferrer" className="btn auto small">Read the audit notes <ArrowUpRight size={16} /></a>
        </div>
      </Section>

      {/* 9 ------------------------------------------------------------ FAQ */}
      <Section id="faq" eyebrow="Questions" title="Short answers.">
        <div>
          <Faq q="What if one chain is down?">
            <p>Nothing can be spent on that chain until it is back, but the other chains keep working with their own slices. If a message to it is lost, the hub asks again a few times (up to 5). Anything still in flight after that stays unused until the period ends. The budget is never overspent, but some of it can go unused.</p>
          </Faq>
          <Faq q="What happens at the end of a period?">
            <p>
              Every slice expires, so spending on each chain stops. The hub then starts the next period: spending counters go back to zero and each chain gets a fresh slice of the full budget. Unspent allowance does not carry over, but the tokens themselves stay in the vaults; only the right to spend them resets.{" "}
              {live(<>New slices open <b>{delay} seconds</b> after the hub decides, as a safety margin between chains. The hub wakes up about every <b>{wake}</b> on this deployment, so the next period can start up to that long after the old one ends. Anyone can also trigger it sooner by calling the hub contract directly. A period here lasts <b>{periodLen}</b>.</>, "")}
            </p>
          </Faq>
          <Faq q="Can I set a cap per spender?">
            <p>Yes. On the Spenders page, each spender can have a cap per chain, per period. It resets when the period does. Leave it empty and that spender is limited only by the slice.</p>
          </Faq>
          <Faq q="Who pays for the automation?">
            <p>
              Whoever funds the fuel. The hub is paid in lREACT, the Reactive Network's test coin, and each chain's vault pays a little of that chain's own test coin for the messages it receives. Anyone can top them up from the Fuel page.{" "}
              {live(<>Right now the hub holds <b>{fmtNative(hub?.reserve)} lREACT</b>.</>, "")}
            </p>
          </Faq>
          <Faq q="Can I use this with my own token?">
            <p>
              Partly. The vault can allow any token that uses the same number of decimals (digits after the point) as the budget token, {DECIMALS} here. The owner allows it by calling the vault directly, which is not yet a button in the app. It is then counted one-for-one as the budget unit, so it only makes sense for tokens worth the same, such as stablecoins (tokens pinned to a currency like the dollar). Tokens that take a fee on every transfer, or that change balances on their own, are a poor fit: they can never cause overspending, but the person paid receives less than the amount, and the vault's balance can drift from its slice. The app itself currently manages only the {SYMBOL} test token, and each chain's money stays on that chain.
            </p>
          </Faq>
        </div>
      </Section>

      {/* 10 ----------------------------------------------------------- closing */}
      <Rise>
        <div className="hw-close row wrap" style={{ gap: 14 }}>
          <Link to="/live" className="btn primary auto" style={{ width: "auto", padding: "0 30px" }}>Open the live budget <ArrowRight size={20} /></Link>
          <Link to="/proof" className="btn auto">See the proof</Link>
        </div>
      </Rise>
    </div>
  );
}

function Eq({ k, v, tone }: { k: string; v: number; tone: "lime" | "spent" | "flight" | "ink" }) {
  return (
    <div className={`hw-eq-cell ${tone}`}>
      <span className="k">{k}</span>
      <span className="num hw-eq-v"><Ticker value={v} format={(n) => Math.round(n).toLocaleString("en-US")} /></span>
    </div>
  );
}
