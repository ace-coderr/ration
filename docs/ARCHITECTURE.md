# Architecture notes

This file records what was checked against the Reactive documentation and source
repositories before any contract was written. Anything marked **design** is a
decision for Ration, not a fact about Reactive.

## Sources checked

| Source | Used for |
| --- | --- |
| https://dev.reactive.network (Reactive Contracts, Callback Contracts, Economy, Lasna pages) | behaviour, limits, fees |
| `Reactive-Network/reactive-lib-omni` (tag `v0.1.0`) | base contracts, interfaces |
| `Reactive-Network/reactive-smart-contract-demos`, branch `omni`, `src/micro-demos` | working Omni examples (callback, cron, ping-pong) |
| `Reactive-Network/system-smart-contracts`, `src/omni`, `deployment_values/` | system contract, callback proxy, proxy addresses |

The `main` branch of the demos repository and `reactive-lib` target the older
Kopli-era API (`AbstractReactive` with `vm`/`rnOnly`, `service`, `react(LogRecord)`
with snake_case fields). **Do not use them.** Omni uses `reactive-lib-omni`.

## Confirmed: networks

| Item | Value | How confirmed |
| --- | --- | --- |
| Lasna chain ID | `5318007` | docs, and `eth_chainId` returned `0x512577` |
| Lasna RPC | `https://lasna-rpc.rnk.dev/` | docs, live call succeeded |
| Lasna explorer | `https://lasna.reactscan.net/` | docs |
| System contract | `0x8888888888888888888888888888888888888888` | docs, `eth_getCode` returned code |
| Base Sepolia callback proxy (84532) | `0x476F44b11F5C942c58f4c8E3d0300E5710743585` | `deployment_values/84532` |
| Unichain Sepolia callback proxy (1301) | `0x775c9B990ADe401060B78D0e98684eEf8d2466C1` | `deployment_values/1301` |
| Ethereum Sepolia callback proxy | `0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4` | `deployment_values/11155111` |

Note: the demo README for the `omni` branch uses `0x082caFba...` as the proxy. That
is an internal fork used by the authors, not the public testnet. Ignore it.

### Faucet (correction to the brief)

lREACT is obtained by **calling** `request(address)` on a faucet contract with ETH
attached, not by a plain transfer:

```
cast send 0x2afaFD298b23b62760711756088F75B7409f5967 "request(address)" $WALLET --value 0.1ether --rpc-url $BASE_SEPOLIA_RPC --private-key $KEY
```

- Base Sepolia faucet: `0x2afaFD298b23b62760711756088F75B7409f5967`
- Ethereum Sepolia faucet: `0x9b9BB25f1A81078C544C829c5EB7822d747Cf434`
- Rate 1 ETH to 100 lREACT. Maximum 500 lREACT per request. Anything above 5 ETH is lost.

## Confirmed: contract API (reactive-lib-omni v0.1.0)

- Solidity `^0.8.29`. Foundry config used by the demos: `via_ir = true`, `optimizer_runs = 200`.
- Import path used by demos: `@reactive/src/...` remapped to `lib/reactive-lib-omni/src/`.
- Reactive side: `AbstractReactive` (constructor takes no arguments; `SYSTEM` is the
  constant `0x8888...`; `REACTIVE_IGNORE` is the wildcard topic; modifier `onlySystem`).
- Destination side: `AbstractCallback(IPayable callbackProxy_, address callbackSender_)`.
  Both are `immutable`. Modifiers `onlyServiceProvider` (caller is the proxy) and
  `onlyCallbackSender(address)` (injected first argument equals the reactive contract).
- A contract cannot inherit both `AbstractReactive` and `AbstractCallback`.
- `coverDebt()` is **internal** (`_coverDebt()`); each contract must expose its own wrapper.
- `AbstractPayer.pay(uint256)` is already implemented and restricted to the service provider.
- Subscribe: `SYSTEM.subscribe(chainId, contract, topic0, topic1, topic2, topic3)`; `0` /
  `address(0)` / `REACTIVE_IGNORE` are wildcards. One criteria set per call (no OR).
  Subscribing from outside the constructor is allowed. `unsubscribe` must repeat all six
  arguments exactly or it silently does nothing.
- `react(LogRecord calldata log_) external onlySystem`. `LogRecord` fields are camelCase:
  `chainId, contractAddress, topic0..topic3, data, blockNumber, opCode, blockHash, txHash, logIndex`.
  `opCode` is the number of topics in the original log (LOG3 gives 3). `data` holds only
  the non-indexed parameters. Reverting inside `react()` is still billed, so unmatched logs
  must fall through, not revert.
- Callback request: `SYSTEM.requestCallbackV_1_0(CallbackConfiguration_V_1_0{chainId, recipient, gasLimit, payload})`.
  This emits `CallbackRequest` on the system contract; it is not an event the reactive
  contract emits. The payload's first argument must be an `address`; the network overwrites it
  with the requesting reactive contract's address.
- Cron: subscribe to `block.chainid`, contract `0x0000000000000000000000000000000000fffFfF`,
  with one of these topic0 values. The event's single non-indexed `uint256` is the block number.

| Event | Interval | Approx. time | topic0 |
| --- | --- | --- | --- |
| Cron1 | 1 block | ~1 s | `0xf02d6ea5c22a71cffe930a4523fcb4f129be6c804db50e4202fb4e0b07ccb514` |
| Cron10 | 10 blocks | ~10 s | `0x04463f7c1651e6b9774d7f85c85bb94654e3c46ca79b0c16fb16d4183307b687` |
| Cron100 | 100 blocks | ~2 min | `0xb49937fb8970e19fd46d48f7e3fb00d659deac0347f79cd7cb542f0fc1503c70` |
| Cron1000 | 1000 blocks | ~17 min | `0xe20b31294d84c3661ddc8f423abb9c70310d0cf172aa2714ead78029b325e3f4` |
| Cron10000 | 10000 blocks | ~3 h | `0xd214e1d84db704ed42d37f538ea9bf71e44ba28bc1cc088b2f5deca654677a56` |

Cron ticks are billed to the subscriber whether or not `react()` does anything.

## Confirmed: economics and limits

- Reactive transaction gas cap: 900,000. Minimum callback gas limit: 100,000 (lower requests are ignored).
- The callback proxy withholds `_extraGas + _maxChargeGas` (+ a small failure-event reserve)
  from the forwarded gas. Too little gives `InsufficientGas`; enough for the proxy but not
  for the target gives a `CallbackFailure` event. A failed callback is still charged.
- Fee: `max(tx.gasprice, basefee) * coeff/1000 * (gasUsed + extraGas)`.
  Base Sepolia / Unichain Sepolia proxies: `extraGas=80000`, `coeff=1100`, `maxChargeGas=50000`,
  `calldataGasPerByte=16`, L1 fee oracle `0x42...0F` (so L2 data fees are added).
- Funding: `depositTo(address)` on the system contract or proxy credits reserves and clears
  debt first. Charges draw reserves first, then debt. **Any debt blocks execution**: the system
  contract skips `react()` and the proxy reverts with `InDebt`. A direct transfer to a
  contract raises its balance only; it does not touch reserves or debt, so the contract must
  expose `coverDebt()` to use it.
- On a charge with empty reserves, the system calls `pay(debt)` on the contract with a gas
  budget of `_maxChargeGas` (50,000), so the contract pays itself from its balance in the same
  transaction and is never blacklisted. This works only if the contract holds enough native balance.
- The callback proxy only accepts `deliverCallback` from its configured operators, and checks
  the target has code (`NotAContract`).

## Not confirmed / to verify on chain

- Exact ordering guarantees between callbacks from different reactive transactions. Treat
  delivery as unordered and possibly duplicated (see invariant design).
- Whether `log_.chainId` for cron logs equals the Lasna chain ID (the demos subscribe with
  `block.chainid`; verify at deploy time).
- Foundry deploy flags for Lasna. The docs use `forge create --broadcast --rpc-url ... --value ...`
  and recommend a pre-funded constructor (`payable`). Gas estimation on Lasna may need
  `--legacy` or an explicit gas limit; test on first deploy.
- Real per-callback fee on both destination chains (measured in `docs/EVIDENCE.md`).

## Design consequences for Ration

1. **Hub is reactive only, vaults are callback only.** The hub holds a vault registry, calls
   `SYSTEM.subscribe` per vault (chain, vault address, `Spent` and `Released` topic0), and
   requests callbacks. Each vault is constructed with its chain's proxy and the hub address,
   so the hub must be deployed first. A wrong hub address means redeploying the vault.
2. **Registration is a post-deploy transaction** (`registerVault(chainId, vault)`), because
   vault addresses do not exist when the hub is deployed. It subscribes then and records the
   vault so that logs from unregistered contracts or the wrong chain are ignored.
3. **Time** uses `block.timestamp` on every chain. Cron is only a wake-up signal. Cron100
   (~2 min) is enough for timeouts and epoch rollover; it keeps tick cost low.
4. **Gas limits** for `release`/`grant`/`resetEpoch` callbacks: set at 300,000 to stay well
   above the 100,000 floor plus proxy overhead; measure and tune after the first loop.
5. **Debt fails safe.** A vault in debt cannot receive `release`/`grant`; the slice stays
   where it is, so budget is under-used, never overspent. The Fuel page must show this.
6. **Callbacks are unordered and may repeat.** All state transitions are keyed by `transferId`
   and are idempotent, and slices are decreased before they are increased (two-phase handoff).

## Confirmed on the live testnets (2026-11-08)

These were open questions above. They are now settled by real transactions
(see `docs/EVIDENCE.md`).

- **Deploying to Lasna** works with a plain `forge create --broadcast --constructor-args 1000`
  (no `--legacy`, no gas flags). `forge script` also works against Base and Unichain Sepolia.
- **Callbacks arrive and authenticate.** The vaults' `onlyServiceProvider` and
  `onlyCallbackSender` checks pass with the hub as the injected first argument.
  Epoch resets, releases and grants all landed through the real proxies.
- **Reactive transactions** appear on Reactscan as a `trigger(contract, log)` call to the system
  contract. One `react()` cost about 276,000 gas and 0.0276 lREACT at 100 gwei, which matches the
  fee formula. A full handoff (three reactive transactions) is about 0.08 lREACT.
- **Callback fee** on Base/Unichain Sepolia was about 0.000003 ETH per callback.
- **Latency** spend to grant landed was 3 and 4 seconds in the two measured loops.
- **Block timestamps** on Lasna are real wall-clock seconds, so `block.timestamp` is safe there.
  (Log objects returned by `eth_getTransactionReceipt` show `blockTimestamp: 0x0`; read the
  block instead.)
- **Explorer links**: `https://lasna.reactscan.net/tx/<hash>` and `/address/<addr>` resolve;
  Base `https://sepolia.basescan.org`, Unichain `https://sepolia.uniscan.xyz`.
- **Public RPC flakiness**: DNS lookups from Foundry and viem occasionally fail on the public
  endpoints. Scripts retry; nothing depends on a single call succeeding.

Still not measured: behaviour when a destination vault is in debt (covered in `docs/AUDIT.md`).
