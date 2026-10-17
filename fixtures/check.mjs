#!/usr/bin/env node
// Validates fixtures/*.json against fixtures/types.ts (enums + shapes) and checks
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

const BOUNTY = {
  id: is.str, repo: (v) => /^[\w.-]+\/[\w.-]+$/.test(v), issue_number: is.int, issue_title: is.str, issue_url: (v) => /^https:\/\/github\.com\//.test(v),
  amount_xof: (v) => is.money(v) && v > 0, status: oneOf(T.BOUNTY_STATUSES), criteria: (v) => is.arr(v) && v.length > 0 && v.every(is.str),
  criteria_confirmed: is.bool, funder_kind: oneOf(['human', 'agent']), funder_login: is.str, labels: (v) => is.arr(v) && v.every(is.str),
  status_comment_id: nullable(is.int), created_at: is.date, updated_at: is.date, expires_at: nullable(is.anyDate),
};
const FUNDING = {
  id: is.str, bounty_id: is.str, rail: oneOf(T.RAILS), source_amount: is.money, source_currency: oneOf(T.SOURCE_CURRENCIES), fee_xof: is.money,
  buffer_xof: is.money, bitnob_ref: is.str, payment_hash: nullable((v) => /^[0-9a-f]{64}$/.test(v)), status: oneOf(T.FUNDING_STATUSES),
  created_at: is.date, paid_at: nullable(is.date),
};
const CLAIM = { id: is.str, bounty_id: is.str, user_login: is.str, status: oneOf(T.CLAIM_STATUSES), extended: is.bool, created_at: is.date, expires_at: is.anyDate };
const REPORT = {
  criteria: (v) => is.arr(v) && v.every((c) => is.str(c.text) && is.bool(c.met) && is.str(c.evidence)),
  verdict: oneOf(T.VERDICTS), summary: is.str, risk_flags: (v) => is.arr(v) && v.every(is.str),
};
const SUBMISSION = {
  id: is.str, bounty_id: is.str, pr_number: is.int, pr_url: is.str, author_login: is.str, head_sha: (v) => /^[0-9a-f]{40}$/.test(v),
  ci: oneOf(T.CI_STATUSES), verdict: nullable(oneOf(T.VERDICTS)), report: nullable(is.obj), spam_score: (v) => is.int(v) && v >= 0 && v <= 100,
  created_at: is.date, merged_at: nullable(is.date),
};
const PAYOUT = {
  id: is.str, bounty_id: is.str, user_login: is.str, amount_xof: is.money, provider: oneOf(T.PROVIDERS), phone_masked: (v) => /^\+221 \d{2} ••• •• \d{2}$/.test(v),
  quote_id: is.str, bitnob_payout_id: nullable(is.str), reference: is.str, status: oneOf(T.PAYOUT_STATUSES), attempts: is.int, last_error: nullable(is.str),
  created_at: is.date, paid_at: nullable(is.date),
};
const EVENT = { at: is.date, type: oneOf(T.EVENT_TYPES), actor: is.str, text: is.str };
const USER = { id: is.str, github_id: is.int, login: is.str, name: is.str, avatar_url: is.str, city: is.str, created_at: is.anyDate };
const ACCOUNT = {
  user_id: is.str, country: oneOf(['SN']), provider: oneOf(T.PROVIDERS), phone_masked: PAYOUT.phone_masked, account_name: is.str,
  status: oneOf(T.ACCOUNT_STATUSES), verified_at: nullable(is.date), locked_until: nullable(is.anyDate),
};
const SUMMARY = { ...BOUNTY, claimed_by: nullable(is.str), pr_number: nullable(is.int) };

// ---------- bounties.json ----------
const bounties = load('bounties.json') ?? [];
const ids = new Set();
const PAID_STATES = ['funded', 'claimed', 'submitted', 'verified', 'paying', 'paid', 'payout_failed', 'on_hold'];
for (const b of bounties) {
  const w = `bounties.json ${b.id}`;
  const { fundings, claims, submission, payout, timeline, ...rest } = b;
  shape(w, rest, BOUNTY);
  if (ids.has(b.id)) fail(w, 'duplicate id');
  ids.add(b.id);
  if (!is.arr(fundings) || !is.arr(claims) || !is.arr(timeline)) { fail(w, 'fundings/claims/timeline must be arrays'); continue; }
  fundings.forEach((f, i) => { shape(`${w} fundings[${i}]`, f, FUNDING); if (f.bounty_id !== b.id) fail(w, 'funding.bounty_id mismatch'); });
  claims.forEach((c, i) => { shape(`${w} claims[${i}]`, c, CLAIM); if (c.bounty_id !== b.id) fail(w, 'claim.bounty_id mismatch'); });
  if (submission !== null) {
    shape(`${w} submission`, submission, SUBMISSION);
    if (submission.report) shape(`${w} submission.report`, submission.report, REPORT);
    if (submission.report && submission.report.criteria.length !== b.criteria.length) fail(w, 'report.criteria length != bounty.criteria length');
  }
  if (payout !== null) {
    shape(`${w} payout`, payout, PAYOUT);
    if (payout.amount_xof !== b.amount_xof) fail(w, 'payout amount != bounty amount');
    if (payout.reference !== `pay-${b.id}`) fail(w, 'payout.reference must be pay-<bountyId> (idempotency)');
  }
  timeline.forEach((e, i) => shape(`${w} timeline[${i}]`, e, EVENT));
  for (let i = 1; i < timeline.length; i++) if (timeline[i].at < timeline[i - 1].at) fail(w, 'timeline not chronological');
  if (timeline[0]?.type !== 'bounty.created') fail(w, 'timeline must start with bounty.created');

  // state consistency (what the state machine guarantees)
  const paidFunding = fundings.some((f) => f.status === 'paid');
  const active = claims.filter((c) => c.status === 'active');
  if (PAID_STATES.includes(b.status) && !paidFunding) fail(w, `${b.status} needs a paid funding`);
  if (['unfunded', 'cancelled'].includes(b.status) && paidFunding) fail(w, `${b.status} must not have a paid funding`);
  if (b.status === 'refunded' && !fundings.some((f) => f.status === 'refunded')) fail(w, 'refunded needs a refunded funding');
  if (active.length > 1) fail(w, 'more than one active claim');
  if (b.status === 'claimed' && active.length !== 1) fail(w, 'claimed needs exactly one active claim');
  if (b.status === 'funded' && active.length) fail(w, 'funded must not have an active claim');
  if (['submitted', 'verified', 'paying', 'paid', 'payout_failed', 'on_hold'].includes(b.status) && !submission) fail(w, `${b.status} needs a submission`);
  if (['verified', 'paying', 'paid', 'payout_failed'].includes(b.status) && !(submission?.merged_at && submission.verdict === 'pass')) fail(w, `${b.status} needs a merged PR with verdict pass`);
  if (b.status === 'paying' && payout?.status !== 'processing' && payout?.status !== 'pending') fail(w, 'paying needs a pending/processing payout');
  if (b.status === 'paid' && (payout?.status !== 'succeeded' || !payout.paid_at)) fail(w, 'paid needs a succeeded payout');
  if (b.status === 'payout_failed' && (payout?.status !== 'failed' || !payout.last_error)) fail(w, 'payout_failed needs a failed payout with last_error');
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
for (const r of T.RAILS) if (!has((b) => b.fundings.some((f) => f.rail === r && f.status !== 'pending'))) fail('coverage', `no funding over "${r}"`);
if (!has((b) => b.funder_kind === 'agent')) fail('coverage', 'no agent-funded bounty');
if (!has((b) => !b.criteria_confirmed)) fail('coverage', 'no bounty with unconfirmed (Claude-drafted) criteria');
for (const e of T.EVENT_TYPES) if (!has((b) => b.timeline.some((t) => t.type === e))) fail('coverage', `event "${e}" never appears in a timeline`);
const ref = (where, id) => { if (!ids.has(id)) fail(where, `unknown bounty_id ${id}`); };

// ---------- board.json ----------
const board = load('board.json');
if (board) {
  shape('board.json stats', board.stats, { paid_count: is.int, paid_total_xof: is.money, median_minutes_merge_to_pay: is.int, developers_paid: is.int });
  board.bounties.forEach((b, i) => { shape(`board.json bounties[${i}]`, b, SUMMARY); ref('board.json', b.id); });
  if (board.bounties.some((b) => ['unfunded', 'cancelled', 'refunded'].includes(b.status))) fail('board.json', 'public board must only show funded money');
  board.external.forEach((e, i) => shape(`board.json external[${i}]`, e, { title: is.str, repo: is.str, url: is.str, amount_usd_cents: is.money, source: is.str }));
}

// ---------- dashboard.json ----------
const dash = load('dashboard.json');
if (dash) {
  shape('dashboard.json', dash, { maintainer: is.str, repos: is.arr, stats: is.obj, bounty_ids: is.arr, needs_action: is.arr, backlog: is.arr });
  shape('dashboard.json stats', dash.stats, { budget_xof: is.money, held_xof: is.money, spent_xof: is.money, active_count: is.int, paid_count: is.int, median_minutes_merge_to_pay: is.int });
  dash.repos.forEach((r, i) => shape(`dashboard.json repos[${i}]`, r, { full_name: is.str, open_issues: is.int, active_bounties: is.int, paid_pct: is.int }));
  dash.bounty_ids.forEach((id) => ref('dashboard.json bounty_ids', id));
  dash.needs_action.forEach((a, i) => { shape(`dashboard.json needs_action[${i}]`, a, { bounty_id: is.str, action: oneOf(['pay_or_reject', 'update_account', 'confirm_criteria', 'fund']), text: is.str }); ref('dashboard.json needs_action', a.bounty_id); });
  dash.backlog.forEach((s, i) => shape(`dashboard.json backlog[${i}]`, s, {
    id: is.str, repo: is.str, issue_number: is.int, issue_title: is.str, criteria: is.arr, price_xof: is.money, reason: is.str, confidence: oneOf(['high', 'medium', 'low']), selected: is.bool,
  }));
  if (!dash.backlog.some((s) => !s.selected)) fail('dashboard.json', 'backlog needs at least one rejected suggestion');
}

// ---------- funding.json ----------
const funding = load('funding.json');
if (funding) {
  const BRK = { amount_xof: is.money, fee_xof: is.money, buffer_xof: is.money, total_xof: is.money, expires_at: is.date };
  for (const r of T.RAILS) if (!funding[r] || funding[r].rail !== r) fail('funding.json', `missing session for rail "${r}"`);
  shape('funding.json lightning', funding.lightning, { ...BRK, rail: oneOf(['lightning']), invoice: (v) => /^lntbs\d+n1/.test(v), payment_hash: FUNDING.payment_hash, amount_sats: is.money });
  shape('funding.json usdt', funding.usdt, { ...BRK, rail: oneOf(['usdt']), address: (v) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v), network: oneOf(['TRON', 'ETHEREUM', 'BSC']), amount_usdt_cents: is.money });
  shape('funding.json ngn', funding.ngn, { ...BRK, rail: oneOf(['ngn']), virtual_account: is.obj, amount_kobo: (v) => is.money(v) && v % 100_000 === 0 });
  for (const r of T.RAILS) { const s = funding[r]; if (s && s.total_xof !== s.amount_xof + s.fee_xof + s.buffer_xof) fail(`funding.json ${r}`, 'total != amount + fee + buffer'); }
}

// ---------- me.json ----------
const me = load('me.json');
if (me) {
  for (const s of ['new', ...T.ACCOUNT_STATUSES]) {
    const m = me.states?.[s];
    if (!m) { fail('me.json', `missing state "${s}"`); continue; }
    shape(`me.json ${s}.user`, m.user, USER);
    if (s === 'new') { if (m.payout_account !== null) fail('me.json new', 'payout_account must be null'); }
    else { shape(`me.json ${s}.payout_account`, m.payout_account, ACCOUNT); if (m.payout_account.status !== s) fail(`me.json ${s}`, 'account status mismatch'); }
    m.active_claims.forEach((c) => ref(`me.json ${s}`, c.bounty_id));
    m.payouts.forEach((p) => { ref(`me.json ${s}`, p.bounty_id); if (!T.PAYOUT_STATUSES.includes(p.status)) fail(`me.json ${s}`, 'bad payout status'); });
  }
  if (!(me.mock?.test_amount_xof >= 100 && me.mock.test_amount_xof <= 199)) fail('me.json', 'test amount must be 100–199 FCFA');
}

// ---------- users.json ----------
const users = load('users.json');
if (users) for (const [login, p] of Object.entries(users)) {
  shape(`users.json ${login}.user`, p.user, USER);
  if (p.user.login !== login) fail(`users.json ${login}`, 'key != login');
  p.work.forEach((w) => ref(`users.json ${login}`, w.bounty_id));
  if (p.stats.paid_count !== p.work.length) fail(`users.json ${login}`, 'paid_count != work.length');
}

// ---------- receipts.json ----------
const receipts = load('receipts.json');
if (receipts) {
  const paid = bounties.filter((b) => b.status === 'paid');
  for (const b of paid) if (!Object.values(receipts).some((r) => r.bounty_id === b.id)) fail('receipts.json', `paid bounty ${b.id} has no receipt`);
  for (const [id, r] of Object.entries(receipts)) {
    if (r.id !== id) fail(`receipts.json ${id}`, 'key != id');
    ref(`receipts.json ${id}`, r.bounty_id);
    const b = bounties.find((x) => x.id === r.bounty_id);
    if (b && (r.amount_xof !== b.amount_xof || r.bitnob_reference !== b.payout?.bitnob_payout_id)) fail(`receipts.json ${id}`, 'does not match its bounty');
    if (!is.date(r.paid_at) || !is.date(r.merged_at)) fail(`receipts.json ${id}`, 'bad dates');
  }
}

// ---------- live.json ----------
const live = load('live.json');
if (live) {
  live.columns.forEach((c) => { if (!T.BOUNTY_STATUSES.includes(c)) fail('live.json', `bad column ${c}`); });
  live.cards.forEach((c) => { ref('live.json cards', c.bounty_id); if (!live.columns.includes(c.status)) fail('live.json', `card ${c.bounty_id} in unknown column`); });
  const pos = Object.fromEntries(live.cards.map((c) => [c.bounty_id, c.status]));
  for (const e of live.events) {
    ref('live.json events', e.bounty_id);
    if (pos[e.bounty_id] !== e.from) fail('live.json', `event ${e.bounty_id} ${e.from}→${e.to} but card is in ${pos[e.bounty_id]}`);
    pos[e.bounty_id] = e.to;
    if (!is.int(e.delay_ms) || e.delay_ms <= 0) fail('live.json', 'delay_ms must be a positive integer');
  }
}

if (errors.length) {
  console.error(`✗ fixtures check failed (${errors.length}):\n  ` + errors.join('\n  '));
  process.exit(1);
}
const states = T.BOUNTY_STATUSES.map((s) => `${s}=${bounties.filter((b) => b.status === s).map((b) => b.id).join(',')}`).join(' ');
console.log(`✓ fixtures OK: ${bounties.length} bounties, all ${T.BOUNTY_STATUSES.length} states covered\n  ${states}`);
