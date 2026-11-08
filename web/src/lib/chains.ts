import { createPublicClient, defineChain, fallback, http, type Chain, type PublicClient } from "viem";
import { LANES, LASNA } from "./config";

export const lasnaChain = defineChain({
  id: LASNA.chainId,
  name: LASNA.name,
  nativeCurrency: { name: "Lasna REACT", symbol: "lREACT", decimals: 18 },
  rpcUrls: { default: { http: LASNA.rpc } },
  blockExplorers: { default: { name: "Reactscan", url: LASNA.explorer } },
  testnet: true,
});

const MULTICALL3 = { address: "0xcA11bde05977b3631167028862bE2a173976CA11" as const };

export const laneChains: Record<string, Chain> = Object.fromEntries(
  LANES.map((l) => [
    l.key,
    defineChain({
      id: l.chainId,
      name: l.name,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: l.rpc } },
      blockExplorers: { default: { name: "Explorer", url: l.explorer } },
      contracts: { multicall3: MULTICALL3 },
      testnet: true,
    }),
  ]),
);

// Lasna has no multicall contract but accepts JSON-RPC batching: calls made in the same tick
// travel as one request. The other chains use multicall3.
const transport = (urls: string[], batch = false) =>
  fallback(urls.map((u) => http(u, { timeout: 12_000, retryCount: 1, batch: batch ? { batchSize: 40, wait: 25 } : false })), { rank: false });

const clients = new Map<string, PublicClient>();

export function clientFor(key: "lasna" | string): PublicClient {
  let c = clients.get(key);
  if (c) return c;
  if (key === "lasna") {
    c = createPublicClient({ chain: lasnaChain, transport: transport(LASNA.rpc, true) }) as PublicClient;
  } else {
    const lane = LANES.find((l) => l.key === key)!;
    c = createPublicClient({
      chain: laneChains[key],
      transport: transport(lane.rpc),
      batch: { multicall: true },
    }) as PublicClient;
  }
  clients.set(key, c);
  return c;
}

export function chainFor(key: "lasna" | string): Chain {
  return key === "lasna" ? lasnaChain : laneChains[key];
}

/** Parameters for wallet_addEthereumChain. */
export function walletChainParams(key: "lasna" | string) {
  const c = chainFor(key);
  return {
    chainId: `0x${c.id.toString(16)}`,
    chainName: c.name,
    nativeCurrency: c.nativeCurrency,
    rpcUrls: c.rpcUrls.default.http,
    blockExplorerUrls: [c.blockExplorers?.default.url],
  };
}
