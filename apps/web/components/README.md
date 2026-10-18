# Web components (W1 design base)

Every W page builds on these. Import from `@/components/ui`. Live catalogue: **`/dev`** (`pnpm --filter @bitbounty/web exec next dev -p 3100`, then http://localhost:3100/dev).

All components are server components (no `"use client"`); wrap them in your own client component when you need state.

## Tokens (`app/globals.css`)

Raw values on `:root` (`--bb-*`), flipped for dark mode (OS setting, or force with `<html data-theme="dark|light">`), exposed to Tailwind through `@theme inline`. Use the utilities, never hex codes, and dark mode comes for free.

| Utility | Meaning |
|---|---|
| `bg-paper` / `bg-sheet` | page background / card surface |
| `text-ink` / `text-muted` | main text / secondary text |
| `border-rule`, `bg-chip` | hairlines, neutral chips |
| `money`, `money-soft` | money held or landed (green) |
| `pending`, `pending-soft` | waiting for funds / on hold (amber) |
| `claim`, `claim-soft` | claimed / in progress (blue) |
| `danger`, `danger-soft` | payout failed (red) |
| `agent`, `agent-soft` | funded by an AI agent (purple, from the landing) |
| `forest`, `money-bright` | landing dark green and bright green (projector screen) |
| `on-solid` | text on a solid `money`/`danger` fill |
| `font-display` / `font-body` / `font-mono` | Bricolage Grotesque / Instrument Sans / JetBrains Mono (via `next/font`) |
| `rounded-[var(--radius-card)]` | 12 px card radius |

## Components

| Component | Props | Use |
|---|---|---|
| `Page` | `nav?: AppNavProps`, `width?: "narrow" \| "default" \| "wide"` | Page container, 16 px gutter on phones, optional top nav |
| `AppNav` | `items?: {href,label}[]`, `active?`, `initials?`, `right?: ReactNode` | Top bar (mark + links + avatar). W9 puts its sign-in button in `right` |
| `Mark` | `label?` | Green "B" tile + wordmark |
| `Section` | `eyebrow?`, `title?`, `description?`, `actions?`, `id?` | Heading block + content |
| `Card` | `emphasis?`, `padding?: "none"\|"sm"\|"md"\|"lg"`, `as?` + div attrs | White sheet, hairline border |
| `StatCard` | `label`, `value`, `sub?`, `money?`, `emphasis?` | Dashboard / profile numbers |
| `Eyebrow` | children | Mono uppercase label |
| `StatusBadge` | `status: BountyStatus`, `lang?: "en" \| "fr"`, `size?` | Bounty status pill; colour + label from `STATUS_META` |
| `STATUS_META` / `statusMeta()` | `Record<BountyStatus, {tone, label, labelFr, hint}>` | Same mapping for custom renderings (lanes on the live screen, dots) |
| `Pill` | `tone?: Tone`, `dot?`, `size?: "sm"\|"md"` + span attrs | Filters, tags, labels |
| `Dot` | `tone?`, `pulse?` | Coloured dot ("live") |
| `Tag` | children | Small square tag (language, label) |
| `Button` / `buttonClass()` | `variant?: "primary"\|"secondary"\|"ghost"\|"danger"`, `size?`, `block?` + button attrs | Actions. `buttonClass({...})` styles a `<Link>` the same way |
| `Amount` / `formatXof()` / `formatSats()` | `xof`, `size?: "sm"\|"md"\|"lg"\|"xl"`, `money?` | FCFA amounts, `62 500 F` (no `Intl`, so no hydration drift) |
| `Table`, `THead`, `TBody`, `Tr`, `Th`, `Td` | `Tr selected?`, `Td numeric?`, `Td mono?` | Bordered table, scrolls inside its border on phones |
| `PhoneFrame` | `time?`, `lock?`, `fluid?` | Phone mockup. `fluid` = real developer page: full width on phones, bezel from `sm:` |
| `PhoneNotification` | `title`, `body`, `icon?` | Wallet payout push notification (e.g. Lightning sats received) |
| `BrowserFrame` | `url` | Browser chrome mockup |
| `Avatar` | `initials`, `size?`, `color?` | Initials avatar, stable colour |
| `cx()` | class parts | Tiny class joiner |

`Tone` = `neutral | money | money-solid | pending | claim | danger | agent | ink`.

### Status mapping

| status | tone | en | fr |
|---|---|---|---|
| unfunded | pending | Awaiting funds | En attente de fonds |
| funded | money | Funded | Financé |
| claimed | claim | Claimed | Réservé |
| submitted | claim | PR submitted | PR soumise |
| verified | money | Verified | Vérifié |
| paying | money | Paying out | Paiement en cours |
| paid | money-solid | Paid | Payé |
| on_hold | pending | On hold | En pause |
| payout_failed | danger | Payout failed | Paiement échoué |
| refunded | neutral | Refunded | Remboursé |
| cancelled | neutral | Cancelled | Annulé |

`STATUS_META` is typed `Record<BountyStatus, …>`: a new status in `@bitbounty/core` fails the typecheck until it gets a badge. Tests: `components/ui/ui.test.tsx`.

## Note on `@bitbounty/core`

The web app imports the core TS source directly (`transpilePackages` + a webpack `extensionAlias` for its `.js` import specifiers, in `next.config.ts`).
