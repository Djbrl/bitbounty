# Developer onboarding: test payout (B3)

Proves the developer's mobile money number works before any bounty depends on it (Flow 3 in docs/product.md, page `/me`, W4).

The HTTP contract is W4's (apps/web/components/onboarding/api.ts, mirrored by the mock in apps/web/lib/mock-api.ts):

1. `POST /api/me/payout-account/sms {"code": "424242"}`: the code is checked by the injected `checkSmsCode` (the SMS sender isn't B3). Code OK → account `sms_ok`, then `TestPayoutService.smsVerifiedThenSend(userId)` sends a random **100–199 FCFA** through Bitnob (quote → initialize → finalize, reference `test-<userId>-<n>`). Returns `Me` + `testPayoutSent: true`. Wrong code → `422 {error:"wrong_code"}`.
2. The developer types what they received: `POST /api/me/payout-account/confirm {"amount": 137}` (`"137 F"`, `"137 FCFA"` accepted).
3. Right → `200` with `Me` (`payoutAccount.status = "verified"`). Wrong → `422 {error:"wrong_amount", attemptsLeft}`. **3 wrong → `423 {error:"locked", lockedUntil}` for 24 h**, then a new test is needed.

Responses never contain the test amount or the full number (`payoutAccount.phoneMasked`, e.g. `+221 77 ••• •• 67`).

| Rule | Why |
| --- | --- |
| `send()` needs the account in `sms_ok` (`409 sms_not_verified`) | no money goes out before the SMS step |
| All send/confirm calls for one user go through a per-user queue | 100 parallel guesses can't all read "0 wrong tries" and beat the lock |
| A test only counts for the number + provider it was sent to; changing either cancels it (`409 number_changed`) | a verified test on the old number must not verify a new one |
| Sending again while a test is waiting → same test, no new payout | double clicks don't cost money |
| Max 3 test payouts per account (`429 too_many_tests`); **failed sends don't count** | each one is real money in production |
| Bitnob error → `502 send_failed` with a generic message (raw error kept in the store + logs); `POST /sms` again resends with a new reference | Bitnob's internals don't reach the browser; a failed quote isn't reused |
| Unreadable input (`"abc"`, `"13.7"`) → `400 invalid_amount`, doesn't use a try | typos aren't guesses |

Errors are `{error, message, attemptsLeft?, lockedUntil?}` with `error` in snake_case (what the W4 page switches on).

## Limits and not wired yet
- The per-user queue is **in-process**. With more than one server instance, the store must do the check-and-update atomically (row lock or `UPDATE … WHERE wrong_tries = $n`).
- `InMemoryPayoutAccountStore` / `InMemoryTestPayoutStore` are single-process and in memory (tests, offline demo). **F3 has no table for test payouts yet**; `payout_accounts.test_amount_xof` (with the 100–199 check) exists, a `test_payouts` table (reference, amount, status, wrong_tries, error) is still needed for Postgres.
- `testPayoutRoutes({ service, getUserId, checkSmsCode, getMe })` isn't mounted in `app.ts`: `getUserId` comes from the GitHub session (W9), `checkSmsCode` from the SMS sender, `getMe` from `GET /api/me`. `POST /api/me/payout-account` (create the account, send the SMS) isn't B3.
