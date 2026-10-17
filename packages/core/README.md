# @bitbounty/core: the contract

Types, events and the bounty state machine. Every module codes against this package.
**It can only grow**: add fields, statuses or events, never rename or remove them.

```ts
import { createBounty, transition } from "@bitbounty/core";

const { bounty, event } = createBounty({ id, repoFullName, issueNumber, issueTitle,
  amountXof: 10000, criteria, funderKind: "human", funderId, createdAt });

const r = transition(bounty, { type: "funding.paid", bountyId: bounty.id,
  occurredAt, fundingId, rail: "lightning", amountXof: 10000 });
if (!r.ok) reply(r.message);   // ILLEGAL_TRANSITION | WRONG_BOUNTY | UNDERFUNDED
else save(r.bounty, r.event);  // r.from → r.to
```

`transition()` is pure: it never mutates the bounty, never throws, and never touches the network.

## Files
| File | What |
| --- | --- |
| `src/types.ts` | `Bounty`, `Funding`, `Claim`, `Submission`, `Payout`, `User`, `PayoutAccount`, statuses |
| `src/events.ts` | `InternalEvent` (union), `EVENT_TYPES`, `EventOf<"pr.merged">` |
| `src/machine.ts` | `TRANSITIONS` table, `transition()`, `canTransition()`, `createBounty()` |
| `src/money.ts` | integer amounts: `Xof`, `Sats`, `Kobo`, `UsdtUnits`, `assertAmount()` |

## Money
Amounts are positive integers in the smallest unit: FCFA, sats, kobo, USDT base units (1 USDT = 1,000,000). Never floats. `createBounty` and `funding.paid` reject anything else.

## Transitions
| From | Event | To |
| --- | --- | --- |
| unfunded | `funding.paid` (amount ≥ bounty) | funded |
| unfunded | `bounty.cancelled` | cancelled |
| funded | `claim.created` | claimed |
| funded | `bounty.cancelled` | refunded |
| claimed | `claim.released` / `claim.expired` | funded |
| claimed | `pr.linked` | submitted |
| claimed | `maintainer.pay` (merge without "Fixes #n") | verified |
| claimed | `bounty.cancelled` | refunded |
| submitted | `verify.done` (records the verdict) | submitted |
| submitted | `pr.merged` | verified if verdict = pass and CI green, else on_hold |
| submitted | `maintainer.pay` | verified |
| submitted | `maintainer.hold` | on_hold |
| submitted | `maintainer.reject` | funded |
| verified | `maintainer.hold` | on_hold |
| verified | `payout.started` | paying |
| paying | `payout.succeeded` | paid |
| paying | `payout.failed` | payout_failed |
| payout_failed | `payout.started` (retry) | paying |
| on_hold | `maintainer.pay` | verified |
| on_hold | `maintainer.reject` | funded |

Everything else is refused. `paid`, `refunded` and `cancelled` are terminal.
Rules this encodes: no claim before funding; no cancel once a PR is in; a merged bounty whose payout fails stays reserved for the developer; the verifier's verdict is a signal and only matters when `pr.merged` arrives.

`bounty.created` is emitted by `createBounty()`, it is not a transition.
Duplicate external events (same webhook twice) are deduped upstream by the `events` table; a replay that reaches `transition()` is refused as illegal.

## Test
```bash
pnpm install && pnpm test && pnpm typecheck
```
