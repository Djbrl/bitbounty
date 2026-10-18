# BitBounty: product definition

## Final positioning (17 10 2026)
**"Algora for West Africa, with Bitnob at the core."** A **marketplace** where open-source developers find paid issues, and get paid in sats over Lightning, to their Lightning Address, the moment the fix is merged (bounties are priced in FCFA).
- **Front side = developers**: the board of paid issues, search, proof-of-work profiles, payment on Wave.
- **Money side = maintainers and funders** (Bitcoin projects, African fintechs, funders like Btrust, AI agents): the GitHub App + "Price my backlog" is *how bounties get onto the marketplace*.
- **Algora proved the model in dollars via Stripe**, which doesn't serve Senegal. We do the same thing where Stripe and PayPal don't pay out: funded in sats / USDT / naira, paid in local currency, all through Bitnob (Lightning, trading, virtual accounts, payouts).
- Answer to "it's just a clone": we aren't copying the product, we're making it **possible** in a region where it can't work today. Plus what Algora doesn't have: funding in sats and naira, Lightning payouts in minutes, proof-of-work profiles, agents as funders.
- Day-one board: optionally list existing public bounties (marked "external, paid in dollars elsewhere") alongside ours ("paid in FCFA on Wave"), so the marketplace doesn't look empty.


> **Name: BitBounty** (decided 17 10 2026, previously "Liggéey"). **Primary target: maintainers.**
> Pitch note: say "**issue** bounties", not "bug bounty", which in the industry means security vulnerability programmes (HackerOne). Minor name collisions: an empty GitHub account `bitbounty`, and an old Solidity project "Bit Bounty" on Devpost.

## Positioning: maintainers first (17 10 2026)
**Who pays:** the maintainers.
1. African fintech and dev-tool companies with open-source SDKs/repos (Bitnob, Paystack, Flutterwave, Africa's Talking…).
2. Global maintainers with a backlog nobody touches.
3. Teams whose AI agents need humans (agents fund through the API, the human owner pays).

**Promise to the maintainer:** *Put a price on your backlog. Pay only when it's merged.*
- **You only pay for merged work**: the money is held, and refunded if nothing gets merged.
- **Less review work**: Claude checks the acceptance criteria and filters spam / AI junk before you open the PR.
- **Zero payout admin**: no invoices, no collecting IDs, no international transfers. We pay the FCFA bounty in sats over Lightning, to the developer's Lightning Address, through Bitnob.
- **Fund however suits you**: Lightning, USDT, or a naira bank transfer.
- **Access to a pool of African developers growing fast** (+3.4M devs in a year in Africa & the Middle East, Octoverse 2025).

**The maintainer's "aha" (onboarding):** Install the app → pick repos → **"Price my backlog"**: Claude reads the open issues, proposes the ones that make good bounties (clear, testable, well scoped), writes the criteria and suggests a price in FCFA → the maintainer ticks the boxes → **one payment funds the whole batch** → the bounties go live on the public board.

**Maintainer surface (added):** a `bitbounty.app/dashboard` page: active bounties across all repos, budget and spending, median merge → payment time, actions (fund, `/pay`, `/hold`, refund), and "Price my backlog" suggestions.

**Developers stay the supply** (their flows don't change: link Wave once, `/claim`, PR, paid), but the pitch, the landing page and the demo open from the maintainer's side.

**Demo opening (maintainers version):** "You maintain an SDK with 40 open issues. Contributors aren't coming. And paying someone in Dakar or Lagos means invoices, transfers, compliance. BitBounty: put a price on your backlog, pay only what gets merged, we handle the rest."


v1, 15 10 2026. Working name. 

## In one sentence
**BitBounty is a GitHub App that turns any issue into a paid task, and pays whoever solves it in sats over Lightning, through Bitnob.**

Everything else (agents, sponsorship, the website) is either a *client* of this primitive or a *window* onto it.

## The single primitive: the funded issue
A GitHub issue + money in escrow + acceptance criteria + a recipient.

```
FUNDED ──claim──▶ CLAIMED ──PR opened──▶ SUBMITTED ──merge + checks──▶ VERIFIED ──▶ PAID
   │                 │ (72 h without a PR)                  │ (24 h objection window)
   └──expiry────▶ REFUNDED ◀──────── released ◀─────────────┘ dispute → maintainer decides
```
Hard rules:
- **Only the state machine moves money.** AI produces *signals* (score, verdict, reasons), never a payment on its own.
- **The merge is the approval.** No maintainer action is needed beyond what they already do. Merge + CI green + verifier OK → automatic payout after the objection window (0 h in the demo, 24 h in real use).
- **One active claim per issue**, with a timer. No race between 10 PRs.
- Once a PR has been submitted, **the funder can't take the money back** without going through a dispute. That protects the developer.

## Who uses it
| Role | Who | What they do |
|---|---|---|
| **Funder** | maintainer, company, sponsor, **AI agent** | funds an issue (`/bounty 10000 FCFA` or the API) |
| **Earner** | African developer | links GitHub ↔ Wave once, claims, opens the PR, gets paid |
| **Maintainer** | owner of the repo | installs the app, merges as usual |

An agent is **a funder like any other**. It uses the API (or the MCP server) with a budget set by a **human owner who stays accountable**. BitBounty doesn't care whether the funder is a human or an agent.

## Where it sits
```
        GitHub (where the work happens)
   issues · comments · PRs · merge · CI
               ▲   │ webhooks
   bot comments│   ▼
   ┌─────────────────────────────────┐
   │ BITBOUNTY (our server)          │
   │  state machine + escrow ledger  │◀── Verifier: Claude (criteria vs PR)
   │  payout orchestration           │◀── Triage: Nemotron (price, spam)
   └─────────────────────────────────┘
               ▲   │ API calls
   notifications│  ▼
        Bitnob (where the money moves)
   Lightning/USDT in · balance · FX · payouts Wave/OM
```
BitBounty is **the trust layer between the work (GitHub) and the money (Bitnob)**.

## The surfaces (only three)
1. **The GitHub App, the main interface.** Commands in comments (`/bounty`, `/claim`, `/unclaim`), bot comments (status, Claude's verdict, payment receipt), labels (`💰 10 000 FCFA`). Nobody has to learn a new tool.
2. **A small website (PWA, works on a phone).**
   - Earner: sign in with GitHub → link a Wave/OM number → earnings and receipts.
   - Funder: payment page (Lightning QR / USDT address) opened from the bot's link.
   - Public: **the board of paid issues** across Africa + the public ledger of payouts.
3. **The API + MCP server** for agents (`post_bounty`, `get_status`, `cancel`), with a budget policy.

No native app. No dashboard for its own sake.

## Who handles what (the "no delays" question)
- **Payment speed:** no human sits between merge and payment. Webhook `pull_request.closed(merged)` → checks → verifier → Bitnob payout → confirmation notification → receipt comment. A few minutes at most.
- **The verifier agent is ours**, run by BitBounty: it reads the issue, its criteria, the diff and the CI results, and posts its verdict as a comment. If it says no, the payment waits for the maintainer.
- **Client agents belong to the funders**, not to us. We give them a clean API and limits.
- **Nemotron** works in the background: suggested price on every issue, French translation, spam / AI-junk score on PRs.

## Bitnob, end to end
Funding: `POST /api/lightning/invoices` → polling until paid · or USDT `POST /api/addresses` → `deposit.success`. Escrow: Bitnob balance (custody) + our ledger (allocation per issue). Price: `GET /api/exchange-rates` (FCFA ↔ BTC/USDT). Payout: `POST /api/payouts/quotes` → `/initialize` (mobile_money, Wave/OM) → `/finalize` → `payouts.withdrawal.success`. Refund: Lightning `pay` to the funder. Earners: `customers` + `beneficiaries`.

## Business model
5% on funding. Later: monthly plan for organisations (budgets, invoices).

## Defensible differences
- Algora / Opire: pay through Stripe (not Senegal), no Lightning, no agent clients.
- GitHub Sponsors: one-off donations, not work; payouts uncertain in Senegal.
- Us: **payment in FCFA on Wave within minutes of the merge**, agents as clients, built to grow the open-source community in West Africa.

## Hackathon scope (23 h)
- **Must:** GitHub App + state machine + Lightning funding + Wave payout (sandbox) + Claude verifier + website (earner onboarding, payment page, board, receipt).
- **Should:** MCP server + the "Claude Code funds a Wolof translation" demo.
- **Cut (roadmap):** sponsor splits, bulk payouts, disputes beyond "the maintainer decides".
- **Dogfooding:** our own hackathon repo runs through BitBounty.

---

# UX flows and edge cases (v2, 15 10 2026)

## Flow 1: the maintainer sets things up (once)
1. Clicks "Install" on the BitBounty site → standard GitHub flow → picks the repos.
   Permissions: issues (write), pull requests (read), checks (write), metadata.
2. The bot opens a welcome issue: "BitBounty is installed. Write `/bounty 10000` on any issue."
3. Optional `.github/bitbounty.yml`: who can fund (default: people with write access), objection window (default 24 h), claim timer (72 h), Claude verification required (yes), languages.

## Flow 2: putting a bounty on an issue
1. On issue #12, the maintainer writes `/bounty 10000` (always **in FCFA**, the amount the developer receives).
2. Checks: the author has write access (otherwise: "Only maintainers can fund here"), the issue is open, it has acceptance criteria.
   - **No criteria?** Nemotron drafts 2–4 from the issue text → the bot proposes them → the maintainer confirms with `/criteria ok` or edits them. **No criteria = no claim possible** (that's what protects everyone in a dispute).
3. The bot replies with ONE status comment that it will keep editing (never a flood of comments):
   > 💰 **Bounty: 10,000 FCFA** · ⏳ Waiting for funding · [Fund this bounty →](link)
   No QR code in the comment: a Lightning invoice expires, so the QR lives on the **payment page** and refreshes itself.
4. Payment page: the amount in the funder's currency (EUR / USD / sats), broken down: 10,000 FCFA + 5% fee + 3% exchange-rate buffer. Two tabs: **Lightning** (QR + copy, auto-refreshed on expiry) and **USDT** (Tron / other chains supported by Bitnob, address + network).
5. Paid → Lightning sats are converted to USDT (trading) to avoid volatility → the ledger reserves 10,000 FCFA for #12 → the bot edits its comment: **✅ Funded: 10,000 FCFA held** · `💰 10 000 FCFA` label · link to the public bounty page (timeline + payment reference).
   **An unfunded bounty can't be claimed.** Developers only ever see real money.

## Flow 3: the developer links their payout account (once, the trust point)
> **Update (B6):** payouts now go in sats over Lightning to the developer's **Lightning Address** (e.g. `awa@blink.sv`); Bitnob's mentor confirmed Wave / Orange Money payouts won't work for us. The phone + SMS + test payout flow below is the original plan (B3), kept for reference.
**Never on GitHub** (comments are public). Everything happens on bitbounty.app/me:
1. Sign in with GitHub.
2. Country → provider (Wave / Orange Money / Free Money) → number → **name registered on the account**.
3. **SMS code** to the number (proves they own the phone).
4. **Test payout:** we send a random small amount (e.g. **137 FCFA**) through Bitnob to that number on that provider. The developer types the amount they received. ✓ = the number is right, the provider is right, the account receives, and the full payout path works **before** any real bounty. (Same idea as banks' test micro-deposits.)
5. Status: **"Payment verified ✓"**. They can claim before verification, but a payout only goes out to a verified account.
- Change of number: GitHub re-authentication + SMS on both numbers + **72 h delay**, and never while a payout is in progress (protects against a hijacked GitHub account redirecting the money).
- 1 number = 1 GitHub account. If someone posts their number in a comment: the bot hides the comment ("minimized") and reminds them where to link it.

## Flow 4: claiming
1. The developer writes `/claim` on the issue.
2. Checks: funded · not already claimed · account linked · fewer than 2 active claims · GitHub account older than 30 days or with past activity (anti fake accounts).
3. The bot assigns the issue (GitHub assignee) and edits the status: **🔒 Claimed by @awa until Fri 18:00**. Notification by email + SMS.
4. Timer: 72 h to open a PR (a draft PR counts and pauses the timer). `/extend` once. `/unclaim` frees it.
- Not linked yet → the claim is held 1 h with a link to /me, then released.

## Flow 5: submitting and verification
1. PR with "Fixes #12" → the bot detects it → status **📝 Submitted (PR #34)**.
2. On every push: **GitHub check "BitBounty verification"** run by Claude: each criterion ✅/❌ with the reason + Nemotron spam/AI-junk score. The maintainer sees it in the PR like CI.
3. PRs from people who haven't claimed the issue: the bot says politely that the issue is taken. They aren't paid unless the maintainer decides otherwise (`/pay @user`).

## Flow 6: merge → payment
1. Merge that closes #12 + CI green + Claude OK → **✔ Validated** → objection window (24 h, `/pay now` to skip it; 0 in the demo).
2. Bitnob: quote (settlement_amount 10000 XOF, from USDT) → initialize (mobile_money, provider, number) → finalize → notification `payouts.withdrawal.success`.
3. Final status comment: **💸 Paid 10,000 FCFA to @awa on Wave · 6 min after the merge · ref PAYOUT_XXXX** + SMS/email to the developer + public receipt.
- Claude says ❌ or CI is red → no automatic payment; the bot asks the maintainer `/pay` or `/reject <reason>`.
- Merge without "Fixes #12" → the bot asks: "Is PR #34 the fix for #12? `/pay @awa`".

## Edge cases
| Case | Rule |
|---|---|
| Lightning invoice expires during payment | the payment page generates a new one; the old one can no longer be paid |
| USDT under/over-payment | credited to the funder's BitBounty balance; bounty funded only once the full amount is there |
| Price moves between funding and payout | the 3% buffer covers it; leftover buffer goes back to the funder's balance, any shortfall is absorbed by the fee |
| Bitnob quote expired (15 min) | automatic new quote |
| Payout fails (wrong number, provider down, `withdrawal.expired`) | 3 retries with backoff → developer alerted "update your account"; **the money stays reserved for them** and never goes back to the funder after a merge |
| Bitnob unavailable | queue + retry, status "payment in progress" |
| Duplicate webhook | idempotent: reference = repo + issue + PR |
| Mobile money account limit (unverified Wave account) | split into several payouts, or warn at linking time |
| Funder cancels before claim | refund to their balance (withdraw over Lightning or USDT) |
| Funder cancels after claim, no PR | allowed, developer notified |
| Funder cancels after a PR | impossible without `/dispute` |
| Issue closed "not planned" while funded | refund after 7 days if no active claim or PR |
| Nobody claims in 60 days | the bot asks the funder: extend or refund |
| Several funders on one issue (`/bounty +5000`) | allowed if the maintainer enables it; refunds pro rata |
| Several people on one PR | v1: PR author paid; `/split @a 70 @b 30` by the maintainer (roadmap) |
| PR reverted or bug comes back during the objection window | `/hold` by the maintainer → dispute |
| Bug comes back after payment | no clawback (stated clearly upfront) |
| Maintainer ignores a correct PR | `/dispute` → Claude report + 7 days. We can't force a merge: **public stats per repo** (% of bounties paid, median time to pay) act as the deterrent |
| Funder = developer (cashing crypto out through fake bounties) | blocked if same identity; limits per account; pattern detection; KYC thresholds. **Compliance point to raise with Bitnob** |
| Agent as funder | same API, budget set by its human owner; the merge is still done by a human maintainer |
| Developer's GitHub account hijacked | 72 h delay on number changes + SMS on both numbers |

## Where the UX can break (to address before the demo)
1. **African funders can't pay in FCFA** (Bitnob has no Wave inbound). Lightning / USDT is fine for the diaspora and foreign companies, but a Dakar company with only Wave can't fund. → Short term: Nigerian NGN accounts; later, an on-ramp partner (Banxaas sells sats for Wave).
2. **The test micro-payout** costs a little per developer and depends on payouts working in the sandbox for SN. → Verify in the sandbox first.
3. **Notifications:** an African developer doesn't necessarily watch their GitHub notifications. → Email + SMS on claim / payment.
4. **Language:** French by default for developers, English for funders. The bot comments in the repo's language.
5. **Prices in two currencies:** developers only ever see FCFA, funders only their own currency. Mixing them = confusion.
6. **"Is the money real?"** → funded badge, public bounty page with the payment reference, payout stats in the README (`💰 23 bounties paid · 6 min average`).

---

# v3: making it impossible to dismiss (15 10 2026)
Context: an AI-friendly hackathon. Everyone will ship a pretty app in 23 h with AI help. What sets us apart is no longer "it works": it's **proof** that nobody else will have.

## New thesis
> **BitBounty is the payroll of the AI-era open-source economy in Africa.** Any human *or agent* can put money on a GitHub issue. African developers are paid in sats over Lightning minutes after the merge, and every payment becomes a verifiable proof of work.

Why now: Octoverse 2025, **+3.4M new developers in Africa & the Middle East in one year**, Nigeria >1.6M ([GitHub](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/)). Meanwhile, agents produce more and more work that needs humans to finish it.

## 5 upgrades (what no other team will have)

### 1. Real traction *during* the hackathon
Not a simulation: **real bounties, real Senegalese developers, real money**, in 23 h.
- During the hackathon we write **an open-source Bitnob SDK** (official SDKs are "coming soon"). Its issues become BitBounty bounties.
- Before Saturday (no code, just people): recruit 10–15 developers through Galsen DEV / GDG Dakar who agree to take bounties on the 17th–18th.
- Budget: ~100,000 FCFA in real bounties (≈ 15 × 5,000–10,000).
- Demo line: **"In 23 hours, 12 developers in Dakar were paid 87,000 FCFA through BitBounty to build the SDK we're showing you."** A recursive project that builds itself while paying the community. Hard to dismiss.
- Dependency: Bitnob production keys (ask at the 11:00 workshop, or before by email). Fallback: sandbox payouts + real GitHub activity.

### 2. A *measured* verifier, not a claimed one
"An AI checks the PR" is something anyone can say. We **measure** it:
- BitBountyBench: ~150 real issue → PR pairs from public repos (merged and actually fixing it / rejected / reverted).
- Run the Claude verifier on them → **wrongful-payment rate** and agreement with maintainers, plus cost per check.
- Nemotron vs Claude on spam and pricing: cost/quality table (the GOMYCODE recipe: real numbers win).
- Slide: "Our verifier pays wrongly in X% of cases, for $0.0Y per PR."

### 3. Agents as first-class clients, live
- **The scout (Nemotron):** walks through the repos of African companies and projects, spots the "payable" issues, writes the criteria, suggests a price. It *creates supply*.
- **The client (Claude Code):** in our own repo, when it hits a task that needs a human (Wolof, a test on a real phone in Dakar, a check of a real merchant flow), it funds the bounty itself through MCP, within a budget.
- On screen: the agent's reasoning ("I can't verify this reliably → I'm hiring a human") next to the developer's phone buzzing.

### 4. Every payment = a verifiable proof of work
- A signed receipt: PR + merge + Bitnob reference + date + amount, checkable by anyone.
- **Developer profile = proof-of-work CV:** "14 paid bounties, 3 repos, 92% accepted". It answers the question every foreign employer asks: "can I trust this developer?"
- Visual: a profile page that's beautiful to share on LinkedIn.

### 5. Pan-African in and out (closing the "no FCFA in" gap)
- In: Lightning + USDT (diaspora, foreign companies, agents) **+ NGN virtual accounts** (a Nigerian company funds with an ordinary bank transfer).
- Out: mobile money in 9+ countries (SN, CI, NE, GH, KE, UG, XAF…).
- Demo: a Lagos maintainer funds in naira → a Dakar developer gets paid in FCFA on Wave. That's the pattern that won in Nairobi (WestToEast), but **for work**, not just a transfer.

## Jury objections and answers
| Objection | Answer |
|---|---|
| "Algora already exists" | Algora pays through Stripe → not Senegal, no Lightning, no agent clients, no proof-of-work CV. And we have local traction. |
| "Isn't this just a crypto off-ramp?" | Money is only released on a **merge verified** by an independent maintainer + criteria + checks; funder ≠ developer; limits; patterns. |
| "AI will flood repos with junk PRs" | One claim at a time, spam score, the maintainer decides, measured verifier (upgrade 2). |
| "Who pays for a Senegalese developer's work?" | Diaspora, foreign companies looking for cheap and verified talent, African companies (NGN today, FCFA through a partner), and agents. |
| "Is it legal?" | We are not the custodian: Bitnob (licensed) holds the funds and pays out; we orchestrate. |
| "Will it survive after the hackathon?" | The SDK repo keeps running through BitBounty; 5% fee; open-source repo. |

## Prep before Saturday (no product code)
1. Bitnob sandbox: payouts SN/Wave + on-the-fly Lightning + NGN virtual accounts.
2. Ask Bitnob for production keys + the off-ramp/compliance question.
3. Recruit 10–15 developers (Galsen DEV, GDG Dakar, university clubs).
4. Real-bounty budget (~100k FCFA) + who pays it.
5. BitBountyBench dataset (collecting public PRs = research data).
6. Nemotron credits: confirm type and quota.

---

# Other ideas at the same bar (AI-essential + Bitnob-essential + undeniable demo)

## Làkk: the Wolof data market ("làkk" = language, to check)
AI labs and agents need data in Wolof, Pulaar and Serer (speech, text, translation) and can't find any. Senegalese speakers record and validate, **paid per accepted sample on Wave**. A model checks quality (audio quality, transcription consistency, cross-validation by other speakers). Buyers (labs, agents) pay per sample over Lightning (L402).
- AI essential (quality, cross-validation, pricing), Bitnob essential (Lightning in, Lightning out by the thousand, bulk payouts).
- Demo: a judge records a sentence in Wolof → validated → paid in seconds; a counter of hours of Wolof collected during the hackathon.
- It's **the same rails as BitBounty** (verified work → instant payment) for data instead of code. Pitch both as a platform: "BitBounty for code, Làkk for language".
- Risks: consent, licensing, fair pay (to design upfront).

## Allowance: bank accounts for AI agents (Dakar SME back office)
An agent runs a small Dakar business's back office: pays 3 suppliers on Wave, renews a SaaS through a **single-use card**, refuses a payment that breaks the policy, asks a human to approve above a threshold. Spending rules (per supplier, per day, whitelist), a log readable by people.
- The 2026 trend (Firebreak, The Doghouse) + maximum Bitnob depth (cards, payouts, Lightning, trading).
- Risk: card issuing / Wallet Infrastructure access in the sandbox.

## Recommendation
**BitBounty v3**, with Làkk as the "same engine, next vertical" line in the pitch.

---

# Constraints confirmed by Jib (16 10 2026)
- Bitnob account: created **Saturday** (not before). → No sandbox tests before the event; verify at 15:00 on day one.
- Team: teammates already in place. No recruiting.
- Real bounty: maybe **one test at 10,000 FCFA**, optional. Only possible with production keys (see below), otherwise everything stays in the sandbox.
- Models: **Claude (Anthropic API key) by default** for the checker and the agent. Nemotron isn't required (Brev ≈ $70 of GPU, not worth the setup). OpenAI as backup.
- Upgrade 1 (traction with recruited developers) dropped. Upgrade 2 (measured checker) optional, done during the hackathon if there's time.

---

# Funding from Lagos in naira (checked in the docs, 16 10 2026)
Chain: **NGN virtual account → NGN balance → NGN/USDT (or NGN/BTC) trade → XOF payout to Wave.**
1. The funder (a Lagos company) is a Bitnob `customer` with full identity details (required for a naira account) → `POST /api/virtual-accounts` → a dedicated Nigerian account number (shown on the payment page, "Bank transfer" tab).
2. They make an ordinary bank transfer → credited within ~10 min to **our company NGN balance** (not per customer) → webhook `virtual_account.deposit.success` (camelCase envelope, snake_case payload; amounts in kobo).
3. Our ledger assigns the deposit to the bounty (the account is tied to the funder).
4. Conversion: `POST /api/trading/quotes` NGN/USDT (or NGN/BTC), whole-naira amounts, ₦500–₦10M, `quote_id` required, quote valid ~10 s in production / 30 s in sandbox → `POST /api/trading/orders`.
5. On merge: XOF payout from USDT (or BTC) as usual.
- Sandbox: `POST /api/virtual-accounts/:id/simulate-deposit` credits **₦1,000 per call** (fixed) → loop it to reach a bounty's amount. NGN quotes/orders work in sandbox.
- Production: virtual accounts + NGN trading are enabled by Bitnob **after KYB** (24–48 h), not self-serve.
- **Bitcoin rule:** going through **NGN → BTC → XOF** makes Bitcoin the bridge between the two currencies (like WestToEast). Otherwise Lightning (diaspora / agent funding) remains the main Bitcoin feature.

---

# Pitch angle: Btrust (event partner) (17 10 2026)
Btrust's mission, as on its site: *"Locating, educating, and remunerating Bitcoin Open-Source Engineers in the Global South."* ([btrust.tech/about](https://www.btrust.tech/about)). Its grants are "contingent on their Proof of Work". It was founded with 500 BTC.
**BitBounty is the infrastructure for those three verbs**, built on Bitnob:
- **Locate** → the public board + **proof-of-work profiles** (paid, merged, verifiable work). That's exactly the signal Btrust uses to award its grants.
- **Educate** → the ladder of "good first paid issues" + **Claude's review on every PR** (criterion by criterion, with evidence). Every bounty is a paid exercise with feedback.
- **Remunerate** → payment in sats over Lightning, minutes after the merge, through Bitnob. No PayPal, no Stripe, no wire transfer.
**Use case to say on stage:** a funder like Btrust (or a Bitcoin project) puts sats over Lightning on issues in Bitcoin open-source repos → developers in Dakar, Lagos or Nairobi get paid in FCFA, naira or shillings. Sats in, local currency out.
**Line:** "Btrust locates, educates and remunerates Bitcoin engineers in the Global South. BitBounty turns that into a GitHub button: an issue, a price in sats, and a payment on Wave as soon as it merges."
Careful: quote their wording exactly, and don't imply a partnership that doesn't exist.
