import { AnimatePresence, motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface ToastItem {
  id: number;
  tone: "ok" | "bad" | "info";
  title: string;
  body?: string;
  link?: { href: string; label: string };
}

interface UiCtx {
  toast: (t: Omit<ToastItem, "id">) => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
}

const Ctx = createContext<UiCtx | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );

  const toast = useCallback((t: Omit<ToastItem, "id">) => {
    const id = ++seq.current;
    setToasts((x) => [...x.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((i) => i.id !== id)), t.tone === "bad" ? 9000 : 6500);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const n = t === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = n;
      try { localStorage.setItem("ration-theme", n); } catch { /* private mode */ }
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", n === "dark" ? "#0A0F0C" : "#F2F4F3");
      return n;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setToasts([]);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo(() => ({ toast, theme, toggleTheme }), [toast, theme, toggleTheme]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className={`toast ${t.tone}`}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
            >
              {t.tone === "ok" ? <Check size={18} color="#B8F23A" /> : t.tone === "bad" ? <X size={18} color="#E5484D" /> : null}
              <div>
                <b>{t.title}</b>
                {t.body && <span>{t.body}</span>}
                {t.link && (
                  <div>
                    <a href={t.link.href} target="_blank" rel="noreferrer">{t.link.label}</a>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export function useUi() {
  const c = useContext(Ctx);
  if (!c) throw new Error("UiProvider missing");
  return c;
}
