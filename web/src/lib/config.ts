import deployment from "@deploy";
import type { Address } from "viem";

export interface LaneCfg {
  key: string;
  name: string;
  short: string;
  chainId: number;
  vault: Address;
  token: Address;
  callbackProxy: Address;
  deployBlock: number;
  explorer: string;
  rpc: string[];
}

export const D = deployment;
export const HUB: Address = deployment.hub.address as Address;
export const HUB_DEPLOY_BLOCK = deployment.hub.deployBlock;
export const SYSTEM: Address = deployment.systemContract as Address;
export const LASNA = deployment.lasna;
export const LANES: LaneCfg[] = deployment.lanes as LaneCfg[];
export const SYMBOL = deployment.tokenSymbol;
export const DECIMALS = deployment.tokenDecimals;
export const X_URL = "https://x.com/_ace_won";

export const laneByKey = (key: string) => LANES.find((l) => l.key === key);
export const laneByChain = (id: number) => LANES.find((l) => l.chainId === id);

export const txUrl = (chain: "lasna" | string, hash: string) =>
  chain === "lasna" ? `${LASNA.explorer}/tx/${hash}` : `${laneByKey(chain)?.explorer}/tx/${hash}`;
export const addrUrl = (chain: "lasna" | string, a: string) =>
  chain === "lasna" ? `${LASNA.explorer}/address/${a}` : `${laneByKey(chain)?.explorer}/address/${a}`;
