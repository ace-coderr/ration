import { animate, motion, useReducedMotion } from "framer-motion";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { addrUrl, type LaneCfg } from "@/lib/config";
import { short } from "@/lib/format";
import { HelpHint, type HelpKey } from "./HelpHint";

export function PageHead({ eyebrow, title, lede, help }: { eyebrow: string; title: string; lede: string; help?: HelpKey }) {
  return (
    <header className="page-head">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <span className="eyebrow">{eyebrow}</span>
      </motion.div>
      <div className="title-row">
        <motion.h1
          className="title"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.04 }}
        >
          {title}
        </motion.h1>
        {help && <HelpHint id={help} />}
      </div>
      <motion.p className="lede" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18, duration: 0.5 }}>
        {lede}
      </motion.p>
    </header>
  );
}

/** Staggered entrance for a group of cards. */
export function Stagger({ children, className = "stack" }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } }}
    >
      {children}
    </motion.div>
  );
}
export const Rise = ({ children, className = "", ...rest }: { children: ReactNode; className?: string } & Record<string, unknown>) => (
  <motion.div
    className={className}
    variants={{ hidden: { opacity: 0, y: 22 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } } }}
    {...rest}
  >
    {children}
  </motion.div>
);

export function Footnote({ children }: { children: ReactNode }) {
  return <p className="footnote">{children}</p>;
}

export function Skeleton({ w = "100%", h = 20, r }: { w?: number | string; h?: number; r?: number }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r }} aria-hidden />;
}

/** Counts up/down to a new value. */
export function Ticker({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduce) { setShown(value); from.current = value; return; }
    const c = animate(from.current, value, {
      duration: 0.9, ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => { from.current = v; setShown(v); },
    });
    return () => c.stop();
  }, [value, reduce]);
  return <span className={className}>{format(shown)}</span>;
}

export function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="copy"
      aria-label={label}
      title={label}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ }
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

export function Addr({ value, chain, full = false }: { value: string; chain?: string; full?: boolean }) {
  return (
    <span className="addr">
      {chain ? (
        <a href={addrUrl(chain, value)} target="_blank" rel="noreferrer">{full ? value : short(value)}</a>
      ) : (
        <span>{full ? value : short(value)}</span>
      )}
      <CopyBtn text={value} label="Copy address" />
    </span>
  );
}

export function ChainBadge({ lane, lasna }: { lane?: LaneCfg; lasna?: boolean }) {
  return (
    <span className="badge">
      <i style={{ background: lasna ? "var(--lime)" : lane?.key === "base" ? "#4C7DFF" : "#FF5FA8" }} />
      {lasna ? "Lasna" : lane?.short}
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const id = useRef(`seg-${Math.random().toString(36).slice(2)}`).current;
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} aria-pressed={o.v === value} onClick={() => onChange(o.v)} style={{ position: "relative" }}>
          {o.v === value && <motion.span layoutId={id} className="seg-thumb" style={{ inset: 0, borderRadius: 999, position: "absolute", background: "var(--lime)", zIndex: -1 }} transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StateCard({ tone = "empty", title, children, action }: { tone?: "empty" | "warn" | "bad"; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <motion.div className={`state ${tone === "empty" ? "" : tone}`} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
      <h3 className="h2">{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </motion.div>
  );
}

export function Stamp({ show, label = "Within budget", sub, tone = "ok" }: { show: boolean; label?: string; sub?: string; tone?: "ok" | "warn" | "bad" }) {
  const reduce = useReducedMotion();
  if (!show) return null;
  return (
    <motion.div
      className={`stamp ${tone === "ok" ? "" : tone}`}
      initial={reduce ? false : { scale: 2.4, opacity: 0, rotate: -18 }}
      animate={{ scale: 1, opacity: 1, rotate: -5 }}
      transition={{ type: "spring", stiffness: 520, damping: 22, mass: 0.9 }}
      role="status"
    >
      {label}
      {sub && <small>{sub}</small>}
    </motion.div>
  );
}
