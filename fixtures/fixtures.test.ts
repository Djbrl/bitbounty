// Run: node --test fixtures/fixtures.test.ts   (Node >= 22.18: type stripping, no build step)
// F1 can wire it into `pnpm test` as-is; asserts are plain node:assert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleMock, liveStream, POLLS_BEFORE_PAID, type Fixtures } from '../apps/web/lib/mock-api.ts';
import { BOUNTY_STATUSES, EVENT_TYPES, TRANSITIONS, type BountyDetail } from './types.ts';

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

test('timelines follow the F2 TRANSITIONS table and only use F2 events', () => {
  for (const b of fx.bounties as BountyDetail[]) {
    let from = b.timeline[0].to;
    for (const e of b.timeline.slice(1)) {
      assert.ok(EVENT_TYPES.includes(e.type), `${b.id}: ${e.type} is not an F2 event`);
      assert.ok((TRANSITIONS[from][e.type] ?? []).includes(e.to), `${b.id}: ${from} --${e.type}--> ${e.to}`);
      from = e.to;
    }
    assert.equal(from, b.status, b.id);
  }
});

test('list filters by status, repo, funder', () => {
  assert.equal(json(get('bounties', 'status=paid,paying')).length, 3);
  assert.ok(json(get('bounties', 'repo=teranga-labs/xof')).every((b: any) => b.repoFullName === 'teranga-labs/xof'));
  assert.ok(json(get('bounties', 'funder=chidi-okafor')).every((b: any) => b.funderLogin === 'chidi-okafor'));
  assert.equal(json(get('bounties'))[0].timeline, undefined, 'list rows are summaries');
});

test('funding: session per rail scaled to the bounty, then polling flips to paid', () => {
  const ln = json(post('bounties/b-101/funding', { rail: 'lightning' })); // 15 000 FCFA
  assert.equal(ln.totalXof, 15000 + 750 + 450);
  assert.equal(ln.amountSats, Math.round(17474 * 1.5));
  assert.equal(ln.expiresAt, '2026-10-17T15:15:00.000Z');
  const ngn = json(post('bounties/b-101/funding', { rail: 'ngn' }));
  assert.equal(ngn.amountKobo % 100_000, 0);
  assert.equal(post('bounties/b-101/funding', { rail: 'paypal' }).status, 400);
  assert.equal(post('bounties/b-107/funding', { rail: 'usdt' }).status, 409);
  for (let i = 1; i < POLLS_BEFORE_PAID; i++) assert.equal(json(get('bounties/b-101/funding')).status, 'pending');
  assert.equal(json(get('bounties/b-101/funding')).status, 'paid');
});

test('pages: board, dashboard, backlog, users, receipts, live', () => {
  assert.ok(json(get('board')).bounties.length > 0);
  const d = json(get('dashboard'));
  assert.equal(d.bounties.length, d.bountyIds.length);
  const batch = json(post('backlog/fund', {}));
  assert.equal(batch.count, 5);
  assert.equal(batch.session.amountXof, 7500 + 12000 + 5000 + 10000 + 6000);
  assert.deepEqual(batch.bountyIds, ['b-sug-1', 'b-sug-2', 'b-sug-3', 'b-sug-4', 'b-sug-5']);
  const created = json(get(`bounties/${batch.bountyIds[0]}`));
  assert.equal(created.status, 'unfunded');
  assert.equal(created.amountXof, 7500);
  assert.equal(json(post(`bounties/${batch.bountyIds[0]}/funding`, { rail: 'lightning' })).amountXof, 7500);
  assert.equal(get('bounties/b-sug-99').status, 404);
  assert.equal(post('backlog/fund', { ids: [] }).status, 400);
  assert.equal(json(get('users/awa-ndiaye')).work[0].receiptId, 'r-107');
  assert.equal(get('users/nobody').status, 404);
  assert.equal(json(get('receipts/r-113')).fundedWith.rail, 'ngn');
  assert.equal(get('receipts/r-1').status, 404);
  assert.ok('stream' in get('live'));
  assert.ok(json(get('live', 'format=json')).events.length > 0);
  assert.equal(get('nope').status, 404);
});

test('/me payout account: a Lightning Address, checked then saved masked', () => {
  assert.equal(json(get('me', 'state=new')).payoutAccount, null);
  assert.equal(json(get('me')).payoutAccount.lightningAddress, 'aw***@blink.sv');
  assert.equal(post('me/lightning-address', { lightningAddress: 'awa' }).status, 400);
  assert.equal(post('me/lightning-address', { lightningAddress: 'awa@nowhere.invalid' }).status, 422);
  assert.equal(json(post('me/lightning-address', { lightningAddress: 'Awa.Diop@Blink.sv' })).lightningAddress, 'aw***@blink.sv');
});

test('/welcome onboarding: answers saved, done sets onboardedAt', () => {
  const st = json(get('me/onboarding'));
  assert.equal(st.preferences.step >= 1, true);
  assert.deepEqual(st.githubLanguages, ['TypeScript', 'Go']);
  assert.equal(post('me/mode', { mode: 'both' }).status, 400);
  assert.equal(json(post('me/mode', { mode: 'hunt' })).defaultMode, 'hunt');
  const saved = json(post('me/onboarding', { preferences: { step: 2, stack: ['Go'] } }));
  assert.equal(saved.defaultMode, 'hunt');
  assert.equal(saved.preferences.step, 2);
  assert.equal(json(post('me/onboarding', { done: true })).onboardedAt, '2026-10-17T15:00:00.000Z');
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
