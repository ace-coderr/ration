import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck, Bot, Copy, Fuel, Gauge, LogOut, Moon, ScrollText, SlidersHorizontal, Sun, Users, Vault, Wallet, X, AlertTriangle, WifiOff,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Logo } from "./Logo";
import { CopyBtn, Ticker } from "./kit";
import { LANES, LASNA, SYMBOL, X_URL, laneByChain } from "@/lib/config";
import { clientFor } from "@/lib/chains";
import { erc20Abi, vaultAbi } from "@/lib/abi";
import { fmtAmt, fmtNative, num, short } from "@/lib/format";
import { onNewEvents, useSnapshot, useStale } from "@/state/data";
import { useUi } from "@/state/ui";
import { KNOWN_CHAIN_IDS, useWallet } from "@/state/wallet";

const NAV = [
  { to: "/live", label: "Live budget", short: "Live", icon: Gauge },
  { to: "/budget", label: "Set budget", short: "Budget", icon: SlidersHorizontal },
  { to: "/vaults", label: "Vaults", short: "Vaults", icon: Vault },
  { to: "/spenders", label: "Spenders", short: "Spenders", icon: Users },
  { to: "/ledger", label: "Ledger", short: "Ledger", icon: ScrollText },
  { to: "/fuel", label: "Fuel", short: "Fuel", icon: Fuel },
  { to: "/agents", label: "Agents", short: "Agents", icon: Bot },
  { to: "/proof", label: "Proof", short: "Proof", icon: BadgeCheck },
];

function BudgetStrip() {
  const { data } = useSnapshot();
  const [pulse, setPulse] = useState(0);
  useEffect(() => onNewEvents((fresh) => { if (fresh.some((e) => e.kind === "spent" && e.ts > Date.now() / 1000 - 30)) setPulse((p) => p + 1); }), []);
  const lanes = data?.lanes ?? [];
  const budget = data?.hub.epochBudget ?? 0n;
  const remaining = lanes.reduce((a, l) => a + l.slice, 0n);
  const share = lanes.length ? Number(budget) / lanes.length : 0;
  const live = !!data && budget > 0n;
  return (
    <Link to="/live" className={`strip ${pulse ? "pulse" : ""}`} key={pulse} aria-label={live ? `Budget remaining ${fmtAmt(remaining)} ${SYMBOL}` : "Budget loading"}>
      <div>
        <div className="strip-label">Remaining</div>
        <div className="strip-amount">
          {live ? <><Ticker value={num(remaining)} format={(n) => Math.round(n).toLocaleString("en-US")} /> <span className="muted">/ {fmtAmt(budget, 0)}</span></> : <span className="muted">–</span>}
        </div>
      </div>
      <div className="strip-bar" aria-hidden>
        {(lanes.length ? lanes : LANES.map(() => null)).map((l, i) => (
          <div className="strip-seg" key={i}>
            <i style={{ width: l && share ? `${Math.min(100, (Number(l.slice) / share) * 100)}%` : "0%" }} />
          </div>
        ))}
      </div>
    </Link>
  );
}

function AccountDrawer() {
  const w = useWallet();
  const [tab, setTab] = useState<"balances" | "roles">("balances");
  const snap = useSnapshot().data;
  const q = useQuery({
    enabled: !!w.account && w.drawerOpen,
    queryKey: ["acct", w.account],
    refetchInterval: 8000,
    queryFn: async () => {
      const a = w.account!;
      return Promise.all(
        LANES.map(async (l) => {
          const c = clientFor(l.key);
          const [eth, tok, spender] = await Promise.all([
            c.getBalance({ address: a }),
            c.readContract({ address: l.token, abi: erc20Abi, functionName: "balanceOf", args: [a] }),
            c.readContract({ address: l.vault, abi: vaultAbi, functionName: "spenders", args: [a] }),
          ]);
          return { l, eth, tok, spender };
        }),
      );
    },
  });
  const lasnaBal = useQuery({
    enabled: !!w.account && w.drawerOpen,
    queryKey: ["acct-lasna", w.account],
    queryFn: () => clientFor("lasna").getBalance({ address: w.account! }),
  });
  const net = w.walletChainId ? (laneByChain(w.walletChainId)?.name ?? (w.walletChainId === LASNA.chainId ? LASNA.name : `Chain ${w.walletChainId}`)) : "Unknown";
  const known = w.walletChainId ? KNOWN_CHAIN_IDS.includes(w.walletChainId) : false;
  return (
    <AnimatePresence>
      {w.drawerOpen && w.account && (
        <>
          <motion.div className="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => w.setDrawerOpen(false)} />
          <motion.aside
            className="drawer" role="dialog" aria-label="Account"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 380, damping: 40 }}
          >
            <div className="row between">
              <div>
                <div className="eyebrow" style={{ marginBottom: 8 }}>{w.walletName ?? "Wallet"}</div>
                <div className="mono" style={{ fontWeight: 700, fontSize: 20 }}>{short(w.account, 8, 6)}</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="iconbtn" aria-label="Copy address" onClick={() => navigator.clipboard?.writeText(w.account!)}><Copy size={16} /></button>
                <button className="iconbtn" aria-label="Disconnect" onClick={w.disconnect}><LogOut size={16} /></button>
                <button className="iconbtn" aria-label="Close" onClick={() => w.setDrawerOpen(false)}><X size={16} /></button>
              </div>
            </div>
            <div className="row">
              <span className={`badge ${known ? "ok" : "warn"}`}><i />{net}</span>
              <span className="badge test">Testnet</span>
            </div>
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === "balances"} onClick={() => setTab("balances")}>Balances</button>
              <button role="tab" aria-selected={tab === "roles"} onClick={() => setTab("roles")}>Roles</button>
            </div>
            {q.isLoading ? <div className="skeleton" style={{ height: 160 }} /> : tab === "balances" ? (
              <div>
                {q.data?.map(({ l, eth, tok }) => (
                  <div key={l.key}>
                    <div className="token-row"><span className="token-dot">{SYMBOL[0]}</span><div style={{ flex: 1 }}><b>{SYMBOL}</b><div className="helper">{l.name}</div></div><span className="num">{fmtAmt(tok)}</span></div>
                    <div className="token-row"><span className="token-dot" style={{ background: "var(--card-2)", color: "var(--ink)" }}>Ξ</span><div style={{ flex: 1 }}><b>ETH</b><div className="helper">gas on {l.short}</div></div><span className="num">{fmtNative(eth)}</span></div>
                  </div>
                ))}
                <div className="token-row"><span className="token-dot" style={{ background: "var(--lime)", color: "#0E1411" }}>R</span><div style={{ flex: 1 }}><b>lREACT</b><div className="helper">gas on Lasna</div></div><span className="num">{fmtNative(lasnaBal.data)}</span></div>
              </div>
            ) : (
              <div>
                {q.data?.map(({ l, spender }) => {
                  const owner = snap?.lanes.find((x) => x.cfg.key === l.key)?.owner;
                  return (
                    <div key={l.key} className="token-row">
                      <div style={{ flex: 1 }}><b>{l.name}</b></div>
                      {owner && w.isOwner(owner) && <span className="badge lime">Owner</span>}
                      {spender[0] ? <span className="badge ok"><i />Spender</span> : <span className="badge">No spending role</span>}
                    </div>
                  );
                })}
                <p className="helper" style={{ marginTop: 14 }}>Roles are read from the vaults. Connecting never changes them.</p>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function WalletButton() {
  const w = useWallet();
  if (w.account) {
    return (
      <button className="btn small auto" onClick={() => w.setDrawerOpen(true)} aria-label="Open account">
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--teal)" }} />
        <span className="mono">{short(w.account, 6, 4)}</span>
      </button>
    );
  }
  return (
    <Link className="btn small auto" to="/connect" style={{ background: "var(--lime)", color: "#0E1411", borderColor: "#0E1411" }}>
      <Wallet size={16} /> Connect
    </Link>
  );
}

function Banners() {
  const w = useWallet();
  const stale = useStale();
  const snap = useSnapshot();
  const wrong = w.account && w.walletChainId && !KNOWN_CHAIN_IDS.includes(w.walletChainId);
  return (
    <>
      {wrong && (
        <div className="banner" role="alert">
          <AlertTriangle size={18} />
          <span>Your wallet is on a network Ration doesn't use. Reading still works. To act, switch to a supported chain.</span>
          <span className="top-spacer" />
          {LANES.map((l) => (<button key={l.key} className="btn small auto" onClick={() => w.switchTo(l.key)}>{l.short}</button>))}
          <button className="btn small auto" onClick={() => w.switchTo("lasna")}>Lasna</button>
        </div>
      )}
      {stale && (
        <div className="banner bad" role="status">
          <WifiOff size={18} />
          <span>{snap.data ? `Showing data from ${Math.round((Date.now() - snap.data.fetchedAt) / 1000)}s ago. Retrying…` : "Can't reach the networks. Retrying…"}</span>
        </div>
      )}
    </>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-in">
        <small>
          Ration runs on testnets only: Base Sepolia, Unichain Sepolia and Reactive Lasna. The token is a mock with no value. Funds don't cross
          chains; only the right to spend them moves.
        </small>
        <nav className="row wrap" style={{ gap: 18, fontSize: 14 }} aria-label="Footer">
          <Link to="/proof">Proof</Link>
          <a href={LASNA.explorer} target="_blank" rel="noreferrer">Reactscan</a>
          <Link to="/agents">Agents</Link>
        </nav>
        {/* last element on every page */}
        <span className="byline">
          built by <a href={X_URL} target="_blank" rel="noreferrer" aria-label="built by ace, opens x.com/_ace_won">ace</a>
        </span>
      </div>
    </footer>
  );
}

export function Shell() {
  const { theme, toggleTheme } = useUi();
  const loc = useLocation();
  const main = useRef<HTMLDivElement>(null);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [loc.pathname]);
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Ration home"><Logo size={34} /></Link>
        <div className="top-spacer" />
        <BudgetStrip />
        <button className="iconbtn" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <WalletButton />
      </header>

      <nav className="rail" aria-label="Main">
        <div className="rail-logo" />
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className="nav" aria-label={label}>
            {({ isActive }) => (
              <>
                {isActive && <motion.span layoutId="rail-pill" style={{ position: "absolute", inset: 0, borderRadius: 14, background: "var(--lime)", zIndex: 0 }} transition={{ type: "spring", stiffness: 460, damping: 38 }} />}
                <Icon size={21} style={{ position: "relative", zIndex: 1, color: isActive ? "#0E1411" : undefined }} />
                <span style={{ position: "relative", zIndex: 1, color: isActive ? "#0E1411" : undefined }}>{label}</span>
              </>
            )}
          </NavLink>
        ))}
        <div className="rail-foot mono muted">TESTNET</div>
      </nav>

      <div className="main" ref={main}>
        <Banners />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={loc.pathname}
            className="page"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
        <Footer />
      </div>

      <nav className="bottombar" aria-label="Main (mobile)">
        {NAV.map(({ to, short: s, icon: Icon }) => (
          <NavLink key={to} to={to} aria-label={s}>
            <Icon size={19} />
            {s}
          </NavLink>
        ))}
      </nav>
      <AccountDrawer />
    </div>
  );
}
