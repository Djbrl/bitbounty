# Web components (U0 design system)

One design system, taken from the landing (`Djbrl/bitbounty-landing`, `styles.css`). Every page builds on it: import from `@/components/ui`, never hard-code hex colours or fonts. Live catalogue, light and dark side by side: **`/dev/ui`** (`pnpm --filter @bitbounty/web dev -p 3100`, then http://localhost:3100/dev/ui; `/dev` redirects there).

Components are server components unless noted; wrap them in your own client component when you need state.

## Tokens (`app/globals.css`)

Raw values on `--bb-*`, redefined for dark mode, exposed to Tailwind through `@theme inline`. Use the utilities (`bg-paper`, `text-ink`, `border-rule`…) and dark mode comes for free.

- **Light everywhere** (U6): the app no longer follows the OS dark mode. Green (`money`) = primary actions, success, money; purple (`agent`, `claim`) = secondary accent (claim/PR states, focus rings, highlights). The dark palette only applies under `data-theme="dark"` on an element (`/live`, the dark panel of `/dev/ui`). Give a themed subtree `bg-paper text-ink`.
- **Dark palette** = the landing's dark band: ink page, deep-green (`#13291F`, landing ink-2) cards, line-dark hairlines, mint secondary text.
- Hex values only appear in `globals.css` and in fixed mockup colours (PhoneFrame bezel/notification, Avatar initials backgrounds).

| Utility | Landing name | Light / dark | Use |
|---|---|---|---|
| `paper` | paper | `#F5F6F3` / `#0B1F17` | page background |
| `sheet` | white | `#FFFFFF` / `#13291F` | cards |
| `ink` | ink | `#0B1F17` / `#F4F5F1` | main text |
| `ink-2` | ink-2 | `#13291F` / `#1A3528` | deep green surface |
| `ink-soft` | text-2 | `#2C4337` / `#CFE2D7` | secondary body text, nav links |
| `muted` | muted | `#5B7366` / `#9DC4AE` | captions, labels |
| `rule` | (list border) | `#E3E7E0` / `#2B4B3B` | hairlines, skeletons |
| `line-dark` | line-dark | `#2B4B3B` | borders on dark surfaces (constant) |
| `chip` | chip | `#EEF0EA` / `#1F3A2D` | chips, neutral pills |
| `mint` | mint | `#9DC4AE` | text on dark surfaces (constant) |
| `money`, `money-soft`, `money-strong` | green | `#167A45` / `#3CC77E` | money held or landed, primary buttons (`money-strong` = hover) |
| `money-bright` | green-bright | `#3CC77E` | bright green on dark surfaces, /live (constant) |
| `bright` | green-bright | `#3CC77E` / `#A7E8C4` | the Verified pill fill (paler in dark so it never matches Paid) |
| `amber`, `on-amber` | amber | `#F2A007` on `#2B1A00` | awaiting funds (solid tag, constant) |
| `pending`, `pending-soft` | (amber, text-safe) | `#855800` / `#F2B440` | on hold, warnings |
| `claim`, `claim-soft` | purple | `#7444D4` on `#F1EBFD` (light) | a developer is on it, PR submitted |
| `danger`, `danger-soft` | (app only) | red | payout failed, errors |
| `agent`, `agent-soft`, `agent-strong` | purple | `#8250DF` / `#B392F0` | funded by an AI agent (`agent-strong` = AA text on `agent-soft`) |
| `tier-bronze/silver/gold` | | darker in light for 3:1 | Avatar tier rings (U3) |
| `forest`, `on-forest` | ink | `#0B1F17` / `#F4F5F1` (constant) | always-dark surfaces: /live (also forces `data-theme="dark"`), toasts (in dark mode they sit on a same-colour page, outlined by `line-dark`) |
| `on-solid` | | white / ink | text on a solid `money`/`danger`/`claim` fill |
| `rounded-[var(--radius-card)]` / `--radius-card-lg` | | 16 px / 22 px | card radius (lg = landing `.card`) |

**Fonts** (`next/font/google` in `app/layout.tsx`, self-hosted at build): as on the landing, **headings and text are Instrument Sans** (h1–h4 default to 700 with `-0.03em` tracking), **amounts and big numbers are Bricolage Grotesque 800** (`font-display`, variable with optical size), **hashes, ids, timers and secondary amounts are JetBrains Mono** (`font-mono`). Don't put `font-display` on headings.

## Components

| Component | Props | Use |
|---|---|---|
| `Button` / `buttonClass()` | `variant?: "primary" \| "secondary" \| "ghost" \| "dark" \| "danger"`, `size?: "sm" \| "md" \| "lg"`, `block?` + button attrs | Pill buttons. primary = landing green, secondary = hairline, ghost = green text link, dark = ink pill ("Installer"). `buttonClass({...})` styles a `<Link>`/`<a>` |
| `Card` | `emphasis?`, `padding?: "none" \| "sm" \| "md" \| "lg"`, `as?` + attrs | White sheet, hairline border; `lg` gets the 22 px radius |
| `StatCard` | `label`, `value`, `sub?`, `money?`, `emphasis?` | Big Bricolage number + label |
| `Chip` | `selected?`, `onClick?`, `icon?`, `size?: "sm" \| "md"` + button attrs | Landing chip. With `selected` (true/false) it is a `<button aria-pressed>` toggle (filters, stack picker); with only `onClick` a plain button; otherwise a `<span>` label (button attrs ignored) |
| `StatusPill` | `status: BountyStatus`, `lang?: "en" \| "fr"`, `size?` | One distinct colour per bounty status (table below). `StatusBadge` is a deprecated alias |
| `STATUS_META` / `statusMeta()` | `Record<BountyStatus, {tone, label, labelFr, hint}>` | Same mapping for custom renderings (lanes, dots) |
| `Pill` | `tone?: Tone`, `dot?`, `size?` + span attrs | Free-form tag in any tone |
| `Dot` | `tone?`, `pulse?` | Coloured dot ("live") |
| `Tag` | children | Small square tag (labels on rows) |
| `Amount` / `formatXof()` / `formatSats()` / `formatNgn()` | `xof`, `sats?`, `ngn?`, `currency?: "xof" \| "ngn" \| "sats"`, `size?: "sm" \| "md" \| "lg" \| "xl"`, `money?` | FCFA big (Bricolage) + sats small (mono) when `sats` is passed. `currency` puts the user's preferred currency big and FCFA small; falls back to FCFA when that value isn't passed. No conversion inside: pass the amounts you have. Without `sats`/`ngn` it renders exactly one span, as before; with a second line, `className` goes on the wrapper |
| `Avatar` | `initials`, `src?`, `size?: "sm" \| "md" \| "lg" \| "xl"`, `color?`, `tier?: "bronze" \| "silver" \| "gold"`, `label?` | Photo or initials; `tier` draws a ring with a transparent gap. Decorative unless `label` is given |
| `ProgressSteps` | `steps: {label, done?, at?}[]`, `current?: number`, `label?` | Numbered steps joined by a rail, ✓ when done, green ring on `current`. Onboarding 1·2·3, bounty lifecycle |
| `EmptyState` | `title`, children (body), `action?`, `icon?`, `align?: "start" \| "center"` | Dashed "nothing here yet" box |
| `Skeleton` | `className` (size/shape) | Pulsing placeholder, hidden from screen readers, static with reduced motion |
| `LoadingState`, `ErrorState` | `label?` / `title?`, `message`, `action?` | Route-level loading and error screens (I1) |
| `Toast` | `tone?: "info" \| "success" \| "error"`, `title`, children, `action?`, `onClose?` | Dark notification card (landing `.notif`), `role="alert"` for errors |
| `ToastProvider` / `useToast()` | `toast({ tone, title, children, action, duration? })` | Client. Provider is mounted in `app/layout.tsx` (polite live region); call `useToast()` from any client component. `duration` ms, default 5000, 0 = sticky; 3 visible max |
| `Page` | `nav?: AppNavProps`, `width?: "narrow" \| "default" \| "wide"` | Page container, 16 px gutter on phones, optional top nav |
| `AppNav` | `items?`, `active?`, `initials?`, `right?` | Top bar (mark + links + avatar) |
| `Mark` | `label?` | Landing logo ("b" stroke + green dot) + wordmark |
| `Section` | `eyebrow?`, `title?`, `description?`, `actions?`, `id?` | Heading block + content |
| `Eyebrow` | children | Mono uppercase label |
| `Table`, `THead`, `TBody`, `Tr`, `Th`, `Td` | `Tr selected?`, `Td numeric?`, `Td mono?` | Bordered table, scrolls inside its border on phones |
| `PhoneFrame`, `BrowserFrame` | see source | Mockups (landing phone colours) |
| `PhoneNotification` | `title`, `body`, `icon?` | Wallet payout push notification (e.g. Lightning sats received) |
| `cx()` | class parts | Tiny class joiner |

`Tone` = `neutral | outline | money | money-solid | bright | pending | amber | claim | claim-solid | danger | agent | ink`.

### Status mapping

| status | tone | look | en | fr |
|---|---|---|---|---|
| unfunded | amber | solid amber (landing tag) | Awaiting funds | En attente de fonds |
| funded | money | soft green | Funded | Financé |
| claimed | claim | soft blue | Claimed | Réservé |
| submitted | claim-solid | solid blue | PR submitted | PR soumise |
| verified | bright | bright green (landing ticks), pale green in dark | Verified | Vérifié |
| paying | ink | ink pill | Paying out | Paiement en cours |
| paid | money-solid | solid green | Paid | Payé |
| on_hold | pending | soft amber | On hold | En pause |
| payout_failed | danger | soft red | Payout failed | Paiement échoué |
| refunded | neutral | grey chip | Refunded | Remboursé |
| cancelled | outline | hairline only | Cancelled | Annulé |

`STATUS_META` is typed `Record<BountyStatus, …>`: a new status in `@bitbounty/core` fails the typecheck until it gets a pill; tests check that no two statuses share a tone and that Verified and Paid stay apart in dark mode. Tests: `components/ui/ui.test.tsx`, `components/ui/design-system.test.tsx`.

## Note on `@bitbounty/core`

The web app imports the core TS source directly (`transpilePackages` + a webpack `extensionAlias` for its `.js` import specifiers, in `next.config.ts`).
