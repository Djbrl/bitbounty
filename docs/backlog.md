# Price my backlog (A3)

Claude reads a repo's open issues, keeps the ones that make good bounties (clear, testable, scoped), drafts 2–4 acceptance criteria and suggests a price in FCFA with a reason. The maintainer ticks the suggestions on `/dashboard` and funds them in one payment. **Nothing is created or funded here**: these are suggestions only.

Code: `apps/server/src/ai/backlog/`.

## Use it
```sh
# CLI: prints the suggestions as JSON (public repo, or private with GITHUB_TOKEN)
pnpm --filter @bitbounty/server backlog owner/name [--max 60]

# HTTP
curl -X POST http://localhost:8787/api/backlog/suggest -H 'content-type: application/json' -d '{"repo":"owner/name"}'
```
Response (`BacklogResult`): `suggestions` in the same shape as `BacklogSuggestion` in `fixtures/types.ts` (what the W2 page reads), plus `issuesRead`, `issuesConsidered`, `issuesSkipped`, `model`, `isFake`, `warnings`.
Errors: `400 invalid_repo`, `404 repo_not_found`, `502 github_unavailable`.

## How it works
1. Reads open issues from the GitHub REST API (pull requests and assigned issues skipped), up to 200.
2. Keeps the **60 most recently updated** (`maxIssues`) and sends them to the model in **batches of 15**, 3 calls in parallel: a 200-issue repo costs 4 calls, not 200.
3. Validates every answer and never trusts it:
   - entries for issues that weren't in the batch, and duplicates, are dropped;
   - a suggestion needs 2 to 4 criteria (more are cut, fewer means no bounty);
   - prices are clamped to **2 500–100 000 FCFA** and rounded to 500;
   - an issue whose text tries to instruct the model is downgraded to `low` and never pre-selected;
   - a batch that fails or answers invalid JSON is skipped with a warning, the rest still comes back.
4. Issue text is wrapped as untrusted data with a random boundary (same approach as the A1 verifier). Criteria are written in the issue's language (French issue → French criteria).
5. Only `high` confidence suggestions come pre-ticked (`selected: true`).

## Model
- `ANTHROPIC_API_KEY` set: Claude with structured outputs (JSON schema). Model: `BACKLOG_MODEL`, else `VERIFIER_MODEL`, else `claude-sonnet-5-5`.
- No key: an offline heuristic (`fake:heuristic-backlog`, `isFake: true`). It keeps described, non-question issues, uses a `- [ ]` checklist as criteria, and prices by size. Good enough for the demo and tests, much less selective than Claude.
