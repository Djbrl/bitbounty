// Generates fixtures/*.json (source of truth for the fixture content).
// Run: node fixtures/generate.mjs && node fixtures/check.mjs
// Hand-editing the JSON is fine too, but regenerate-then-check keeps cross-file ids consistent.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRANSITIONS } from './types.ts';

const OUT = process.argv[2] ?? dirname(fileURLToPath(import.meta.url));
const hex = (seed, n = 64) => createHash('sha256').update(seed).digest('hex').slice(0, n);
const T = (day, h, m = 0) => `2026-10-${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
const addH = (iso, h) => new Date(Date.parse(iso) + h * 3600e3).toISOString().replace('.000Z', 'Z');
const fee = (a) => Math.round(a * 0.05);
const buf = (a) => Math.round(a * 0.03);
const SATS_PER_XOF = 1.618; // BTC ≈ $110k, $1 ≈ 562 FCFA
const toSats = (xof) => Math.round(xof * SATS_PER_XOF);
const toUsdtUnits = (xof) => Math.ceil((xof / 562) * 100) * 10_000; // 1 USDT = 1_000_000 units, cent precision
const toKobo = (xof) => Math.ceil((xof * 2.633) / 1000) * 1000 * 100; // ₦1,000 steps (simulate-deposit)
const label = (a) => `💰 ${a.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} FCFA`;

// ---------------- users ----------------
const users = {
  'awa-ndiaye': { name: 'Awa Ndiaye', city: 'Dakar', gid: 81234567, langs: ['TypeScript', 'Go'] },
  'moussa-diop': { name: 'Moussa Diop', city: 'Thiès', gid: 70456123, langs: ['TypeScript', 'Python'] },
  'fatou-sall': { name: 'Fatou Sall', city: 'Dakar', gid: 93311802, langs: ['TypeScript', 'Rust'] },
  'ibou-fall': { name: 'Ibrahima Fall', city: 'Saint-Louis', gid: 66120934, langs: ['JavaScript', 'PHP'] },
  'seynabou-gueye': { name: 'Seynabou Guèye', city: 'Dakar', gid: 102938475, langs: ['Wolof', 'Markdown', 'TypeScript'] },
  'cheikh-ba': { name: 'Cheikh Ba', city: 'Ziguinchor', gid: 88776655, langs: ['TypeScript'] },
  Djbrl: { name: 'Djibril Sy', city: 'Dakar', gid: 12345678, langs: ['TypeScript'] },
  'chidi-okafor': { name: 'Chidi Okafor', city: 'Lagos', gid: 55443322, langs: ['TypeScript', 'Kotlin'] },
};
const userObj = (login) => {
  const u = users[login];
  return {
    id: `usr_${hex(login, 10)}`,
    githubId: u.gid,
    login,
    avatarUrl: `https://avatars.githubusercontent.com/u/${u.gid}?v=4`,
    createdAt: '2021-03-14T10:22:00Z',
    name: u.name,
    city: u.city,
  };
};
// B6: developers are paid in sats over Lightning, to their Lightning Address (always masked in the API).
const wallets = {
  'awa-ndiaye': 'aw***@blink.sv',
  'moussa-diop': 'mo***@walletofsatoshi.com',
  'fatou-sall': 'fa***@blink.sv',
  'ibou-fall': 'ib***@getalby.com',
  'seynabou-gueye': 'se***@blink.sv',
  'cheikh-ba': 'ch***@blink.sv',
};
const XOF_PER_BTC = Math.round(1e8 / SATS_PER_XOF);
/** Sats a payout sends: rounded down, as B6 does. */
const payoutSats = (xof) => Math.floor((xof * 1e8) / XOF_PER_BTC);
const groupSats = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} sats`;

// ---------------- bounties ----------------
const REPO = 'teranga-labs/bitnob-js';
const funderId = (kind, login) => (kind === 'agent' ? `agt_${hex(login, 10)}` : `usr_${hex(login, 10)}`);
function base(id, repo, issue, title, amount, status, criteria, opts = {}) {
  const created = opts.created ?? T(17, 15, 10);
  const kind = opts.funderKind ?? 'human';
  const funder = opts.funder ?? 'Djbrl';
  return {
    // core Bounty
    id,
    repoFullName: repo,
    issueNumber: issue,
    issueTitle: title,
    amountXof: amount,
    status,
    criteria: criteria.map((text) => ({ text })),
    funderKind: kind,
    funderId: funderId(kind, funder),
    verdict: null, // set by detail() from the timeline
    statusCommentId: 2400000000 + issue * 7,
    createdAt: created,
    expiresAt: opts.expiresAt ?? addH(created, 24 * 60),
    // view
    issueUrl: `https://github.com/${repo}/issues/${issue}`,
    criteriaConfirmed: opts.criteriaConfirmed ?? true,
    funderLogin: funder,
    labels: status === 'unfunded' || status === 'cancelled' ? ['bounty'] : ['bounty', label(amount)],
    updatedAt: created,
  };
}
function funding(b, rail, at, status = 'paid') {
  const total = b.amountXof + fee(b.amountXof) + buf(b.amountXof);
  const [amt, cur] =
    rail === 'lightning' ? [toSats(total), 'BTC'] : rail === 'usdt' ? [toUsdtUnits(total), 'USDT'] : [toKobo(total), 'NGN'];
  return {
    id: `fnd_${b.id.slice(2)}_1`,
    bountyId: b.id,
    rail,
    sourceAmount: amt,
    sourceCurrency: cur,
    bitnobRef: `fund-${b.id}-1`,
    paymentHash: rail === 'lightning' ? hex(`ph-${b.id}`) : null,
    status,
    paidAt: status === 'paid' ? at : null,
    feeXof: fee(b.amountXof),
    bufferXof: buf(b.amountXof),
    createdAt: addH(at, -0.1),
  };
}
const claim = (b, login, at, status, extended = false) => ({
  id: `clm_${b.id.slice(2)}_${login.split('-')[0]}`,
  bountyId: b.id,
  userId: `usr_${hex(login, 10)}`,
  status,
  expiresAt: addH(at, extended ? 96 : 72),
  userLogin: login,
  extended,
  createdAt: at,
});
function submission(b, pr, login, at, ci, verdict, report, mergedAt = null, spam = 4) {
  return {
    id: `sub_${b.id.slice(2)}_${pr}`,
    bountyId: b.id,
    prNumber: pr,
    authorLogin: login,
    headSha: hex(`sha-${b.id}-${pr}`, 40),
    verdict,
    report,
    spamScore: spam,
    mergedAt,
    prUrl: `https://github.com/${b.repoFullName}/pull/${pr}`,
    ci,
    createdAt: at,
  };
}
const report = (b, mets, verdict, summary, flags = []) => ({
  criteria: b.criteria.map(({ text }, i) => ({ text, met: mets[i][0], evidence: mets[i][1] })),
  verdict,
  summary,
  riskFlags: flags,
});
function payout(b, login, at, status, attempts, lastError = null, paidAt = null) {
  return {
    id: `pyt_${b.id.slice(2)}`,
    bountyId: b.id,
    userId: `usr_${hex(login, 10)}`,
    amountXof: b.amountXof,
    quoteId: `qt_${hex(`q-${b.id}`, 16)}`,
    bitnobPayoutId: status === 'pending' ? null : `PAYOUT_${hex(`p-${b.id}`, 10).toUpperCase()}`,
    reference: `pay-${b.id}`,
    status,
    attempts,
    lastError,
    paidAt,
    rail: 'lightning',
    lightningAddress: wallets[login],
    amountSats: payoutSats(b.amountXof),
    xofPerBtc: XOF_PER_BTC,
    paymentHash: hex(`ph-${b.id}`),
    userLogin: login,
    createdAt: at,
  };
}
const ev = (occurredAt, type, actor, text) => ({ occurredAt, type, actor, text });

// Replays the timeline through core's TRANSITIONS (mirrored in types.ts): fills `to` on each
// event and bounty.verdict, and throws if the fixture is not a legal path to bounty.status.
function replay(d) {
  let status = 'unfunded';
  let verdict = null;
  for (const e of d.timeline) {
    if (e.type === 'bounty.created') { e.to = 'unfunded'; continue; }
    const targets = TRANSITIONS[status]?.[e.type] ?? [];
    if (!targets.length) throw new Error(`${d.id}: ${e.type} is illegal from ${status}`);
    let to = targets[0];
    if (e.type === 'verify.done') verdict = d.submission.verdict;
    if (e.type === 'pr.linked' || e.type === 'maintainer.reject') verdict = null;
    if (e.type === 'pr.merged') to = verdict === 'pass' && d.submission.ci === 'success' ? 'verified' : 'on_hold';
    e.to = status = to;
  }
  if (status !== d.status) throw new Error(`${d.id}: timeline ends in ${status}, bounty says ${d.status}`);
  d.verdict = verdict;
}

const B = [];
function detail(b, { fundings = [], claims = [], submission = null, payout = null, timeline = [] }) {
  const d = { ...b, fundings, claims, submission, payout, timeline };
  if (timeline.length) d.updatedAt = timeline[timeline.length - 1].occurredAt;
  replay(d);
  B.push(d);
  return d;
}

// b-101 unfunded — criteria drafted by Claude, not yet confirmed
{
  const b = base('b-101', REPO, 21, 'payouts.finalize: retry with exponential backoff on 5xx', 15000, 'unfunded', [
    'finalize() retries up to 3 times on HTTP 5xx with 1 s, 2 s, 4 s delays',
    'The same idempotency reference is reused on every retry',
    'Unit test simulates two 503 responses then a 200',
  ], { criteriaConfirmed: false, created: T(17, 15, 40) });
  detail(b, { timeline: [ev(T(17, 15, 40), 'bounty.created', 'Djbrl', '/bounty 15000 — criteria drafted by Claude, waiting for /criteria ok')] });
}
// b-102 funded (lightning)
{
  const b = base('b-102', 'teranga-labs/xof', 3, 'formatXOF(): use a narrow no-break space as thousands separator', 5000, 'funded', [
    'formatXOF(10000) returns "10 000 FCFA" with U+202F',
    'Negative amounts keep the minus sign before the digits',
    'README example updated',
  ], { created: T(17, 15, 20) });
  const f = funding(b, 'lightning', T(17, 15, 26));
  const r = report(b, [
    [true, 'src/format.ts:7 uses \\u202F'],
    [false, 'formatXOF(-500) returns "500- FCFA"'],
    [false, 'README.md unchanged'],
  ], 'fail', 'Separator fixed, but negative amounts are broken and the README was not updated.');
  detail(b, {
    fundings: [f],
    claims: [claim(b, 'ibou-fall', T(17, 16, 10), 'released'), claim(b, 'cheikh-ba', T(17, 17, 10), 'released')],
    submission: submission(b, 4, 'cheikh-ba', T(17, 18, 0), 'success', 'fail', r),
    timeline: [
      ev(T(17, 15, 20), 'bounty.created', 'Djbrl', '/bounty 5000'),
      ev(T(17, 15, 26), 'funding.paid', 'bitnob', `Funded over Lightning: ${f.sourceAmount.toLocaleString('en')} sats`),
      ev(T(17, 16, 10), 'claim.created', 'ibou-fall', '/claim'),
      ev(T(17, 17, 2), 'claim.released', 'ibou-fall', '/unclaim — bounty open again'),
      ev(T(17, 17, 10), 'claim.created', 'cheikh-ba', '/claim'),
      ev(T(17, 18, 0), 'pr.linked', 'cheikh-ba', 'PR #4 "Fixes #3"'),
      ev(T(17, 18, 3), 'verify.done', 'bitbounty', 'Claude: ❌ 1/3 criteria met'),
      ev(T(17, 18, 30), 'maintainer.reject', 'Djbrl', '/reject negative amounts broken — bounty open again'),
    ],
  });
}
// b-103 claimed (active claim)
{
  const b = base('b-103', REPO, 14, 'lightning.createInvoice(): return expires_at as an ISO date', 10000, 'claimed', [
    'createInvoice() response includes expires_at (ISO 8601, UTC)',
    'Type definitions updated in src/types.ts',
    'Test covers the 900 s default expiry',
  ], { created: T(17, 15, 15) });
  detail(b, {
    fundings: [funding(b, 'lightning', T(17, 15, 31))],
    claims: [claim(b, 'awa-ndiaye', T(17, 16, 5), 'active')],
    timeline: [
      ev(T(17, 15, 15), 'bounty.created', 'Djbrl', '/bounty 10000'),
      ev(T(17, 15, 31), 'funding.paid', 'bitnob', 'Funded over Lightning'),
      ev(T(17, 16, 5), 'claim.created', 'awa-ndiaye', '/claim — locked until Mon 20 Oct 16:05'),
    ],
  });
}
// b-104 submitted — verifier says fail (criterion missing)
{
  const b = base('b-104', REPO, 9, 'Add HMAC signature helper for webhook verification', 12000, 'submitted', [
    'verifyWebhook(body, signature, secret) uses timing-safe comparison',
    'Rejects signatures older than 5 minutes',
    'Tests cover valid, tampered and expired payloads',
  ], { created: T(17, 15, 12) });
  const r = report(b, [
    [true, 'src/webhooks.ts:18 uses crypto.timingSafeEqual'],
    [false, 'No timestamp check found in src/webhooks.ts'],
    [true, 'test/webhooks.test.ts: 3 cases, expired case missing'],
  ], 'fail', 'Signature check is correct and timing-safe. The 5-minute freshness rule from the criteria is not implemented.');
  detail(b, {
    fundings: [funding(b, 'usdt', T(17, 15, 35))],
    claims: [claim(b, 'moussa-diop', T(17, 15, 50), 'active')],
    submission: submission(b, 31, 'moussa-diop', T(17, 18, 40), 'success', 'fail', r),
    timeline: [
      ev(T(17, 15, 12), 'bounty.created', 'Djbrl', '/bounty 12000'),
      ev(T(17, 15, 35), 'funding.paid', 'bitnob', 'Funded in USDT (TRON)'),
      ev(T(17, 15, 50), 'claim.created', 'moussa-diop', '/claim'),
      ev(T(17, 18, 40), 'pr.linked', 'moussa-diop', 'PR #31 "Fixes #9"'),
      ev(T(17, 18, 44), 'verify.done', 'bitbounty', 'Claude: ❌ 2/3 criteria met — freshness check missing'),
    ],
  });
}
// b-105 verified — merged, pass, objection window running
{
  const b = base('b-105', REPO, 17, 'Typed error classes for Bitnob API errors', 8000, 'verified', [
    'BitnobError exposes status, code and request_id',
    'RateLimitError is thrown on HTTP 429 with retry_after',
    'All public methods document the errors they throw',
  ], { created: T(17, 15, 18) });
  const r = report(b, [
    [true, 'src/errors.ts:4-31'],
    [true, 'src/http.ts:57 maps 429 → RateLimitError(retry_after)'],
    [true, 'JSDoc @throws added on 14 public methods'],
  ], 'pass', 'All three criteria are met with tests. Changes are limited to the error layer.');
  detail(b, {
    fundings: [funding(b, 'lightning', T(17, 15, 29))],
    claims: [claim(b, 'cheikh-ba', T(17, 16, 0), 'done')],
    submission: submission(b, 33, 'cheikh-ba', T(17, 19, 10), 'success', 'pass', r, T(17, 21, 2)),
    timeline: [
      ev(T(17, 15, 18), 'bounty.created', 'Djbrl', '/bounty 8000'),
      ev(T(17, 15, 29), 'funding.paid', 'bitnob', 'Funded over Lightning'),
      ev(T(17, 16, 0), 'claim.created', 'cheikh-ba', '/claim'),
      ev(T(17, 19, 10), 'pr.linked', 'cheikh-ba', 'PR #33 "Fixes #17"'),
      ev(T(17, 19, 13), 'verify.done', 'bitbounty', 'Claude: ✅ 3/3 criteria met'),
      ev(T(17, 21, 2), 'pr.merged', 'Djbrl', 'PR #33 merged — objection window 24 h (ends Sat 18 Oct 21:02)'),
    ],
  });
}
// b-106 paying — payout processing
{
  const b = base('b-106', 'galsen-oss/wolof-i18n', 4, 'Wolof translations for the checkout screens', 7500, 'paying', [
    'All 42 keys in locales/en/checkout.json have a Wolof value in locales/wo/checkout.json',
    'Amounts and placeholders ({amount}, {name}) are preserved',
    'Reviewed by a second Wolof speaker in the PR',
  ], { created: T(17, 16, 30), funder: 'Djbrl' });
  const r = report(b, [
    [true, '42/42 keys present'],
    [true, 'Placeholders unchanged in all 42 strings'],
    [true, 'Approved review by @fatou-sall'],
  ], 'pass', 'Complete translation, placeholders intact, peer-reviewed.');
  detail(b, {
    fundings: [funding(b, 'lightning', T(17, 16, 33))],
    claims: [claim(b, 'seynabou-gueye', T(17, 16, 50), 'done')],
    submission: submission(b, 6, 'seynabou-gueye', T(17, 20, 15), 'success', 'pass', r, T(17, 22, 30)),
    payout: payout(b, 'seynabou-gueye', T(17, 22, 31), 'processing', 1),
    timeline: [
      ev(T(17, 16, 30), 'bounty.created', 'Djbrl', '/bounty 7500'),
      ev(T(17, 16, 33), 'funding.paid', 'bitnob', 'Funded over Lightning'),
      ev(T(17, 16, 50), 'claim.created', 'seynabou-gueye', '/claim'),
      ev(T(17, 20, 15), 'pr.linked', 'seynabou-gueye', 'PR #6 "Fixes #4"'),
      ev(T(17, 20, 17), 'verify.done', 'bitbounty', 'Claude: ✅ 3/3 criteria met'),
      ev(T(17, 22, 30), 'pr.merged', 'Djbrl', 'PR #6 merged (/pay now)'),
      ev(T(17, 22, 31), 'payout.started', 'bitbounty', `Payout to se***@blink.sv over Lightning: ${groupSats(payoutSats(7500))} — processing`),
    ],
  });
}
// b-107 paid — the headline happy path (receipt r-107)
{
  const b = base('b-107', REPO, 12, 'Add payouts.quote() for SN mobile money', 10000, 'paid', [
    'payouts.quote({ country: "SN", settlement_amount }) returns quote_id and expires_at',
    'Uses the /api/payouts/quotes endpoint with source "offchain"',
    'Test with recorded sandbox response',
  ], { created: T(17, 15, 5) });
  const r = report(b, [
    [true, 'src/payouts.ts:22-48'],
    [true, 'src/payouts.ts:31 body.source = "offchain"'],
    [true, 'test/payouts.quote.test.ts with fixture sandbox-quote-sn.json'],
  ], 'pass', 'quote() implemented as specified, with a recorded sandbox fixture. No unrelated changes.');
  detail(b, {
    fundings: [funding(b, 'lightning', T(17, 15, 9))],
    claims: [claim(b, 'awa-ndiaye', T(17, 15, 22), 'done')],
    submission: submission(b, 34, 'awa-ndiaye', T(17, 17, 48), 'success', 'pass', r, T(17, 18, 20)),
    payout: payout(b, 'awa-ndiaye', T(17, 18, 21), 'succeeded', 1, null, T(17, 18, 26)),
    timeline: [
      ev(T(17, 15, 5), 'bounty.created', 'Djbrl', '/bounty 10000'),
      ev(T(17, 15, 9), 'funding.paid', 'bitnob', 'Funded over Lightning: 17 474 sats'),
      ev(T(17, 15, 22), 'claim.created', 'awa-ndiaye', '/claim'),
      ev(T(17, 17, 48), 'pr.linked', 'awa-ndiaye', 'PR #34 "Fixes #12"'),
      ev(T(17, 17, 51), 'verify.done', 'bitbounty', 'Claude: ✅ 3/3 criteria met'),
      ev(T(17, 18, 20), 'pr.merged', 'Djbrl', 'PR #34 merged'),
      ev(T(17, 18, 21), 'payout.started', 'bitbounty', `Payout to aw***@blink.sv over Lightning: ${groupSats(payoutSats(10000))}`),
      ev(T(17, 18, 26), 'payout.succeeded', 'bitnob', `💸 Paid 10 000 FCFA (${groupSats(payoutSats(10000))}) to @awa-ndiaye over Lightning · 6 min after the merge`),
    ],
  });
}
// b-108 payout_failed — 3 attempts, the developer's Lightning wallet never answered
{
  const b = base('b-108', REPO, 19, 'README: quick start in French', 3000, 'payout_failed', [
    'README.fr.md covers install, auth and one payout example',
    'Linked from the main README',
  ], { created: T(17, 15, 45) });
  const r = report(b, [
    [true, 'README.fr.md, 3 sections'],
    [true, 'README.md:5'],
  ], 'unsure', 'French quick start complete and linked. Claude cannot judge the quality of the French prose.', ['natural-language quality not machine-checkable']);
  detail(b, {
    fundings: [funding(b, 'lightning', T(17, 15, 48))],
    claims: [claim(b, 'moussa-diop', T(17, 16, 20), 'done')],
    submission: submission(b, 32, 'moussa-diop', T(17, 17, 30), 'success', 'unsure', r, T(17, 18, 58)),
    payout: payout(b, 'moussa-diop', T(17, 19, 1), 'failed', 3, 'lnurl unreachable: mo***@walletofsatoshi.com: LNURL server timed out after 10000 ms'),
    timeline: [
      ev(T(17, 15, 45), 'bounty.created', 'Djbrl', '/bounty 3000'),
      ev(T(17, 15, 48), 'funding.paid', 'bitnob', 'Funded over Lightning'),
      ev(T(17, 16, 20), 'claim.created', 'moussa-diop', '/claim'),
      ev(T(17, 17, 30), 'pr.linked', 'moussa-diop', 'PR #32 "Fixes #19"'),
      ev(T(17, 17, 33), 'verify.done', 'bitbounty', 'Claude: ⚠️ unsure — 2/2 criteria met, prose quality not checkable'),
      ev(T(17, 18, 58), 'pr.merged', 'Djbrl', 'PR #32 merged — verdict unsure, on hold for the maintainer'),
      ev(T(17, 19, 0), 'maintainer.pay', 'Djbrl', '/pay — French reviewed by hand'),
      ev(T(17, 19, 1), 'payout.started', 'bitbounty', `Payout to mo***@walletofsatoshi.com over Lightning: ${groupSats(payoutSats(3000))} (attempt 1)`),
      ev(T(17, 19, 2), 'payout.failed', 'bitnob', "Attempt 1/3 failed: the developer's Lightning wallet didn't answer"),
      ev(T(17, 19, 3), 'payout.started', 'bitbounty', 'Retry (attempt 2)'),
      ev(T(17, 19, 4), 'payout.failed', 'bitnob', "Attempt 2/3 failed: the developer's Lightning wallet didn't answer"),
      ev(T(17, 19, 8), 'payout.started', 'bitbounty', 'Retry (attempt 3)'),
      ev(T(17, 19, 9), 'payout.failed', 'bitnob', 'Attempt 3/3 failed — @moussa-diop asked to check their Lightning Address. The 3 000 FCFA stay reserved for them.'),
    ],
  });
}
// b-109 on_hold — verifier unsure, maintainer /hold before merging
{
  const b = base('b-109', 'teranga-labs/xof', 5, 'parseXOF(): accept "10.000 F" and "10 000 FCFA"', 6000, 'on_hold', [
    'parseXOF accepts dot, space and U+202F separators',
    'Accepts the suffixes F, FCFA and XOF',
    'Returns an integer, throws on decimals',
  ], { created: T(17, 15, 25) });
  const r = report(b, [
    [true, 'src/parse.ts:9 regex covers the 3 separators'],
    [true, 'src/parse.ts:12'],
    [false, 'Decimals are rounded instead of throwing (src/parse.ts:20) — unclear if intended'],
  ], 'unsure', 'Separators and suffixes are handled. Decimal input is rounded silently, which contradicts criterion 3 unless the maintainer accepts it.', ['changes rounding behaviour of an existing helper']);
  detail(b, {
    fundings: [funding(b, 'lightning', T(17, 15, 27))],
    claims: [claim(b, 'ibou-fall', T(17, 15, 55), 'done')],
    submission: submission(b, 8, 'ibou-fall', T(17, 18, 5), 'success', 'unsure', r, null, 12),
    timeline: [
      ev(T(17, 15, 25), 'bounty.created', 'Djbrl', '/bounty 6000'),
      ev(T(17, 15, 27), 'funding.paid', 'bitnob', 'Funded over Lightning'),
      ev(T(17, 15, 55), 'claim.created', 'ibou-fall', '/claim'),
      ev(T(17, 18, 5), 'pr.linked', 'ibou-fall', 'PR #8 "Fixes #5"'),
      ev(T(17, 18, 8), 'verify.done', 'bitbounty', 'Claude: ⚠️ unsure — decimals rounded instead of rejected'),
      ev(T(17, 20, 52), 'maintainer.hold', 'Djbrl', '/hold — rounding change needs a decision (see #11)'),
    ],
  });
}
// b-110 refunded — closed "not planned", nobody claimed
{
  const b = base('b-110', REPO, 7, 'Support Bitnob v1 legacy endpoints', 20000, 'refunded', [
    'All /v1 endpoints are reachable through client.legacy',
    'Deprecation warning logged once per process',
  ], { created: T(17, 15, 2) });
  const f = funding(b, 'lightning', T(17, 15, 6));
  detail(b, {
    fundings: [f],
    timeline: [
      ev(T(17, 15, 2), 'bounty.created', 'Djbrl', '/bounty 20000'),
      ev(T(17, 15, 6), 'funding.paid', 'bitnob', 'Funded over Lightning'),
      ev(T(17, 17, 0), 'bounty.cancelled', 'bitbounty', 'Issue closed as not planned before any claim — 21 600 FCFA returned to the funder balance'),
    ],
  });
}
// b-111 cancelled — /cancel before funding
{
  const b = base('b-111', 'galsen-oss/wolof-i18n', 2, 'Pulaar locale scaffolding', 5000, 'cancelled', [
    'locales/ff/ folder with the same keys as locales/en/',
  ], { created: T(17, 16, 0) });
  detail(b, {
    timeline: [
      ev(T(17, 16, 0), 'bounty.created', 'Djbrl', '/bounty 5000'),
      ev(T(17, 16, 45), 'bounty.cancelled', 'Djbrl', '/cancel — merged into #4, never funded'),
    ],
  });
}
// b-112 funded again after claim.expired (demo timer: 5 min)
{
  const b = base('b-112', REPO, 23, 'Add ESM + CJS dual build', 9000, 'funded', [
    'package.json exports both import and require entry points',
    'npm pack output contains dist/esm and dist/cjs',
    'CI job runs a smoke test with both module systems',
  ], { created: T(17, 15, 30) });
  const c = claim(b, 'cheikh-ba', T(17, 15, 40), 'expired');
  c.expiresAt = T(17, 15, 45); // demo timer 5 min
  detail(b, {
    fundings: [funding(b, 'usdt', T(17, 15, 33))],
    claims: [c],
    timeline: [
      ev(T(17, 15, 30), 'bounty.created', 'Djbrl', '/bounty 9000'),
      ev(T(17, 15, 33), 'funding.paid', 'bitnob', 'Funded in USDT (TRON)'),
      ev(T(17, 15, 40), 'claim.created', 'cheikh-ba', '/claim'),
      ev(T(17, 15, 45), 'claim.expired', 'bitbounty', 'No PR before the deadline — @cheikh-ba unassigned, bounty open again'),
    ],
  });
}
// b-113 Lagos route: funded in naira by a Lagos maintainer, paid in sats over Lightning in Dakar
{
  const b = base('b-113', 'naija-rails/ngn-kit', 41, 'Validate NUBAN account numbers (check digit)', 10000, 'paid', [
    'isValidNuban(bankCode, account) implements the CBN check-digit algorithm',
    'Covers 10-digit accounts with 3- and 6-digit bank codes',
    'Tests with 5 valid and 5 invalid numbers',
  ], { created: T(17, 23, 0), funder: 'chidi-okafor' });
  const r = report(b, [
    [true, 'src/nuban.ts:3-40'],
    [true, 'src/nuban.ts:12 pads 3-digit codes to 6'],
    [true, 'test/nuban.test.ts: 10 cases'],
  ], 'pass', 'Algorithm matches the CBN spec, tests cover both bank-code lengths.');
  detail(b, {
    fundings: [funding(b, 'ngn', T(17, 23, 14))],
    claims: [claim(b, 'fatou-sall', T(17, 23, 20), 'done')],
    submission: submission(b, 44, 'fatou-sall', T(18, 1, 5), 'success', 'pass', r, T(18, 1, 30)),
    payout: payout(b, 'fatou-sall', T(18, 1, 31), 'succeeded', 1, null, T(18, 1, 35)),
    timeline: [
      ev(T(17, 23, 0), 'bounty.created', 'chidi-okafor', '/bounty 10000'),
      ev(T(17, 23, 14), 'funding.paid', 'bitnob', 'Bank transfer ₦29 000 received on the virtual account → traded NGN → BTC'),
      ev(T(17, 23, 20), 'claim.created', 'fatou-sall', '/claim'),
      ev(T(18, 1, 5), 'pr.linked', 'fatou-sall', 'PR #44 "Fixes #41"'),
      ev(T(18, 1, 8), 'verify.done', 'bitbounty', 'Claude: ✅ 3/3 criteria met'),
      ev(T(18, 1, 30), 'pr.merged', 'chidi-okafor', 'PR #44 merged'),
      ev(T(18, 1, 31), 'payout.started', 'bitbounty', `Payout to fa***@blink.sv over Lightning: ${groupSats(payoutSats(10000))}`),
      ev(T(18, 1, 35), 'payout.succeeded', 'bitnob', `💸 Paid 10 000 FCFA (${groupSats(payoutSats(10000))}) to @fatou-sall over Lightning · Lagos → Dakar in 5 min`),
    ],
  });
}
// b-114 agent-funded (Claude Code via MCP), claimed
{
  const b = base('b-114', 'Djbrl/bitbounty-demo', 3, 'Translate the onboarding SMS into Wolof', 5000, 'claimed', [
    'The 4 SMS templates in sms/fr.json have a Wolof version in sms/wo.json',
    'Each message stays under 160 characters',
    'Native speaker confirms the tone is polite (comment in the PR)',
  ], { created: T(18, 2, 10), funderKind: 'agent', funder: 'claude-code@Djbrl' });
  detail(b, {
    fundings: [funding(b, 'lightning', T(18, 2, 11))],
    claims: [claim(b, 'seynabou-gueye', T(18, 2, 20), 'active')],
    timeline: [
      ev(T(18, 2, 10), 'bounty.created', 'claude-code@Djbrl', 'post_bounty via MCP: "I can\'t check Wolof tone reliably → hiring a human"'),
      ev(T(18, 2, 11), 'funding.paid', 'bitnob', 'Funded from the agent budget (Lightning)'),
      ev(T(18, 2, 20), 'claim.created', 'seynabou-gueye', '/claim'),
    ],
  });
}

// ---------------- derived pages ----------------
const summary = (d) => {
  const { fundings, claims, submission, payout, timeline, ...b } = d;
  const active = claims.find((c) => c.status === 'active' || c.status === 'done');
  return { ...b, claimedBy: active?.userLogin ?? null, prNumber: submission?.prNumber ?? null };
};
const byId = Object.fromEntries(B.map((d) => [d.id, d]));
const paid = B.filter((d) => d.status === 'paid');
const minutes = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 60000);

const receipts = Object.fromEntries(
  paid.map((d) => {
    const f = d.fundings.find((x) => x.status === 'paid');
    const r = {
      id: `r-${d.id.slice(2)}`,
      bountyId: d.id,
      repoFullName: d.repoFullName,
      issueNumber: d.issueNumber,
      issueTitle: d.issueTitle,
      prNumber: d.submission.prNumber,
      prUrl: d.submission.prUrl,
      recipientLogin: d.payout.userLogin,
      amountXof: d.amountXof,
      lightningAddress: d.payout.lightningAddress,
      fundedWith: { rail: f.rail, sourceAmount: f.sourceAmount, sourceCurrency: f.sourceCurrency, funderLogin: d.funderLogin },
      mergedAt: d.submission.mergedAt,
      paidAt: d.payout.paidAt,
      minutesMergeToPay: minutes(d.submission.mergedAt, d.payout.paidAt),
      bitnobReference: d.payout.bitnobPayoutId,
      paidWith: { rail: 'lightning', amountSats: d.payout.amountSats, xofPerBtc: d.payout.xofPerBtc, paymentHash: d.payout.paymentHash },
      signature: `ed25519:${hex(`sig-${d.id}`, 64)}`,
    };
    return [r.id, r];
  }),
);

const publicStatuses = ['funded', 'claimed', 'submitted', 'verified', 'paying', 'paid'];
const board = {
  stats: {
    paidCount: 23,
    paidTotalXof: 187500,
    medianMinutesMergeToPay: 6,
    developersPaid: 9,
  },
  bounties: B.filter((d) => publicStatuses.includes(d.status)).map(summary),
  external: [
    { title: 'Add BOLT12 offer decoding', repoFullName: 'lightningdevkit/ldk-node', url: 'https://github.com/lightningdevkit/ldk-node/issues', amountUsdCents: 50000, source: 'external — paid in dollars elsewhere' },
    { title: 'Fix fee estimation on signet', repoFullName: 'bitcoindevkit/bdk', url: 'https://github.com/bitcoindevkit/bdk/issues', amountUsdCents: 30000, source: 'external — paid in dollars elsewhere' },
  ],
};

const mine = (d) => d.funderLogin === 'Djbrl';
const crit = (...xs) => xs.map((text) => ({ text }));
const dashboard = {
  maintainer: 'Djbrl',
  repos: [
    { fullName: 'teranga-labs/bitnob-js', openIssues: 40, activeBounties: 6, paidPct: 86 },
    { fullName: 'teranga-labs/xof', openIssues: 7, activeBounties: 2, paidPct: 100 },
    { fullName: 'galsen-oss/wolof-i18n', openIssues: 12, activeBounties: 1, paidPct: 75 },
  ],
  stats: {
    budgetXof: 150000,
    heldXof: B.filter((d) => ['funded', 'claimed', 'submitted', 'verified', 'paying', 'payout_failed', 'on_hold'].includes(d.status) && mine(d)).reduce((s, d) => s + d.amountXof, 0),
    spentXof: B.filter((d) => d.status === 'paid' && mine(d)).reduce((s, d) => s + d.amountXof, 0),
    activeCount: B.filter((d) => ['funded', 'claimed', 'submitted', 'verified', 'paying'].includes(d.status) && mine(d)).length,
    paidCount: B.filter((d) => d.status === 'paid' && mine(d)).length,
    medianMinutesMergeToPay: 6,
  },
  bountyIds: B.filter(mine).map((d) => d.id),
  needsAction: [
    { bountyId: 'b-101', action: 'confirm_criteria', text: 'Claude drafted 3 criteria for #21 — reply /criteria ok' },
    { bountyId: 'b-101', action: 'fund', text: '#21 is waiting for funding (15 000 FCFA)' },
    { bountyId: 'b-104', action: 'pay_or_reject', text: 'PR #31: Claude says 2/3 criteria — /pay or /reject' },
    { bountyId: 'b-109', action: 'pay_or_reject', text: 'PR #8 on hold (decimals rounded) — /pay or /reject' },
    { bountyId: 'b-108', action: 'update_account', text: 'Payout to @moussa-diop failed 3× — waiting for them to update their account' },
  ],
  backlog: [
    { id: 'sug-1', repoFullName: REPO, issueNumber: 25, issueTitle: 'Add virtualAccounts.simulateDeposit() for sandbox', criteria: crit('Calls POST /api/virtual-accounts/:id/simulate-deposit', 'Throws outside sandbox', 'Test with recorded response'), priceXof: 7500, reason: 'Small, testable, one endpoint. Good first paid issue.', confidence: 'high', selected: true },
    { id: 'sug-2', repoFullName: REPO, issueNumber: 26, issueTitle: 'Pagination helper for list endpoints', criteria: crit('paginate() async iterator over cursor-based endpoints', 'Works for payouts and invoices lists', 'Stops on empty page'), priceXof: 12000, reason: 'Clear scope, reused by 6 endpoints.', confidence: 'high', selected: true },
    { id: 'sug-3', repoFullName: REPO, issueNumber: 28, issueTitle: 'Document every payout error code', criteria: crit('docs/errors.md lists all payout error codes', 'Each code has cause and fix'), priceXof: 5000, reason: 'Docs task, easy to verify.', confidence: 'medium', selected: true },
    { id: 'sug-4', repoFullName: 'teranga-labs/xof', issueNumber: 8, issueTitle: 'Convert XOF ↔ GHS / NGN with a rates provider', criteria: crit('convert(amount, from, to, rates) returns an integer in the target minor unit', 'Rounding documented'), priceXof: 10000, reason: 'Needed for multi-country payouts. Criteria testable.', confidence: 'medium', selected: true },
    { id: 'sug-5', repoFullName: 'galsen-oss/wolof-i18n', issueNumber: 9, issueTitle: 'Wolof strings for error messages', criteria: crit('All keys in locales/en/errors.json translated', 'Reviewed by a second speaker'), priceXof: 6000, reason: 'Needs a human speaker — agents can\'t verify tone.', confidence: 'high', selected: true },
    { id: 'sug-6', repoFullName: REPO, issueNumber: 30, issueTitle: 'Rewrite the client in Rust', criteria: crit('Feature parity'), priceXof: 150000, reason: 'Too large and vague for a bounty — split it first.', confidence: 'low', selected: false },
  ],
};

const BRK = { amountXof: 10000, feeXof: 500, bufferXof: 300, totalXof: 10800 };
const fundingSessions = {
  lightning: { ...BRK, rail: 'lightning', invoice: 'lntbs174740n1pn' + hex('inv', 180).replace(/[^a-z0-9]/g, 'q') + 'cqpjsp5', paymentHash: hex('ph-session'), amountSats: 17474, expiresAt: T(17, 15, 20) },
  usdt: { ...BRK, rail: 'usdt', address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', network: 'TRON', amountUsdtUnits: 19_220_000, expiresAt: T(17, 15, 20) },
  ngn: { ...BRK, rail: 'ngn', virtualAccount: { bankName: 'Wema Bank (sandbox)', accountNumber: '9930481276', accountName: 'BitBounty / Chidi Okafor' }, amountKobo: 2900000, expiresAt: T(17, 15, 20) },
};

// PayoutAccountView: core PayoutAccount minus phoneE164/testAmountXof (never sent to the browser), plus phoneMasked.
const meAccount = (status) => ({
  userId: userObj('awa-ndiaye').id,
  country: 'SN',
  provider: 'wave',
  accountName: 'AWA NDIAYE',
  status,
  verifiedAt: status === 'verified' ? T(17, 14, 32) : null,
  lockedUntil: status === 'verified' ? T(20, 14, 32) : null,
  phoneMasked: '+221 77 ••• •• 42',
  // B6/U1: payouts go to this Lightning Address (masked); the mobile money fields are legacy.
  lightningAddress: 'aw***@blink.sv',
});
const meBase = (account, verified) => ({
  user: userObj('awa-ndiaye'),
  payoutAccount: account,
  earnings: verified ? { totalXof: 10000, paidCount: 1 } : { totalXof: 0, paidCount: 0 },
  activeClaims: verified ? [{ bountyId: 'b-103', issueTitle: byId['b-103'].issueTitle, repoFullName: byId['b-103'].repoFullName, expiresAt: byId['b-103'].claims[0].expiresAt }] : [],
  payouts: verified ? [{ bountyId: 'b-107', amountXof: 10000, status: 'succeeded', paidAt: T(17, 18, 26), receiptId: 'r-107' }] : [],
});
const me = {
  mock: { smsCode: '424242', testAmountXof: 137, defaultState: 'verified' },
  states: {
    new: meBase(null, false),
    pending: meBase(meAccount('pending'), false),
    sms_ok: meBase(meAccount('sms_ok'), false),
    verified: meBase(meAccount('verified'), true),
  },
};

const profile = (login) => {
  const work = paid
    .filter((d) => d.payout.userLogin === login)
    .map((d) => ({ bountyId: d.id, repoFullName: d.repoFullName, issueTitle: d.issueTitle, prNumber: d.submission.prNumber, amountXof: d.amountXof, paidAt: d.payout.paidAt, receiptId: `r-${d.id.slice(2)}` }));
  return {
    user: userObj(login),
    stats: {
      paidCount: work.length,
      totalXof: work.reduce((s, w) => s + w.amountXof, 0),
      repos: new Set(work.map((w) => w.repoFullName)).size,
      acceptedPct: 100,
      medianMinutesMergeToPay: 5,
    },
    languages: users[login].langs,
    work,
  };
};
const profiles = Object.fromEntries(['awa-ndiaye', 'fatou-sall', 'moussa-diop', 'seynabou-gueye'].map((l) => [l, profile(l)]));
profiles['moussa-diop'].stats.acceptedPct = 50;

const card = (d, status = d.status) => {
  const who = d.claims.find((c) => c.status === 'active' || c.status === 'done')?.userLogin ?? null;
  return { bountyId: d.id, status, repoFullName: d.repoFullName, issueTitle: d.issueTitle, amountXof: d.amountXof, who, city: who ? users[who].city : null };
};
const live = {
  columns: ['funded', 'claimed', 'submitted', 'verified', 'paying', 'paid'],
  cards: [
    card(byId['b-102']),
    card(byId['b-112']),
    card(byId['b-103']),
    card(byId['b-114']),
    card(byId['b-104']),
    card(byId['b-105']),
    card(byId['b-106']),
    card(byId['b-107']),
    { ...card(byId['b-113'], 'funded'), who: null, city: null },
  ],
  events: [
    { delayMs: 2500, bountyId: 'b-113', event: 'claim.created', from: 'funded', to: 'claimed', text: '@fatou-sall claimed naija-rails/ngn-kit#41 (funded in naira from Lagos)' },
    { delayMs: 3000, bountyId: 'b-106', event: 'payout.succeeded', from: 'paying', to: 'paid', text: `💸 7 500 FCFA (${groupSats(payoutSats(7500))}) paid to @seynabou-gueye over Lightning` },
    { delayMs: 3000, bountyId: 'b-113', event: 'pr.linked', from: 'claimed', to: 'submitted', text: 'PR #44 opened on naija-rails/ngn-kit' },
    { delayMs: 2500, bountyId: 'b-113', event: 'pr.merged', from: 'submitted', to: 'verified', text: 'Claude: ✅ 3/3 criteria met · merged' },
    { delayMs: 2000, bountyId: 'b-113', event: 'payout.started', from: 'verified', to: 'paying', text: `Payout started: ${groupSats(payoutSats(10000))} over Lightning` },
    { delayMs: 3500, bountyId: 'b-113', event: 'payout.succeeded', from: 'paying', to: 'paid', text: `💸 Lagos → Dakar: ₦29 000 in, 10 000 FCFA (${groupSats(payoutSats(10000))}) out over Lightning` },
  ],
};

const write = (name, data) => writeFileSync(join(OUT, name), JSON.stringify(data, null, 2) + '\n');
write('bounties.json', B);
write('board.json', board);
write('dashboard.json', dashboard);
write('funding.json', fundingSessions);
write('me.json', me);
write('users.json', profiles);
write('receipts.json', receipts);
write('live.json', live);
console.log('wrote', B.length, 'bounties');
