# @bitbounty/db

Postgres 16 schema (Drizzle), SQL migrations and the demo seed. Enum values mirror `@bitbounty/core` and only grow.

## Commands (from the repo root, `DATABASE_URL` set)
| Command | What it does |
| --- | --- |
| `pnpm db:migrate` | applies the SQL migrations in `drizzle/` (safe to run again) |
| `pnpm db:seed` | replaces the demo rows, and only them, in one transaction (safe to run again). Refuses a non-local database or `NODE_ENV=production` unless `SEED_ALLOW_REMOTE=1` |
| `pnpm db:generate` | after a change to `src/schema.ts`, writes a new migration in `drizzle/` (commit it) |

The server also runs the migrations itself at start when `DATABASE_URL` is set. From built JS: `node packages/db/dist/cli/migrate.js`.

## Tables
`users`, `payout_accounts`, `installations`, `repos`, `bounties`, `fundings`, `claims`, `submissions`, `payouts`, `ledger`, `events`, `agents`.

Rules the database enforces:
- **One payout per bounty** (`payouts.bounty_id` unique, `reference` unique): retries update the row, never add one.
- **One active claim per bounty** (partial unique index), so two simultaneous `/claim`s can't both win.
- **Webhooks stored once:** `events` is unique on `(source, external_id)`; dedupe is `insert … on conflict do nothing`. With `bounty_id` set, the rows form the bounty's timeline.
- One bounty per `(repo, issue_number)`. `bounties.status` only accepts the contract's statuses.
- Money columns are integers in the smallest unit (whole FCFA, sats, kobo, USDT base units), and amounts are `> 0`.
- Lightning payouts (migration `0002`): `payouts.rail`, `lightning_address`, `amount_sats`, `xof_per_btc` (the rate, for the receipt), `payment_request`, `payment_hash`, `sent_at`, `preimage`; `payout_accounts.lightning_address`. Older mobile money columns are kept but optional.
- `bounties.funder_id` is a `users.id` or an `agents.id`, so it has no foreign key. `repos.github_repo_id` is the stable key (`full_name` changes on rename).

## Ledger convention
Every line is signed from the bounty's escrow point of view, so **the sum of a bounty's lines is the money still held for it**: `fund` + paid by the funder, `fee` − BitBounty's cut, `payout` − amount sent, `refund` − amount returned. `reserve` and `fx` lines come in pairs that net to zero.

## Seed
A demo story for the board: 3 repos owned by `Djbrl` (`sunu-wallet`, `teranga-ui`, `xof-rates`, not the live demo repo), developers with Lightning Addresses, one agent, and 9 bounties from 5 000 to 25 000 FCFA (1 unfunded, 2 funded of which one in naira, 1 claimed, 1 submitted, 1 verified, 3 paid with receipts). Each bounty has the rows its status implies (fundings, claims, submissions with a verifier report, payouts, ledger lines, events). Times are relative to when you run it.

The seed only touches rows whose id starts with `00000000-0000-4000-8000-` (fixed ids in `SEED_IDS`, `src/seed.ts`). Real bounties, webhooks and users stay. If a real user already has one of the fake developer logins, it stops before writing anything.

## Use from code
```ts
import { createDb, bounties } from "@bitbounty/db";
const { db, close } = createDb(process.env.DATABASE_URL!);
const rows = await db.select().from(bounties);
```
Consumed from `dist/`, which `pnpm install` builds (`prepare`); rebuild with `pnpm --filter @bitbounty/db build` after editing `src/`. The web app imports tables and enums only from `@bitbounty/db/schema` (no driver).

## Test
`pnpm --filter @bitbounty/db test` runs on PGlite (in-memory Postgres): migrations from an empty database, the seed, idempotence, that a reseed keeps real rows, and the constraints above. With `DATABASE_URL` set, the same suite also runs against that Postgres in a throwaway `bitbounty_test_*` database that the test creates and drops.
