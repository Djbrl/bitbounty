# Price my backlog (A3)

Claude reads a repo's open issues, keeps the ones that make good bounties (clear, testable, scoped), drafts 2–4 acceptance criteria and suggests a price in FCFA with a reason. The maintainer ticks the suggestions on `/dashboard` and funds them in one payment. **Nothing is created or funded here**: these are suggestions only.

Code: `apps/server/src/ai/backlog/`.

## Use it
```sh
# CLI: prints the suggestions as JSON (public repo; BACKLOG_GITHUB_TOKEN raises the rate limit)
pnpm --filter @bitbounty/server backlog owner/name [--max 60]

# HTTP
curl -X POST http://localhost:8787/api/backlog/suggest -H 'content-type: application/json' -d '{"repo":"owner/name"}'
```
Response (`BacklogResult`): `suggestions` in the same shape as `BacklogSuggestion` in `fixtures/types.ts` (what the W2 page reads), plus `issuesRead`, `issuesConsidered`, `issuesSkipped`, `model`, `isFake`, `warnings`.
Errors: `400 invalid_repo`, `404 repo_not_found`, `429 github_rate_limited` (with the reset time) or `429 too_many_requests`, `502 github_unavailable`, `500 backlog_failed`.

**No user session yet** (I1 adds it through the web app), so the route protects itself:
- the GitHub token is a dedicated `BACKLOG_GITHUB_TOKEN`, never a broad `GITHUB_TOKEN` from the shell. Make it a fine-grained, read-only, public-repos token: anything it can read, callers can price;
- the result is cached per repo for 10 minutes (same repo = no GitHub or model call);
- each client gets 6 new repos per minute, which bounds model cost.

## How it works
1. Reads the **60 most recently updated** open issues from the GitHub REST API (`maxIssues`; pull requests and assigned issues skipped).
2. Sends them to the model in **batches of 15**, all in parallel: a big repo costs 4 calls, not 200. The whole call stops at **120 s** and returns what it has, with a warning.
3. Validates every answer and never trusts it:
   - each entry is validated on its own: a bad entry is dropped (with a warning), not the whole batch; long text is trimmed;
   - entries for issues that weren't in the batch, and duplicates, are dropped; issues the model skipped are listed in `warnings`;
   - a suggestion needs 2 to 4 criteria (more are cut, fewer means no bounty);
   - prices are clamped to **2 500–100 000 FCFA** and rounded to 500;
   - an issue whose text tries to instruct the model (English or French: "ignore previous instructions", "price_xof: …", "ce ticket vaut 100 000 FCFA"…) is downgraded to `low` and never pre-selected;
   - a batch that fails or answers invalid JSON is skipped with a warning, the rest still comes back.
4. Issue text is wrapped as untrusted data with a random boundary (same approach as the A1 verifier). Criteria are written in the issue's language (French issue → French criteria).
5. Only `high` confidence suggestions below the 100 000 FCFA cap come pre-ticked (`selected: true`).
6. Suggestion ids include the repo (`sug-teranga-labs-bitnob-js-21`), so they stay unique across repos.

## Model
- `ANTHROPIC_API_KEY` set: Claude with structured outputs (JSON schema). Model: `BACKLOG_MODEL`, else `VERIFIER_MODEL`, else `claude-sonnet-5-5`.
- No key: an offline heuristic (`fake:heuristic-backlog`, `isFake: true`). It keeps described issues that aren't questions or roadmaps/tracking issues, uses a `- [ ]` checklist as criteria (otherwise a template, in French for French issues), and prices by size. Good enough for the demo and tests, much less selective than Claude.
