import { formatUnits, parseAbi, type Address, type PublicClient } from "viem";

const abi = parseAbi([
  "function paused() view returns (bool)",
  "function spenders(address) view returns (bool allowed, uint256 cap)",
  "function tokenAllowed(address) view returns (bool)",
  "function restrictRecipients() view returns (bool)",
  "function recipientAllowed(address) view returns (bool)",
  "function epochId() view returns (uint256)",
  "function epochEnd() view returns (uint256)",
  "function slice() view returns (uint256)",
  "function spentBy(uint256 epoch, address spender) view returns (uint256)",
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export interface SpendCheck {
  client: PublicClient;
  laneName: string;
  vault: Address;
  token: Address;
  spender: Address;
  to: Address;
  amount: bigint;
  /** Total slice left across all chains, for a clearer message. */
  remainingTotal?: bigint;
  decimals?: number;
  symbol?: string;
}

export interface SpendVerdict {
  ok: boolean;
  /** Stable machine-readable code. */
  code:
    | "ok" | "paused" | "not_spender" | "token_not_allowed" | "zero_amount" | "recipient_not_allowed"
    | "epoch_expired" | "exceeds_slice" | "exceeds_cap" | "vault_underfunded";
  /** One plain sentence a person (or an agent) can act on. */
  reason: string;
  slice?: bigint;
}

/**
 * Asks the vault, read-only, whether a spend would go through, and says why not in plain words.
 * The checks follow the order the contract applies them, so the first problem found is the one
 * the contract would revert with.
 */
export async function checkSpend(p: SpendCheck): Promise<SpendVerdict> {
  const dec = p.decimals ?? 6;
  const sym = p.symbol ?? "mUSDC";
  const f = (v: bigint) => Number(formatUnits(v, dec)).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const c = p.client;
  const v = { address: p.vault, abi } as const;
  const [paused, info, tokenOk, restrict, recipOk, epochId, epochEnd, slice, balance, block] = await Promise.all([
    c.readContract({ ...v, functionName: "paused" }),
    c.readContract({ ...v, functionName: "spenders", args: [p.spender] }),
    c.readContract({ ...v, functionName: "tokenAllowed", args: [p.token] }),
    c.readContract({ ...v, functionName: "restrictRecipients" }),
    c.readContract({ ...v, functionName: "recipientAllowed", args: [p.to] }),
    c.readContract({ ...v, functionName: "epochId" }),
    c.readContract({ ...v, functionName: "epochEnd" }),
    c.readContract({ ...v, functionName: "slice" }),
    c.readContract({ address: p.token, abi: erc20, functionName: "balanceOf", args: [p.vault] }),
    c.getBlock({ blockTag: "latest" }),
  ]);
  const totalNote = p.remainingTotal !== undefined ? `; remaining total ${f(p.remainingTotal)} ${sym}` : "";

  if (paused) return { ok: false, code: "paused", reason: `Spending is paused on ${p.laneName}. The owner has to resume it.`, slice };
  if (!info[0]) return { ok: false, code: "not_spender", reason: `This address is not an approved spender on ${p.laneName}. The owner has to add it.`, slice };
  if (!tokenOk) return { ok: false, code: "token_not_allowed", reason: `That token is not on the ${p.laneName} allowlist.`, slice };
  if (p.amount === 0n) return { ok: false, code: "zero_amount", reason: "The amount must be above zero.", slice };
  if (restrict && !recipOk) return { ok: false, code: "recipient_not_allowed", reason: `${p.laneName} only pays recipients on its allowed list, and this one is not on it.`, slice };
  if (block.timestamp >= epochEnd) return { ok: false, code: "epoch_expired", reason: `The slice on ${p.laneName} has expired. Spending resumes when the next period starts.`, slice };
  if (p.amount > slice) return { ok: false, code: "exceeds_slice", reason: `Exceeds slice on ${p.laneName}: ${f(p.amount)} requested, ${f(slice)} ${sym} available here${totalNote}.`, slice };
  if (info[1] > 0n) {
    const used = await c.readContract({ ...v, functionName: "spentBy", args: [epochId, p.spender] });
    const left = used >= info[1] ? 0n : info[1] - used;
    if (p.amount > left) return { ok: false, code: "exceeds_cap", reason: `Exceeds this spender's cap on ${p.laneName}: ${f(p.amount)} requested, ${f(left)} ${sym} left of a ${f(info[1])} cap this period.`, slice };
  }
  if (balance < p.amount) return { ok: false, code: "vault_underfunded", reason: `The ${p.laneName} vault holds only ${f(balance)} ${sym}, less than the ${f(p.amount)} requested. It needs funding.`, slice };
  return { ok: true, code: "ok", reason: `Allowed: ${f(p.amount)} ${sym} on ${p.laneName}. ${f(slice - p.amount)} would remain on this chain${totalNote ? totalNote.replace("; remaining total", "; total left would be") : ""}.`, slice };
}
