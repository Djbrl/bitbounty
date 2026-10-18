import type { BountyStatus, FundingRail, PayoutProvider, Verdict } from "@bitbounty/core";
import type { Lang } from "./format.js";
import type { PayoutFailureReason } from "./render.js";

/**
 * Every word of the status comment, per language. Arguments arrive already
 * escaped / formatted: copy never sees raw user text.
 */
export interface Copy {
  pill: Record<BountyStatus, string>;
  steps: readonly [string, string, string, string, string];
  issueLine: (issue: string, title: string) => string;
  noCriteria: string;
  moreCriteria: (n: number) => string;
  fundCta: string;
  fundedHeld: (amount: string, sats: string | null, rail: string | null, at: string | null) => string;
  claimedBy: (who: string, until: string) => string;
  submitted: (pr: string, who: string | null) => string;
  verdictPending: string;
  verdict: Record<Verdict, string>;
  verdictNote: string;
  riskFlags: (flags: string) => string;
  validated: (until: string | null) => string;
  paying: (amount: string, who: string, provider: string) => string;
  paid: (amount: string, who: string, provider: string) => string;
  reference: (ref: string) => string;
  receipt: string;
  holdReason: (reason: string) => string;
  onHold: string;
  payoutFailed: (who: string) => string;
  lastError: (err: string, attempts: number | null) => string;
  /** Short public reasons a payout failed (I3): never the raw error. */
  payoutReasons: Record<PayoutFailureReason, string>;
  refunded: (amount: string) => string;
  cancelled: string;
  nextLabel: string;
  next: {
    unfundedNoCriteria: string;
    unfunded: string;
    funded: (meUrl: string) => string;
    claimed: (who: string, issue: string) => string;
    submittedPending: (pr: string) => string;
    submitted: (pr: string) => string;
    verified: string;
    paying: string;
    paid: (who: string) => string;
    onHold: string;
    /** Failed for a reason the developer can't fix (Bitnob down, expired…): nothing to do. */
    payoutFailed: string;
    payoutFailedFinal: (who: string) => string;
    /** Failed because the developer has no usable payout account. */
    payoutAccount: (who: string, meUrl: string) => string;
    payoutAccountFinal: (who: string, meUrl: string) => string;
    closed: string;
  };
  bountyPage: string;
  footer: string;
  provider: Record<PayoutProvider, string>;
  rail: Record<FundingRail, string>;
}

const PROVIDER = { wave: "Wave", orange: "Orange Money", free: "Free Money" } as const;

const en: Copy = {
  pill: {
    unfunded: "⏳ Waiting for funding",
    funded: "✅ Funded · held in escrow",
    claimed: "🔒 Claimed",
    submitted: "📝 Submitted",
    verified: "✔ Validated",
    paying: "💸 Paying",
    paid: "💸 Paid",
    on_hold: "⏸ On hold",
    payout_failed: "⚠️ Payout failed",
    refunded: "↩️ Refunded",
    cancelled: "✖ Cancelled",
  },
  steps: ["Funded", "Claimed", "PR", "Validated", "Paid"],
  issueLine: (issue, title) => `Bounty on **${issue}** · ${title}`,
  noCriteria: "_Acceptance criteria: the issue's **Done when** list. Claude checks the PR against it._",
  moreCriteria: (n) => `_…and ${n} more on the bounty page._`,
  fundCta: "Fund this bounty →",
  fundedHeld: (amount, sats, rail, at) =>
    `**${amount}** held in escrow${sats ? ` (${sats})` : ""}${rail ? ` · paid via ${rail}` : ""}${at ? ` · ${at}` : ""}.`,
  claimedBy: (who, until) => `${who} is on it, claim held until **${until}**.`,
  submitted: (pr, who) => `${pr}${who ? ` by ${who}` : ""} is linked to this issue.`,
  verdictPending: "🤖 **Claude:** checking the PR against the criteria…",
  verdict: {
    pass: "🤖 **Claude:** ✅ looks like every criterion is met.",
    fail: "🤖 **Claude:** ❌ at least one criterion looks unmet.",
    unsure: "🤖 **Claude:** 🤔 not sure, a human should look.",
  },
  verdictNote: "_Claude's verdict is a signal only. The maintainer decides._",
  riskFlags: (flags) => `Flags: ${flags}`,
  validated: (until) =>
    until ? `Merged and validated. Objection window until **${until}**.` : "Merged and validated.",
  paying: (amount, who, provider) => `Sending **${amount}** to ${who} on ${provider}…`,
  paid: (amount, who, provider) => `**${amount}** paid to ${who} on ${provider}`,
  reference: (ref) => `Ref \`${ref}\``,
  receipt: "Receipt →",
  holdReason: (reason) => `Reason: ${reason}`,
  onHold: "Payment is paused until the maintainer decides.",
  payoutFailed: (who) => `The payout to ${who} didn't go through. The money stays reserved for them.`,
  lastError: (err, attempts) => `Last error${attempts ? ` (attempt ${attempts})` : ""}: ${err}`,
  payoutReasons: {
    unreachable: "Bitnob didn't answer",
    expired: "Bitnob reported the payment expired",
    rejected: "Bitnob refused the payment",
    no_account: "the developer hasn't set a payout account yet",
    setup: "a payout setup problem on BitBounty's side",
    other: "the payment didn't complete",
    wallet_unreachable: "the developer's Lightning wallet didn't answer",
    wallet_refused: "the developer's Lightning Address can't receive this payment",
  },
  refunded: (amount) => `**${amount}** went back to the funder.`,
  cancelled: "This bounty was cancelled before it was funded.",
  nextLabel: "**Next:**",
  next: {
    unfundedNoCriteria:
      "fund it with the link above (list the acceptance criteria under **Done when** in the issue). Developers can `/claim` once the money is held.",
    unfunded: "fund it with the link above. Developers can `/claim` once the money is held.",
    funded: (meUrl) =>
      `comment \`/claim\` to take it. You need a payout account at ${meUrl}. Paid to Wave, Orange Money or Free Money within minutes of the merge.`,
    claimed: (who, issue) =>
      `${who}, open a PR with \`Fixes ${issue}\` before the deadline. Need more time? \`/extend\` (once). Giving up? \`/unclaim\`.`,
    submittedPending: (pr) =>
      `maintainer, review ${pr}. Merging it pays automatically if Claude says ✅ and CI is green. Otherwise \`/pay\`, \`/hold\` or \`/reject <reason>\`.`,
    submitted: (pr) =>
      `maintainer, merge ${pr} to pay automatically (needs Claude ✅ and CI green), or decide yourself: \`/pay\`, \`/hold\` or \`/reject <reason>\`.`,
    verified: "nothing to do, the payout leaves after the window. Maintainer: `/pay now` to skip the wait, `/hold` to stop it.",
    paying: "nothing to do. This comment updates when the money lands.",
    paid: (who) => `nothing. Done, thank you ${who}!`,
    onHold: "maintainer, `/pay` to release the money or `/reject <reason>` to reopen the bounty for claims.",
    payoutFailed: "nothing to do. We retry automatically.",
    payoutFailedFinal: (who) =>
      `no more automatic retries. The money stays reserved for ${who}; maintainer, contact BitBounty to sort out the payout.`,
    payoutAccount: (who, meUrl) => `${who}, set your payout account at ${meUrl}. We retry automatically.`,
    payoutAccountFinal: (who, meUrl) =>
      `${who}, set your payout account at ${meUrl}. No more automatic retries: the money stays reserved for you, ask the maintainer to contact BitBounty once it's set.`,
    closed: "nothing. This bounty is closed.",
  },
  bountyPage: "Bounty page",
  footer: "BitBounty · paid in FCFA to Wave, Orange Money or Free Money",
  provider: PROVIDER,
  rail: { lightning: "Lightning", usdt: "USDT", ngn: "bank transfer (NGN)" },
};

const fr: Copy = {
  pill: {
    unfunded: "⏳ En attente de financement",
    funded: "✅ Financée · fonds bloqués",
    claimed: "🔒 Réservée",
    submitted: "📝 PR soumise",
    verified: "✔ Validée",
    paying: "💸 Paiement en cours",
    paid: "💸 Payée",
    on_hold: "⏸ En pause",
    payout_failed: "⚠️ Échec du paiement",
    refunded: "↩️ Remboursée",
    cancelled: "✖ Annulée",
  },
  steps: ["Financée", "Réservée", "PR", "Validée", "Payée"],
  issueLine: (issue, title) => `Prime sur **${issue}** · ${title}`,
  noCriteria: "_Critères d'acceptation : la liste **Done when** de l'issue. Claude vérifie la PR par rapport à elle._",
  moreCriteria: (n) => `_…et ${n} de plus sur la page de la prime._`,
  fundCta: "Financer cette prime →",
  fundedHeld: (amount, sats, rail, at) =>
    `**${amount}** bloqués en séquestre${sats ? ` (${sats})` : ""}${rail ? ` · payé via ${rail}` : ""}${at ? ` · ${at}` : ""}.`,
  claimedBy: (who, until) => `${who} s'en occupe, réservation jusqu'à **${until}**.`,
  submitted: (pr, who) => `${pr}${who ? ` de ${who}` : ""} est liée à cette issue.`,
  verdictPending: "🤖 **Claude :** vérification de la PR par rapport aux critères…",
  verdict: {
    pass: "🤖 **Claude :** ✅ tous les critères semblent remplis.",
    fail: "🤖 **Claude :** ❌ au moins un critère semble non rempli.",
    unsure: "🤖 **Claude :** 🤔 pas sûr, un humain doit regarder.",
  },
  verdictNote: "_L'avis de Claude n'est qu'un signal. C'est le mainteneur qui décide._",
  riskFlags: (flags) => `Alertes : ${flags}`,
  validated: (until) =>
    until
      ? `Mergée et validée. Délai d'objection jusqu'à **${until}**.`
      : "Mergée et validée.",
  paying: (amount, who, provider) => `Envoi de **${amount}** à ${who} sur ${provider}…`,
  paid: (amount, who, provider) => `**${amount}** payés à ${who} sur ${provider}`,
  reference: (ref) => `Réf. \`${ref}\``,
  receipt: "Reçu →",
  holdReason: (reason) => `Motif : ${reason}`,
  onHold: "Le paiement est en pause jusqu'à la décision du mainteneur.",
  payoutFailed: (who) =>
    `Le paiement à ${who} n'est pas passé. L'argent lui reste réservé.`,
  lastError: (err, attempts) => `Dernière erreur${attempts ? ` (tentative ${attempts})` : ""} : ${err}`,
  payoutReasons: {
    unreachable: "Bitnob n'a pas répondu",
    expired: "Bitnob a signalé que le paiement a expiré",
    rejected: "Bitnob a refusé le paiement",
    no_account: "le développeur n'a pas encore de compte de paiement",
    setup: "un problème de configuration des paiements chez BitBounty",
    other: "le paiement n'a pas abouti",
    wallet_unreachable: "le portefeuille Lightning du développeur n'a pas répondu",
    wallet_refused: "l'adresse Lightning du développeur ne peut pas recevoir ce paiement",
  },
  refunded: (amount) => `**${amount}** rendus au financeur.`,
  cancelled: "Cette prime a été annulée avant d'être financée.",
  nextLabel: "**Prochaine étape :**",
  next: {
    unfundedNoCriteria:
      "financez-la avec le lien ci-dessus (listez les critères d'acceptation sous **Done when** dans l'issue). Les devs pourront faire `/claim` dès que l'argent est bloqué.",
    unfunded: "financez-la avec le lien ci-dessus. Les devs pourront faire `/claim` dès que l'argent est bloqué.",
    funded: (meUrl) =>
      `commentez \`/claim\` pour la prendre. Il faut un compte de paiement sur ${meUrl}. Payé sur Wave, Orange Money ou Free Money quelques minutes après le merge.`,
    claimed: (who, issue) =>
      `${who}, ouvrez une PR avec \`Fixes ${issue}\` avant l'échéance. Besoin de plus de temps ? \`/extend\` (une fois). Vous abandonnez ? \`/unclaim\`.`,
    submittedPending: (pr) =>
      `mainteneur, relisez ${pr}. Le merge paie automatiquement si Claude dit ✅ et que la CI est verte. Sinon \`/pay\`, \`/hold\` ou \`/reject <motif>\`.`,
    submitted: (pr) =>
      `mainteneur, mergez ${pr} pour payer automatiquement (Claude ✅ et CI verte), ou décidez vous-même : \`/pay\`, \`/hold\` ou \`/reject <motif>\`.`,
    verified:
      "rien à faire, le paiement part après le délai. Mainteneur : `/pay now` pour ne pas attendre, `/hold` pour l'arrêter.",
    paying: "rien à faire. Ce commentaire se met à jour dès que l'argent arrive.",
    paid: (who) => `rien. C'est fini, merci ${who} !`,
    onHold:
      "mainteneur, `/pay` pour débloquer l'argent ou `/reject <motif>` pour rouvrir la prime aux réservations.",
    payoutFailed: "rien à faire. Nous réessayons automatiquement.",
    payoutFailedFinal: (who) =>
      `plus de nouvel essai automatique. L'argent reste réservé à ${who} ; mainteneur, contactez BitBounty pour régler le paiement.`,
    payoutAccount: (who, meUrl) => `${who}, configurez votre compte de paiement sur ${meUrl}. Nous réessayons automatiquement.`,
    payoutAccountFinal: (who, meUrl) =>
      `${who}, configurez votre compte de paiement sur ${meUrl}. Plus de nouvel essai automatique : l'argent vous reste réservé, demandez au mainteneur de contacter BitBounty une fois fait.`,
    closed: "rien. Cette prime est close.",
  },
  bountyPage: "Page de la prime",
  footer: "BitBounty · payé en FCFA sur Wave, Orange Money ou Free Money",
  provider: PROVIDER,
  rail: { lightning: "Lightning", usdt: "USDT", ngn: "virement bancaire (NGN)" },
};

export const COPY: Readonly<Record<Lang, Copy>> = { en, fr };
