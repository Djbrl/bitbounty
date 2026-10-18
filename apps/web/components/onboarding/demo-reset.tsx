"use client";

import { useState } from "react";
import { Button, Card } from "../ui";
import { postJson, type ApiResult } from "./api";

type Lang = "fr" | "en";

const TEXT = {
  fr: {
    title: "Zone démo",
    body: "Efface ton compte de paiement, ton mode et tes réponses d'onboarding pour rejouer /welcome. L'historique des bounties et paiements reste.",
    button: "Réinitialiser la démo",
    busy: "Réinitialisation…",
    confirm: "Réinitialiser la démo ? Ta Lightning Address, ton mode et ton onboarding seront effacés.",
    error: "La réinitialisation a échoué. Réessaie.",
  },
  en: {
    title: "Demo zone",
    body: "Wipes your payout account, mode and onboarding answers so you can replay /welcome. Bounty and payout history stays.",
    button: "Reset demo",
    busy: "Resetting…",
    confirm: "Reset the demo? Your Lightning Address, mode and onboarding will be erased.",
    error: "Reset failed. Try again.",
  },
} as const;

export const STORAGE_PREFIX = "bitbounty.";

/** Removes every localStorage key starting with "bitbounty." (tour flags included). Never throws. */
export function clearBitbountyStorage(storage: Storage | undefined = typeof window === "undefined" ? undefined : window.localStorage): void {
  try {
    if (!storage) return;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
  } catch {
    /* storage blocked: nothing to clear */
  }
}

export interface DemoResetApi {
  reset(): Promise<ApiResult<{ ok: true }>>;
}

export const demoResetApi: DemoResetApi = { reset: () => postJson("/api/me/reset-demo", {}) };

export interface DemoResetProps {
  lang?: Lang;
  api?: DemoResetApi;
  /** Injected in tests; defaults to a full navigation to /welcome. */
  navigate?: (href: string) => void;
}

/** /me "Zone démo": wipes the signed-in user's account (POST /api/me/reset-demo) and replays onboarding. */
export function DemoReset({ lang = "fr", api = demoResetApi, navigate = (href) => window.location.assign(href) }: DemoResetProps) {
  const t = TEXT[lang];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function reset() {
    if (!window.confirm(t.confirm)) return;
    setBusy(true);
    setError(false);
    const res = await api.reset();
    if (!res.ok) {
      setBusy(false);
      return setError(true);
    }
    clearBitbountyStorage();
    navigate("/welcome");
  }

  return (
    <Card padding="lg" as="section" className="mt-4 grid gap-3" lang={lang} aria-labelledby="demo-zone-title">
      <h2 id="demo-zone-title" className="text-base font-extrabold text-danger">
        {t.title}
      </h2>
      <p className="text-[13px] leading-[1.45] text-muted">{t.body}</p>
      {error && (
        <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger">
          {t.error}
        </p>
      )}
      <div>
        <Button variant="danger" onClick={reset} disabled={busy}>
          {busy ? t.busy : t.button}
        </Button>
      </div>
    </Card>
  );
}
