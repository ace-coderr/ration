import { motion } from "framer-motion";
import { Ticker } from "./kit";
import { SYMBOL } from "@/lib/config";
import { fmtAmt, num } from "@/lib/format";

/** Shared gauge: remaining (lime), in flight (hatched), spent (ink), over one half-circle. */
export function Gauge({ slices, flight, spent, total, caption }: { slices: bigint; flight: bigint; spent: bigint; total: bigint; caption?: string }) {
  const t = Math.max(1, num(total));
  const s = Math.min(1, num(slices) / t);
  const f = Math.min(1 - s, num(flight) / t);
  const p = Math.min(1 - s - f, num(spent) / t);
  const arc = (len: number, off: number) => ({ strokeDasharray: `${Math.max(len, 0.0001)} 3`, strokeDashoffset: -off });
  const D = "M 22 150 A 118 118 0 0 1 258 150";
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 420 }}>
      <svg viewBox="0 0 280 168" width="100%" role="img" aria-label={`${fmtAmt(slices)} of ${fmtAmt(total)} ${SYMBOL} still spendable`}>
        <defs>
          <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" fill="var(--lime)" opacity="0.28" />
            <rect width="3.5" height="7" fill="var(--lime)" />
          </pattern>
        </defs>
        <path d={D} pathLength={1} fill="none" stroke="var(--card-2)" strokeWidth="26" strokeLinecap="butt" />
        <motion.path d={D} pathLength={1} fill="none" stroke="var(--lime)" strokeWidth="26" initial={arc(0, 0)} animate={arc(s, 0)} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} />
        <motion.path d={D} pathLength={1} fill="none" stroke="url(#hatch)" strokeWidth="26" initial={arc(0, s)} animate={arc(f, s)} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} />
        <motion.path d={D} pathLength={1} fill="none" stroke="var(--spent)" strokeWidth="26" initial={arc(0, s + f)} animate={arc(p, s + f)} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} />
        {[0, 0.25, 0.5, 0.75, 1].map((q) => {
          const a = Math.PI * (1 - q);
          return <line key={q} x1={140 + Math.cos(a) * 98} y1={150 - Math.sin(a) * 98} x2={140 + Math.cos(a) * 90} y2={150 - Math.sin(a) * 90} stroke="var(--muted)" strokeWidth="1.5" />;
        })}
      </svg>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 4, textAlign: "center" }}>
        <div className="stat"><div className="v" style={{ fontSize: 46, alignSelf: "center" }}><Ticker value={num(slices)} format={(n) => Math.round(n).toLocaleString("en-US")} /></div></div>
        <div className="helper" style={{ marginTop: 6 }}>{caption ?? `of ${fmtAmt(total, 0)} ${SYMBOL} left to spend`}</div>
      </div>
    </div>
  );
}
