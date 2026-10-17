// Mock API (F4): serves fixtures/*.json at /api/* so every page can be built before the back end.
// I1 replaces this file with a proxy to the real server API. More specific routes
// (e.g. /api/auth/[...nextauth] from W9) take precedence over this catch-all.
import bounties from '../../../../../fixtures/bounties.json';
import board from '../../../../../fixtures/board.json';
import dashboard from '../../../../../fixtures/dashboard.json';
import funding from '../../../../../fixtures/funding.json';
import me from '../../../../../fixtures/me.json';
import users from '../../../../../fixtures/users.json';
import receipts from '../../../../../fixtures/receipts.json';
import live from '../../../../../fixtures/live.json';
import { handleMock, liveStream, type Fixtures } from '../../../lib/mock-api';

export const dynamic = 'force-dynamic';

const fx = { bounties, board, dashboard, funding, me, users, receipts, live } as unknown as Fixtures;

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  if (req.method !== 'GET') body = await req.json().catch(() => ({}));
  const res = handleMock(fx, req.method, path, url.searchParams, body);
  if ('stream' in res) {
    return new Response(liveStream(fx.live, { speed: Number(url.searchParams.get('speed') ?? 1) || 1 }), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
    });
  }
  return Response.json(res.json, { status: res.status, headers: { 'X-BitBounty-Mock': 'fixtures' } });
}

export { handle as GET, handle as POST };
