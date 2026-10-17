// I1: one switch between the real server and the fixtures.
// BITBOUNTY_API_URL (or NEXT_PUBLIC_API_URL) set → every page and /api/* call the real server.
// Unset → the F4 mock over fixtures/*.json, so the web still runs alone (offline dev, tests).

type Env = Record<string, string | undefined>;

/** Origin of the real server, without a trailing slash; null → use the fixtures. */
export function apiBaseUrl(env: Env = process.env): string | null {
  const raw = (env.BITBOUNTY_API_URL || env.NEXT_PUBLIC_API_URL || "").trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

/** The server answered with an error, or couldn't be reached. Pages turn it into their error state. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? `${code} (${status})`);
    this.name = "ApiError";
  }
}

export interface ApiOptions {
  /** GitHub login of the signed-in user, sent to the server with the internal token. */
  user?: string | null;
  timeoutMs?: number;
  env?: Env;
  fetchImpl?: typeof fetch;
  init?: RequestInit;
}

/** Headers that let the server trust `user` (it checks INTERNAL_API_TOKEN). Nothing without both. */
export function identityHeaders(user: string | null | undefined, env: Env = process.env): Record<string, string> {
  const token = env.INTERNAL_API_TOKEN?.trim();
  return token && user ? { authorization: `Bearer ${token}`, "x-bitbounty-user": user } : {};
}

/**
 * GET a page's data from the real server. 404 → null (the page renders its not-found);
 * any other failure, slow answer or unreachable server → ApiError (the page's error state).
 */
export async function apiGet<T>(path: string, opts: ApiOptions = {}): Promise<T | null> {
  const base = apiBaseUrl(opts.env);
  if (!base) throw new ApiError(500, "api_not_configured", "BITBOUNTY_API_URL is not set");
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${base}${path}`, {
      cache: "no-store",
      ...opts.init,
      headers: { accept: "application/json", ...identityHeaders(opts.user, opts.env), ...(opts.init?.headers ?? {}) },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new ApiError(503, timedOut ? "server_timeout" : "server_unreachable", timedOut ? "The server took too long to answer" : "The server can't be reached");
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? "server_error");
  }
  return (await res.json()) as T;
}

/** Real server when configured, otherwise the fixture mock. */
export async function load<T>(path: string, mock: () => T | null | Promise<T | null>, opts: ApiOptions = {}): Promise<T | null> {
  return apiBaseUrl(opts.env) ? apiGet<T>(path, opts) : mock();
}

/** User-facing text for an error state. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError || (err && typeof err === "object" && "code" in err)) {
    const code = (err as { code?: string }).code;
    if (code === "server_unreachable") return "Le serveur BitBounty ne répond pas. Réessayez dans un instant.";
    if (code === "server_timeout") return "Le serveur met trop de temps à répondre. Réessayez.";
    if (code === "unauthorized") return "Connectez-vous avec GitHub pour voir cette page.";
  }
  // In production Next.js hides server error details from the browser: stay generic but useful.
  return "Le serveur BitBounty ne répond pas ou a renvoyé une erreur. Réessayez dans un instant.";
}
