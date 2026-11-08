import "dotenv/config";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, type Address, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const lasna = defineChain({
  id: 5318007,
  name: "Reactive Lasna",
  nativeCurrency: { name: "Lasna REACT", symbol: "lREACT", decimals: 18 },
  rpcUrls: { default: { http: [process.env.LASNA_RPC ?? "https://lasna-rpc.rnk.dev/"] } },
  blockExplorers: { default: { name: "Reactscan", url: "https://lasna.reactscan.net" } },
});

export const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org"] } },
  blockExplorers: { default: { name: "Basescan", url: "https://sepolia.basescan.org" } },
});

export const unichainSepolia = defineChain({
  id: 1301,
  name: "Unichain Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.UNICHAIN_SEPOLIA_RPC ?? "https://sepolia.unichain.org"] } },
  blockExplorers: { default: { name: "Uniscan", url: "https://sepolia.uniscan.xyz" } },
});

export const SYSTEM_CONTRACT: Address = "0x8888888888888888888888888888888888888888";

export const vaultAbi = parseAbi([
  "function slice() view returns (uint256)",
  "function spentInEpoch() view returns (uint256)",
  "function epochId() view returns (uint256)",
  "function epochEnd() view returns (uint256)",
  "function epochBudget() view returns (uint256)",
  "function paused() view returns (bool)",
  "function spend(address token, address to, uint256 amount)",
  "event Spent(address indexed spender, address indexed token, address indexed to, uint256 amount, uint256 newSlice, uint256 epochId, uint256 seq, uint256 timestamp)",
  "event Released(bytes32 indexed transferId, uint256 requested, uint256 actual, uint256 newSlice, uint256 epochId, uint256 seq, uint256 timestamp)",
  "event Granted(bytes32 indexed transferId, uint256 amount, uint256 newSlice, uint256 epochId, uint256 seq, uint256 timestamp)",
  "event EpochReset(uint256 indexed epochId, uint256 slice, uint256 epochEnd, uint256 budget, uint256 seq, uint256 timestamp)",
]);

export const hubAbi = parseAbi([
  "function epochId() view returns (uint256)",
  "function epochEnd() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function startEpoch()",
  "event TransferRequested(bytes32 indexed transferId, uint256 fromChain, uint256 toChain, uint256 amount, uint256 epochId)",
  "event TransferReleased(bytes32 indexed transferId, uint256 requested, uint256 actual)",
  "event TransferGranting(bytes32 indexed transferId, uint256 amount, uint8 attempt)",
  "event TransferDone(bytes32 indexed transferId, uint256 amount, uint256 latency)",
  "event TransferExpired(bytes32 indexed transferId)",
]);

export const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export interface Lane {
  name: string;
  chain: Chain;
  vault: Address;
  token: Address;
  explorer: string;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

export function config() {
  const lanes: Lane[] = [
    { name: "Base Sepolia", chain: baseSepolia, vault: req("BASE_VAULT") as Address, token: req("BASE_TOKEN") as Address, explorer: "https://sepolia.basescan.org" },
    { name: "Unichain Sepolia", chain: unichainSepolia, vault: req("UNICHAIN_VAULT") as Address, token: req("UNICHAIN_TOKEN") as Address, explorer: "https://sepolia.uniscan.xyz" },
  ];
  const hub = req("HUB_ADDRESS") as Address;
  const agent = privateKeyToAccount(req("AGENT_PRIVATE_KEY") as Hex);
  return { lanes, hub, agent };
}

export function publicClient(chain: Chain) {
  return createPublicClient({ chain, transport: http() });
}

export function walletClient(chain: Chain, key: Hex) {
  return createWalletClient({ chain, account: privateKeyToAccount(key), transport: http() });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry flaky public RPC calls a few times. */
export async function retry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw last;
}
