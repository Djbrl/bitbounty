# Product

**BitBounty is a GitHub App that turns an issue into a paid task, and pays whoever solves it in sats over Lightning, through Bitnob.**

This page is the product definition we built against. What is actually built is in the [README](../README.md#status); design points that are not built are marked *(not built)*.

## Positioning
- **Who pays:** maintainers, companies with open-source SDKs, funders of Bitcoin open source, and AI agents with a budget set by a human.
- **Who earns:** developers, in West Africa first, who need nothing but a GitHub account and a Lightning Address.
- **Why it doesn't exist yet:** bounty platforms such as Algora pay through Stripe, which doesn't pay out in Senegal. BitBounty prices in FCFA, holds and moves the money through Bitnob, and pays in sats over Lightning.
- **Promise to the maintainer:** put a price on your backlog and pay only for merged work. Claude checks the acceptance criteria before you review; there are no invoices or international transfers to handle.
- Say "issue bounties", not "bug bounties" (which means security programmes).

## The primitive: a funded issue
A GitHub issue + money held on Bitnob + acceptance criteria + a recipient.

`unfunded → funded → claimed → submitted → verified → paying → paid`, with `on_hold`, `payout_failed`, `refunded` and `cancelled` on the side ([transition table](../packages/core/README.md)).

Rules:
- **Only the state machine moves money.** AI produces signals (a verdict, a price), never a payment.
- **The merge is the approval.** Merge + CI green + verifier pass → automatic payout after the objection window. Anything else waits for the maintainer (`/pay` or `/reject`).
- **One active claim per issue**, with a timer. No race between ten PRs.
- **Once a PR is submitted, the funder can't cancel.** That protects the developer.
- **After a merge, the money stays reserved for the developer**, even if the payout fails.
- An unfunded bounty can't be claimed: developers only see money that is really there.

## Surfaces
1. **The GitHub App** is the main interface: commands in comments, one status comment per issue that the bot keeps editing, labels, and the "BitBounty verification" check on PRs ([github-app.md](github-app.md)).
2. **The web app:** payment page, bounty page, receipts, public board, proof-of-work profiles, maintainer home with "Price my backlog", developer home, live screen.
3. **The agent API and MCP server**, so an agent can post bounties within a budget its human owner sets ([agents.md](agents.md)).

## Flows
1. **Maintainer:** installs the app, optionally runs "Price my backlog" (Claude proposes issues with criteria and a price), comments `/bounty 10000` (always in FCFA, the amount the developer receives).
2. **Funding:** the payment page asks for bounty + 5% fee + 3% exchange-rate buffer, as a Lightning invoice that refreshes when it expires. Paid → the status comment says **Funded**. Naira bank transfer is built for the sandbox only; USDT *(not built)*.
3. **Developer:** signs in with GitHub on the web and saves a Lightning Address once (never on GitHub, where comments are public). BitBounty checks it resolves before saving.
4. **Claim:** `/claim`, 72 h to open a PR, `/extend` once, `/unclaim` to give it back.
5. **Submit:** a PR with `Fixes #12` links the bounty; Claude checks every push against the criteria (the issue's "Done when" list).
6. **Merge → payout:** FCFA → sats at Bitnob's rate, an invoice for that exact amount from the developer's Lightning Address, paid through Bitnob, receipt in the status comment.

## Edge cases
| Case | Rule |
| --- | --- |
| Lightning invoice expires before payment | a new one is created; the old one is still watched, and a late payment is credited |
| Developer's wallet returns a wrong amount, network or expiry | refused before paying; nothing sent |
| Payout fails | up to 3 attempts; then `payout_failed` and the money stays reserved for the developer |
| Unclear answer from Bitnob | treated as "maybe paid": read the payment first, never send a second payment |
| Duplicate webhook | stored once per delivery id; the state machine refuses a repeat transition |
| PR by someone who didn't claim | not linked; the bot says the issue is taken. The maintainer can still `/pay @user` |
| Merge without `Fixes #12` | the bot asks "Is PR #34 the fix for #12?" |
| Verifier unsure or CI red at merge | `on_hold` until the maintainer decides |
| Funder cancels before a PR | allowed; status `refunded`, money returned by hand *(automatic refund not built)* |
| Funder cancels after a PR | refused |
| Bug comes back after payment | no clawback, stated upfront |
| Agent as funder | same rules; budget and allowed repos set by its human owner; a human still merges |
| Disputes, split payments, change-of-address delay, email notifications | *(not built)* |

## Business model
A fee on funding (5% in the current pricing). Later: plans for organisations.

## Pitch angle
Btrust's mission is "locating, educating, and remunerating Bitcoin open-source engineers in the Global South". BitBounty maps onto it: the board and proof-of-work profiles **locate**, Claude's review on every PR **educates**, and the payout in sats **remunerates**. This is an inspiration, not a partnership.
