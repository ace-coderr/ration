# Audit log

A self-review of Ration before submission. It is not an independent audit. Findings are
listed with what was done about each. **The deployed testnet contracts are the source in this
repository, byte for byte, so contract findings below are documented and not patched here.** They
are fixed in the next deployment, before any mainnet use.

Severity is judged for this product: money is a testnet mock token, but the design goal is "never
exceed the budget".

## Summary

| # | Area | Severity | Status |
|---|---|---|---|
| 1 | Forced early period start briefly allowed two live slices | Medium | **Fixed** (two-step close, start gate) |
| 2 | Hub cron tick reverted if lane weights were not 100% | Medium | **Fixed** |
| 3 | A stuck grant after a late release is not retried | Low | Documented |
| 4 | Duplicate `grant` re-emits the caller's amount | Low | Documented |
| 5 | Debt on a vault strands in-flight allowance until the period ends | Low | Documented, Fuel page warns |
| 6 | Clock skew between chains at period boundaries | Info | Mitigated by start delay and vault clamp |
| 7 | Owner key loss | Info | Documented honestly below |
| 8 | Reentrancy test did not assert the guard | Info | Fixed in tests |
| 9 | A lost period reset left a vault idle for the whole period; first reset ran out of gas | High (found on redeploy) | **Fixed** (re-send logic, 600k gas, regression guard) |

The first version of the contracts was deployed, reviewed, and then **replaced**: findings 1, 2 and 9 changed contract code, so
the contracts were redeployed and the loop proof re-run. The addresses in this repository are the fixed ones. Findings 3 to 5 are
under-use only (never overspend) and stay documented.

## What was checked and how

**Invariant** `sum(slices) + spent + in-flight <= budget` holds under interleaving, reordering,
duplicate delivery, dropped callbacks and period rollover. Checked by a stateful fuzz test
(`test/Invariant.t.sol`): a handler spends on both vaults and delivers *any* queued callback at *any*
time, repeatedly or never, while time passes and periods roll. 256 runs of 80 calls, five invariants. The test
was mutation-checked: removing the "shrink the donor first" line in `release` makes it fail with
total 1250 against a budget of 1000.

**Callback authentication.** Every vault callback has `onlyServiceProvider` (caller is this chain's
callback proxy) and `onlyCallbackSender` (the injected first argument is the hub). Tests cover a
non-proxy caller, a wrong reactive sender, and the other chain's proxy. The hub's `react` is
`onlySystem`. Both bindings are immutable.

**Where funds can go.** Only `spend` moves vault tokens to a third party, only for an approved spender, only out of the
slice, only to allowed recipients when that list is on. `withdraw` is owner-only and only for unallocated balance, and
always pays the owner. The hub never touches tokens.

**Replay.** Releases and grants are keyed by `transferId` in the vault (`releaseSeen`, `grantApplied`). The hub only
advances a transfer from the expected state and only from the expected vault and chain. Tested: duplicate and reordered
release/grant, replay after done, a forged `Released` from the wrong vault, wrong chain, wrong contract.

**Timeouts cannot double-grant.** A retry re-sends the same `transferId` and amount, and the vault applies each id once.
Tested: lost grant retried and applied once; original and retry both delivered; retries capped at 5.

**Epoch rollover mid-transfer.** Callbacks carry the period id. A late grant from an old period is rejected and cannot
inflate the new budget. Tested. A vault that misses its reset stops spending at the old period's end (lease expiry).

**Token quirks.** Fee-on-transfer tokens cannot overspend, because the slice is accounting, not balance (tested; the
recipient simply receives less). `SafeERC20` handles tokens that return nothing or `false`. Allowlisting requires the same
decimals as the budget unit. ERC-777 style hooks are stopped by `nonReentrant`. Rebasing tokens are not supported.

**Reentrancy.** `spend`, `deposit` and `withdraw` are `nonReentrant`; state changes happen before the transfer. A hostile
token that re-enters `spend` is rejected with the guard's own error (asserted exactly).

**Rounding, dust, zero.** Weights are in basis points and the last lane takes the remainder so shares sum to the budget
exactly (tested with an odd budget). Zero amounts revert on `spend`, `deposit`, `withdraw`. A release of zero closes the transfer.

**Pause.** Pause blocks `spend` only. The hub can still move allowance in and out, so a paused vault can still be drained
by the hub's normal rebalancing. This is intentional so a pause never strands budget, and is stated in the UI.

**Hub safety.** Unknown chain, unknown emitter, wrong topic count and stale-period events are ignored and never revert
(a revert is still billed). `react` loops over at most 8 lanes. One `react` measured about 276,000 gas against the
900,000 cap. After a vault redeploy, `replaceVault` unsubscribes the old vault with the exact same arguments and
subscribes the new one; events from the old address are ignored (tested).

**Repository hygiene.** No private keys in any tracked file (checked against the actual keys), no `.env` tracked, no
unfinished-work markers, no tool or assistant traces, one author identity (the noreply address).

## Findings

### 1. Forced early period start briefly allowed two live slices (Medium, fixed)
In the first version `startEpoch()` began a new period at once. Vaults received new slices by callback a few seconds later, and a
vault that had not yet been told still held an unexpired old slice, so old and new slices could be spent together.
*Fix:* a forced start is now two steps. The hub tells every vault to **close** the current period (spending stops on that chain
immediately) and issues new slices only after every active vault has confirmed. If a confirmation is lost the hub waits for the old
period's natural end, which fails safe. Each new slice also has a start time ten seconds after the hub's decision, and the vault
clamps that start to the end of its own old lease, so even clock skew cannot make the two overlap. The invariant fuzz now includes a
random owner force-start and checks that two vaults are never spendable in different periods at once. Putting the old behaviour
back makes that test fail ("two periods spendable at once"), so the test would have caught the bug.
*Residual:* a vault in debt cannot receive the close, so a forced start then waits until the period ends naturally.

### 2. Hub cron tick reverted if lane weights were not 100% (Medium, fixed)
A rollover tick with invalid weights reverted and was billed on every tick. The tick now checks weights first and skips
silently. A forced start that was held back because weights changed mid-way is finished by the next tick once they are fixed.

### 9. A lost period reset left a vault idle for the whole period (High, found on redeploy, fixed)
While redeploying, the first period's reset callbacks never took effect. Measured cause: the first reset on a fresh vault needs
about 164,000 gas, and the hub asked for 300,000, of which the callback proxy keeps about 136,000. The reset ran out of gas.
That failure also exposed a design gap: **a failed reset could not be re-sent**, and a forced restart cannot help a vault that never
joined the period it would close, so that vault would stay idle until the period ended. The affected deployment was abandoned.
*Fix:* the callback gas default is 600,000; the hub now records which vaults confirmed the current period and the cron tick re-sends
the reset to any that did not (up to five times, one round per timeout); the owner can call `reissueEpoch()` to do it at once;
the vault ignores a period it already joined, so repeats are safe. Two tests guard the margin by measuring real callback gas
against the configured limit; with the old 300,000 limit the first-reset test fails.

### 3. A stuck grant after a late release is not retried (Low)
If a release lands after its transfer expired, the hub still grants it. If the recipient lane already started a new inbound
transfer, the old grant is sent once and is not tracked for retries. If that one callback is lost, the allowance is stranded until
the period ends. Under-use only, never overspend.

### 4. Duplicate `grant` re-emits the caller's amount (Low)
On a repeated `grant` the vault emits `Granted` with the amount in the new call, not the amount applied the first time. The
hub never sends a different amount for the same id, and ignores the repeat, so nothing is affected, but the event is
misleading in theory. *Fix next deployment:* store and re-emit the applied amount.

### 5. Debt on a vault strands in-flight allowance (Low)
A vault in debt reverts callbacks with `InDebt`. A release to it simply fails and the transfer expires (nothing moved). A
grant to it fails after the donor already gave up allowance; the hub retries up to 5 times, then the allowance stays in flight
until the period ends. Never overspend. The Fuel page shows reserves and runway, warns before debt, and a top-up pays debt first.
Recovery: top up through `depositTo`; retries stop after 5, so top up before that.

### 6. Clock skew between chains (Info, mitigated)
Periods are timestamps on the hub; vaults enforce them with their own chain's time, and chains differ by about a second. New
slices open ten seconds after the hub's decision and never before the vault's own old lease ends, so skew of up to that size cannot cause an
overlap. Block numbers are never used.

### 7. Owner key loss (Info)
Each vault and the hub have a single owner key. If it is lost: tokens held in vaults cannot be withdrawn and settings cannot
change. The hub keeps rolling periods with its last settings, spenders keep spending within them, and funds can still only go to
allowed recipients. There is no recovery path. Use a multisig or hardware wallet as owner before using real value. If it is
stolen, the thief can withdraw unallocated funds and approve spenders, and cannot exceed the slice per period without the hub.

### 8. Reentrancy test was weak (Info, fixed)
The first version only asserted "reverts". It now asserts `ReentrancyGuardReentrantCall`.

## Frontend

- **Wrong network:** a banner explains it and offers one-click switching; reads keep working. Every write switches the wallet to the right chain first. Triggered for real with a wallet reporting Ethereum mainnet: the banner appeared, and clicking Base switched the wallet to chain 84532 and cleared it.
- **Stale data:** a banner shows how old the data is and that it is retrying; the last good data stays on screen. Triggered for real by failing every RPC request: it appeared after about 10 seconds with both lanes and the budget strip still showing, and cleared 2 seconds after the network returned.
- **Wallet disconnect or account change:** handled by wallet events; write buttons fall back to the "connect" card.
- **Failed transactions:** every write is simulated first, so a refusal is explained in plain words (for example "That is more than this chain's slice") before anything is signed. A cancelled signature says nothing was sent.
- **Malicious token metadata:** token names and symbols are never read from token contracts. The UI uses the symbol in `deployments/testnet.json`.
- **Public RPC limits:** each chain has a fallback RPC; log scans shrink their range on failure; Lasna calls are batched.
- **Local MCP log:** the Agents page reads `127.0.0.1:7373` only if the user runs the MCP server, and only shows what that server reports.
- **Visual pass:** every page was loaded in both themes at desktop width (no error cards, no leftover loading skeletons, no horizontal overflow, the "Built by ace" byline last) and at 375 px width (no horizontal overflow).
- **Not covered:** no automated browser tests; the checks above were run by hand in a browser. Writes were exercised through the UI with a local test signer, not a real wallet extension.
