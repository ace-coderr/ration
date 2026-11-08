import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";

export type HelpKey = "live" | "budget" | "vaults" | "spenders" | "ledger" | "fuel" | "agents" | "proof";

/** Short, plain-words help for each page. Each links to the matching section of /how-it-works. */
export const HELP: Record<HelpKey, { text: string; anchor: string }> = {
  live: {
    text: "This is your budget right now. Each lane is one chain, and the lime blocks are what can still be spent there. When a chain runs low, blocks slide in from a chain that has spare room.",
    anchor: "spending",
  },
  budget: {
    text: "Pick how much can be spent in total and how long a period lasts. The total is split across the chains at the start of every period. Only the owner can change it, and a change applies from the next period unless you start one now.",
    anchor: "idea",
  },
  vaults: {
    text: "A vault is the account that holds the money on one chain. Only the owner can add money, take it out, or pause spending there. Spenders can never touch the money except to spend inside their limit.",
    anchor: "who",
  },
  spenders: {
    text: "A spender is a person or an AI agent allowed to spend. They can only spend inside the slice on each chain, and inside their own cap if you set one. Revoking someone takes effect within seconds.",
    anchor: "who",
  },
  ledger: {
    text: "Every spend and every move of allowance between chains, with a link to its transaction. Speed is the number of seconds from a spend to the new allowance arriving on that chain.",
    anchor: "spending",
  },
  fuel: {
    text: "The automation pays small network fees to keep running: lREACT on the Reactive network and a little ETH on each chain. If one runs dry, it pauses until someone tops it up. The budget stays safe while it waits.",
    anchor: "who",
  },
  agents: {
    text: "An AI agent can read the budget and ask to spend through MCP, a standard way to plug tools into AI assistants. The vault makes the decision, and it says why in plain words when the answer is no.",
    anchor: "agents",
  },
  proof: {
    text: "This checks that all the slices, plus what has been spent, plus what is moving between chains, never went above the budget. It reads the chains' own records and replays them in your browser.",
    anchor: "safe",
  },
};

export function HelpHint({ id }: { id: HelpKey }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const h = HELP[id];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); btn.current?.focus(); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="help" ref={wrap}>
      <button
        ref={btn}
        type="button"
        className="help-btn"
        aria-label="What is this page?"
        aria-expanded={open}
        aria-controls={uid}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open && (
        <div id={uid} role="dialog" aria-label="About this page" className="help-pop">
          <p>{h.text}</p>
          <Link to={`/how-it-works#${h.anchor}`} onClick={() => setOpen(false)}>
            More: How it works
          </Link>
        </div>
      )}
    </span>
  );
}
