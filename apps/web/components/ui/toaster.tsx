"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Toast, type ToastProps } from "./toast";

export interface ToastInput extends Pick<ToastProps, "tone" | "title" | "children" | "action"> {
  /** Auto-dismiss after this many ms (default 5000). 0 keeps it until closed. */
  duration?: number;
}

type ShowToast = (toast: ToastInput) => void;

const ToastContext = createContext<ShowToast | null>(null);

interface Item extends ToastInput {
  id: number;
}

let nextId = 0;

/** Mounted once in the root layout: holds the toasts and renders them bottom-centre (phone) / bottom-right. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback<ShowToast>((toast) => setItems((all) => [...all.slice(-2), { ...toast, id: ++nextId }]), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 grid justify-items-center gap-2 sm:left-auto sm:right-6 sm:justify-items-end">
        {items.map((t) => (
          <ToastItem key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ item, onDismiss }: { item: Item; onDismiss: (id: number) => void }) {
  const { duration = 5000, id, ...props } = item;
  useEffect(() => {
    if (duration <= 0) return;
    const t = setTimeout(() => onDismiss(id), duration);
    return () => clearTimeout(t);
  }, [duration, id, onDismiss]);
  return <Toast {...props} onClose={() => onDismiss(id)} className="pointer-events-auto" />;
}

/** `const toast = useToast(); toast({ tone: "success", title: "Bounty funded" })`. Needs <ToastProvider>. */
export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast() needs <ToastProvider> (mounted in app/layout.tsx)");
  return show;
}
