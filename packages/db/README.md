# @bitbounty/db

Postgres schema (Drizzle), SQL migrations and demo seed. Tables follow [docs/plan.md §3](../../docs/plan.md); enum values mirror `@bitbounty/core` and can only grow.

## Commands (from the repo root, `DATABASE_URL` set)
| Command | What it does |
| --- | --- |
| `pnpm db:migrate` | applies the SQL migrations in `drizzle/` (safe to run again) |
| `pnpm db:seed` | **empties every table**, then inserts the demo data, in one transaction. Refuses a non-local database or `NODE_ENV=production` unless `SEED_ALLOW_REMOTE=1` |
| `pnpm db:generate` | after a change to `src/schema.ts`, writes a new migration in `drizzle/` (commit it) |

## Tables
`users`, `payout_accounts`, `installations`, `repos`, `bounties`, `fundings`, `claims`, `submissions`, `payouts`, `ledger`, `events`, `agents`.

Rules the database enforces:
- `events`: one row per `(source, external_id)` (unique index `events_source_external_id_uq`). Webhook dedupe = `insert ... on conflict do nothing`. Columns follow the server's `DrizzleEventStore` (F6): serial `id`, `type`/`action`/`repo`/`installation_id`, `payload`, `status` `received|processed|failed`, `error`, `received_at`, `processed_at`; `bounty_id` (nullable) makes it the bounty timeline.
- **One payout per bounty** (`payouts.bounty_id` unique, `reference` = `pay-<bountyId>` unique): retries update the row, they never add one.
- **B6 Lightning payouts** (migration `0002_b6_lightning_payouts`): `payouts.rail` (`mobile_money` for older rows, `lightning`), and the current attempt's `lightning_address`, `amount_sats` (> 0), `xof_per_btc` (the rate, for the receipt), `payment_request`, `payment_hash`, `invoice_expires_at`, `sent_at`, `preimage`. `payout_accounts.lightning_address` (lower-case `user@domain`); the mobile money columns are now optional, but an account needs a Lightning Address or a phone.
- **One active claim per bounty** (partial unique index): two `/claim` at the same time can't both win.
- One bounty per `(repo, issue_number)`. One payout account per phone number (E.164, e.g. `+221770000001`).
- `bounties.status` only accepts the contract's statuses.
- Money columns are integers in the smallest unit (whole FCFA, sats, kobo, USDT base units); amounts are `> 0`, attempts `>= 0`, spam score in `[0, 1]`, test amount in `[100, 199]`.
- `bounties.funder_id` is a `users.id` (human) or an `agents.id` (agent), so it has no foreign key.
- `repos.github_repo_id` is the stable key (webhooks carry it); `full_name` changes on rename.

## Ledger convention
Every line is signed from the bounty's escrow point of view, so **the sum of a bounty's lines is the money still held for it**:
`fund` +total paid by the funder · `fee` −BitBounty's cut · `payout` −amount sent · `refund` −amount returned.
A funded bounty sums to `amount_xof`; a paid or refunded one to 0. `reserve` and `fx` are internal moves recorded in pairs that net to zero.

## Seed
One demo repo (`bitbounty-demo/bitnob-sdk`), 3 users (`fatou-maintainer`, `awa-dev` on Wave and `moussa-dev` on Orange Money, both verified), one agent, and **one bounty in each of the 11 statuses**. Each bounty has the rows its status implies: fundings, claims, submissions with a verifier report, payouts, ledger lines, and a timeline of events (`bounty.created`, `funding.paid`, `claim.created`, `pr.linked`, `verify.done`, `pr.merged`, `payout.*`…). Open bounties carry the 60-day `expires_at`. Ids are fixed (`SEED_IDS` in `src/seed.ts`), so pages and tests can link to them.

## Use from code
```ts
import { createDb, bounties } from "@bitbounty/db";
const { db, close } = createDb(process.env.DATABASE_URL!);
const rows = await db.select().from(bounties);
```
It is consumed from `dist/`, which `pnpm install` builds (`prepare`); rebuild with `pnpm --filter @bitbounty/db build` after editing `src/`. The web app imports tables and enums only from `@bitbounty/db/schema` (no driver).

The server (`apps/server`) depends on it: `DrizzleEventStore` writes webhooks to `events`, `DrizzleBountyRepo` (apps/server/src/bounties/drizzle-repo.ts) stores bounties, claims and submissions, and `src/index.ts` runs `runMigrations()` at start when `DATABASE_URL` is set.

## Deploy
The server applies migrations at start (Docker and Railway alike). To run them by hand from built JS: `node packages/db/dist/cli/migrate.js`.

## Tests
`pnpm test` runs on PGlite (an in-memory Postgres), no database or Docker needed: migrations from an empty database, seed, idempotence, and the constraints above.

With `DATABASE_URL` set, the same suite also runs against that real Postgres, inside a throwaway database (`bitbounty_test_*`) that the test creates and drops, so your dev data is untouched. Without it, that half is skipped:
```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/bitbounty pnpm --filter @bitbounty/db test   # 48 passed
```
