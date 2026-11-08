/**
 * One-command demo reset. Starts a fresh budget period (even split, nothing spent), then checks that
 * every vault received its slice and that the hub and vaults have enough fuel for a demo.
 *
 *   pnpm seed
 *
 * Needs DEPLOYER_PRIVATE_KEY (the hub owner) in .env.
 */
import { writeFileSync } from "node:fs";
import { formatUnits, type Hex } from "viem";
import { config, hubAbi, lasna, publicClient, retry, sleep, vaultAbi, walletClient } from "./lib/chains.js";
import { parseAbi } from "viem";

const { lanes, hub } = config();
const fmt = (v: bigint) => formatUnits(v, 6);
const payable = parseAbi(["function reserves(address) view returns (uint256)", "function debts(address) view returns (uint256)"]);
const SYSTEM = "0x8888888888888888888888888888888888888888" as const;
const PROXIES: Record<number, `0x${string}`> = { 84532: "0x476F44b11F5C942c58f4c8E3d0300E5710743585", 1301: "0x775c9B990ADe401060B78D0e98684eEf8d2466C1" };

const key = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("DEPLOYER_PRIVATE_KEY missing in .env");
const lasnaPub = publicClient(lasna);
const wallet = walletClient(lasna, key);

const lasnaFrom = await retry(() => lasnaPub.getBlockNumber());
const fromBlocks = new Map<string, bigint>();
for (const l of lanes) fromBlocks.set(l.name, await retry(() => publicClient(l.chain).getBlockNumber()));
const before = await retry(() => lasnaPub.readContract({ address: hub, abi: hubAbi, functionName: "epochId" }));
console.log(`hub period before: ${before}. Starting a new oneâ€¦`);
const tx = await wallet.writeContract({ address: hub, abi: hubAbi, functionName: "startEpoch" as never, gas: 1_500_000n, maxPriorityFeePerGas: 1n } as never);
await lasnaPub.waitForTransactionReceipt({ hash: tx });
console.log("startEpoch tx", `https://lasna.reactscan.net/tx/${tx}`);

const target = before + 1n;
const t0 = Date.now();
for (const l of lanes) {
  const c = publicClient(l.chain);
  for (;;) {
    const e = await retry(() => c.readContract({ address: l.vault, abi: vaultAbi, functionName: "epochId" }));
    if (e >= target) break;
    if (Date.now() - t0 > 180_000) throw new Error(`${l.name} did not receive the new period in 3 minutes`);
    await sleep(3000);
  }
  // new slices open a few seconds after the hub decides (safety delay): wait until they are spendable
  for (;;) {
    const [start, blk] = await Promise.all([
      retry(() => c.readContract({ address: l.vault, abi: vaultAbi, functionName: "epochStart" })),
      retry(() => c.getBlock()),
    ]);
    if (blk.timestamp >= start) break;
    await sleep(2000);
  }
  const [slice, spent] = await Promise.all([
    retry(() => c.readContract({ address: l.vault, abi: vaultAbi, functionName: "slice" })),
    retry(() => c.readContract({ address: l.vault, abi: vaultAbi, functionName: "spentInEpoch" })),
  ]);
  const [reserve, debt] = await Promise.all([
    retry(() => c.readContract({ address: PROXIES[l.chain.id], abi: payable, functionName: "reserves", args: [l.vault] })),
    retry(() => c.readContract({ address: PROXIES[l.chain.id], abi: payable, functionName: "debts", args: [l.vault] })),
  ]);
  console.log(`${l.name}: slice ${fmt(slice)}, spent ${fmt(spent)}, fuel ${formatUnits(reserve, 18)} ETH${debt > 0n ? "  ** IN DEBT: top up on the Fuel page **" : ""}`);
}
const hr = await retry(() => lasnaPub.readContract({ address: SYSTEM, abi: payable, functionName: "reserves", args: [hub] }));
console.log(`hub fuel: ${formatUnits(hr, 18)} lREACT${hr < 2n * 10n ** 18n ? "  ** LOW: top up on the Fuel page **" : ""}`);
// ---- evidence: spending stopped on every chain BEFORE new slices were issued
const ts = async (c: ReturnType<typeof publicClient>, n: bigint) => Number((await retry(() => c.getBlock({ blockNumber: n }))).timestamp);
const rows: { step: string; chain: string; tx: string; url: string; t: number }[] = [];
const closing = await retry(() => lasnaPub.getContractEvents({ address: hub, abi: hubAbi, eventName: "EpochClosing", fromBlock: lasnaFrom }));
if (closing.length) rows.push({ step: "1. Hub starts closing the old period", chain: "Reactive Lasna", tx: closing[0].transactionHash!, url: `https://lasna.reactscan.net/tx/${closing[0].transactionHash}`, t: await ts(lasnaPub, closing[0].blockNumber!) });
let lastClose = 0;
for (const l of lanes) {
  const c = publicClient(l.chain);
  const cl = await retry(() => c.getContractEvents({ address: l.vault, abi: vaultAbi, eventName: "EpochClosed", fromBlock: fromBlocks.get(l.name)! }));
  if (cl.length) { const t = Number(cl[0].args.timestamp); lastClose = Math.max(lastClose, t); rows.push({ step: "2. Vault confirms: spending stopped here", chain: l.name, tx: cl[0].transactionHash!, url: `${l.explorer}/tx/${cl[0].transactionHash}`, t }); }
}
const started = await retry(() => lasnaPub.getContractEvents({ address: hub, abi: hubAbi, eventName: "EpochStarted", fromBlock: lasnaFrom }));
if (started.length) rows.push({ step: "3. Hub issues the new period (all chains confirmed)", chain: "Reactive Lasna", tx: started[0].transactionHash!, url: `https://lasna.reactscan.net/tx/${started[0].transactionHash}`, t: await ts(lasnaPub, started[0].blockNumber!) });
let firstOpen = Infinity;
for (const l of lanes) {
  const c = publicClient(l.chain);
  const rs = await retry(() => c.getContractEvents({ address: l.vault, abi: vaultAbi, eventName: "EpochReset", fromBlock: fromBlocks.get(l.name)! }));
  if (rs.length) { firstOpen = Math.min(firstOpen, Number(rs[0].args.epochStart)); rows.push({ step: "4. Vault joins the new period", chain: l.name, tx: rs[0].transactionHash!, url: `${l.explorer}/tx/${rs[0].transactionHash}`, t: Number(rs[0].args.timestamp) }); }
}
if (rows.length) {
  const t0 = rows[0].t;
  const ok = lastClose <= firstOpen;
  let md = `# Evidence: forced early start never overlaps\n\nGenerated by \`pnpm seed\` at ${new Date().toISOString()}. The owner started a new period while one was running.\n\n`;
  md += `| Step | Chain | Transaction | Seconds after start |\n|---|---|---|---|\n`;
  for (const r of rows) md += `| ${r.step} | ${r.chain} | [\`${r.tx.slice(0, 12)}…${r.tx.slice(-6)}\`](${r.url}) | +${Math.max(0, r.t - t0)} |\n`;
  md += `\nThe last vault confirmed it had stopped spending at ${new Date(lastClose * 1000).toISOString()}. The earliest moment any new slice could be spent is ${new Date(firstOpen * 1000).toISOString()}. **${ok ? "Old and new slices were never spendable at the same time." : "OVERLAP DETECTED."}**\n`;
  writeFileSync("docs/EVIDENCE_FORCED_START.md", md);
  console.log(ok ? "forced start: old and new slices never overlapped (docs/EVIDENCE_FORCED_START.md)" : "OVERLAP DETECTED");
}
console.log(`ready in ${Math.round((Date.now() - t0) / 1000)}s. Open /live and start the demo.`);
