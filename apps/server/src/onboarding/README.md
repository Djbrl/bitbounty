# Developer onboarding: test payout (B3)

Proves the developer's mobile money number works before any bounty depends on it (Flow 3 in docs/product.md, page `/me`, W4).

1. `POST /api/me/payout-account/test` → `TestPayoutService.send(userId)`: sends a random **100–199 FCFA** to the linked number through Bitnob (quote → initialize → finalize, reference `test-<userId>-<n>`). The response never contains the amount.
2. The developer types what they received: `POST /api/me/payout-account/confirm {"amount": "137"}` (`"137 F"`, `"137 FCFA"` accepted).
3. Right → payout account `verified`. Wrong → `422 WRONG_AMOUNT` with `triesLeft`. **3 wrong → `423 LOCKED` for 24 h**, then a new test is needed.

| Rule | Why |
| --- | --- |
| A test only counts for the number + provider it was sent to; changing either cancels it (`409 NUMBER_CHANGED`) | a verified test on the old number must not verify a new one |
| `send()` again while a test is waiting → same test, no new payout; concurrent calls share one send | double clicks don't cost money |
| Max 3 test payouts per account (`429 TOO_MANY_TESTS`) | each one is real money in production |
| Unreadable input (`"abc"`, `"13.7"`) → `400 INVALID_AMOUNT`, doesn't use a try | typos aren't guesses |
| Bitnob error → `502 SEND_FAILED`, next send uses a new reference | a failed quote isn't reused |

Errors are `{error, code, triesLeft?, lockedUntil?}`.

## Not wired yet
`testPayoutRoutes({ service, getUserId })` isn't mounted in `app.ts`: `getUserId` comes from the GitHub session (W9) and the stores from Postgres (F3: `payout_accounts.test_amount_xof` already has the 100–199 check). In-memory stores are provided for tests and the offline demo. The SMS step (`sms_ok`) is mocked in W4.
