import { formatUnits, parseUnits } from "viem";
import { DECIMALS } from "./config";

/** Token amount, trimmed: 1,250 or 1,250.5 or 0.25. */
export function fmtAmt(v: bigint | undefined, maxFrac = 2): string {
  if (v === undefined) return "–";
  const n = Number(formatUnits(v, DECIMALS));
  return n.toLocaleString("en-US", { maximumFractionDigits: maxFrac, minimumFractionDigits: 0 });
}

export function toUnits(s: string): bigint | undefined {
  const t = s.replace(/,/g, "").trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return undefined;
  try {
    return parseUnits(t, DECIMALS);
  } catch {
    return undefined;
  }
}

export const num = (v: bigint) => Number(formatUnits(v, DECIMALS));

export function fmtNative(v: bigint | undefined, digits = 4): string {
  if (v === undefined) return "–";
  const n = Number(formatUnits(v, 18));
  if (n === 0) return "0";
  if (n < 0.0001) return "<0.0001";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export const short = (a: string, h = 6, t = 4) => (a.length > h + t + 2 ? `${a.slice(0, h)}…${a.slice(-t)}` : a);

export function ago(ts: number, now = Date.now() / 1000): string {
  const d = Math.max(0, Math.round(now - ts));
  if (d < 5) return "just now";
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export function duration(sec: number): string {
  if (sec < 90) return `${Math.round(sec)} seconds`;
  if (sec < 5400) return `${Math.round(sec / 60)} minutes`;
  if (sec < 172800) return `${Math.round(sec / 3600)} hours`;
  return `${Math.round(sec / 86400)} days`;
}

export function periodLabel(sec: number): string {
  if (sec === 86400) return "day";
  if (sec === 604800) return "week";
  if (sec === 2592000) return "month";
  if (sec === 3600) return "hour";
  return duration(sec);
}

export const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
