/**
 * One-command demo reset. Starts a fresh budget period (even split, nothing spent), then checks that
 * every vault received its slice and that the hub and vaults have enough fuel for a demo.
 *
 *   pnpm seed
 *
 * Needs DEPLOYER_PRIVATE_KEY (the hub owner) in .env.
 */
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

const before = await retry(() => lasnaPub.readContract({ address: hub, abi: hubAbi, functionName: "epochId" }));
console.log(`hub period before: ${before}. Starting a new one…`);
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
console.log(`ready in ${Math.round((Date.now() - t0) / 1000)}s. Open /live and start the demo.`);
