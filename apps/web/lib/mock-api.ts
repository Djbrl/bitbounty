// Mock implementation of the HTTP API (docs/plan.md §3 "HTTP API"), backed by fixtures/*.json.
// Pure: takes the fixtures as an argument, so it runs under Next (route.ts) and under
// `node --test` (fixtures/mock-api.test.ts) without a bundler.
// I1 replaces this with the real server API; page code should only depend on the URLs.
// Types: fixtures/types.ts mirrors the F2 contract (#44); replace with import from @bitbounty/core once #44 merges.
import type {
  Board,
  BountyDetail,
  BountyStatus,
  BountySummary,
  Dashboard,
  FundingSession,
  Live,
  Me,
  OnboardingState,
  Profile,
  FundingRail,
  Receipt,
} from '../../../fixtures/types';

export interface Fixtures {
  bounties: BountyDetail[];
  board: Board;
  dashboard: Dashboard;
  funding: Record<FundingRail, FundingSession>;
  me: { mock: { smsCode: string; testAmountXof: number; defaultState: MeState }; states: Record<MeState, Me> };
  users: Record<string, Profile>;
  receipts: Record<string, Receipt>;
  live: Live;
}
export type MeState = 'new' | 'pending' | 'sms_ok' | 'verified';

export type MockResult = { status: number; json: unknown } | { status: 200; stream: 'live' };

const ok = (json: unknown) => ({ status: 200, json });
const err = (status: number, error: string, extra: Record<string, unknown> = {}) => ({ status, json: { error, ...extra } });

// U1: the /welcome answers in fixtures mode. On globalThis so the page (server component) and
// /api/* (route handler) share it inside one `next` process; reset with resetMockOnboarding().
const ONBOARDING_KEY = '__bitbountyMockOnboarding';
type Holder = { [ONBOARDING_KEY]?: OnboardingState };

function mockOnboarding(fx: Fixtures): OnboardingState {
  const g = globalThis as Holder;
  if (!g[ONBOARDING_KEY]) {
    const login = fx.me?.states?.new?.user.login ?? 'awa-ndiaye';
    g[ONBOARDING_KEY] = {
      login,
      defaultMode: null,
      onboardedAt: null,
      preferences: { role: null, stack: [], currency: 'xof', language: 'fr', repo: null, step: 1 },
      lightningAddress: null,
      githubLanguages: fx.users?.[login]?.languages ?? [],
      installedRepos: fx.dashboard?.repos.map((r) => r.fullName) ?? [],
      appInstallUrl: 'https://github.com/apps/bitbounty-dakar',
    };
  }
  return g[ONBOARDING_KEY]!;
}

/** Forgets the mock's onboarding answers (tests). */
export function resetMockOnboarding(): void {
  delete (globalThis as Holder)[ONBOARDING_KEY];
}

/** Polls per unfunded bounty before the mock reports it as paid (lets /pay show the transition). */
export const POLLS_BEFORE_PAID = 3;
const polls = new Map<string, number>();

export function toSummary(d: BountyDetail): BountySummary {
  const { fundings: _f, claims, submission, payout: _p, timeline: _t, ...b } = d;
  const c = claims.find((x) => x.status === 'active' || x.status === 'done');
  return { ...b, claimedBy: c?.userLogin ?? null, prNumber: submission?.prNumber ?? null };
}

/** Bounty id the mock gives a backlog suggestion once "Fund N bounties" creates it (sug-1 -> b-sug-1). */
export const backlogBountyId = (suggestionId: string) => `b-${suggestionId}`;

/** The unfunded bounty a funded backlog suggestion becomes (stateless: derived from dashboard.json). */
function backlogBounty(fx: Fixtures, bid: string): BountyDetail | undefined {
  const s = fx.dashboard?.backlog.find((x) => backlogBountyId(x.id) === bid);
  const tpl = fx.bounties.find((b) => b.status === 'unfunded');
  if (!s || !tpl) return undefined;
  return {
    ...tpl,
    id: bid,
    repoFullName: s.repoFullName,
    issueNumber: s.issueNumber,
    issueTitle: s.issueTitle,
    issueUrl: `https://github.com/${s.repoFullName}/issues/${s.issueNumber}`,
    amountXof: s.priceXof,
    criteria: s.criteria,
    criteriaConfirmed: true,
    funderLogin: fx.dashboard.maintainer,
    fundings: [],
    claims: [],
    submission: null,
    payout: null,
    timeline: [],
  };
}

function fundingSession(fx: Fixtures, d: { amountXof: number }, rail: FundingRail, now: Date): FundingSession {
  const tpl = fx.funding[rail];
  const ratio = d.amountXof / tpl.amountXof;
  const amountXof = d.amountXof;
  const feeXof = Math.round(amountXof * 0.05);
  const bufferXof = Math.round(amountXof * 0.03);
  const base = { amountXof, feeXof, bufferXof, totalXof: amountXof + feeXof + bufferXof };
  const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
  if (tpl.rail === 'lightning') return { ...tpl, ...base, amountSats: Math.round(tpl.amountSats * ratio), expiresAt };
  // USDT base units (1 USDT = 1_000_000), rounded up to the cent
  if (tpl.rail === 'usdt') return { ...tpl, ...base, amountUsdtUnits: Math.ceil((tpl.amountUsdtUnits * ratio) / 10_000) * 10_000, expiresAt };
  // naira: whole ₦1,000 steps (sandbox simulate-deposit credits ₦1,000 per call)
  return { ...tpl, ...base, amountKobo: Math.ceil((tpl.amountKobo * ratio) / 100_000) * 100_000, expiresAt };
}

export function handleMock(
  fx: Fixtures,
  method: string,
  path: string[],
  query: URLSearchParams,
  body: Record<string, unknown> = {},
  now: Date = new Date(),
): MockResult {
  const [root, id, sub] = path;
  const find = (bid: string) => fx.bounties.find((b) => b.id === bid) ?? backlogBounty(fx, bid);

  if (method === 'GET' && root === 'bounties' && !id) {
    const statuses = query.get('status')?.split(',').filter(Boolean) as BountyStatus[] | undefined;
    const repo = query.get('repo');
    const funder = query.get('funder');
    const rows = fx.bounties
      .filter((b) => !statuses?.length || statuses.includes(b.status))
      .filter((b) => !repo || b.repoFullName === repo)
      .filter((b) => !funder || b.funderLogin === funder)
      .map(toSummary);
    return ok(rows);
  }

  if (root === 'bounties' && id) {
    const d = find(id);
    if (!d) return err(404, 'bounty_not_found', { id });
    if (method === 'GET' && !sub) return ok(d);
    if (sub === 'funding' && method === 'POST') {
      const rail = (body.rail ?? 'lightning') as FundingRail;
      if (!fx.funding[rail]) return err(400, 'invalid_rail', { rail });
      if (d.status !== 'unfunded') return err(409, 'already_funded', { status: d.status });
      polls.delete(id);
      return ok(fundingSession(fx, d, rail, now));
    }
    if (sub === 'funding' && method === 'GET') {
      if (d.status !== 'unfunded') return ok({ status: 'paid', bountyStatus: d.status });
      const n = (polls.get(id) ?? 0) + 1;
      polls.set(id, n);
      return n >= POLLS_BEFORE_PAID ? ok({ status: 'paid', bountyStatus: 'funded' }) : ok({ status: 'pending', bountyStatus: 'unfunded' });
    }
  }

  if (method === 'GET' && root === 'board') return ok(fx.board);

  if (method === 'GET' && root === 'dashboard') {
    const bounties = fx.dashboard.bountyIds.map(find).filter(Boolean).map((b) => toSummary(b as BountyDetail));
    return ok({ ...fx.dashboard, bounties });
  }

  if (method === 'POST' && root === 'backlog' && id === 'fund') {
    const ids = Array.isArray(body.ids) ? (body.ids as string[]) : fx.dashboard.backlog.filter((s) => s.selected).map((s) => s.id);
    const picked = fx.dashboard.backlog.filter((s) => ids.includes(s.id));
    if (!picked.length) return err(400, 'nothing_selected');
    const amount = picked.reduce((s, x) => s + x.priceXof, 0);
    return ok({ count: picked.length, suggestions: picked.map((s) => s.id), bountyIds: picked.map((s) => backlogBountyId(s.id)), session: fundingSession(fx, { amountXof: amount }, (body.rail as FundingRail) ?? 'lightning', now) });
  }

  if (root === 'me' && id === 'onboarding') {
    const st = mockOnboarding(fx);
    if (method === 'GET') return ok(st);
    if (method === 'POST') {
      if (body.defaultMode !== undefined && body.defaultMode !== 'maintain' && body.defaultMode !== 'hunt') return err(400, 'invalid_default_mode');
      if (body.defaultMode) st.defaultMode = body.defaultMode as OnboardingState['defaultMode'];
      if (body.preferences && typeof body.preferences === 'object') st.preferences = { ...st.preferences, ...(body.preferences as Partial<OnboardingState['preferences']>) };
      if (body.done === true && !st.onboardedAt) st.onboardedAt = now.toISOString();
      return ok(st);
    }
  }

  if (root === 'me' && id === 'lightning-address' && method === 'POST') {
    // Same checks as the server: user@domain format, then "does it resolve" (mock: *.invalid never does).
    const raw = typeof body.lightningAddress === 'string' ? body.lightningAddress.trim().toLowerCase() : '';
    const m = /^([a-z0-9\-_.+]{1,64})@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/.exec(raw);
    if (!m) return err(400, 'invalid_lightning_address');
    if (m[2]!.endsWith('.invalid')) return err(422, 'lightning_address_unreachable', { retryable: false });
    const masked = `${m[1]!.slice(0, 2)}***@${m[2]}`;
    mockOnboarding(fx).lightningAddress = masked;
    return ok({ lightningAddress: masked });
  }

  if (root === 'me') {
    const S = fx.me.states;
    if (method === 'GET' && !id) {
      const state = (query.get('state') ?? fx.me.mock.defaultState) as MeState;
      return S[state] ? ok(S[state]) : err(400, 'invalid_state', { state });
    }
  }

  if (method === 'GET' && root === 'users' && id) {
    return fx.users[id] ? ok(fx.users[id]) : err(404, 'user_not_found', { login: id });
  }

  if (method === 'GET' && root === 'receipts' && id) {
    return fx.receipts[id] ? ok(fx.receipts[id]) : err(404, 'receipt_not_found', { id });
  }

  if (method === 'GET' && root === 'live') {
    return query.get('format') === 'json' ? ok(fx.live) : { status: 200, stream: 'live' };
  }

  return err(404, 'not_found', { method, path: '/api/' + path.join('/') });
}

/** SSE for /live: one `snapshot`, then each fixture event after its delay, looping by default. */
export function liveStream(live: Live, { loop = true, speed = 1 } = {}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const run = (i: number) => {
        if (i === 0) send('snapshot', { columns: live.columns, cards: live.cards });
        if (i >= live.events.length) {
          if (!loop) return controller.close();
          timer = setTimeout(() => run(0), 4000 / speed);
          return;
        }
        timer = setTimeout(() => {
          send('transition', live.events[i]);
          run(i + 1);
        }, live.events[i]!.delayMs / speed);
      };
      run(0);
    },
    cancel() {
      clearTimeout(timer);
    },
  });
}
