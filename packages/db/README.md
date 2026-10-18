# @bitbounty/db

Postgres schema (Drizzle), SQL migrations and demo seed. Tables follow [docs/plan.md §3](../../docs/plan.md); enum values mirror `@bitbounty/core` and can only grow.

## Commands (from the repo root, `DATABASE_URL` set)
| Command | What it does |
| --- | --- |
| `pnpm db:migrate` | applies the SQL migrations in `drizzle/` (safe to run again) |
| `pnpm db:seed` | replaces the demo rows (and only them, see Seed below), in one transaction. Safe to run again. Refuses a non-local database or `NODE_ENV=production` unless `SEED_ALLOW_REMOTE=1` |
| `pnpm db:generate` | after a change to `src/schema.ts`, writes a new migration in `drizzle/` (commit it) |

## Tables
`users`, `payout_accounts`, `installations`, `repos`, `bounties`, `fundings`, `claims`, `submissions`, `payouts`, `ledger`, `events`, `agents`.

Rules the database enforces:
- `events`: one row per `(source, external_id)` (unique index `events_source_external_id_uq`). Webhook dedupe = `insert ... on conflict do nothing`. Columns follow the server's `DrizzleEventStore` (F6): serial `id`, `type`/`action`/`repo`/`installation_id`, `payload`, `status` `received|processed|failed`, `error`, `received_at`, `processed_at`; `bounty_id` (nullable) makes it the bounty timeline.
- **One payout per bounty** (`payouts.bounty_id` unique, `reference` = `pay-<bountyId>` unique): retries update the row, they never add one.
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
A demo story for the board, in the Lightning era (developers are paid in sats to a Lightning Address):
- **3 repos** owned by `Djbrl`: `sunu-wallet` (a Lightning wallet), `teranga-ui` (a component kit), `xof-rates` (an FCFA rates API). These are not the live demo repo (`Djbrl/bitbounty-demo`, see [docs/demo/demo-repo.md](../../docs/demo/demo-repo.md)), so seeded bounties never collide with the issues used on stage.
- **People**: `Djbrl` funds most bounties (signed in, his `/dashboard` shows them); developers `awa-diop` (`awadiop@blink.sv`), `moussa-ndiaye` (`moussa@walletofsatoshi.com`) and `fatou-sall` (`fatousall@blink.sv`), all verified; `chidi-okafor`, a funder in Lagos.
- **An agent** (`ci-triage-agent`, A4) that funded the flaky-test bounty.
- **9 bounties**, 5 000–25 000 FCFA: 1 open (unfunded), 2 funded (one paid in naira from Lagos), 1 claimed, 1 submitted (the Wolof translation, verifier `unsure`), 1 verified, 3 paid with a succeeded payout and receipt (2–3 minutes from merge to paid). **No failed payout**: the failure paths are shown by the I3 script (`apps/server/src/e2e/failure-paths.ts`), which does not use the seed.

Each bounty has the rows its status implies: fundings (sats or kobo), claims, submissions with a verifier report, payouts, ledger lines, and events (`bounty.created`, `funding.paid`, `claim.created`, `pr.linked`, `verify.done`, `pr.merged`, `payout.sent`, `payout.succeeded`). Times are relative to when you run it (the last 2 days). Open bounties carry the 60-day `expires_at`. Ids are fixed (`SEED_IDS` in `src/seed.ts`), so pages and tests can link to them.

**Re-runnable and non-destructive.** Every seeded id starts with `00000000-0000-4000-8000-`. The seed first deletes rows with that prefix (from this seed or any older one) and nothing else, then inserts. Real bounties, webhooks and users written by the live server stay; a seeded user, repo or installation that real rows point at is kept. It reuses the `Djbrl` user and installation if the server already stored them.

**Lightning columns.** When the database has B6's columns (`payout_accounts.lightning_address`, `payouts.amount_sats`…, migration `0002`), the seed fills them: accounts become Lightning-only and the paid payouts carry `rail = lightning`, the address, the sats, the rate (`SEED_XOF_PER_BTC`), and a payment hash that is the SHA-256 of the stored preimage. Without them, accounts keep a placeholder phone and that step is skipped (the seed prints `lightningColumns: false`).

To reseed the database of the Docker stack (from the repo root, after `corepack pnpm install`):
```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/bitbounty corepack pnpm --filter @bitbounty/db db:seed
```

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
`pnpm test` runs on PGlite (an in-memory Postgres), no database or Docker needed: migrations from an empty database, the seed story, idempotence, that a reseed keeps real rows and removes an older seed's, and the constraints above.

With `DATABASE_URL` set, the same suite also runs against that real Postgres, inside a throwaway database (`bitbounty_test_*`) that the test creates and drops, so your dev data is untouched. Without it, that half is skipped:
```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/bitbounty pnpm --filter @bitbounty/db test   # 54 passed
```
