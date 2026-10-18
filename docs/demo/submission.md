# Submission (D6): text ready to paste

Deadline: **Sunday 18 Oct, 14:00**. Fill the form from this page, then check every link in a private browser window (done-when). Fields marked **[fill]** need a human.

## Checklist before submitting
- [ ] Every link below opens in a private window (no sign-in needed): app, landing, repo, demo repo, video, deck.
- [ ] The backup video (D4) is uploaded and its link is set below and in `bitbounty-landing/site.config.js` (`trailerYoutubeId`).
- [ ] The deck is shared (Share menu → anyone with the link) and its link is below.
- [ ] The README tally is final and agreed (rule 10).

## Project name
BitBounty

## Tagline (one line)
Get paid to fix open source, from Dakar: bounties on GitHub issues, funded through Bitnob, paid in sats over Lightning on merge.

## Short description (≈ 50 words)
BitBounty lets open-source maintainers put a price on a GitHub issue with one comment. They fund it over Lightning or by naira bank transfer through Bitnob. A developer claims it, opens a PR, Claude checks it against the issue's acceptance criteria, the maintainer merges, and the developer is paid in sats to their Lightning Address.

## The problem
Open source runs on unpaid work. Maintainers have no simple way to pay for a specific fix, and developers in West Africa who could fix it have no easy way to be paid across borders for a single contribution.

## The solution
Everything happens inside GitHub: `/bounty 10000` prices an issue in FCFA, the bot answers with a Lightning invoice (or a Nigerian virtual account for funders in Lagos), `/claim` gives a developer 72 hours, Claude reviews the PR as an advisory GitHub check, and the merge triggers a Lightning payout in sats. AI agents can fund work too, through an MCP server with budgets set by a human.

## How we use Bitnob
- HMAC-signed API calls (`X-Auth-*` headers)
- Lightning invoices to fund bounties (proven in sandbox, simulated payment → `funding.paid`)
- NGN virtual accounts for funders in Lagos (sandbox deposit simulated)
- Rates: FCFA ↔ sats ↔ NGN
- Lightning pay for developer payouts (built with idempotent references, a sats cap and no double pay; the sandbox refuses outgoing Lightning, so the live proof is **[fill: done on production / pending]**)
- Signed webhooks moving each bounty forward

## Tech
TypeScript monorepo: Next.js (Vercel), Hono server, Postgres + Drizzle, GitHub App, Claude (verifier + backlog pricing), MCP server, Docker, Cloudflare tunnel.

## Built with AI agents
100% of the code was written by AI coding agents (Claude Code, claude-opus-5-5). The humans chose and sized tasks, wrote briefs, reviewed, tested and decided. Every PR names the agent and model.

## Team
- Jib (@Djbrl): **[fill role]**
- **[fill name]** (@Rabatou): **[fill role]**
- Mouhamed (@Kml221-bot): **[fill role]**
- **[fill name]** (@cheikhteej): **[fill role]**

## Links
- App: https://bitbounty-app.vercel.app
- Landing: https://bitbounty-nine.vercel.app
- Code: https://github.com/Djbrl/bitbounty
- Demo repo: https://github.com/Djbrl/bitbounty-demo
- GitHub App: https://github.com/apps/bitbounty-dakar
- Video: **[fill]**
- Deck: **[fill: shared link]**

## What's next
Recurring bounties for Bitcoin open-source projects, a public leaderboard of paid contributors, and agent-funded maintenance with human-set budgets. No partnerships claimed: Bitnob is the infrastructure we built on, and Btrust's mission (locating, educating and paying Bitcoin open-source engineers in the Global South) is our inspiration, not an affiliation.
