# End-to-end runs

## The happy path
One script plays the whole story on an empty store:

**`/bounty` → fund → `/claim` → PR "Fixes #1" → BitBounty check (pass) → merge → payout → paid**

```sh
pnpm --filter @bitbounty/server e2e                                  # offline fakes, 3 runs in a row
pnpm --filter @bitbounty/server e2e -- --sandbox                     # real Bitnob sandbox (keys in .env), naira funding
pnpm --filter @bitbounty/server e2e -- --sandbox --fund=lightning
# options: --runs=3 --address=awa@blink.sv --amount=300
```
With `--sandbox` the payout step fails: our sandbox account refuses `send_lightning` (see [payouts](../payouts/README.md)).

| Part | In the run |
| --- | --- |
| Webhook receivers, commands, PR detection, check run, verifier pipeline, funding, settlement, payouts | the real modules, wired like `src/app.ts` |
| GitHub | signed `issue_comment` / `pull_request` webhooks into the real receiver; comments, labels and check runs go to an in-memory fake |
| The verifier's model | a scripted answer (both criteria met) |
| Bitnob | `FakeBitnob`, or the real sandbox with `--sandbox` |

Each step checks the bounty's status and the order of internal events:
`bounty.created → funding.paid → claim.created → pr.linked → verify.done → pr.merged → payout.started → payout.succeeded`, ending with the `bounty: paid` label. `test/e2e.test.ts` runs it on every `pnpm test`.

## Failure paths
`failure-paths.ts` plays two failures with the same modules and checks what GitHub and the web show:

| Scenario | What happens |
| --- | --- |
| Payout retry | attempt 1 fails at Bitnob → `payout_failed`, comment "The money stays reserved for them" → automatic retry → `paid` with a receipt |
| Claim expiry | `/claim` and no PR before the deadline → `claim.expired`, developer unassigned, back to `funded` → another developer claims it |

```sh
pnpm --filter @bitbounty/server demo:failures                  # both scenarios, prints each step and the final comments
pnpm --filter @bitbounty/server demo:failures -- --serve=8787  # slow version with the read API on :8787
```
`test/failure-paths.test.ts` runs both on every `pnpm test`.

## Settlement rules (`src/settlement/`)
- `verify.done` records the verdict on the bounty. A merge (or `/pay`) that leaves it `verified` starts the payout after `OBJECTION_WINDOW_MINUTES` (default 0, checked at boot: 0 to 35791, anything else refuses to start).
- When the window ends, the bounty is read again and paid only if still `verified`. `/hold` or `/reject` during the window cancel it.
- A bounty moves to `paying` before any Bitnob call, so a restart can't pay twice. Window timers are in memory: after a restart a bounty can stay `verified`; a maintainer then types `/hold` then `/pay`.
- The public status comment shows a short failure reason, never the raw error.
- If the issue has no stored criteria, the verifier reads its "Done when" list.
- Claim length: `CLAIM_TTL_MINUTES` (default 72 h).
