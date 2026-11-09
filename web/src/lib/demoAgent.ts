import { createWalletClient, fallback, http, parseEventLogs, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkSpend } from "@core";
import { vaultAbi } from "./abi";
import { chainFor, clientFor } from "./chains";
import { DECIMALS, SYMBOL, laneByKey } from "./config";
import { fmtAmt } from "./format";
import { explain } from "./errors";

/*
 * ----------------------------------------------------------------------------------------------
 * THE SHARED DEMO KEY. THIS IS A DELIBERATE, PUBLIC DEMO KEY. IT IS NOT A SECRET.
 *
 * It exists so that a first-time visitor can make one real spend without a wallet. It is published
 * on purpose, so anyone can read it from this file or from the website's code. That is safe because
 * the key has no power except what the vaults give it:
 *   - it is an approved spender, and nothing else. It is not an owner and cannot change any setting;
 *   - the vaults cap it at 100 mUSDC per period per chain, and enforce that on-chain;
 *   - the token is a play-money test token with no value;
 *   - it holds only a few hundredths of a cent of test ETH, for gas.
 * Anyone who uses the key directly, skipping this page, is still bound by the same on-chain cap.
 *
 * It is the ONLY key in this web app. The owner key and the agent key are never in the app.
 * ----------------------------------------------------------------------------------------------
 */
export const DEMO_PRIVATE_KEY: Hex = "0xf0599c068e35c392f0aa86131ede871d16f3d43fca3e0fbc334ed8e1b5b17784"; // gitleaks:allow  (deliberate public demo key, see the note above)
export const DEMO_ADDRESS: Address = "0x77849260B9644ECDb98e0b746692bb09Dd749c26";

/** One-click amounts. Fixed on purpose: the page never sends anything else. */
export const DEMO_AMOUNTS = [5, 10] as const;
export type DemoAmount = (typeof DEMO_AMOUNTS)[number];
/** Where demo spends are sent: a dead address, so the test tokens are simply gone. */
export const DEMO_RECIPIENT: Address = "0x000000000000000000000000000000000000dEaD";
export const DEMO_COOLDOWN_MS = 8_000;
const COOLDOWN_KEY = "ration-demo-last";

/** Conservative per-spend gas cost (measured: about 4.8e-7 ETH on Base, 1.2e-7 on Unichain; doubled and more). */
export const GAS_PER_SPEND_ETH: Record<string, number> = { base: 1.0e-6, unichain: 3.0e-7 };
/** Below this many spends' worth of gas, the button is disabled. */
export const MIN_SPENDS_OF_GAS = 3;

export const account = privateKeyToAccount(DEMO_PRIVATE_KEY);
if (account.address.toLowerCase() !== DEMO_ADDRESS.toLowerCase()) {
  // The constants disagree: refuse to run rather than sign as an unexpected account.
  throw new Error("Demo key does not match the demo address");
}

export type DemoResult =
  | { ok: true; hash: Hex; newSlice: bigint; amount: number }
  | { ok: false; kind: "cooldown" | "cap" | "slice" | "paused" | "period" | "gas" | "clash" | "network" | "rejected" | "pending" | "unverified" | "invalid" | "unknown"; message: string; hash?: Hex };

// ------------------------------------------------------------------ cooldown (per browser, shared by tabs)

export function cooldownLeftMs(): number {
  try {
    const last = Number(localStorage.getItem(COOLDOWN_KEY) ?? 0);
    return Math.max(0, last + DEMO_COOLDOWN_MS - Date.now());
  } catch {
    return 0;
  }
}
const stampCooldown = () => { try { localStorage.setItem(COOLDOWN_KEY, String(Date.now())); } catch { /* private mode: the in-tab lock still applies */ } };

// ------------------------------------------------------------------ one spend at a time, across tabs

let tabBusy = false;
async function exclusive<T>(fn: () => Promise<T>): Promise<T | "busy"> {
  if (tabBusy) return "busy";
  tabBusy = true;
  try {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (locks?.request) return await locks.request("ration-demo-spend", fn);
    return await fn();
  } finally {
    tabBusy = false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isNonceClash = (e: unknown) => /nonce (is )?too low|nonce has already been used|replacement transaction underpriced|already known|transaction underpriced|nonce too high/i.test(String((e as { message?: string })?.message ?? e) + String((e as { details?: string })?.details ?? ""));
const isNetwork = (e: unknown) => /fetch|network|timeout|timed out|http request failed|econn|enotfound|rate limit|429|503|502/i.test(String((e as { message?: string })?.message ?? e));
const isNoGas = (e: unknown) => /insufficient funds|exceeds the balance|gas required exceeds allowance/i.test(String((e as { message?: string })?.message ?? e));

/** Never show a raw error: known contract refusals become plain sentences, everything else a calm generic one. */
function friendly(e: unknown, laneName: string): DemoResult {
  if (isNoGas(e)) return { ok: false, kind: "gas", message: `The demo agent is out of gas on ${laneName}, so it can't send right now.` };
  if (isNetwork(e)) return { ok: false, kind: "network", message: "Couldn't reach the network. Nothing was sent. Try again in a moment." };
  const text = explain(e, { lane: laneName });
  // explain() falls back to the library's own message for unknown errors; only trust its decoded sentences.
  const decoded = /slice|cap|spender|paused|period|allowlist|recipient|amount|decimals|owner|expired|started/i.test(text) && !/^(The |A |An )?(request|transaction|execution|http|rpc|fetch)/i.test(text);
  return { ok: false, kind: "rejected", message: decoded ? text : "The spend was refused and nothing was spent. Try again in a moment." };
}

/**
 * Sends one real spend from the shared demo agent. The page only ever asks for a fixed amount to a fixed
 * recipient, and this function re-checks everything against the chain right before sending, so a stale
 * screen can't cause a bad spend. It reports success only after the network confirms the transaction AND the
 * vault's own `Spent` event for this agent and amount is found in the receipt.
 */
export async function demoSpend(laneKey: string, amount: number): Promise<DemoResult> {
  const lane = laneByKey(laneKey);
  if (!lane || !(DEMO_AMOUNTS as readonly number[]).includes(amount)) {
    return { ok: false, kind: "invalid", message: "That option isn't available for the demo agent." };
  }
  const run = await exclusive(async (): Promise<DemoResult> => {
    const wait = cooldownLeftMs();
    if (wait > 0) return { ok: false, kind: "cooldown", message: `Please wait ${Math.ceil(wait / 1000)} seconds between demo spends.` };

    const pub = clientFor(laneKey);
    const units = parseUnits(String(amount), DECIMALS);
    let verdict;
    try {
      verdict = await checkSpend({ client: pub, laneName: lane.name, vault: lane.vault, token: lane.token, spender: DEMO_ADDRESS, to: DEMO_RECIPIENT, amount: units, symbol: SYMBOL, decimals: DECIMALS });
    } catch (e) {
      return friendly(e, lane.name);
    }
    if (!verdict.ok) {
      const kind = verdict.code === "exceeds_cap" ? "cap" : verdict.code === "exceeds_slice" ? "slice" : verdict.code === "paused" ? "paused" : verdict.code === "epoch_expired" || verdict.code === "epoch_not_started" ? "period" : "rejected";
      const message = kind === "cap"
        ? "Demo cap reached for this period. It resets with the next period, or connect an approved wallet."
        : kind === "slice" ? `${lane.name} has only ${fmtAmt(verdict.slice)} ${SYMBOL} left in its slice, so it can't take that.`
        : verdict.reason;
      return { ok: false, kind, message };
    }
    let bal: bigint;
    try { bal = await pub.getBalance({ address: DEMO_ADDRESS }); } catch (e) { return friendly(e, lane.name); }
    const floor = BigInt(Math.round(GAS_PER_SPEND_ETH[laneKey] * MIN_SPENDS_OF_GAS * 1e18));
    if (bal < floor) return { ok: false, kind: "gas", message: `The demo agent is low on gas on ${lane.name}, so spending is paused there until the owner tops it up.` };

    const wallet = createWalletClient({ account, chain: chainFor(laneKey), transport: fallback(lane.rpc.map((u) => http(u, { timeout: 15_000 }))) });
    let hash: Hex | undefined;
    stampCooldown();
    for (let attempt = 1; attempt <= 3 && !hash; attempt++) {
      try {
        const { request } = await pub.simulateContract({ account, address: lane.vault, abi: vaultAbi, functionName: "spend", args: [lane.token, DEMO_RECIPIENT, units] });
        hash = await wallet.writeContract(request);
      } catch (e) {
        if (isNonceClash(e) && attempt < 3) { await sleep(500 + Math.random() * 900); continue; }
        if (isNonceClash(e)) return { ok: false, kind: "clash", message: "Someone else used the shared demo agent at the same moment. Nothing was spent. Try again in a few seconds." };
        return friendly(e, lane.name);
      }
    }
    if (!hash) return { ok: false, kind: "unknown", message: "The spend could not be sent. Nothing was spent. Try again." };

    let rc;
    try {
      rc = await pub.waitForTransactionReceipt({ hash, timeout: 75_000 });
    } catch {
      return { ok: false, kind: "pending", hash, message: "Sent, but the network hasn't confirmed it yet. Check the transaction link before trying again." };
    }
    if (rc.status !== "success") return { ok: false, kind: "rejected", hash, message: "The network rejected that spend, so nothing was spent." };
    const log = parseEventLogs({ abi: vaultAbi, eventName: "Spent", logs: rc.logs }).find(
      (l) => l.address.toLowerCase() === lane.vault.toLowerCase() && l.args.spender.toLowerCase() === DEMO_ADDRESS.toLowerCase() && l.args.amount === units,
    );
    if (!log) return { ok: false, kind: "unverified", hash, message: "The transaction was mined, but I couldn't confirm the spend from it. Check the transaction link." };
    return { ok: true, hash, newSlice: log.args.newSlice, amount };
  });
  return run === "busy" ? { ok: false, kind: "cooldown", message: "A demo spend is already being sent. Wait for it to finish." } : run;
}
