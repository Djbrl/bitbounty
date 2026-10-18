"use client";

import { useState, type ReactNode } from "react";
import type { DisplayCurrency, OnboardingRole, OnboardingState, UserMode } from "../../../../fixtures/types";
import { LightningAddressForm } from "../onboarding/onboarding";
import type { PayoutAccountApi } from "../onboarding/api";
import { Amount, Avatar, Button, buttonClass, Card, Chip, cx, Eyebrow, ProgressSteps } from "../ui";
import { welcomeApi, type OnboardingPatch, type WelcomeApi } from "./api";
import {
  CURRENCIES,
  initialRole,
  initialStack,
  issuesHref,
  LANGUAGES,
  modeForRole,
  PREVIEW_AMOUNT,
  SAVE_ERROR_FR,
  showsHunter,
  showsMaintainer,
  stackOptions,
  STEP_COUNT,
  toggle,
  APP_HREF,
  type Step,
} from "./logic";

export interface WelcomeFlowProps {
  initial: OnboardingState;
  intent: UserMode | null;
  step: Step;
  /** Injected in tests. */
  api?: WelcomeApi;
  addressApi?: PayoutAccountApi;
}

const ROLE_CARDS: { id: OnboardingRole; icon: string; title: string; body: string }[] = [
  { id: "maintain", icon: "🏗️", title: "Financer des issues sur mes dépôts", body: "Installez l'app GitHub, chiffrez votre backlog avec Claude et financez en sats, USDT ou naira." },
  { id: "hunt", icon: "⚡", title: "Être payé pour corriger des bugs", body: "Choisissez une issue payée, ouvrez une PR : les sats arrivent sur votre Lightning Address au merge." },
  { id: "both", icon: "🔁", title: "Les deux", body: "Un seul compte GitHub : financer sur un dépôt et corriger sur un autre." },
];

const STEP_LABELS = ["Votre rôle", "Vos préférences", "C'est parti"];

/** /welcome: 3 steps (role · preferences · setup), Back / Skip everywhere, each step saved so a reload resumes. */
export function WelcomeFlow({ initial, intent, step: initialStep, api = welcomeApi, addressApi }: WelcomeFlowProps) {
  const [state, setState] = useState(initial);
  const [step, setStep] = useState<Step>(initialStep);
  const [role, setRole] = useState<OnboardingRole | null>(() => initialRole(initial.preferences.role, intent));
  const [stack, setStack] = useState<string[]>(() => initialStack(initial));
  const [currency, setCurrency] = useState<DisplayCurrency>(initial.preferences.currency);
  const [language, setLanguage] = useState<"fr" | "en">(initial.preferences.language);
  const [repo, setRepo] = useState<string | null>(initial.preferences.repo ?? initial.installedRepos[0] ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = stackOptions(initial.githubLanguages, initial.preferences.stack);

  async function save(patch: OnboardingPatch): Promise<OnboardingState | null> {
    setBusy(true);
    setError(null);
    const res = await api.save(patch);
    setBusy(false);
    if (!res.ok) {
      setError(SAVE_ERROR_FR);
      return null;
    }
    setState(res.data);
    return res.data;
  }

  function show(next: Step) {
    setStep(next);
    setError(null);
    // The URL carries the step, so a reload lands on the same one (the server also keeps it).
    const url = new URL(window.location.href);
    url.searchParams.set("step", String(next));
    window.history.replaceState(null, "", url);
    window.scrollTo?.({ top: 0 });
  }

  async function next(patch: OnboardingPatch, to: Step) {
    if (await save({ ...patch, preferences: { ...patch.preferences, step: to } })) show(to);
  }

  async function finish() {
    if (await save({ done: true })) window.location.assign(APP_HREF);
  }

  async function stepOne() {
    // The workspace goes through U2's mode storage (cookie + users.default_mode); the rest through /api/me/onboarding.
    if (role) await api.saveMode(modeForRole(role, intent));
    await next(role ? { preferences: { role } } : {}, 2);
  }

  async function stepTwo() {
    await api.saveLang(language);
    await next({ preferences: { stack, currency, language, repo } }, 3);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start" lang="fr">
      <Card padding="lg" as="section" className="grid gap-5">
        <ProgressSteps
          label="Étapes de l'accueil"
          current={step - 1}
          steps={STEP_LABELS.map((label, i) => ({ label: <span className="max-sm:sr-only">{label}</span>, done: i + 1 < step }))}
        />
        <span className="font-mono text-[11px] font-medium tracking-[0.05em] text-muted">
          ÉTAPE {step} / {STEP_COUNT}
        </span>

        {step === 1 && (
          <>
            <Heading>Bienvenue @{state.login}, qu&apos;est-ce qui vous amène ?</Heading>
            <div role="radiogroup" aria-label="Votre rôle" className="grid gap-3">
              {ROLE_CARDS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={role === c.id}
                  data-role={c.id}
                  onClick={() => setRole(c.id)}
                  className={cx(
                    "grid grid-cols-[auto_1fr] items-start gap-3 rounded-[var(--radius-card)] border p-4 text-left transition",
                    role === c.id ? "border-money bg-money-soft" : "border-rule bg-sheet hover:border-ink",
                  )}
                >
                  <span aria-hidden className="text-2xl leading-none">
                    {c.icon}
                  </span>
                  <span className="grid gap-1">
                    <b className="text-[15px]">{c.title}</b>
                    <span className="text-[13px] leading-snug text-muted">{c.body}</span>
                  </span>
                </button>
              ))}
            </div>
            <Nav busy={busy} error={error} onNext={stepOne} nextDisabled={!role} onSkip={() => next({}, 2)} />
          </>
        )}

        {step === 2 && (
          <>
            <Heading>Faites-en votre espace</Heading>
            {showsHunter(role) && (
              <div className="grid gap-4">
                <Group label="Vos langages et votre stack" hint={initial.githubLanguages.length ? "Pré-remplis depuis vos dépôts GitHub publics." : "Choisissez ce que vous savez corriger."}>
                  <div className="flex flex-wrap gap-1.5">
                    {options.map((s) => (
                      <Chip key={s} selected={stack.some((x) => x.toLowerCase() === s.toLowerCase())} onClick={() => setStack((l) => toggle(l, s))}>
                        {s}
                      </Chip>
                    ))}
                  </div>
                </Group>
                <Group label="Afficher les montants en">
                  <Segmented name="currency" value={currency} options={CURRENCIES} onChange={setCurrency} />
                </Group>
                <Group label="Langue">
                  <Segmented name="language" value={language} options={LANGUAGES} onChange={setLanguage} />
                </Group>
              </div>
            )}
            {showsMaintainer(role) && (
              <Group label="Vos dépôts" hint="Les dépôts où l'app GitHub BitBounty est installée.">
                {initial.installedRepos.length ? (
                  <div role="radiogroup" aria-label="Dépôt" className="flex flex-wrap gap-1.5">
                    {initial.installedRepos.map((r) => (
                      <Chip key={r} role="radio" aria-checked={repo === r} selected={repo === r} onClick={() => setRepo(r)} className="font-mono">
                        {r}
                      </Chip>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-muted">Aucun dépôt pour l&apos;instant.</p>
                )}
                <a href={state.appInstallUrl} target="_blank" rel="noreferrer" className={buttonClass({ variant: "dark", size: "sm", className: "justify-self-start" })}>
                  Installer sur GitHub
                </a>
              </Group>
            )}
            <Nav busy={busy} error={error} onBack={() => show(1)} onNext={stepTwo} onSkip={() => next({}, 3)} />
          </>
        )}

        {step === 3 && (
          <>
            <Heading>Dernière étape</Heading>
            {showsHunter(role) && (
              <Group label="Où recevoir vos bounties" hint="En sats sur Lightning, quelques secondes après le merge.">
                {state.lightningAddress ? (
                  <div role="status" className="flex flex-wrap items-center gap-2 rounded-[10px] bg-money-soft px-3 py-2.5 text-[13px] font-semibold text-money">
                    <span aria-hidden>✓</span> Lightning Address vérifiée · <span className="font-mono">{state.lightningAddress}</span>
                  </div>
                ) : (
                  <LightningAddressForm api={addressApi} onSaved={(masked) => setState((s) => ({ ...s, lightningAddress: masked }))} />
                )}
              </Group>
            )}
            {showsMaintainer(role) && (
              <Group label="Votre premier bounty" hint={repo ? `Sur ${repo}.` : "Installez d'abord l'app GitHub sur un dépôt."}>
                <div className="flex flex-wrap gap-2">
                  {repo ? (
                    <>
                      <a href="/dashboard" className={buttonClass({ size: "sm" })}>
                        Chiffrer mon backlog
                      </a>
                      <a href={issuesHref(repo)} target="_blank" rel="noreferrer" className={buttonClass({ variant: "secondary", size: "sm" })}>
                        Financer une issue
                      </a>
                    </>
                  ) : (
                    <a href={state.appInstallUrl} target="_blank" rel="noreferrer" className={buttonClass({ variant: "dark", size: "sm" })}>
                      Installer sur GitHub
                    </a>
                  )}
                </div>
                <p className="text-xs text-muted">
                  Sur une issue, commentez <code className="font-mono">/bounty 10000</code> : BitBounty répond avec un lien de paiement.
                </p>
              </Group>
            )}
            <Nav busy={busy} error={error} onBack={() => show(2)} onNext={finish} nextLabel="Terminer" onSkip={finish} />
          </>
        )}
      </Card>

      <Preview login={state.login} role={role} stack={stack} currency={currency} repo={repo} address={state.lightningAddress} />
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h1 className="text-[1.5rem] font-extrabold leading-[1.15]">{children}</h1>;
}

function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="mb-1 text-[13px] font-semibold">{label}</legend>
      {hint && <p className="-mt-1 text-xs text-muted">{hint}</p>}
      {children}
    </fieldset>
  );
}

function Segmented<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <Chip key={o.id} role="radio" aria-checked={value === o.id} selected={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

function Nav(props: { busy: boolean; error: string | null; onBack?: () => void; onNext: () => void; onSkip: () => void; nextLabel?: string; nextDisabled?: boolean }) {
  return (
    <div className="grid gap-3 pt-1">
      {props.error && (
        <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger">
          {props.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {props.onBack && (
          <Button variant="secondary" onClick={props.onBack} disabled={props.busy}>
            Retour
          </Button>
        )}
        <Button onClick={props.onNext} disabled={props.busy || props.nextDisabled} className="ml-auto">
          {props.busy ? "Enregistrement…" : (props.nextLabel ?? "Continuer")}
        </Button>
        <Button variant="ghost" onClick={props.onSkip} disabled={props.busy}>
          Passer
        </Button>
      </div>
      <p className="text-xs text-muted">Tout reste modifiable plus tard dans vos réglages.</p>
    </div>
  );
}

/** Live preview of what the workspace will show (hunter card and/or the chosen repo). */
function Preview(p: { login: string; role: OnboardingRole | null; stack: string[]; currency: DisplayCurrency; repo: string | null; address: string | null }) {
  return (
    <aside aria-label="Aperçu" className="grid gap-3 max-lg:hidden">
      <Eyebrow>Aperçu</Eyebrow>
      {showsHunter(p.role) && (
        <Card className="grid gap-3">
          <div className="flex items-center gap-3">
            <Avatar initials={p.login.slice(0, 2).toUpperCase()} src={`https://github.com/${p.login}.png`} size="md" />
            <div className="grid min-w-0">
              <b className="truncate">@{p.login}</b>
              <span className="truncate font-mono text-xs text-muted">{p.address ?? "Lightning Address à ajouter"}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {p.stack.length ? p.stack.slice(0, 8).map((s) => <Chip key={s} size="sm">{s}</Chip>) : <span className="text-xs text-muted">Aucune stack choisie</span>}
          </div>
          <div className="flex items-end justify-between gap-2 border-t border-rule pt-3">
            <span className="text-xs text-muted">Exemple de bounty</span>
            <Amount {...PREVIEW_AMOUNT} currency={p.currency} money />
          </div>
        </Card>
      )}
      {showsMaintainer(p.role) && (
        <Card className="grid gap-1">
          <span className="text-xs text-muted">Dépôt</span>
          <b className="truncate font-mono text-sm">{p.repo ?? "Aucun dépôt choisi"}</b>
        </Card>
      )}
    </aside>
  );
}
