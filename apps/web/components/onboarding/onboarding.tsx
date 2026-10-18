"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Me, PayoutProvider } from "../../../../fixtures/types";
import { Button, buttonClass, cx, PhoneFrame } from "../ui";
import { onboardingApi, type OnboardingApi } from "./api";
import {
  classifyAmountFailure,
  formatCountdown,
  formatDateFr,
  formatSnPhone,
  maskSnPhone,
  normalizeSnPhone,
  OFFERED_PROVIDERS,
  OTP_LENGTH,
  parseAmount,
  PHONE_ERROR_FR,
  providerLabel,
  RESEND_SECONDS,
  sanitizeOtp,
  STEP_COUNT,
  STEP_NUMBER,
  stepFromAccount,
  type OnboardingStep,
} from "./logic";

export interface OnboardingProps {
  me: Me;
  /** Injected in tests; defaults to the /api/me/payout-account calls. */
  api?: OnboardingApi;
}

const API_ERROR_FR: Record<string, string> = {
  wrong_code: "Code incorrect. Vérifie le SMS et réessaie.",
  phone_and_provider_required: "Choisis un opérateur et entre ton numéro.",
  network_error: "Pas de connexion. Réessaie dans un instant.",
  send_failed: "L'envoi du montant test a échoué. Réessaie dans un instant.",
  too_many_tests: "Trop de montants test envoyés sur ce compte. Contacte-nous.",
  sms_not_verified: "Valide d'abord le code reçu par SMS.",
  no_test: "Aucun montant test en attente. Recommence l'étape SMS.",
  number_changed: "Ton numéro a changé : un nouveau montant test est nécessaire.",
  invalid_amount: "Entre un montant en FCFA, sans décimales (par ex. 125).",
};
const LOCKED_FR = "Trop d'essais. Par sécurité, ce compte est bloqué : on t'enverra un nouveau montant test d'ici 24 h.";
const apiError = (code: string) => API_ERROR_FR[code] ?? "Une erreur est survenue. Réessaie.";

/** Developer onboarding on /me: provider + number, SMS code, test amount, verified. All French. */
export function Onboarding({ me: initialMe, api = onboardingApi }: OnboardingProps) {
  const [me, setMe] = useState(initialMe);
  const [step, setStep] = useState<OnboardingStep>(() => stepFromAccount(initialMe.payoutAccount));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // step 1
  const [provider, setProvider] = useState<PayoutProvider>(initialMe.payoutAccount?.provider ?? "wave");
  const [phone, setPhone] = useState("");
  const [accountName, setAccountName] = useState(initialMe.user.name);
  const [national, setNational] = useState<string | null>(null);
  // step 2
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);
  // step 3
  const [amount, setAmount] = useState("");
  const [failed, setFailed] = useState(0);
  const [locked, setLocked] = useState(false);
  const [confirmedAmount, setConfirmedAmount] = useState<number | null>(null);

  useEffect(() => {
    if (step !== "sms" || resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [step, resendIn]);

  const go = (next: OnboardingStep) => {
    setError(null);
    setStep(next);
  };

  async function submitAccount(e?: FormEvent) {
    e?.preventDefault();
    const parsed = normalizeSnPhone(phone);
    if (!parsed.ok) return setError(PHONE_ERROR_FR[parsed.error]);
    if (accountName.trim().length < 2) return setError("Entre le nom exact enregistré sur ton compte.");
    setBusy(true);
    setError(null);
    const res = await api.createAccount({ provider, phone: parsed.e164, accountName: accountName.trim(), country: "SN" });
    setBusy(false);
    if (!res.ok) return setError(apiError(res.error));
    setMe(res.data);
    setNational(parsed.national);
    setPhone(formatSnPhone(parsed.national));
    setCode("");
    setResendIn(RESEND_SECONDS);
    go("sms");
  }

  async function submitCode(e?: FormEvent) {
    e?.preventDefault();
    if (code.length !== OTP_LENGTH) return;
    setBusy(true);
    setError(null);
    const res = await api.verifySms(code);
    setBusy(false);
    if (!res.ok) {
      setCode("");
      return setError(apiError(res.error));
    }
    setMe(res.data);
    go("amount");
  }

  async function submitAmount(e?: FormEvent) {
    e?.preventDefault();
    if (locked) return;
    const n = parseAmount(amount);
    if (n === null) return setError("Entre un montant en FCFA, sans décimales (par ex. 125).");
    setBusy(true);
    setError(null);
    const res = await api.confirmAmount(n);
    setBusy(false);
    if (res.ok) {
      setMe(res.data);
      setConfirmedAmount(n);
      return go("verified");
    }
    const failure = classifyAmountFailure(res, failed);
    if (failure.kind === "other") return setError(apiError(res.error));
    setFailed((f) => f + 1);
    setAmount("");
    if (failure.kind === "locked") {
      setLocked(true);
      return setError(LOCKED_FR);
    }
    const left = failure.attemptsLeft;
    setError(`Ce n'est pas le bon montant. Il te reste ${left} essai${left > 1 ? "s" : ""}.`);
  }

  const account = me.payoutAccount;
  const masked = national ? maskSnPhone(national) : (account?.phoneMasked ?? "ton numéro");
  const providerName = providerLabel(account?.provider ?? provider);

  return (
    <div lang="fr" className="flex justify-center">
      <PhoneFrame fluid time={step === "verified" ? "9:44" : step === "account" ? "9:41" : "9:42"}>
        {step === "account" && (
          <form className="flex flex-1 flex-col gap-3" onSubmit={submitAccount} noValidate>
            <StepLabel step="account" />
            <Heading>Où veux-tu être payé ?</Heading>
            <Lead>
              Connecté en tant que <b className="text-ink">@{me.user.login}</b>. Ce numéro ne sera jamais affiché sur GitHub.
            </Lead>
            <div role="radiogroup" aria-label="Opérateur" className="grid grid-cols-2 gap-1.5">
              {OFFERED_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={provider === p.id}
                  onClick={() => setProvider(p.id)}
                  className={cx(
                    "rounded-[9px] border px-1 py-2 text-center text-[13px] font-semibold transition",
                    provider === p.id ? "border-money bg-money-soft text-money" : "border-rule bg-sheet text-ink hover:bg-chip",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Field label="Pays">
              <div className="text-[15px] font-medium">🇸🇳 Sénégal</div>
            </Field>
            <Field label="Numéro" htmlFor="ob-phone">
              <div className="flex items-baseline gap-1.5 text-[15px] font-medium">
                <span className="text-muted">+221</span>
                <input
                  id="ob-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="77 412 58 30"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onBlur={() => {
                    const p = normalizeSnPhone(phone);
                    if (p.ok) setPhone(formatSnPhone(p.national));
                  }}
                  aria-invalid={!!error && !normalizeSnPhone(phone).ok}
                  className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted/60"
                />
              </div>
            </Field>
            <Field label="Nom sur le compte" htmlFor="ob-name">
              <input
                id="ob-name"
                name="accountName"
                autoComplete="name"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                className="w-full min-w-0 bg-transparent text-[15px] font-medium outline-none"
              />
            </Field>
            <ErrorLine error={error} />
            <Cta disabled={busy}>{busy ? "Envoi du code…" : "Continuer"}</Cta>
          </form>
        )}

        {step === "sms" && (
          <form className="flex flex-1 flex-col gap-3" onSubmit={submitCode} noValidate>
            <StepLabel step="sms" />
            <Heading>Code reçu par SMS</Heading>
            <Lead>Envoyé au {masked}.</Lead>
            <OtpInput value={code} onChange={(v) => setCode(sanitizeOtp(v))} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              {resendIn > 0 ? (
                <span>Renvoyer dans {formatCountdown(resendIn)}</span>
              ) : (
                <button
                  type="button"
                  className="font-semibold text-money underline-offset-2 hover:underline"
                  onClick={() => (national ? submitAccount() : go("account"))}
                >
                  Renvoyer le code
                </button>
              )}
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => go("account")}>
                Modifier le numéro
              </button>
            </div>
            <ErrorLine error={error} />
            <Cta disabled={busy || code.length !== OTP_LENGTH}>{busy ? "Vérification…" : "Vérifier"}</Cta>
          </form>
        )}

        {step === "amount" && (
          <form className="flex flex-1 flex-col gap-3" onSubmit={submitAmount} noValidate>
            <StepLabel step="amount" />
            <Heading>On vient de t&apos;envoyer un petit montant sur {providerName}</Heading>
            <Lead>Entre exactement ce que tu as reçu. Ça confirme que les paiements arrivent bien chez toi.</Lead>
            <label htmlFor="ob-amount" className="sr-only">
              Montant reçu en FCFA
            </label>
            <div className="flex items-baseline justify-center gap-2 pb-1.5 pt-4">
              <input
                id="ob-amount"
                name="amount"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                value={amount}
                disabled={locked}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d\s]/g, "").slice(0, 9))}
                className="w-[5ch] min-w-0 border-b-2 border-rule bg-transparent text-center font-display text-[2.4rem] font-extrabold leading-none tabular-nums outline-none focus:border-money disabled:opacity-50"
              />
              <span className="font-display text-[1.1rem] font-extrabold">FCFA</span>
            </div>
            <p className="text-center text-xs text-muted">
              Regarde le dernier SMS de {providerName} ou l&apos;historique de l&apos;app.
            </p>
            <ErrorLine error={error} />
            <Cta disabled={busy || locked || !amount.trim()}>{busy ? "Vérification…" : "Confirmer le montant"}</Cta>
          </form>
        )}

        {step === "verified" && account && (
          <div className="flex flex-1 flex-col gap-3">
            <span className="font-mono text-[11px] font-medium tracking-[0.05em] text-muted">COMPTE DE PAIEMENT</span>
            {confirmedAmount !== null ? (
              <>
                <Heading>On vient de t&apos;envoyer un petit montant sur {providerName}</Heading>
                <div className="pb-1.5 pt-4 text-center font-display text-[2.4rem] font-extrabold leading-none tabular-nums">
                  {confirmedAmount} <span className="text-[1.1rem]">FCFA</span>
                </div>
              </>
            ) : (
              <Heading>Tu es prêt à être payé</Heading>
            )}
            <div role="status" className="flex items-center gap-2 rounded-[10px] bg-money-soft px-3 py-2.5 text-[13px] font-semibold text-money">
              <span aria-hidden>✓</span> Paiement vérifié · prêt à recevoir des bounties
            </div>
            <dl className="grid gap-2 rounded-[10px] border border-rule px-3 py-2.5 text-[13px]">
              <Row label="Opérateur">{providerLabel(account.provider)}</Row>
              <Row label="Numéro">{national ? maskSnPhone(national) : account.phoneMasked}</Row>
              <Row label="Nom">{account.accountName}</Row>
              {account.verifiedAt && <Row label="Vérifié le">{formatDateFr(account.verifiedAt)}</Row>}
            </dl>
            <p className="text-xs leading-snug text-muted">
              Changer de numéro : reconnexion GitHub, SMS aux deux numéros et 72 h de délai, jamais pendant un paiement en cours.
            </p>
            <Link href="/explore" className={buttonClass({ size: "lg", block: true, className: "mt-auto" })}>
              Voir les bounties ouvertes
            </Link>
          </div>
        )}
      </PhoneFrame>
    </div>
  );
}

function StepLabel({ step }: { step: keyof typeof STEP_NUMBER }) {
  return (
    <span className="font-mono text-[11px] font-medium tracking-[0.05em] text-muted">
      ÉTAPE {STEP_NUMBER[step]} / {STEP_COUNT}
    </span>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h1 className="text-[1.35rem] font-extrabold leading-[1.12]">{children}</h1>;
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-[1.45] text-muted">{children}</p>;
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-px rounded-[10px] border border-rule bg-sheet px-3 py-2 focus-within:border-money">
      <label htmlFor={htmlFor} className="text-[11px] text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger">
      {error}
    </p>
  );
}

function Cta({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <Button type="submit" size="lg" block disabled={disabled} className="mt-auto">
      {children}
    </Button>
  );
}

/** Six boxes (as in the mockup) over one real input: paste, SMS autofill and screen readers all work. */
function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <div className="grid grid-cols-6 gap-1.5" aria-hidden>
        {Array.from({ length: OTP_LENGTH }, (_, i) => (
          <span
            key={i}
            className={cx(
              "grid h-[42px] place-items-center rounded-[9px] border bg-sheet font-mono text-lg font-semibold",
              i === value.length ? "border-money" : "border-rule",
            )}
          >
            {value[i] ?? ""}
          </span>
        ))}
      </div>
      <input
        aria-label="Code à 6 chiffres reçu par SMS"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={OTP_LENGTH + 4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0"
        autoFocus
      />
    </div>
  );
}
