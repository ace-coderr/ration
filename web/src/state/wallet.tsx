import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createWalletClient, custom, type Abi, type Address, type Hex } from "viem";
import { chainFor, clientFor, walletChainParams } from "@/lib/chains";
import { explain } from "@/lib/errors";
import { LANES, LASNA, txUrl } from "@/lib/config";
import { useUi } from "./ui";

interface Eip1193 {
  request(a: { method: string; params?: unknown }): Promise<any>;
  on?(ev: string, fn: (...a: any[]) => void): void;
  removeListener?(ev: string, fn: (...a: any[]) => void): void;
}
export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
  provider: Eip1193;
}

export interface WriteOpts {
  chain: string; // "lasna" or lane key
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  title: string; // shown in the success toast, e.g. "Vault paused"
  laneName?: string;
}

interface WalletCtx {
  wallets: WalletInfo[];
  account?: Address;
  walletChainId?: number;
  walletName?: string;
  connecting: boolean;
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
  connect: (w?: WalletInfo) => Promise<void>;
  disconnect: () => void;
  switchTo: (chain: string) => Promise<boolean>;
  write: (o: WriteOpts) => Promise<Hex | undefined>;
  isOwner: (owner?: string) => boolean;
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { toast } = useUi();
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [active, setActive] = useState<WalletInfo | undefined>();
  const [account, setAccount] = useState<Address | undefined>();
  const [walletChainId, setWalletChainId] = useState<number | undefined>();
  const [connecting, setConnecting] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const activeRef = useRef<WalletInfo | undefined>(undefined);
  activeRef.current = active;

  // discover wallets (EIP-6963), with a fallback to window.ethereum
  useEffect(() => {
    const found = new Map<string, WalletInfo>();
    const add = (w: WalletInfo) => { found.set(w.uuid, w); setWallets([...found.values()]); };
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.info && d?.provider) add({ ...d.info, provider: d.provider });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const t = setTimeout(() => {
      const eth = (window as any).ethereum as Eip1193 | undefined;
      if (eth && found.size === 0) add({ uuid: "injected", name: "Browser wallet", icon: "", rdns: "injected", provider: eth });
    }, 400);
    return () => { window.removeEventListener("eip6963:announceProvider", onAnnounce); clearTimeout(t); };
  }, []);

  const attach = useCallback(async (w: WalletInfo, prompt: boolean) => {
    const accts: string[] = await w.provider.request({ method: prompt ? "eth_requestAccounts" : "eth_accounts" });
    if (!accts?.length) return false;
    const cid = await w.provider.request({ method: "eth_chainId" });
    setActive(w);
    setAccount(accts[0] as Address);
    setWalletChainId(parseInt(cid, 16));
    try { localStorage.setItem("ration-wallet", w.rdns); localStorage.removeItem("ration-disconnected"); } catch { /* ignore */ }
    return true;
  }, []);

  // silent reconnect
  useEffect(() => {
    if (!wallets.length || active) return;
    try {
      if (localStorage.getItem("ration-disconnected")) return;
      const last = localStorage.getItem("ration-wallet");
      const w = wallets.find((x) => x.rdns === last);
      if (w) attach(w, false).catch(() => undefined);
    } catch { /* ignore */ }
  }, [wallets, active, attach]);

  // wallet events
  useEffect(() => {
    if (!active) return;
    const p = active.provider;
    const onAccounts = (a: string[]) => { setAccount(a[0] as Address | undefined); if (!a.length) setActive(undefined); };
    const onChain = (c: string) => setWalletChainId(parseInt(c, 16));
    p.on?.("accountsChanged", onAccounts);
    p.on?.("chainChanged", onChain);
    return () => { p.removeListener?.("accountsChanged", onAccounts); p.removeListener?.("chainChanged", onChain); };
  }, [active]);

  const connect = useCallback(async (w?: WalletInfo) => {
    const target = w ?? wallets[0];
    if (!target) { toast({ tone: "bad", title: "No wallet found", body: "Install a browser wallet such as MetaMask or Rabby, then reload." }); return; }
    setConnecting(true);
    try { await attach(target, true); }
    catch (e) { toast({ tone: "bad", title: "Could not connect", body: explain(e) }); }
    finally { setConnecting(false); }
  }, [wallets, attach, toast]);

  const disconnect = useCallback(() => {
    setActive(undefined); setAccount(undefined); setWalletChainId(undefined); setDrawerOpen(false);
    try { localStorage.setItem("ration-disconnected", "1"); } catch { /* ignore */ }
  }, []);

  const switchTo = useCallback(async (chain: string): Promise<boolean> => {
    const w = activeRef.current;
    if (!w) return false;
    const target = chainFor(chain).id;
    const cur = parseInt(await w.provider.request({ method: "eth_chainId" }), 16);
    if (cur === target) return true;
    try {
      await w.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${target.toString(16)}` }] });
    } catch (e: any) {
      if (e?.code === 4902 || e?.code === -32603 || /unrecognized|not added|add/i.test(e?.message ?? "")) {
        await w.provider.request({ method: "wallet_addEthereumChain", params: [walletChainParams(chain)] });
      } else throw e;
    }
    setWalletChainId(target);
    return true;
  }, []);

  const write = useCallback(async (o: WriteOpts): Promise<Hex | undefined> => {
    const w = activeRef.current;
    if (!w || !account) { toast({ tone: "bad", title: "Connect a wallet first", body: "Connecting can't move any money." }); return undefined; }
    const pub = clientFor(o.chain);
    try {
      await switchTo(o.chain);
      // simulate first: a revert here gives a precise reason and costs nothing
      await pub.simulateContract({
        account, address: o.address, abi: o.abi, functionName: o.functionName, args: o.args as any, value: o.value,
      } as any);
      const wc = createWalletClient({ account, chain: chainFor(o.chain), transport: custom(w.provider) });
      const hash = await wc.writeContract({
        address: o.address, abi: o.abi, functionName: o.functionName, args: o.args as any, value: o.value,
      } as any);
      toast({ tone: "info", title: "Sent. Waiting for the network…", link: { href: txUrl(o.chain, hash), label: "View transaction" } });
      const rc = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (rc.status !== "success") throw new Error("The transaction was mined but failed.");
      toast({ tone: "ok", title: o.title, link: { href: txUrl(o.chain, hash), label: "View transaction" } });
      return hash;
    } catch (e) {
      toast({ tone: "bad", title: "Nothing was changed", body: explain(e, { lane: o.laneName }) });
      return undefined;
    }
  }, [account, switchTo, toast]);

  const isOwner = useCallback((owner?: string) => !!account && !!owner && account.toLowerCase() === owner.toLowerCase(), [account]);

  const value = useMemo<WalletCtx>(
    () => ({ wallets, account, walletChainId, walletName: active?.name, connecting, drawerOpen, setDrawerOpen, connect, disconnect, switchTo, write, isOwner }),
    [wallets, account, walletChainId, active, connecting, drawerOpen, connect, disconnect, switchTo, write, isOwner],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const c = useContext(Ctx);
  if (!c) throw new Error("WalletProvider missing");
  return c;
}

export const KNOWN_CHAIN_IDS = [LASNA.chainId, ...LANES.map((l) => l.chainId)];
