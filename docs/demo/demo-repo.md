# Demo repo: `Djbrl/bitbounty-demo`

The public GitHub repo the demo happens on. A tiny JavaScript library, **FCFA amounts and Lightning sats**, with realistic issues: one small real bug that a developer fixes live, and the Wolof translation task.

- **Repo content:** [`docs/demo/bitbounty-demo/`](bitbounty-demo/) (README, `src/`, `test/`, `locales/`, a GitHub Actions workflow running `npm test`). No dependencies: `npm test` is `node --test`, CI takes ~15 s.
- **Issues:** the 6 below, exactly as they are created (title, labels, body). The `#### Done when` list of each body is what BitBounty reads as the acceptance criteria.
- **Script:** [`scripts/demo-repo.sh`](../../scripts/demo-repo.sh) creates the repo from that folder, the labels and the issues, reading this file (keep the `### Issue N ·`, `Labels:` and `issue-body` markers intact).

The seed data of the board (`pnpm db:seed`) uses other repos (`Djbrl/sunu-wallet`, `Djbrl/teranga-ui`, `Djbrl/xof-rates`) so it never collides with this one.

## Set it up (human, ~5 minutes)
```sh
scripts/demo-repo.sh --dry-run   # prints what it would create, touches nothing
scripts/demo-repo.sh             # creates Djbrl/bitbounty-demo, labels, 6 issues (safe to re-run)
```
Then:
1. Install the BitBounty GitHub App on `Djbrl/bitbounty-demo` (github.com/settings/installations → the app → Repository access).
2. Fund the issues that should already show on the board (comment on each, as Djbrl): `/bounty 7500` on the rate issue, `/bounty 5000` on the docs issue. Leave **issue 1 unfunded**: it is funded live. Leave **issue 2 (Wolof) without any bounty**: Claude Code posts it through MCP in the agent demo ([agent-demo.md](agent-demo.md)), and an issue gets one bounty, ever.
3. Check that `main` is green in the Actions tab.

## On stage: the live bug (issue 1)
| Step | Who | What |
| --- | --- | --- |
| 1 | maintainer | On issue 1, comment `/bounty 10000`, pay the Lightning invoice from the status comment |
| 2 | developer | `/claim` |
| 3 | developer | In `src/fcfa.js`, add the `g` flag to the regex in `groupThousands`, add a test (diff below), open a PR titled `Fix thousands grouping for amounts of a million or more` with `Fixes #1` in the body |
| 4 | CI + Claude | `npm test` green, the BitBounty check run says every criterion is met |
| 5 | maintainer | Merge: the developer is paid 10 000 FCFA in sats to their Lightning Address, the receipt shows on the issue and the board |

The fix (one character plus a test):
```diff
--- a/src/fcfa.js
+++ b/src/fcfa.js
-  return sign + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/, " ");
+  return sign + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
--- a/test/fcfa.test.js
+++ b/test/fcfa.test.js
+test("groups every thousand, not only the last one", () => {
+  assert.equal(formatXof(1500000), "1 500 000 FCFA");
+  assert.equal(formatXof(1000000000), "1 000 000 000 FCFA");
+  assert.equal(formatSats(12345678), "12 345 678 sats");
+});
```
Without the `g`, only the last group gets a space: `formatXof(1500000)` returns `"1 500000 FCFA"` (checked: the shipped tests pass because they stop at 25 000; with the fix, all pass).

## Issues

### Issue 1 · formatXof shows "1 500000 FCFA" for amounts of a million or more
Labels: `bug` `good first issue` · Bounty: 10 000 FCFA, funded live on stage

<!-- issue-body:start -->
Amounts of one million FCFA or more are grouped wrongly: only the last three digits get a space.

#### Steps to reproduce
```sh
node -e 'import("./src/fcfa.js").then((m) => console.log(m.formatXof(1500000)))'
```

- **Expected:** `1 500 000 FCFA` (what the README promises)
- **Actual:** `1 500000 FCFA`

`formatSats` has the same problem: `formatSats(12345678)` gives `12 345678 sats`. Payouts above a million sats look broken on receipts.

Where to look: `groupThousands` in `src/fcfa.js`, used by both functions.

#### Done when
- `formatXof(1500000)` returns `1 500 000 FCFA` and `formatXof(1000000000)` returns `1 000 000 000 FCFA`
- `formatSats(12345678)` returns `12 345 678 sats`
- A test in `test/fcfa.test.js` covers amounts of one million and more
- `npm test` passes
<!-- issue-body:end -->

### Issue 2 · Add a Wolof (wo) translation of the messages
Labels: `translation` `good first issue` `help wanted` · Bounty: 15 000 FCFA, posted live by Claude Code through MCP ([agent-demo.md](agent-demo.md)), then funded by the owner

<!-- issue-body:start -->
Most people who use this library in Senegal speak Wolof first. The messages only exist in English and French (`locales/en.json`, `locales/fr.json`).

Add `locales/wo.json` with a Wolof translation of every message, and add `"wo"` to `LANGUAGES` in `src/i18n.js`.

Keep the `{name}`, `{amount}` and `{address}` placeholders as they are, and keep "Lightning Address" in English if there is no common Wolof word for it.

#### Done when
- `locales/wo.json` has every key of `locales/en.json`, and only those
- `"wo"` is in `LANGUAGES` and `t("wo", "welcome", { name: "Awa" })` returns the Wolof message with the name filled in
- Placeholders (`{name}`, `{amount}`, `{address}`) are unchanged in every message
- A native Wolof speaker approves the wording in the pull request
- `npm test` passes
<!-- issue-body:end -->

### Issue 3 · xofToSats returns Infinity or NaN when the rate is missing or 0
Labels: `bug` · Bounty: 7 500 FCFA, funded before the demo

<!-- issue-body:start -->
When the exchange rate could not be fetched, callers pass `0` or `undefined`, and the conversion silently returns a number that is not an amount:

```js
xofToSats(10000, 0);         // Infinity
xofToSats(10000, undefined); // NaN
satsToXof(16129, undefined); // NaN
```

That value then ends up in an invoice. It should fail loudly instead.

#### Done when
- `xofToSats` and `satsToXof` throw a `RangeError` when the rate is missing, not a number, 0 or negative
- The error message says which rate was given
- Valid rates still give the same results as today
- Covered by tests, `npm test` passes
<!-- issue-body:end -->

### Issue 4 · README: show a payout in sats and FCFA, step by step
Labels: `documentation` `good first issue` · Bounty: 5 000 FCFA, funded before the demo

<!-- issue-body:start -->
New users ask how to show "you received 16 129 sats (10 000 FCFA)". The README has one-line examples but no complete one.

#### Done when
- The README has a "Show a payout" section with a runnable example that converts an FCFA amount to sats at a given rate and prints both with `formatSats` and `formatXof`
- The example says where the rate comes from and that it is in FCFA per bitcoin
- Every code sample in the README runs as written with Node 20
<!-- issue-body:end -->

### Issue 5 · parseXof(): read "25 000 FCFA", "25.000 F CFA" and "25000"
Labels: `enhancement` · Bounty: 12 500 FCFA (optional, leave unfunded if short on time)

<!-- issue-body:start -->
Forms and chat messages write amounts in many ways. We need the reverse of `formatXof`.

#### Done when
- `parseXof(text)` is exported from `src/fcfa.js` and returns a whole number of FCFA
- It accepts spaces, non-breaking spaces or dots as thousands separators, and an optional `FCFA`, `F CFA`, `CFA` or `XOF` suffix, in any case: `"25 000 FCFA"`, `"25.000 F CFA"`, `"25000"` and `"25 000 xof"` all give `25000`
- It throws a `RangeError` for anything else (`"abc"`, `"12,5"`, an empty string, a negative amount)
- Covered by tests, `npm test` passes
<!-- issue-body:end -->

### Issue 6 · Add formatXofShort(): "1,5 M FCFA" and "25 k FCFA"
Labels: `enhancement` · No bounty (shows an unfunded issue on the repo)

<!-- issue-body:start -->
Dashboards and small screens need short amounts.

#### Done when
- `formatXofShort(amount)` is exported from `src/fcfa.js`
- Below 1 000 it is the same as `formatXof`; from 1 000 it uses `k` and from 1 000 000 `M`, with at most one decimal and a comma as decimal separator: `25000` → `25 k FCFA`, `1500000` → `1,5 M FCFA`, `2000000` → `2 M FCFA`
- Covered by tests, `npm test` passes
<!-- issue-body:end -->

## Check the fix offline
Issue 1 gives a one-line repro, the expected and actual output, and the function to look at. The fix is one character and the test is three lines. Try it: copy `docs/demo/bitbounty-demo/` somewhere, run `npm test` (11 pass), apply the diff above, run it again (12 pass).
