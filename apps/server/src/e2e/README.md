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

### Safety rules (review of #85)
- **The objection window re-checks.** When the timer fires, the bounty is read again and the payout starts only if it is still `verified`. `/hold` or `/reject` during the window cancel the timer; `/hold` then `/pay` starts a new window and pays once. A redelivered merge replaces the pending timer, it doesn't add one.
- **`OBJECTION_WINDOW_MINUTES` is checked at boot:** a number of minutes from 0 to 35791 (Node's timer limit), empty = 0. Anything else (`abc`, `-5`, `1e3`) and the server refuses to start, instead of paying at once.
- **No `PAYOUT_ACCOUNTS` entry for the developer** fails the payout on the first attempt (`PayoutConfigError`, not retried), with the reason in `lastError`. Add the entry, then retry the payout.
- **Restarts.** The payout store (`InMemoryPayoutStore`) and the window timers are **in memory** in `app.ts`; B6 (#86) persists them. What a restart can't do: pay twice. `payout.started` moves the bounty to `paying` before any Bitnob call, the bounty table is in Postgres, and from `paying` / `paid` / `payout_failed` the state machine refuses `/pay` and settlement ignores a redelivered merge. What a restart can do: leave a bounty `verified` (timer lost) or `paying` (in-flight payout lost). `verified` → a maintainer types `/hold` then `/pay`. `paying` → check the payout in the Bitnob dashboard by its reference `pay-<bountyId>-<attempt>` before doing anything by hand.

Also: A2's `RepoBountyLookup` falls back to the issue's "Done when" criteria when the bounty has none. `/bounty` creates bounties without criteria, so before this the verifier could only answer `unsure` and nothing was ever paid automatically.

## Failure paths (I3)
`src/e2e/failure-paths.ts` plays the two failures the demo shows, with the same real modules (+ G5 claim timers) and checks what **GitHub** and the **web** show at every step:

| Scenario | What happens | GitHub | Web (`/b/:id`, `/live`) |
| --- | --- | --- | --- |
| **payout retry** | merge → payout attempt 1 → Bitnob webhook `payouts.withdrawal.expired` → `payout_failed` → B2 retries with a new quote (attempt 2) → Bitnob success → `paid` | status comment `⚠️ Payout failed` with "The money stays reserved for them", `Last error (attempt 1): Bitnob reported the payment expired`, "Next: nothing to do. We retry automatically"; then `💸 Paid` with the receipt link; label `bounty: paid` | timeline `… payout.started → payout.failed → payout.started → payout.succeeded`, payout `succeeded` in 2 attempts, claim `done` |
| **claim expiry** | `/claim` and no PR before the deadline → G5 timer → `claim.expired` → back to `funded` → another developer `/claim`s | developer assigned then **unassigned**, note `⏰ @awa-dev's claim expired without a PR…`, status comment back to `Funded`, then `Claimed` by the next developer | timeline `… claim.created → claim.expired → claim.created`, new active claim |

```bash
pnpm --filter @bitbounty/server demo:failures                 # both scenarios, prints each step + the final GitHub comments
pnpm --filter @bitbounty/server demo:failures -- --serve=8787 # slow version (20 s claim, 4 s retry) with the read API on :8787
BITBOUNTY_API_URL=http://localhost:8787 pnpm --filter @bitbounty/web dev   # then watch /live and open the two /b/:id it prints
```
`test/failure-paths.test.ts` runs both on every `pnpm test`.

Fixes that came with it, so the failures read cleanly:
- the status comment is re-rendered with the claim, the PR and the payout's attempt / last error / receipt (`statusExtras`, used by `app.ts` and the scenarios). Before, `payout_failed` showed no reason;
- the comment no longer says "Nobody can claim until the maintainer confirms criteria / `/criteria ok`": `/criteria` doesn't exist yet and claims are open once funded. It now says the criteria are the issue's **Done when** list (what A2's verifier reads) and, once funded, "comment `/claim` to take it" (EN and FR);
- after the last payout attempt, the comment stops promising "We retry automatically" (and promises no manual retry either: there is none yet);
- the issue is public, so the payout failure is a short reason (`Bitnob didn't answer`, `Bitnob reported the payment expired`, `Bitnob refused the payment`, `the developer hasn't set a payout account yet`, `a payout setup problem on BitBounty's side`, else `the payment didn't complete`), never the raw `lastError` (hosts, env var names). The raw text stays in the server log and the payout row. "Set your payout account at /me" only shows when that is the cause;
- a stopped claim scheduler (`InMemoryClaimScheduler.stop()`) arms no new timer until `start()`, so with `--serve` the second claim stays on screen instead of expiring 20 s later;
- the bounty page shows "From the issue · Done when list on GitHub" instead of "Claude draft · waiting for /criteria ok" when no criteria are stored;
- the bounty page shows the claim as `done` once merged, and the verifier's verdict even when only the bounty carries it.

On the real server, the claim timer is `CLAIM_TTL_MINUTES` (use 2–5 for a live demo).
