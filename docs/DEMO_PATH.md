# Demo path (under 3 minutes)

The video shows the real, live product with a wallet connected and its address visible. Nothing is mocked.

## Before recording (2 minutes, once)

1. **Reset the demo:** `pnpm seed`. It starts a fresh period, so both lanes begin at 500 and nothing is spent. It takes about 5 seconds and prints the fuel levels. If it prints `LOW` or `IN DEBT`, top up on the Fuel page first.
2. **Wallet:** import the owner testnet key from `.env` (`DEPLOYER_PRIVATE_KEY`) into a browser wallet. This key is the owner and also an approved spender, so one wallet can show everything. It is a throwaway key for testnets only. It needs a little ETH on Base Sepolia (about 0.001 per spend) and on Unichain Sepolia.
3. **Networks:** open the app, go to `/connect`, click **Add the three networks to my wallet**, approve the prompts.
4. **Browser:** a clean window, dark or light, 1440 px wide, address bar showing the app URL. Open `/` first.

Check: `/live` shows 500 and 500, "Within budget" stamp, nothing in flight.

## Script and click path

| Time | Say | Click | What the viewer sees |
|---|---|---|---|
| 0:00 | "This is Ration. It's working right now, on three live chains." | Stay on `/`. Point at the live lanes. | Real vaults, real slices, live-data badge. |
| 0:10 | "The problem: one spending limit, but every chain enforces its own, so across chains you can silently go over. Ration keeps one budget and moves the right to spend to where it's needed." | Click **Connect** (top right), then **Connect** on the card. | Connect card over drifting lanes, readiness checklist all green. Wallet address now in the top bar. |
| 0:30 | "Connecting can't move money. I'm the owner, and an approved spender." | Click **Live budget** in the rail. | Gauge fills in, lanes slide in, stamp thunks: "Within budget, verified from chain data". |
| 0:45 | "Base has half the budget. I'll spend most of it." | In **Spend**: pick **Base**, click chip **350**, then **Spend 350 mUSDC on Base**. Confirm in the wallet. | Toast "Sent", then "Spent 350". The budget strip pulses and ticks down. Base's lime blocks turn dark. |
| 1:05 | "Base is now low. Nobody ran a bot. A reactive contract on Lasna saw the spend." | Watch the lanes. | Blocks leave the Unichain lane into the **In flight** row, then land in Base. About 4 to 6 seconds after the spend. A latency chip appears under Recent transfers: about 3 to 4 s. |
| 1:25 | "The slice left Unichain *before* it arrived on Base, so it was never counted twice." | Point at the in-flight row. | "In flight" number is non-zero for about a second, then 0. |
| 1:35 | "Every step is a transaction you can open." | Click **Ledger**. Click one tx link. | Feed shows the spend, the release, the grant, the hub confirmations, with latency chips. Explorer tab opens. |
| 2:00 | "How is Reactive load-bearing? The hub is a reactive contract: it subscribes to events on two chains and sends callbacks. Take it away and there's no rebalancing, and no server replaces it." | Click **Proof**. | Replay of every event ever recorded, stamp "Within budget", peak total equals the budget, median speed. |
| 2:20 | "Agents can use this too." | Click **Agents**. In *Try a spend* choose Unichain, chip **5000**, **Check this spend**. | A plain denial: "Exceeds slice on Unichain Sepolia: 5,000 requested, N available; remaining total M." |
| 2:40 | "Next: more chains, spender policies, and a multisig owner." | Back to **Live budget**. | End on the lanes. |

## Expected timings (measured)

| Step | Typical |
|---|---|
| Wallet confirm to spend mined on Base/Unichain | 2 to 5 s |
| Spend to grant landed (on-chain) | 3 to 4 s (measured in 3 loops) |
| Spend to blocks moving on screen | 5 to 8 s (the page reads events every 4 s, and animates one step per 1.15 s so the in-flight state is visible) |
| `pnpm seed` | about 5 s |

## If something goes wrong on camera

- **Nothing moves after a spend:** check the Fuel page. A vault or the hub out of fuel pauses callbacks. Top up, then spend again. The budget is never overspent either way.
- **A spend is refused:** the toast says why in plain words (for example the slice is used up). Run `pnpm seed` to reset.
- **Public RPC is slow:** the page shows a "retrying" banner and keeps the last good data. Wait a few seconds.
- **Wrong network in the wallet:** a banner appears with one-click switch buttons.

## After recording

`pnpm seed` returns the demo to a clean start. `pnpm prove-loop` regenerates fresh evidence with new transaction hashes if you want them.
