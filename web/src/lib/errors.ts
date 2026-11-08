import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import { fmtAmt } from "./format";

/** Turn any contract or wallet failure into a short, plain sentence. */
export function explain(err: unknown, ctx?: { lane?: string }): string {
  const where = ctx?.lane ? ` on ${ctx.lane}` : "";
  if (err instanceof BaseError) {
    const rejected = err.walk((e) => e instanceof UserRejectedRequestError || (e as { code?: number }).code === 4001);
    if (rejected) return "You cancelled the request in your wallet. Nothing was sent.";
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (reverted?.data) {
      const a = (reverted.data.args ?? []) as readonly unknown[];
      switch (reverted.data.errorName) {
        case "ExceedsSlice":
          return `That is more than this chain's slice${where}. Only ${fmtAmt(a[1] as bigint)} can be spent here right now.`;
        case "ExceedsSpenderCap":
          return `That is over this spender's cap. They have ${fmtAmt(a[1] as bigint)} left this period.`;
        case "NotSpender":
          return "This address is not an approved spender. The owner has to add it first.";
        case "TokenNotAllowed":
          return "That token is not on this vault's allowlist.";
        case "RecipientNotAllowed":
          return "This vault only pays addresses on its recipient list.";
        case "Paused":
          return `Spending is paused${where}. The owner can resume it.`;
        case "EpochExpired":
          return `This period's slice has expired${where}. Spending resumes when the next period starts.`;
        case "EpochNotStarted":
          return `The new period has not started${where}. Spending opens in a few seconds.`;
        case "AlreadyClosing":
          return "A new period is already being started. Wait for it to finish.";
        case "NothingToStart":
          return "There is nothing to re-send right now.";
        case "ZeroAmount":
          return "Enter an amount above zero.";
        case "ZeroAddress":
          return "That address is empty. Paste a full address.";
        case "ExceedsUnallocated":
          return `Only ${fmtAmt(a[1] as bigint)} is free to withdraw. The rest backs the current slice.`;
        case "DecimalsMismatch":
          return "That token does not use the same decimals as the budget, so it can't be allowlisted.";
        case "OwnableUnauthorizedAccount":
        case "NotOwner":
          return "Only the owner can do this. Switch to the owner wallet.";
        case "BadWeights":
          return "Chain shares must add up to 100%.";
        case "BadConfig":
          return "One of those settings is out of range.";
        case "EpochStillRunning":
          return "The current period has not ended yet.";
        case "ERC20InsufficientBalance":
          return "The wallet does not hold enough of that token.";
        case "ERC20InsufficientAllowance":
          return "The vault has not been approved to take that much. Approve first.";
        default:
          return `The contract refused it (${reverted.data.errorName}).`;
      }
    }
    const m = err.shortMessage || err.message;
    if (/insufficient funds/i.test(m)) return "The wallet does not have enough gas for this network.";
    if (/chain/i.test(m) && /mismatch|switch/i.test(m)) return "Switch your wallet to the right network, then try again.";
    return m.split("\n")[0];
  }
  if (err instanceof Error) return err.message.split("\n")[0];
  return "Something went wrong. Nothing was sent.";
}
