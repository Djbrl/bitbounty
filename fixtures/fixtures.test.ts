// Run: node --test fixtures/fixtures.test.ts   (Node >= 22.18: type stripping, no build step)
// F1 can wire it into `pnpm test` as-is; asserts are plain node:assert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleMock, liveStream, POLLS_BEFORE_PAID, type Fixtures } from '../apps/web/lib/mock-api.ts';
import { BOUNTY_STATUSES } from './types.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (n: string) => JSON.parse(readFileSync(join(dir, `${n}.json`), 'utf8'));
const fx = {
  bounties: read('bounties'), board: read('board'), dashboard: read('dashboard'), funding: read('funding'),
  me: read('me'), users: read('users'), receipts: read('receipts'), live: read('live'),
} as Fixtures;
const q = (s = '') => new URLSearchParams(s);
const get = (path: string, query = '') => handleMock(fx, 'GET', path.split('/').filter(Boolean), q(query));
const post = (path: string, body: Record<string, unknown>) => handleMock(fx, 'POST', path.split('/').filter(Boolean), q(), body, new Date('2026-10-17T15:00:00Z'));
const json = (r: ReturnType<typeof handleMock>) => ('json' in r ? (r.json as any) : assert.fail('expected json'));

test('check.mjs passes', () => {
  const out = execFileSync(process.execPath, [join(dir, 'check.mjs')], { encoding: 'utf8' });
  assert.match(out, /fixtures OK/);
});

test('every bounty state is served by GET /api/bounties/:id', () => {
  for (const s of BOUNTY_STATUSES) {
    const row = json(get('bounties', `status=${s}`))[0];
    assert.ok(row, `no bounty in ${s}`);
    const r = get(`bounties/${row.id}`);
    assert.equal(r.status, 200);
    assert.equal(json(r).status, s);
    assert.ok(Array.isArray(json(r).timeline));
  }
  assert.equal(get('bounties/b-999').status, 404);
});

test('list filters by status, repo, funder', () => {
  assert.equal(json(get('bounties', 'status=paid,paying')).length, 3);
  assert.ok(json(get('bounties', 'repo=teranga-labs/xof')).every((b: any) => b.repo === 'teranga-labs/xof'));
  assert.ok(json(get('bounties', 'funder=chidi-okafor')).every((b: any) => b.funder_login === 'chidi-okafor'));
  assert.equal(json(get('bounties'))[0].timeline, undefined, 'list rows are summaries');
});

test('funding: session per rail scaled to the bounty, then polling flips to paid', () => {
  const ln = json(post('bounties/b-101/funding', { rail: 'lightning' })); // 15 000 FCFA
  assert.equal(ln.total_xof, 15000 + 750 + 450);
  assert.equal(ln.amount_sats, Math.round(17474 * 1.5));
  assert.equal(ln.expires_at, '2026-10-17T15:15:00.000Z');
  const ngn = json(post('bounties/b-101/funding', { rail: 'ngn' }));
  assert.equal(ngn.amount_kobo % 100_000, 0);
  assert.equal(post('bounties/b-101/funding', { rail: 'paypal' }).status, 400);
  assert.equal(post('bounties/b-107/funding', { rail: 'usdt' }).status, 409);
  for (let i = 1; i < POLLS_BEFORE_PAID; i++) assert.equal(json(get('bounties/b-101/funding')).status, 'pending');
  assert.equal(json(get('bounties/b-101/funding')).status, 'paid');
});

test('pages: board, dashboard, backlog, users, receipts, live', () => {
  assert.ok(json(get('board')).bounties.length > 0);
  const d = json(get('dashboard'));
  assert.equal(d.bounties.length, d.bounty_ids.length);
  const batch = json(post('backlog/fund', {}));
  assert.equal(batch.count, 5);
  assert.equal(batch.session.amount_xof, 7500 + 12000 + 5000 + 10000 + 6000);
  assert.equal(post('backlog/fund', { ids: [] }).status, 400);
  assert.equal(json(get('users/awa-ndiaye')).work[0].receipt_id, 'r-107');
  assert.equal(get('users/nobody').status, 404);
  assert.equal(json(get('receipts/r-113')).funded_with.rail, 'ngn');
  assert.equal(get('receipts/r-1').status, 404);
  assert.ok('stream' in get('live'));
  assert.ok(json(get('live', 'format=json')).events.length > 0);
  assert.equal(get('nope').status, 404);
});

test('/me onboarding: new → pending → sms_ok → verified', () => {
  assert.equal(json(get('me', 'state=new')).payout_account, null);
  assert.equal(json(get('me')).payout_account.status, 'verified');
  assert.equal(post('me/payout-account', { provider: 'wave' }).status, 400);
  assert.equal(json(post('me/payout-account', { provider: 'wave', phone: '+221770000042' })).payout_account.status, 'pending');
  assert.equal(post('me/payout-account/sms', { code: '000000' }).status, 422);
  assert.equal(json(post('me/payout-account/sms', { code: '424242' })).payout_account.status, 'sms_ok');
  const wrong = post('me/payout-account/confirm', { amount: 173 });
  assert.equal(wrong.status, 422);
  assert.equal(json(post('me/payout-account/confirm', { amount: 137 })).payout_account.status, 'verified');
});

test('live SSE: snapshot then transitions', async () => {
  const reader = liveStream(fx.live, { loop: false, speed: 1000 }).getReader();
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  assert.match(text, /^event: snapshot\n/);
  assert.equal(text.match(/event: transition/g)?.length, fx.live.events.length);
});
