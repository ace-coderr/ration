/**
 * Proves the full Ration loop on live testnets, in both directions:
 *
 *   spend on vault A (origin event) -> hub reacts on Lasna -> release callback on vault B
 *   -> hub reacts to Released -> grant callback on vault A -> hub reacts to Granted
 *
 * Everything is read back from chain data, so the script can be re-run at any time and the
 * evidence it writes (docs/EVIDENCE.md, docs/evidence.json) can be checked by anyone.
 *
 *   pnpm prove-loop            run the loops on-chain and write the evidence
 *   pnpm prove-loop --report   rebuild docs/EVIDENCE.md from docs/evidence.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import {
  config, erc20Abi, hubAbi, lasna, publicClient, retry, sleep, vaultAbi, walletClient, type Lane,
} from "./lib/chains.js";

const MERCHANT: Address = "0x000000000000000000000000000000000000dEaD";
const LOW_TARGET = parseUnits("150", 6); // spend down to this slice, below the 200 watermark
const STAGE_TIMEOUT_MS = 10 * 60 * 1000;
const LASNA_EXPLORER = "https://lasna.reactscan.net";

const { lanes, hub, agent } = config();
const lasnaClient = publicClient(lasna);
const clientOf = new Map<Lane, ReturnType<typeof publicClient>>(lanes.map((l) => [l, publicClient(l.chain)]));
const fmt = (n: bigint) => formatUnits(n, 6);

interface Step {
  step: string;
  chain: string;
  tx: Hex;
  url: string;
  ts: number;
}
interface LoopResult {
  direction: string;
  transferId: Hex;
  amountRequested: string;
  amountMoved: string;
  slicesBefore: Record<string, string>;
  slicesAfter: Record<string, string>;
  steps: Step[];
  latency: { eventToReactiveTx: number; reactiveTxToRelease: number; releaseToGrant: number; totalSpendToGrant: number; totalSpendToDone: number };
}

async function blockTs(client: ReturnType<typeof publicClient>, n: bigint): Promise<number> {
  const b = await retry(() => client.getBlock({ blockNumber: n }));
  return Number(b.timestamp);
}

async function waitFor<T>(label: string, fn: () => Promise<T | undefined>): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await retry(fn).catch(() => undefined);
    if (v !== undefined) return v;
    if (Date.now() - start > STAGE_TIMEOUT_MS) throw new Error(`Timed out waiting for: ${label}`);
    process.stdout.write(".");
    await sleep(4000);
  }
}

async function slices(): Promise<{ slice: bigint[]; spent: bigint[]; budget: bigint }> {
  const slice: bigint[] = [];
  const spent: bigint[] = [];
  let budget = 0n;
  for (const l of lanes) {
    const c = clientOf.get(l)!;
    slice.push(await retry(() => c.readContract({ address: l.vault, abi: vaultAbi, functionName: "slice" })));
    spent.push(await retry(() => c.readContract({ address: l.vault, abi: vaultAbi, functionName: "spentInEpoch" })));
    budget = await retry(() => c.readContract({ address: l.vault, abi: vaultAbi, functionName: "epochBudget" }));
  }
  return { slice, spent, budget };
}

async function runLoop(spenderIdx: number): Promise<LoopResult> {
  const src = lanes[spenderIdx];
  const donor = lanes[1 - spenderIdx];
  const srcClient = clientOf.get(src)!;
  const donorClient = clientOf.get(donor)!;
  console.log(`\n=== Loop: spend on ${src.name}, expect refill from ${donor.name}`);

  const before = await slices();
  const sliceSrc = before.slice[spenderIdx];
  let amount = sliceSrc > LOW_TARGET ? sliceSrc - LOW_TARGET : parseUnits("1", 6);
  if (amount > sliceSrc) amount = sliceSrc;
  console.log(`slices before: ${lanes.map((l, i) => `${l.name}=${fmt(before.slice[i])}`).join("  ")}`);
  console.log(`spending ${fmt(amount)} mUSDC on ${src.name}`);

  const srcFrom = await retry(() => srcClient.getBlockNumber());
  const donorFrom = await retry(() => donorClient.getBlockNumber());
  const lasnaFrom = await retry(() => lasnaClient.getBlockNumber());

  // 1. Origin event: a real spend by the agent.
  const wallet = walletClient(src.chain, process.env.AGENT_PRIVATE_KEY as Hex);
  const spendTx = await wallet.writeContract({
    address: src.vault, abi: vaultAbi, functionName: "spend", args: [src.token, MERCHANT, amount],
  });
  const spendRcpt = await srcClient.waitForTransactionReceipt({ hash: spendTx });
  const tSpend = await blockTs(srcClient, spendRcpt.blockNumber);
  console.log(`spend tx ${spendTx} (${src.name})`);

  const steps: Step[] = [{ step: "1. Spend (origin event)", chain: src.name, tx: spendTx, url: `${src.explorer}/tx/${spendTx}`, ts: tSpend }];

  // 2. Hub reacts on Lasna and requests a release.
  process.stdout.write("waiting for hub TransferRequested");
  const requested = await waitFor("TransferRequested", async () => {
    const logs = await lasnaClient.getContractEvents({ address: hub, abi: hubAbi, eventName: "TransferRequested", fromBlock: lasnaFrom });
    return logs.find((l) => l.args.toChain === BigInt(src.chain.id));
  });
  const transferId = requested.args.transferId as Hex;
  const tReq = await blockTs(lasnaClient, requested.blockNumber);
  steps.push({ step: "2. Hub reacts, requests release", chain: "Reactive Lasna", tx: requested.transactionHash, url: `${LASNA_EXPLORER}/tx/${requested.transactionHash}`, ts: tReq });
  console.log(`\nhub requested transfer ${transferId.slice(0, 12)}… (${fmt(requested.args.amount as bigint)})`);

  // 3. Release callback lands on the donor vault.
  process.stdout.write("waiting for Released on donor");
  const released = await waitFor("Released", async () => {
    const logs = await donorClient.getContractEvents({ address: donor.vault, abi: vaultAbi, eventName: "Released", args: { transferId }, fromBlock: donorFrom });
    return logs[0];
  });
  const tRel = await blockTs(donorClient, released.blockNumber);
  steps.push({ step: "3. Release callback (donor slice shrinks)", chain: donor.name, tx: released.transactionHash, url: `${donor.explorer}/tx/${released.transactionHash}`, ts: tRel });
  const actual = released.args.actual as bigint;
  console.log(`\nreleased ${fmt(actual)} on ${donor.name}`);

  // 4. Hub reacts to Released and requests the grant.
  process.stdout.write("waiting for hub TransferGranting");
  const granting = await waitFor("TransferGranting", async () => {
    const logs = await lasnaClient.getContractEvents({ address: hub, abi: hubAbi, eventName: "TransferGranting", args: { transferId }, fromBlock: lasnaFrom });
    return logs[0];
  });
  const tGrt = await blockTs(lasnaClient, granting.blockNumber);
  steps.push({ step: "4. Hub reacts to Released, requests grant", chain: "Reactive Lasna", tx: granting.transactionHash, url: `${LASNA_EXPLORER}/tx/${granting.transactionHash}`, ts: tGrt });

  // 5. Grant callback lands on the spending vault.
  process.stdout.write("\nwaiting for Granted on spending vault");
  const granted = await waitFor("Granted", async () => {
    const logs = await srcClient.getContractEvents({ address: src.vault, abi: vaultAbi, eventName: "Granted", args: { transferId }, fromBlock: srcFrom });
    return logs[0];
  });
  const tGranted = await blockTs(srcClient, granted.blockNumber);
  steps.push({ step: "5. Grant callback (spending slice grows)", chain: src.name, tx: granted.transactionHash, url: `${src.explorer}/tx/${granted.transactionHash}`, ts: tGranted });
  console.log(`\ngranted ${fmt(granted.args.amount as bigint)} on ${src.name}`);

  // 6. Hub confirms completion.
  process.stdout.write("waiting for hub TransferDone");
  const done = await waitFor("TransferDone", async () => {
    const logs = await lasnaClient.getContractEvents({ address: hub, abi: hubAbi, eventName: "TransferDone", args: { transferId }, fromBlock: lasnaFrom });
    return logs[0];
  });
  const tDone = await blockTs(lasnaClient, done.blockNumber);
  steps.push({ step: "6. Hub reacts to Granted, transfer done", chain: "Reactive Lasna", tx: done.transactionHash, url: `${LASNA_EXPLORER}/tx/${done.transactionHash}`, ts: tDone });

  const after = await slices();
  const sumNow = after.slice.reduce((a, b) => a + b, 0n) + after.spent.reduce((a, b) => a + b, 0n);
  console.log(`slices after:  ${lanes.map((l, i) => `${l.name}=${fmt(after.slice[i])}`).join("  ")}`);
  console.log(`sum(slices) + spent = ${fmt(sumNow)} <= budget ${fmt(after.budget)}  ${sumNow <= after.budget ? "OK" : "VIOLATED"}`);
  if (sumNow > after.budget) throw new Error("INVARIANT VIOLATED");

  const rec = (l: Lane, v: bigint[]) => Object.fromEntries(lanes.map((x, i) => [x.name, fmt(v[i])]));
  return {
    direction: `${src.name} spends, ${donor.name} donates`,
    transferId,
    amountRequested: fmt(requested.args.amount as bigint),
    amountMoved: fmt(actual),
    slicesBefore: rec(src, before.slice),
    slicesAfter: rec(src, after.slice),
    steps,
    latency: {
      eventToReactiveTx: tReq - tSpend,
      reactiveTxToRelease: tRel - tReq,
      releaseToGrant: tGranted - tRel,
      totalSpendToGrant: tGranted - tSpend,
      totalSpendToDone: tDone - tSpend,
    },
  };
}

const c = (n: number) => Math.max(0, n);

function writeEvidence(loops: LoopResult[], finalState: { slice: bigint[]; spent: bigint[]; budget: bigint }) {
  const generatedAt = new Date().toISOString();
  const addr = (a: string, base: string) => `[\`${a}\`](${base}/address/${a})`;
  let md = `# Evidence: full loop on live testnets\n\nGenerated by \`pnpm prove-loop\` at ${generatedAt}. Every row links to the transaction.\n\n`;
  md += `## Deployed contracts\n\n| Contract | Chain | Address |\n|---|---|---|\n`;
  md += `| RationHub | Reactive Lasna (5318007) | ${addr(hub, LASNA_EXPLORER)} |\n`;
  for (const l of lanes) {
    md += `| RationVault | ${l.name} (${l.chain.id}) | ${addr(l.vault, l.explorer)} |\n`;
    md += `| MockUSDC (mock, no value) | ${l.name} | ${addr(l.token, l.explorer)} |\n`;
  }
  loops.forEach((lp, i) => {
    md += `\n## Loop ${i + 1}: ${lp.direction}\n\nTransfer \`${lp.transferId}\`. Requested ${lp.amountRequested} mUSDC, moved ${lp.amountMoved} mUSDC.\n\n`;
    md += `| Step | Chain | Transaction | Seconds after spend |\n|---|---|---|---|\n`;
    for (const s of lp.steps) md += `| ${s.step} | ${s.chain} | [\`${s.tx.slice(0, 12)}…${s.tx.slice(-6)}\`](${s.url}) | +${c(s.ts - lp.steps[0].ts)} |\n`;
    md += `\n| Latency | Seconds |\n|---|---|\n`;
    md += `| Origin event to reactive transaction | ${c(lp.latency.eventToReactiveTx)} |\n`;
    md += `| Reactive transaction to release callback | ${c(lp.latency.reactiveTxToRelease)} |\n`;
    md += `| Release callback to grant callback | ${c(lp.latency.releaseToGrant)} |\n`;
    md += `| **Spend to grant landed** | **${c(lp.latency.totalSpendToGrant)}** |\n`;
    md += `| Spend to hub confirmation | ${c(lp.latency.totalSpendToDone)} |\n`;
    md += `\nSlices before: ${JSON.stringify(lp.slicesBefore)}. After: ${JSON.stringify(lp.slicesAfter)}.\n`;
  });
  md += `
Timing note: block timestamps have one-second resolution and come from three different chains, so single hops can be off by about a second (hops that would read below zero are shown as 0). Totals are the reliable figures.
`;
  const sum = finalState.slice.reduce((a, b) => a + b, 0n) + finalState.spent.reduce((a, b) => a + b, 0n);
  md += `\n## Invariant check (from chain data)\n\nAfter the last loop: sum(slices) = ${fmt(finalState.slice.reduce((a, b) => a + b, 0n))}, spent = ${fmt(finalState.spent.reduce((a, b) => a + b, 0n))}, total ${fmt(sum)} against a budget of ${fmt(finalState.budget)}. ${sum <= finalState.budget ? "The invariant holds." : "VIOLATED."}\n`;
  mkdirSync(dirname("docs/EVIDENCE.md"), { recursive: true });
  writeFileSync("docs/EVIDENCE.md", md);
  writeFileSync("docs/evidence.json", JSON.stringify({ generatedAt, hub, lanes: lanes.map((l) => ({ name: l.name, chainId: l.chain.id, vault: l.vault, token: l.token })), loops, final: { budget: fmt(finalState.budget), slices: finalState.slice.map(fmt), spent: finalState.spent.map(fmt) } }, null, 2));
}

async function main() {
  if (process.argv.includes("--report")) {
    const j = JSON.parse(readFileSync("docs/evidence.json", "utf8"));
    writeEvidence(j.loops, {
      budget: parseUnits(j.final.budget, 6),
      slice: j.final.slices.map((x: string) => parseUnits(x, 6)),
      spent: j.final.spent.map((x: string) => parseUnits(x, 6)),
    });
    console.log("Report regenerated from docs/evidence.json");
    return;
  }
  const s = await slices();
  console.log("agent:", agent.address);
  for (const [i, l] of lanes.entries()) {
    const bal = await retry(() => clientOf.get(l)!.readContract({ address: l.token, abi: erc20Abi, functionName: "balanceOf", args: [l.vault] }));
    console.log(`${l.name}: vault ${l.vault} slice=${fmt(s.slice[i])} tokens held=${fmt(bal)}`);
  }
  const hubEpoch = await retry(() => lasnaClient.readContract({ address: hub, abi: hubAbi, functionName: "epochId" }));
  if (hubEpoch === 0n) throw new Error("Hub has no running epoch. Run startEpoch first.");

  const loops: LoopResult[] = [];
  loops.push(await runLoop(0)); // Base spends, Unichain donates
  writeEvidence(loops, await slices());
  loops.push(await runLoop(1)); // Unichain spends, Base donates
  writeEvidence(loops, await slices());
  console.log("\nEvidence written to docs/EVIDENCE.md and docs/evidence.json");
}

main().catch((e) => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
