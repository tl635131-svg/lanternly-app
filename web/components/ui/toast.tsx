"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { IconAlert, IconCheck, IconX } from "./icons";

type Toast = { id: number; tone: "success" | "error" | "info"; text: string };
const Ctx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, tone, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {items.map((t) => (
          <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className="pointer-events-auto flex max-w-md items-center gap-3 rounded-md bg-night px-4 py-3 text-sm text-on-night shadow-pop">
            {t.tone === "error" ? <IconAlert className="text-glow" /> : <IconCheck className="text-glow" />}
            <span>{t.text}</span>
            <button className="ml-2 opacity-70 hover:opacity-100" aria-label="Dismiss notification" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}><IconX size={16} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
