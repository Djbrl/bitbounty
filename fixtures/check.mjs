#!/usr/bin/env node
// Validates fixtures/*.json against fixtures/types.ts (F2 contract mirror: enums, shapes, TRANSITIONS),
// replays every timeline through TRANSITIONS, and checks
// that every bounty state, claim state, payout state, verdict, rail and /me step is covered.
// Exits 1 on any failure. Needs Node >= 22.18 (imports types.ts via type stripping).
// Run: node fixtures/check.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from './types.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

const load = (name) => {
  try {
    return JSON.parse(readFileSync(join(dir, name), 'utf8'));
  } catch (e) {
    fail(name, `does not parse: ${e.message}`);
    return null;
  }
};

const ISO = /^2026-10-1[78]T\d{2}:\d{2}:\d{2}Z$/;
const ANY_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const is = {
  str: (v) => typeof v === 'string' && v.length > 0,
  int: (v) => Number.isInteger(v),
  money: (v) => Number.isInteger(v) && v >= 0,
  bool: (v) => typeof v === 'boolean',
  date: (v) => typeof v === 'string' && ISO.test(v),
  anyDate: (v) => typeof v === 'string' && ANY_ISO.test(v),
  arr: (v) => Array.isArray(v),
  obj: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
};
const oneOf = (list) => (v) => list.includes(v);
const nullable = (f) => (v) => v === null || f(v);

function shape(where, value, spec) {
  if (!is.obj(value)) return fail(where, 'not an object');
  for (const [k, check] of Object.entries(spec)) {
    if (!(k in value)) fail(where, `missing "${k}"`);
    else if (!check(value[k])) fail(where, `bad "${k}": ${JSON.stringify(value[k])}`);
  }
  for (const k of Object.keys(value)) if (!(k in spec)) fail(where, `unexpected key "${k}" (not in types.ts)`);
}

const CRITERIA = (v) => is.arr(v) && v.length > 0 && v.every((c) => is.obj(c) && is.str(c.text) && Object.keys(c).length === 1);
const SRC_FOR_RAIL = { lightning: 'BTC', usdt: 'USDT', ngn: 'NGN' };
const MASKED = (v) => /^\+221 \d{2} ••• •• \d{2}$/.test(v);
/** A masked Lightning Address: two characters, `***`, then the domain (`aw***@blink.sv`). */
const LN_MASKED = (v) => typeof v === 'string' && /^[a-z0-9]{2}\*\*\*@[a-z0-9.-]+\.[a-z]{2,}$/.test(v);
const BOUNTY = {
  // core Bounty (#44)
  id: is.str, repoFullName: (v) => /^[\w.-]+\/[\w.-]+$/.test(v), issueNumber: is.int, issueTitle: is.str,
  amountXof: (v) => is.money(v) && v > 0, status: oneOf(T.BOUNTY_STATUSES), criteria: CRITERIA,
  funderKind: oneOf(['human', 'agent']), funderId: is.str, verdict: nullable(oneOf(T.VERDICTS)),
  statusCommentId: nullable(is.int), createdAt: is.date, expiresAt: nullable(is.anyDate),
  // view
  issueUrl: (v) => /^https:\/\/github\.com\//.test(v), criteriaConfirmed: is.bool, funderLogin: is.str,
  labels: (v) => is.arr(v) && v.every(is.str), updatedAt: is.date,
};
const FUNDING = {
  id: is.str, bountyId: is.str, rail: oneOf(T.RAILS), sourceAmount: (v) => is.money(v) && v > 0, sourceCurrency: oneOf(T.SOURCE_CURRENCIES),
  bitnobRef: is.str, paymentHash: nullable((v) => /^[0-9a-f]{64}$/.test(v)), status: oneOf(T.FUNDING_STATUSES), paidAt: nullable(is.date),
  feeXof: is.money, bufferXof: is.money, createdAt: is.date,
};
const CLAIM = {
  id: is.str, bountyId: is.str, userId: is.str, status: oneOf(T.CLAIM_STATUSES), expiresAt: is.anyDate,
  userLogin: is.str, extended: is.bool, createdAt: is.date,
};
const REPORT = {
  criteria: (v) => is.arr(v) && v.every((c) => is.str(c.text) && is.bool(c.met) && is.str(c.evidence)),
  verdict: oneOf(T.VERDICTS), summary: is.str, riskFlags: (v) => is.arr(v) && v.every(is.str),
};
const SUBMISSION = {
  id: is.str, bountyId: is.str, prNumber: is.int, authorLogin: is.str, headSha: (v) => /^[0-9a-f]{40}$/.test(v),
  verdict: nullable(oneOf(T.VERDICTS)), report: nullable(is.obj), spamScore: nullable((v) => is.int(v) && v >= 0 && v <= 100), mergedAt: nullable(is.date),
  prUrl: is.str, ci: oneOf(['pending', 'success', 'failure']), createdAt: is.date,
};
const PAYOUT = {
  id: is.str, bountyId: is.str, userId: is.str, amountXof: is.money, quoteId: nullable(is.str), bitnobPayoutId: nullable(is.str),
  reference: is.str, status: oneOf(T.PAYOUT_STATUSES), attempts: is.int, lastError: nullable(is.str), paidAt: nullable(is.date),
  rail: oneOf(['lightning']), lightningAddress: LN_MASKED, amountSats: (v) => is.int(v) && v > 0, xofPerBtc: (v) => is.int(v) && v > 0,
  paymentHash: (v) => /^[0-9a-f]{64}$/.test(v),
  userLogin: is.str, createdAt: is.date,
};
const EVENT = { occurredAt: is.date, type: oneOf(T.EVENT_TYPES), to: oneOf(T.BOUNTY_STATUSES), actor: is.str, text: is.str };
const USER = { id: is.str, githubId: is.int, login: is.str, avatarUrl: nullable(is.str), createdAt: is.anyDate, name: is.str, city: is.str };
const ACCOUNT = {
  userId: is.str, country: oneOf(['SN']), provider: oneOf(T.PROVIDERS), accountName: is.str, status: oneOf(T.ACCOUNT_STATUSES),
  verifiedAt: nullable(is.date), lockedUntil: nullable(is.anyDate), phoneMasked: MASKED,
};
const SUMMARY = { ...BOUNTY, claimedBy: nullable(is.str), prNumber: nullable(is.int) };

/** Replays a timeline against core's TRANSITIONS (mirrored in types.ts). Returns the final status. */
function replay(w, b) {
  let status = null;
  let verdict = null;
  b.timeline.forEach((e, i) => {
    const at = `${w} timeline[${i}] ${e.type}`;
    if (i === 0) {
      if (e.type !== 'bounty.created' || e.to !== 'unfunded') fail(at, 'timeline must start with bounty.created → unfunded');
      status = 'unfunded';
      return;
    }
    if (e.type === 'bounty.created') return fail(at, 'bounty.created only once, first');
    const targets = T.TRANSITIONS[status]?.[e.type] ?? [];
    if (!targets.length) return fail(at, `illegal transition from ${status} (TRANSITIONS)`);
    if (!targets.includes(e.to)) return fail(at, `${status} → ${e.to} not allowed, expected one of ${targets.join('|')}`);
    if (e.type === 'verify.done') verdict = b.submission?.verdict ?? null;
    if (e.type === 'pr.linked' || e.type === 'maintainer.reject') verdict = null;
    if (e.type === 'pr.merged') {
      const expect = verdict === 'pass' && b.submission?.ci === 'success' ? 'verified' : 'on_hold';
      if (e.to !== expect) fail(at, `pr.merged with verdict ${verdict} / ci ${b.submission?.ci} must go to ${expect}`);
      if (!b.submission?.mergedAt) fail(at, 'pr.merged but submission.mergedAt is null');
    }
    status = e.to;
  });
  if (status !== b.status) fail(w, `timeline ends in ${status}, bounty.status is ${b.status}`);
  if (verdict !== b.verdict) fail(w, `bounty.verdict ${b.verdict} != replayed ${verdict}`);
}

// ---------- bounties.json ----------
const bounties = load('bounties.json') ?? [];
const ids = new Set();
const PAID_STATES = ['funded', 'claimed', 'submitted', 'verified', 'paying', 'paid', 'payout_failed', 'on_hold', 'refunded'];
for (const b of bounties) {
  const w = `bounties.json ${b.id}`;
  const { fundings, claims, submission, payout, timeline, ...rest } = b;
  shape(w, rest, BOUNTY);
  if (ids.has(b.id)) fail(w, 'duplicate id');
  ids.add(b.id);
  if (!is.arr(fundings) || !is.arr(claims) || !is.arr(timeline)) { fail(w, 'fundings/claims/timeline must be arrays'); continue; }
  fundings.forEach((f, i) => {
    shape(`${w} fundings[${i}]`, f, FUNDING);
    if (f.bountyId !== b.id) fail(w, 'funding.bountyId mismatch');
    if (SRC_FOR_RAIL[f.rail] !== f.sourceCurrency) fail(w, `funding over ${f.rail} must be in ${SRC_FOR_RAIL[f.rail]}`);
    if ((f.status === 'paid') !== (f.paidAt !== null)) fail(w, 'funding.paidAt set iff status paid');
  });
  claims.forEach((c, i) => { shape(`${w} claims[${i}]`, c, CLAIM); if (c.bountyId !== b.id) fail(w, 'claim.bountyId mismatch'); });
  if (submission !== null) {
    shape(`${w} submission`, submission, SUBMISSION);
    if (submission.bountyId !== b.id) fail(w, 'submission.bountyId mismatch');
    if (submission.report) shape(`${w} submission.report`, submission.report, REPORT);
    if (submission.report && submission.report.criteria.length !== b.criteria.length) fail(w, 'report.criteria length != bounty.criteria length');
  }
  if (payout !== null) {
    shape(`${w} payout`, payout, PAYOUT);
    if (payout.amountXof !== b.amountXof) fail(w, 'payout amount != bounty amount');
    if (payout.reference !== `pay-${b.id}`) fail(w, 'payout.reference must be pay-<bountyId> (idempotency)');
  }
  timeline.forEach((e, i) => shape(`${w} timeline[${i}]`, e, EVENT));
  for (let i = 1; i < timeline.length; i++) if (timeline[i].occurredAt < timeline[i - 1].occurredAt) fail(w, 'timeline not chronological');
  replay(w, b);

  // state consistency (what the state machine guarantees)
  const paidFunding = fundings.some((f) => f.status === 'paid');
  const active = claims.filter((c) => c.status === 'active');
  const count = (t) => timeline.filter((e) => e.type === t).length;
  if (PAID_STATES.includes(b.status) && !paidFunding) fail(w, `${b.status} needs a paid funding`);
  if (['unfunded', 'cancelled'].includes(b.status) && paidFunding) fail(w, `${b.status} must not have a paid funding`);
  if (active.length > 1) fail(w, 'more than one active claim');
  if (b.status === 'claimed' && active.length !== 1) fail(w, 'claimed needs exactly one active claim');
  if (b.status === 'funded' && active.length) fail(w, 'funded must not have an active claim');
  if (['submitted', 'paying', 'paid', 'payout_failed'].includes(b.status) && !submission) fail(w, `${b.status} needs a submission`);
  if (['paying', 'paid', 'payout_failed'].includes(b.status) && !submission?.mergedAt) fail(w, `${b.status} needs a merged PR`);
  if (b.status === 'paying' && payout?.status !== 'processing' && payout?.status !== 'pending') fail(w, 'paying needs a pending/processing payout');
  if (b.status === 'paid' && (payout?.status !== 'succeeded' || !payout.paidAt)) fail(w, 'paid needs a succeeded payout');
  if (b.status === 'payout_failed' && (payout?.status !== 'failed' || !payout.lastError)) fail(w, 'payout_failed needs a failed payout with lastError');
  if (payout && payout.attempts !== count('payout.started')) fail(w, `payout.attempts ${payout.attempts} != payout.started events ${count('payout.started')}`);
  if (['unfunded', 'funded', 'claimed', 'submitted', 'verified', 'refunded', 'cancelled', 'on_hold'].includes(b.status) && payout) fail(w, `${b.status} must not have a payout`);
  if (b.status === 'unfunded' && b.labels.some((l) => l.startsWith('💰'))) fail(w, 'unfunded must not carry the 💰 label');
}

// coverage
const has = (pred) => bounties.some(pred);
for (const s of T.BOUNTY_STATUSES) if (!has((b) => b.status === s)) fail('coverage', `no bounty in state "${s}"`);
for (const s of T.CLAIM_STATUSES) if (!has((b) => b.claims.some((c) => c.status === s))) fail('coverage', `no claim "${s}"`);
if (!has((b) => b.status === 'funded' && b.claims.some((c) => c.status === 'expired'))) fail('coverage', 'no "claim expired → funded again" bounty');
for (const s of ['processing', 'succeeded', 'failed']) if (!has((b) => b.payout?.status === s)) fail('coverage', `no payout "${s}"`);
for (const v of T.VERDICTS) if (!has((b) => b.submission?.verdict === v)) fail('coverage', `no verdict "${v}"`);
for (const r of T.RAILS) if (!has((b) => b.fundings.some((f) => f.rail === r && f.status === 'paid'))) fail('coverage', `no funding over "${r}"`);
if (!has((b) => b.funderKind === 'agent')) fail('coverage', 'no agent-funded bounty');
if (!has((b) => !b.criteriaConfirmed)) fail('coverage', 'no bounty with unconfirmed (Claude-drafted) criteria');
for (const e of T.EVENT_TYPES) if (!has((b) => b.timeline.some((t) => t.type === e))) fail('coverage', `event "${e}" never appears in a timeline`);
const ref = (where, id) => { if (!ids.has(id)) fail(where, `unknown bountyId ${id}`); };

// ---------- board.json ----------
const board = load('board.json');
if (board) {
  shape('board.json stats', board.stats, { paidCount: is.int, paidTotalXof: is.money, medianMinutesMergeToPay: is.int, developersPaid: is.int });
  board.bounties.forEach((b, i) => { shape(`board.json bounties[${i}]`, b, SUMMARY); ref('board.json', b.id); });
  if (board.bounties.some((b) => ['unfunded', 'cancelled', 'refunded'].includes(b.status))) fail('board.json', 'public board must only show funded money');
  board.external.forEach((e, i) => shape(`board.json external[${i}]`, e, { title: is.str, repoFullName: is.str, url: is.str, amountUsdCents: is.money, source: is.str }));
}

// ---------- dashboard.json ----------
const dash = load('dashboard.json');
if (dash) {
  shape('dashboard.json', dash, { maintainer: is.str, repos: is.arr, stats: is.obj, bountyIds: is.arr, needsAction: is.arr, backlog: is.arr });
  shape('dashboard.json stats', dash.stats, { budgetXof: is.money, heldXof: is.money, spentXof: is.money, activeCount: is.int, paidCount: is.int, medianMinutesMergeToPay: is.int });
  dash.repos.forEach((r, i) => shape(`dashboard.json repos[${i}]`, r, { fullName: is.str, openIssues: is.int, activeBounties: is.int, paidPct: is.int }));
  dash.bountyIds.forEach((id) => ref('dashboard.json bountyIds', id));
  dash.needsAction.forEach((a, i) => { shape(`dashboard.json needsAction[${i}]`, a, { bountyId: is.str, action: oneOf(['pay_or_reject', 'update_account', 'confirm_criteria', 'fund']), text: is.str }); ref('dashboard.json needsAction', a.bountyId); });
  dash.backlog.forEach((s, i) => shape(`dashboard.json backlog[${i}]`, s, {
    id: is.str, repoFullName: is.str, issueNumber: is.int, issueTitle: is.str, criteria: CRITERIA, priceXof: is.money, reason: is.str, confidence: oneOf(['high', 'medium', 'low']), selected: is.bool,
  }));
  if (!dash.backlog.some((s) => !s.selected)) fail('dashboard.json', 'backlog needs at least one rejected suggestion');
}

// ---------- funding.json ----------
const funding = load('funding.json');
if (funding) {
  const BRK = { amountXof: is.money, feeXof: is.money, bufferXof: is.money, totalXof: is.money, expiresAt: is.date };
  for (const r of T.RAILS) if (!funding[r] || funding[r].rail !== r) fail('funding.json', `missing session for rail "${r}"`);
  shape('funding.json lightning', funding.lightning, { ...BRK, rail: oneOf(['lightning']), invoice: (v) => /^lntbs\d+n1/.test(v), paymentHash: FUNDING.paymentHash, amountSats: is.money });
  shape('funding.json usdt', funding.usdt, { ...BRK, rail: oneOf(['usdt']), address: (v) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v), network: oneOf(['TRON', 'ETHEREUM', 'BSC']), amountUsdtUnits: is.money });
  shape('funding.json ngn', funding.ngn, { ...BRK, rail: oneOf(['ngn']), virtualAccount: is.obj, amountKobo: (v) => is.money(v) && v % 100_000 === 0 });
  for (const r of T.RAILS) { const s = funding[r]; if (s && s.totalXof !== s.amountXof + s.feeXof + s.bufferXof) fail(`funding.json ${r}`, 'total != amount + fee + buffer'); }
}

// ---------- me.json ----------
const me = load('me.json');
if (me) {
  for (const s of ['new', ...T.ACCOUNT_STATUSES]) {
    const m = me.states?.[s];
    if (!m) { fail('me.json', `missing state "${s}"`); continue; }
    shape(`me.json ${s}.user`, m.user, USER);
    if (s === 'new') { if (m.payoutAccount !== null) fail('me.json new', 'payoutAccount must be null'); }
    else { shape(`me.json ${s}.payoutAccount`, m.payoutAccount, ACCOUNT); if (m.payoutAccount.status !== s) fail(`me.json ${s}`, 'account status mismatch'); }
    m.activeClaims.forEach((c) => ref(`me.json ${s}`, c.bountyId));
    m.payouts.forEach((p) => { ref(`me.json ${s}`, p.bountyId); if (!T.PAYOUT_STATUSES.includes(p.status)) fail(`me.json ${s}`, 'bad payout status'); });
  }
  if (!(me.mock?.testAmountXof >= 100 && me.mock.testAmountXof <= 199)) fail('me.json', 'test amount must be 100–199 FCFA');
}

// ---------- users.json ----------
const users = load('users.json');
if (users) for (const [login, p] of Object.entries(users)) {
  shape(`users.json ${login}.user`, p.user, USER);
  if (p.user.login !== login) fail(`users.json ${login}`, 'key != login');
  p.work.forEach((w) => ref(`users.json ${login}`, w.bountyId));
  if (p.stats.paidCount !== p.work.length) fail(`users.json ${login}`, 'paidCount != work.length');
}

// ---------- receipts.json ----------
const receipts = load('receipts.json');
if (receipts) {
  const paid = bounties.filter((b) => b.status === 'paid');
  for (const b of paid) if (!Object.values(receipts).some((r) => r.bountyId === b.id)) fail('receipts.json', `paid bounty ${b.id} has no receipt`);
  for (const [id, r] of Object.entries(receipts)) {
    if (r.id !== id) fail(`receipts.json ${id}`, 'key != id');
    ref(`receipts.json ${id}`, r.bountyId);
    const b = bounties.find((x) => x.id === r.bountyId);
    if (b && (r.amountXof !== b.amountXof || r.bitnobReference !== b.payout?.bitnobPayoutId)) fail(`receipts.json ${id}`, 'does not match its bounty');
    if (!is.date(r.paidAt) || !is.date(r.mergedAt)) fail(`receipts.json ${id}`, 'bad dates');
    if (b && (r.lightningAddress !== b.payout?.lightningAddress || r.paidWith?.amountSats !== b.payout?.amountSats)) {
      fail(`receipts.json ${id}`, 'Lightning Address or sats do not match the payout');
    }
    if ('provider' in r || 'phoneMasked' in r) fail(`receipts.json ${id}`, 'payouts are Lightning now: no provider / phone');
  }
}

// ---------- live.json ----------
const live = load('live.json');
if (live) {
  live.columns.forEach((c) => { if (!T.BOUNTY_STATUSES.includes(c)) fail('live.json', `bad column ${c}`); });
  live.cards.forEach((c) => { ref('live.json cards', c.bountyId); if (!live.columns.includes(c.status)) fail('live.json', `card ${c.bountyId} in unknown column`); });
  const pos = Object.fromEntries(live.cards.map((c) => [c.bountyId, c.status]));
  for (const e of live.events) {
    ref('live.json events', e.bountyId);
    if (pos[e.bountyId] !== e.from) fail('live.json', `event ${e.bountyId} ${e.from}→${e.to} but card is in ${pos[e.bountyId]}`);
    if (!(T.TRANSITIONS[e.from]?.[e.event] ?? []).includes(e.to)) fail('live.json', `${e.bountyId}: ${e.event} ${e.from}→${e.to} not in TRANSITIONS`);
    pos[e.bountyId] = e.to;
    if (!is.int(e.delayMs) || e.delayMs <= 0) fail('live.json', 'delayMs must be a positive integer');
  }
}

if (errors.length) {
  console.error(`✗ fixtures check failed (${errors.length}):\n  ` + errors.join('\n  '));
  process.exit(1);
}
const states = T.BOUNTY_STATUSES.map((s) => `${s}=${bounties.filter((b) => b.status === s).map((b) => b.id).join(',')}`).join(' ');
console.log(`✓ fixtures OK: ${bounties.length} bounties, all ${T.BOUNTY_STATUSES.length} states covered\n  ${states}`);
