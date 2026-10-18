# Onboarding

`profileRoutes` (mounted in `app.ts`) back the web's `/welcome` and `/me`. Same identity as `/api/me`: the web sends `INTERNAL_API_TOKEN` and the signed-in login in `X-BitBounty-User`.

| Route | What |
| --- | --- |
| `GET /api/me/onboarding` | answers so far (role, stack, currency `xof\|ngn\|sats`, language `fr\|en`, repo, step), `onboardedAt`, the default workspace, the Lightning Address **masked**, the user's top GitHub languages (public API, cached 6 h, `[]` on failure), and the repos where the GitHub App is installed |
| `POST /api/me/onboarding {preferences?, done?}` | saves the answers; `done: true` sets `users.onboarded_at` once |
| `POST /api/me/lightning-address {lightningAddress}` | `400 invalid_lightning_address` if not `user@domain`; `422 lightning_address_unreachable` if LNURL-pay can't be resolved (nothing saved); otherwise saved on `payout_accounts.lightning_address` and returned masked |

Storage: `DrizzleProfileStore` (`users.preferences` jsonb) with `DATABASE_URL`, else `InMemoryProfileStore`.

Payouts look up the developer's address in `PAYOUT_ACCOUNTS` first, then the address saved here (`payeeWithFallback` in `app.ts`).

`test-payout.ts` and `routes.ts` hold an earlier onboarding step (an SMS code, then a small mobile money test payment). It was dropped with mobile money payouts and is not mounted.

Tests: `pnpm --filter @bitbounty/server test` (the Postgres store test runs only when `DATABASE_URL` is set).
