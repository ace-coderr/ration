#!/usr/bin/env node
/**
 * Ration MCP server (stdio). Lets an AI agent read the shared budget and spend inside it.
 * The agent holds only a spender key: it can spend within its slice and cap, nothing else.
 *
 * Env: AGENT_PRIVATE_KEY (required for request_spend), RATION_LOG_PORT (default 7373).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  createPublicClient, createWalletClient, defineChain, fallback, formatUnits, http, parseAbi, parseUnits,
  type Address, type Hex, type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkSpend } from "../../core/src/index.js";

// ------------------------------------------------------------------ config
function findDeployment(): any {
  if (process.env.RATION_DEPLOYMENT) return JSON.parse(readFileSync(process.env.RATION_DEPLOYMENT, "utf8"));
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const p = join(dir, "deployments", "testnet.json");
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
    dir = dirname(dir);
  }
  throw new Error("deployments/testnet.json not found. Set RATION_DEPLOYMENT.");
}
const D = findDeployment();
const SYMBOL: string = D.tokenSymbol;
const DEC: number = D.tokenDecimals;
const fmt = (v: bigint) => Number(formatUnits(v, DEC)).toLocaleString("en-US", { maximumFractionDigits: 2 });

const mkChain = (id: number, name: string, rpc: string[]) =>
  defineChain({ id, name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: rpc } } });
const clientOf = (id: number, name: string, rpc: string[]): PublicClient =>
  createPublicClient({ chain: mkChain(id, name, rpc), transport: fallback(rpc.map((u) => http(u, { timeout: 15000, retryCount: 2 }))) }) as PublicClient;

interface Lane { key: string; name: string; chainId: number; vault: Address; token: Address; rpc: string[]; deployBlock: number; client: PublicClient }
const lanes: Lane[] = D.lanes.map((l: any) => ({ ...l, client: clientOf(l.chainId, l.name, l.rpc) }));
const hubClient = clientOf(D.hub.chainId, D.lasna.name, D.lasna.rpc);
const HUB: Address = D.hub.address;

const vaultAbi = parseAbi([
  "function slice() view returns (uint256)",
  "function spentInEpoch() view returns (uint256)",
  "function epochId() view returns (uint256)",
  "function epochEnd() view returns (uint256)",
  "function epochBudget() view returns (uint256)",
  "function paused() view returns (bool)",
  "function spenders(address) view returns (bool allowed, uint256 cap)",
  "function spentBy(uint256 epoch, address spender) view returns (uint256)",
  "function spend(address token, address to, uint256 amount)",
  "event Spent(address indexed spender, address indexed token, address indexed to, uint256 amount, uint256 newSlice, uint256 epochId, uint256 seq, uint256 timestamp)",
  "event Released(bytes32 indexed transferId, uint256 requested, uint256 actual, uint256 newSlice, uint256 epochId, uint256 seq, uint256 timestamp)",
  "event Granted(bytes32 indexed transferId, uint256 amount, uint256 newSlice, uint256 epochId, uint256 seq, uint256 timestamp)",
  "event EpochReset(uint256 indexed epochId, uint256 slice, uint256 epochEnd, uint256 budget, uint256 seq, uint256 timestamp)",
]);
const hubAbi = parseAbi([
  "function epochId() view returns (uint256)",
  "function epochEnd() view returns (uint256)",
  "function epochBudget() view returns (uint256)",
  "function epochLength() view returns (uint256)",
  "function refillBps() view returns (uint16)",
]);

const agentKey = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
const agent = agentKey ? privateKeyToAccount(agentKey) : undefined;

// ------------------------------------------------------------------ call log (for the web app)
interface Call { t: number; tool: string; input: unknown; ok: boolean; summary: string }
const calls: Call[] = [];
function record(tool: string, input: unknown, ok: boolean, summary: string) {
  calls.push({ t: Date.now(), tool, input, ok, summary });
  if (calls.length > 200) calls.shift();
  console.error(`[ration-mcp] ${tool} ${ok ? "ok" : "denied"}: ${summary}`);
}
const port = Number(process.env.RATION_LOG_PORT ?? 7373);
createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-private-network", "true");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.url?.startsWith("/calls")) { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ calls })); }
  res.statusCode = 404; res.end();
}).on("error", (e) => console.error("[ration-mcp] call log disabled:", e.message)).listen(port, "127.0.0.1");

// ------------------------------------------------------------------ chain reads
async function state() {
  const hubEpoch = await hubClient.readContract({ address: HUB, abi: hubAbi, functionName: "epochId" });
  const [hubEnd, hubBudget, length, refill] = await Promise.all([
    hubClient.readContract({ address: HUB, abi: hubAbi, functionName: "epochEnd" }),
    hubClient.readContract({ address: HUB, abi: hubAbi, functionName: "epochBudget" }),
    hubClient.readContract({ address: HUB, abi: hubAbi, functionName: "epochLength" }),
    hubClient.readContract({ address: HUB, abi: hubAbi, functionName: "refillBps" }),
  ]);
  const per = await Promise.all(lanes.map(async (l) => {
    const v = { address: l.vault, abi: vaultAbi } as const;
    const [slice, spent, epoch, end, paused, block] = await Promise.all([
      l.client.readContract({ ...v, functionName: "slice" }),
      l.client.readContract({ ...v, functionName: "spentInEpoch" }),
      l.client.readContract({ ...v, functionName: "epochId" }),
      l.client.readContract({ ...v, functionName: "epochEnd" }),
      l.client.readContract({ ...v, functionName: "paused" }),
      l.client.getBlock(),
    ]);
    return { lane: l, slice, spent, epoch, expired: block.timestamp >= end, paused };
  }));
  const remaining = per.reduce((a, p) => a + (p.expired || p.paused ? 0n : p.slice), 0n);
  return { hubEpoch, hubEnd, hubBudget, length, refill, per, remaining, now: Math.floor(Date.now() / 1000) };
}

const text = (s: string, isError = false) => ({ content: [{ type: "text" as const, text: s }], isError });
const laneByKey = (k: string) => lanes.find((l) => l.key === k.toLowerCase() || l.name.toLowerCase().startsWith(k.toLowerCase()));

// ------------------------------------------------------------------ tools
const server = new McpServer({ name: "ration", version: "0.1.0" });

server.registerTool("get_budget", { description: "Total budget for the current period, how much is spent, how much is left, and when the period ends." }, async () => {
  try {
    const s = await state();
    const spent = s.per.reduce((a, p) => a + p.spent, 0n);
    const left = Math.max(0, Number(s.hubEnd) - s.now);
    const out = `Budget this period: ${fmt(s.hubBudget)} ${SYMBOL} across ${lanes.length} chains. Spent: ${fmt(spent)}. Spendable right now: ${fmt(s.remaining)}. Period ${s.hubEpoch} ends in about ${Math.round(left / 3600)} hours.`;
    record("get_budget", {}, true, `${fmt(s.remaining)} left of ${fmt(s.hubBudget)}`);
    return text(out);
  } catch (e: any) { record("get_budget", {}, false, "read failed"); return text(`Could not read the chains: ${e.shortMessage ?? e.message}`, true); }
});

server.registerTool("get_slices", { description: "How much can be spent on each chain right now (each chain's slice), plus whether it is paused or expired." }, async () => {
  try {
    const s = await state();
    const rows = s.per.map((p) => `${p.lane.name}: ${fmt(p.slice)} ${SYMBOL} spendable${p.paused ? " (PAUSED)" : ""}${p.expired ? " (slice expired, waiting for the next period)" : ""}; spent here ${fmt(p.spent)}`);
    record("get_slices", {}, true, rows.map((r) => r.split(";")[0]).join(" · "));
    return text(rows.join("\n"));
  } catch (e: any) { record("get_slices", {}, false, "read failed"); return text(`Could not read the chains: ${e.shortMessage ?? e.message}`, true); }
});

server.registerTool("get_remaining", { description: "How much this agent can still spend: the total left across chains and this agent's own cap on each chain." }, async () => {
  try {
    const s = await state();
    const lines = [`Total spendable across chains: ${fmt(s.remaining)} ${SYMBOL}.`];
    if (agent) {
      for (const p of s.per) {
        const [info, used] = await Promise.all([
          p.lane.client.readContract({ address: p.lane.vault, abi: vaultAbi, functionName: "spenders", args: [agent.address] }),
          p.lane.client.readContract({ address: p.lane.vault, abi: vaultAbi, functionName: "spentBy", args: [p.epoch, agent.address] }),
        ]);
        if (!info[0]) { lines.push(`${p.lane.name}: this agent (${agent.address}) is not an approved spender.`); continue; }
        const capLeft = info[1] === 0n ? p.slice : (info[1] > used ? info[1] - used : 0n);
        lines.push(`${p.lane.name}: this agent can spend up to ${fmt(capLeft < p.slice ? capLeft : p.slice)} ${SYMBOL} (slice ${fmt(p.slice)}${info[1] > 0n ? `, cap left ${fmt(capLeft)}` : ", no cap"}).`);
      }
    } else lines.push("No AGENT_PRIVATE_KEY is set, so per-agent limits are not shown.");
    record("get_remaining", {}, true, `${fmt(s.remaining)} total`);
    return text(lines.join("\n"));
  } catch (e: any) { record("get_remaining", {}, false, "read failed"); return text(`Could not read the chains: ${e.shortMessage ?? e.message}`, true); }
});

server.registerTool("request_spend", {
  description: "Spend from a chain's vault. The vault enforces the rules; if the spend is refused the reason is returned in plain words. Amount is a decimal number of tokens.",
  inputSchema: { chain: z.string().describe(`One of: ${lanes.map((l) => l.key).join(", ")}`), to: z.string().describe("Recipient address (0x…)"), amount: z.string().describe("Amount, e.g. 25 or 12.5") },
}, async ({ chain, to, amount }) => {
  const input = { chain, to, amount };
  try {
    if (!agent) { record("request_spend", input, false, "no agent key"); return text("This server has no AGENT_PRIVATE_KEY, so it can read but not spend.", true); }
    const lane = laneByKey(chain);
    if (!lane) { record("request_spend", input, false, "unknown chain"); return text(`Unknown chain "${chain}". Use one of: ${lanes.map((l) => l.key).join(", ")}.`, true); }
    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) { record("request_spend", input, false, "bad address"); return text("The recipient is not a full 0x address.", true); }
    let units: bigint;
    try { units = parseUnits(amount, DEC); } catch { record("request_spend", input, false, "bad amount"); return text(`"${amount}" is not a valid amount.`, true); }

    const s = await state();
    const verdict = await checkSpend({ client: lane.client, laneName: lane.name, vault: lane.vault, token: lane.token, spender: agent.address, to: to as Address, amount: units, remainingTotal: s.remaining, symbol: SYMBOL, decimals: DEC });
    if (!verdict.ok) { record("request_spend", input, false, `denied: ${verdict.code}`); return text(`Denied. ${verdict.reason}`, true); }

    const wallet = createWalletClient({ account: agent, chain: mkChain(lane.chainId, lane.name, lane.rpc), transport: fallback(lane.rpc.map((u) => http(u))) });
    const hash = await wallet.writeContract({ address: lane.vault, abi: vaultAbi, functionName: "spend", args: [lane.token, to as Address, units] });
    const rc = await lane.client.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (rc.status !== "success") { record("request_spend", input, false, "reverted"); return text(`The transaction was mined but failed. Hash ${hash}.`, true); }
    const left = await lane.client.readContract({ address: lane.vault, abi: vaultAbi, functionName: "slice" });
    record("request_spend", input, true, `spent ${amount} on ${lane.key}`);
    return text(`Spent ${fmt(units)} ${SYMBOL} on ${lane.name} to ${to}. ${fmt(left)} ${SYMBOL} left on this chain. Transaction ${hash}.`);
  } catch (e: any) {
    record("request_spend", input, false, "error");
    return text(`The spend did not go through: ${e.shortMessage ?? e.message}. Nothing was spent.`, true);
  }
});

server.registerTool("get_ledger", { description: "Recent activity from the vaults: spends, releases, grants and period resets.", inputSchema: { limit: z.number().int().min(1).max(50).optional() } }, async ({ limit }) => {
  try {
    const rows: { ts: number; text: string }[] = [];
    await Promise.all(lanes.map(async (l) => {
      const latest = await l.client.getBlockNumber();
      const from = BigInt(Math.max(l.deployBlock, Number(latest) - 20_000));
      for (let cur = from; cur <= latest; cur += 2000n) {
        const to = cur + 1999n > latest ? latest : cur + 1999n;
        const logs = await l.client.getContractEvents({ address: l.vault, abi: vaultAbi, fromBlock: cur, toBlock: to });
        for (const g of logs as any[]) {
          const a = g.args;
          const ts = Number(a.timestamp);
          if (g.eventName === "Spent") rows.push({ ts, text: `${l.name}: spent ${fmt(a.amount)} ${SYMBOL} (slice now ${fmt(a.newSlice)})` });
          else if (g.eventName === "Released") rows.push({ ts, text: `${l.name}: gave up ${fmt(a.actual)} ${SYMBOL} of allowance` });
          else if (g.eventName === "Granted") rows.push({ ts, text: `${l.name}: took on ${fmt(a.amount)} ${SYMBOL} of allowance` });
          else if (g.eventName === "EpochReset") rows.push({ ts, text: `${l.name}: new period, slice ${fmt(a.slice)} ${SYMBOL}` });
        }
      }
    }));
    rows.sort((a, b) => b.ts - a.ts);
    const out = rows.slice(0, limit ?? 15).map((r) => `${new Date(r.ts * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC  ${r.text}`);
    record("get_ledger", { limit }, true, `${out.length} entries`);
    return text(out.length ? out.join("\n") : "No activity yet.");
  } catch (e: any) { record("get_ledger", { limit }, false, "read failed"); return text(`Could not read the chains: ${e.shortMessage ?? e.message}`, true); }
});

await server.connect(new StdioServerTransport());
console.error(`[ration-mcp] ready. agent=${agent?.address ?? "none (read-only)"} log=http://127.0.0.1:${port}/calls`);
