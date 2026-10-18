"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { Me } from "../../../../fixtures/types";
import { Button, buttonClass, Card, Eyebrow } from "../ui";
import { payoutAccountApi, type PayoutAccountApi } from "./api";
import { addressError, checkAddressInput, savedAddress } from "./logic";

export interface LightningAddressFormProps {
  /** Called with the masked address once the server checked and saved it. */
  onSaved: (masked: string) => void;
  api?: PayoutAccountApi;
  submitLabel?: string;
  /** Extra button next to submit (e.g. "Annuler"). */
  onCancel?: () => void;
}

/** One field: `toi@blink.sv`. Format checked here, "does it resolve" checked by the server (B6's LNURL resolver). */
export function LightningAddressForm({ onSaved, api = payoutAccountApi, submitLabel = "Vérifier et enregistrer", onCancel }: LightningAddressFormProps) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const checked = checkAddressInput(value);
    if (!checked.ok) return setError(addressError(checked.error));
    setBusy(true);
    setError(null);
    const res = await api.saveLightningAddress(checked.address);
    setBusy(false);
    if (!res.ok) return setError(addressError(res.error));
    setValue("");
    onSaved(res.data.lightningAddress);
  }

  return (
    <form className="grid gap-3" onSubmit={submit} noValidate>
      <label htmlFor="ln-address" className="grid gap-1.5">
        <span className="text-[13px] font-semibold">Lightning Address</span>
        <input
          id="ln-address"
          name="lightningAddress"
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="toi@blink.sv"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={!!error}
          aria-describedby="ln-address-help"
          className="w-full min-w-0 rounded-[10px] border border-rule bg-sheet px-3 py-2.5 font-mono text-[15px] outline-none focus:border-money"
        />
        <span id="ln-address-help" className="text-xs text-muted">
          Tu la trouves dans ton wallet Lightning (Blink, Wallet of Satoshi, Phoenix…). Tes bounties arrivent en sats, en quelques secondes.
        </span>
      </label>
      {error && (
        <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Vérification…" : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Annuler
          </Button>
        )}
      </div>
    </form>
  );
}

export interface OnboardingProps {
  me: Me;
  /** Injected in tests; defaults to POST /api/me/lightning-address. */
  api?: PayoutAccountApi;
}

/** /me: the developer's payout account, a Lightning Address. Shows it masked, or asks for it. French. */
export function Onboarding({ me, api }: OnboardingProps) {
  const [address, setAddress] = useState<string | null>(() => savedAddress(me.payoutAccount));
  const [editing, setEditing] = useState(false);

  return (
    <Card padding="lg" as="section" className="grid gap-4" lang="fr">
      <Eyebrow>Compte de paiement</Eyebrow>
      {address && !editing ? (
        <>
          <h1 className="text-[1.35rem] font-extrabold leading-tight">Tu es prêt à être payé</h1>
          <div role="status" className="flex items-center gap-2 rounded-[10px] bg-money-soft px-3 py-2.5 text-[13px] font-semibold text-money">
            <span aria-hidden>✓</span> Lightning Address vérifiée · prête à recevoir des bounties
          </div>
          <dl className="grid gap-2 rounded-[10px] border border-rule px-3 py-2.5 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Lightning Address</dt>
              <dd className="font-mono font-medium">{address}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Connecté en tant que</dt>
              <dd className="font-medium">@{me.user.login}</dd>
            </div>
          </dl>
          <p className="text-xs leading-snug text-muted">Les paiements partent en sats sur Lightning dès que la PR est mergée et vérifiée.</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/explore" className={buttonClass()}>
              Voir les bounties ouvertes
            </Link>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Modifier
            </Button>
          </div>
        </>
      ) : (
        <>
          <h1 className="text-[1.35rem] font-extrabold leading-tight">Où veux-tu être payé ?</h1>
          <p className="text-[13px] leading-[1.45] text-muted">
            Connecté en tant que <b className="text-ink">@{me.user.login}</b>. Ton adresse ne sera jamais affichée en entier sur GitHub ni sur les reçus.
          </p>
          <LightningAddressForm
            api={api}
            onSaved={(masked) => {
              setAddress(masked);
              setEditing(false);
            }}
            onCancel={address ? () => setEditing(false) : undefined}
          />
        </>
      )}
    </Card>
  );
}
