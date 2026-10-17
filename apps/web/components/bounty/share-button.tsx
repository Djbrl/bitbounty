"use client";

import { useState } from "react";
import { buttonClass } from "../ui/button";

/** "Partager le reçu": native share sheet on phones, copy link elsewhere. */
export function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // user cancelled the share sheet or clipboard is blocked: nothing to do
    }
  }
  return (
    <button type="button" onClick={share} className={buttonClass({ variant: "secondary", block: true })}>
      {copied ? "Lien copié ✓" : "Partager le reçu"}
    </button>
  );
}
