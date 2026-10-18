// I1: forwards a browser /api/* request to the real server (used by app/api/[...path]/route.ts).
import { identityHeaders } from './api';
import { sessionLogin } from './session-login';

export const SSE_HEADERS = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' };

const isDotSegment = (s: string) => s === '' || s === '.' || s === '..';

/** True if a segment is empty or a dot segment, as given or after (double) percent-decoding. */
function badSegment(seg: string): boolean {
  let cur = seg;
  for (let i = 0; i < 3; i++) {
    if (isDotSegment(cur)) return true;
    try {
      cur = decodeURIComponent(cur);
    } catch {
      return true;
    }
  }
  return false;
}

/** Forwards to the server. Path segments are re-encoded so `..` or `?` can't escape `/api/`. */
export async function proxy(
  req: Request,
  base: string,
  path: string[],
  url: URL,
  user?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (path.some(badSegment)) return Response.json({ error: 'bad_path' }, { status: 400 });
  const target = `${base}/api/${path.map(encodeURIComponent).join('/')}${url.search}`;
  const isLive = path[0] === 'live';
  const login = user === undefined ? await sessionLogin() : user;
  const headers: Record<string, string> = { accept: req.headers.get('accept') ?? 'application/json', ...identityHeaders(login) };
  const contentType = req.headers.get('content-type');
  if (contentType) headers['content-type'] = contentType;
  // The live stream stays open once it answers, but must answer (headers) within 10 s.
  const connect = new AbortController();
  const connectTimer = isLive ? setTimeout(() => connect.abort(new DOMException("timeout", "TimeoutError")), 10_000) : undefined;
  try {
    const res = await fetchImpl(target, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
      cache: 'no-store',
      // The live stream stays open; everything else must answer quickly.
      signal: isLive ? AbortSignal.any([req.signal, connect.signal]) : AbortSignal.any([req.signal, AbortSignal.timeout(15_000)]),
    });
    clearTimeout(connectTimer);
    if (isLive && res.ok && res.body) return new Response(res.body, { status: 200, headers: SSE_HEADERS });
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' } });
  } catch (err) {
    clearTimeout(connectTimer);
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    return Response.json({ error: timedOut ? 'server_timeout' : 'server_unreachable' }, { status: timedOut ? 504 : 503 });
  }
}

