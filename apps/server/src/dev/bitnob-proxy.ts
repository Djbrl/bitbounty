import { createHash, timingSafeEqual } from "node:crypto";
import { BitnobError, type BitnobClient } from "@bitbounty/bitnob";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

/**
 * DEV ONLY (F7): `/dev/bitnob/*` forwards teammates' Bitnob **sandbox** calls, signed with this
 * server's keys, from this server's whitelisted IP. Mounted only when `DEV_PROXY_TOKEN` is set.
 *
 *   curl -H "authorization: Bearer $BITNOB_PROXY_TOKEN" https://<tunnel>/dev/bitnob/api/whoami
 *
 * Or set `BITNOB_BASE_URL=https://<tunnel>/dev/bitnob` + `BITNOB_PROXY_TOKEN` and use `BitnobClient`
 * unchanged (see docs/bitnob-api.md, "F7").
 */
export const PROXY_PREFIX = "/dev/bitnob";

export interface BitnobProxyDeps {
  /** Bearer token the caller must send (`DEV_PROXY_TOKEN`). */
  token: string;
  /** Signs and forwards. Null when the server has no Bitnob keys: every authorised call answers 503. */
  client: Pick<BitnobClient, "forward"> | null;
  /** Largest accepted request body, in bytes (default 64 KiB). */
  maxBodyBytes?: number;
  /** Upstream timeout per call (default 20 s). */
  timeoutMs?: number;
  log?: (line: string) => void;
  now?: () => number;
}

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/**
 * Key, webhook and account-settings management stays out of reach, whatever the spelling.
 * A path segment containing one of these words is refused with 403.
 */
const BLOCKED_WORDS = ["key", "webhook", "setting", "secret", "credential", "whitelist", "permission", "token"];
/** Whole segments refused too (team / company administration). */
const BLOCKED_SEGMENTS = new Set(["account", "accounts", "users", "members", "team", "teams", "company", "companies", "ips"]);

const SEGMENT = /^[A-Za-z0-9_~.-]+$/;

/** Why a raw path (after the prefix) is refused, or null when it may be forwarded. */
export function checkPath(rawPath: string): { status: 400 | 403; error: string } | null {
  const bad = (error: string) => ({ status: 400 as const, error });
  if (!rawPath.startsWith("/api/")) return bad("only /api/... paths are forwarded");
  if (/%2e|%2f|%5c|%00|%25/i.test(rawPath)) return bad("encoded dots, slashes or percent signs are not allowed");
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return bad("malformed path encoding");
  }
  // Control characters and anything else odd fail the SEGMENT check below.
  if (decoded.includes("\\") || decoded.includes("//")) return bad("malformed path");
  const segments = decoded.slice(1).split("/");
  if (segments.at(-1) === "") segments.pop();
  for (const seg of segments) {
    if (seg === "." || seg === ".." || seg.includes("..")) return bad("path traversal");
    if (!SEGMENT.test(seg)) return bad("unexpected characters in path");
    const lower = seg.toLowerCase();
    if (BLOCKED_SEGMENTS.has(lower) || BLOCKED_WORDS.some((w) => lower.includes(w))) {
      return { status: 403, error: "this Bitnob path is blocked on the dev proxy" };
    }
  }
  return null;
}

/** Constant-time token check: both sides are hashed first, so length leaks nothing either. */
export function tokenMatches(header: string | undefined, token: string): boolean {
  const m = /^Bearer (.+)$/.exec(header ?? "");
  const given = createHash("sha256").update(m?.[1] ?? "").digest();
  const want = createHash("sha256").update(token).digest();
  return timingSafeEqual(given, want) && m !== null;
}

/** The URL exactly as the client sent it (before WHATWG normalisation resolves `..` and `%2e%2e`). */
function rawRequestUrl(c: Context): string {
  const incoming = (c.env as { incoming?: { url?: string } } | undefined)?.incoming;
  if (typeof incoming?.url === "string") return incoming.url;
  const u = new URL(c.req.url);
  return u.pathname + u.search;
}

function isOurs(path: string): boolean {
  return path === PROXY_PREFIX || path.startsWith(`${PROXY_PREFIX}/`);
}

function safeUser(v: string | undefined): string {
  return v && /^[A-Za-z0-9._@-]{1,40}$/.test(v) ? v : "-";
}

export function bitnobProxyRoutes(deps: BitnobProxyDeps): Hono {
  const app = new Hono();
  const log = deps.log ?? ((line: string) => console.log(line));
  const now = deps.now ?? Date.now;
  const maxBody = deps.maxBodyBytes ?? 64 * 1024;

  // Sandbox check, once (cached, concurrent first calls share it). A failed whoami isn't cached.
  let sandbox: Promise<boolean> | null = null;
  const isSandbox = (client: Pick<BitnobClient, "forward">): Promise<boolean> => {
    sandbox ??= client
      .forward("GET", "/api/whoami", "", { timeoutMs: deps.timeoutMs ?? 20_000 })
      .then((r) => {
        if (r.status !== 200) throw new BitnobError(`whoami answered ${r.status}`, r.status, `HTTP_${r.status}`);
        const json = JSON.parse(r.body) as { data?: { environment?: unknown }; environment?: unknown };
        const env = json.data?.environment ?? json.environment;
        if (env !== "sandbox") log(`[dev-proxy] Bitnob keys are not sandbox (environment=${String(env)}): proxy refuses every call`);
        return env === "sandbox";
      })
      .catch((err: unknown) => {
        sandbox = null;
        throw err;
      });
    return sandbox;
  };

  const auth: MiddlewareHandler = async (c, next) => {
    if (!tokenMatches(c.req.header("authorization"), deps.token)) return c.json({ error: "unauthorized" }, 401);
    await next();
  };

  // Runs for every request: it must see traversal that URL parsing resolved *out of* the prefix
  // (`/dev/bitnob/../../api/whoami` arrives here as `/api/whoami`).
  app.use("*", async (c, next) => {
    const raw = rawRequestUrl(c);
    const rawPath = raw.split("?")[0]!;
    const path = new URL(c.req.url).pathname;
    if (!isOurs(rawPath) && !isOurs(path)) return next();
    const t0 = now();
    let res: Response;
    if (!rawPath.startsWith("/") || rawPath !== path) {
      // `..`, `%2e%2e`, absolute-form URLs, or anything the URL parser had to rewrite.
      res = c.json({ error: "path traversal or non-canonical URL" }, 400);
    } else {
      await next();
      res = c.res;
    }
    // One line per call: user, method, path (no query), status, ms. Never bodies, headers or tokens.
    log(`[dev-proxy] user=${safeUser(c.req.header("x-dev-user"))} ${c.req.method} ${rawPath.slice(0, 200)} -> ${res.status} ${now() - t0}ms`);
    return res;
  });

  app.all(`${PROXY_PREFIX}/*`, auth, bodyLimit({ maxSize: maxBody, onError: (c) => c.json({ error: `body over ${maxBody} bytes` }, 413) }), async (c) => {
    const url = new URL(c.req.url); // canonical: the guard above checked it equals the raw path
    const rawPath = url.pathname.slice(PROXY_PREFIX.length);
    const search = url.search;
    const refused = checkPath(rawPath);
    if (refused) return c.json({ error: refused.error }, refused.status);
    if (/[\s#\\]/.test(search)) return c.json({ error: "malformed query" }, 400);
    const method = c.req.method.toUpperCase();
    if (!ALLOWED_METHODS.has(method)) return c.json({ error: "method not allowed" }, 405);
    if (!deps.client) return c.json({ error: "the server has no Bitnob keys" }, 503);

    let body = "";
    const text = await c.req.text();
    if (text.trim() !== "") {
      try {
        body = JSON.stringify(JSON.parse(text)); // compact: we sign exactly what we send
      } catch {
        return c.json({ error: "body must be JSON" }, 400);
      }
    }

    try {
      if (!(await isSandbox(deps.client))) {
        return c.json({ error: "the server's Bitnob keys are not sandbox keys: dev proxy disabled" }, 403);
      }
      // Single attempt (no retry, POST or not): the caller decides whether to retry.
      const res = await deps.client.forward(method, rawPath + search, body, { timeoutMs: deps.timeoutMs ?? 20_000 });
      const empty = res.status === 204 || res.status === 205 || res.status === 304;
      const headers: Record<string, string> = {};
      if (res.contentType && !empty) headers["content-type"] = res.contentType;
      return new Response(empty ? null : res.body, { status: res.status, headers });
    } catch (err) {
      const e = err instanceof BitnobError ? err : null;
      if (e?.code === "TIMEOUT") return c.json({ error: "Bitnob timed out" }, 504);
      return c.json({ error: "Bitnob unreachable", code: e?.code ?? "PROXY" }, 502);
    }
  });

  return app;
}
