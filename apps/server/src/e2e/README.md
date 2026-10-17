# End-to-end run (I2)

One script plays the whole story, start to finish, on an empty database:

**`/bounty` → fund → `/claim` → PR "Fixes #1" → BitBounty check (pass) → merge → payout → paid**

```bash
pnpm --filter @bitbounty/server e2e                    # offline fakes, 3 runs in a row
pnpm --filter @bitbounty/server e2e -- --sandbox       # real Bitnob sandbox (keys in .env), naira funding
pnpm --filter @bitbounty/server e2e -- --sandbox --fund=lightning   # prints an invoice to pay from a sandbox wallet
# options: --runs=3 --phone=+221… --provider=wave|orange --name="Awa Diop" --amount=300
```
It's also a test (`test/e2e.test.ts`, 3 runs + the Lagos route), so `pnpm test` guards the full path on every change.

## What's real and what's simulated
| Part | In the run |
| --- | --- |
| Webhook receivers (F6, B5), commands (G1–G3), PR detection (G4), check run (A2), verifier pipeline (A1), funding (B1/B4), payouts (B2), settlement | **the real modules**, wired like `src/app.ts` |
| GitHub | simulated: **signed** `issue_comment` / `pull_request` webhooks into the real receiver; comments, labels and check runs go to an in-memory fake API |
| The verifier's model | a scripted answer (both criteria met), so the run doesn't depend on Claude |
| Bitnob | `FakeBitnob` offline, or the **real sandbox** with `--sandbox` (invoice or naira account + simulated deposits + NGN→BTC order, payout quote → initialize → finalize, polled until paid) |
| Database | a fresh in-memory repo per run, and a unique repo name (`bitbounty-e2e/demo-<id>`) |

Each step checks the bounty's status, and the run checks the internal events come in this order:
`bounty.created → funding.paid → claim.created → pr.linked → verify.done → pr.merged → payout.started → payout.succeeded`, and that the issue ends with the `bounty: paid` label.

## Settlement (the glue it needed)
`src/settlement/`: nobody was listening after the PR. `Settlement` now does it, in the harness and in `app.ts`:
- `verify.done` → records the verdict on the `submitted` bounty (before, `pr.merged` always saw `verdict: null` → `on_hold`);
- merge or `/pay` that leaves the bounty `verified` → `PayoutService.start()` after `OBJECTION_WINDOW_MINUTES` (0 by default);
- B2's `payout.*` → `paying` / `paid` / `payout_failed` through `transition()`, then published;
- funding, PR and payout events → status comment re-rendered.
Where to pay comes from `PAYOUT_ACCOUNTS` (by GitHub login) until W4/B3 store verified accounts.

Also: A2's `RepoBountyLookup` falls back to the issue's "Done when" criteria when the bounty has none. `/bounty` creates bounties without criteria, so before this the verifier could only answer `unsure` and nothing was ever paid automatically.
