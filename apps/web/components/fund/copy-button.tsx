"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../ui";

export interface CopyButtonProps {
  value: string;
  label: string;
  /** id of the element holding the text, selected for a manual copy when the clipboard is refused. */
  targetId?: string;
}

type CopyState = "idle" | "copied" | "failed";

/** Copies `value`; if the clipboard API is missing or refused, selects the text and says so. */
export function CopyButton({ value, label, targetId }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);
    let next: CopyState = "copied";
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(value);
    } catch {
      const el = targetId ? document.getElementById(targetId) : null;
      if (el) window.getSelection()?.selectAllChildren(el);
      next = "failed";
    }
    setState(next);
    timer.current = setTimeout(() => setState("idle"), next === "failed" ? 5000 : 2000);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" onClick={copy}>
        {state === "copied" ? "Copied ✓" : label}
      </Button>
      <span role="status" aria-live="polite" className="text-xs text-pending">
        {state === "failed" ? "Copy blocked: text selected, copy it by hand" : ""}
      </span>
    </span>
  );
}
