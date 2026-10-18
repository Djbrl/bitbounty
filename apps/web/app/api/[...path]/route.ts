// /api/* for the browser (fund page polling, onboarding, backlog, /live SSE).
// I1: with BITBOUNTY_API_URL set, a proxy to the real server (adds the signed-in user for the
// server's per-user routes). Without it, the F4 mock over fixtures/*.json, so the web runs alone.
// More specific routes (e.g. /api/auth/[...nextauth] from W9) take precedence over this catch-all.
import bounties from '../../../../../fixtures/bounties.json';
import board from '../../../../../fixtures/board.json';
import dashboard from '../../../../../fixtures/dashboard.json';
import funding from '../../../../../fixtures/funding.json';
import me from '../../../../../fixtures/me.json';
import users from '../../../../../fixtures/users.json';
import receipts from '../../../../../fixtures/receipts.json';
import live from '../../../../../fixtures/live.json';
import { apiBaseUrl } from '../../../lib/api';
import { proxy, SSE_HEADERS } from '../../../lib/api-proxy';
import { handleMock, liveStream, type Fixtures } from '../../../lib/mock-api';

export const dynamic = 'force-dynamic';

const fx = { bounties, board, dashboard, funding, me, users, receipts, live } as unknown as Fixtures;

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  const url = new URL(req.url);
  const base = apiBaseUrl();
  if (base) return proxy(req, base, path, url);

  let body: Record<string, unknown> = {};
  if (req.method !== 'GET') body = await req.json().catch(() => ({}));
  const res = handleMock(fx, req.method, path, url.searchParams, body);
  if ('stream' in res) {
    return new Response(liveStream(fx.live, { speed: Number(url.searchParams.get('speed') ?? 1) || 1 }), { headers: SSE_HEADERS });
  }
  return Response.json(res.json, { status: res.status, headers: { 'X-BitBounty-Mock': 'fixtures' } });
}

export { handle as GET, handle as POST, handle as DELETE };
