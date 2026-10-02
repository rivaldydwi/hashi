"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// Pemberitahuan singkat (toast) untuk umpan balik yang tidak perlu mengubah halaman (mis. "Tersalin"). Wilayah aria-live "polite" selalu ada di DOM,
// jadi pembaca layar membacakannya. Hilang sendiri setelah 4 detik; kesalahan bertahan lebih lama (8 detik).

type Toast = { id: number; text: string; tone: "ok" | "error" };
const Ctx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const next = useRef(1);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = next.current++;
    setItems((xs) => [...xs.slice(-2), { id, text, tone }]);
    timers.current.set(id, setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === "error" ? 8000 : 4000));
  }, []);
  useEffect(() => { const t = timers.current; return () => t.forEach(clearTimeout); }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 min-[900px]:items-end min-[900px]:pr-6" data-testid="toast-region">
        {items.map((x) => (
          <div key={x.id} data-testid="toast" className={`pointer-events-auto max-w-sm rounded-xl border px-4 py-3 text-sm font-medium shadow-sm ${x.tone === "error" ? "border-rose-300 bg-rose-50 text-rose-900" : "border-line bg-card text-ink"}`}>
            {x.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
