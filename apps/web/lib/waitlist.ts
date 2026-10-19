// Waitlist emails, stored in Upstash Redis through its REST API (the store Vercel's Upstash integration adds
// to the project). No SDK: one fetch per call, so the route stays small and testable with a fake fetch.
// Emails live in a sorted set scored by the signup time; a second signup with the same email keeps the first.

export const WAITLIST_KEY = "bitbounty:waitlist";
/** Signups allowed per IP per hour, to keep bots from filling the list. */
export const RATE_LIMIT_PER_HOUR = 10;

export interface RedisRest {
  url: string;
  token: string;
}

/** Vercel's Upstash integration sets KV_REST_API_*; a store created on Upstash directly sets UPSTASH_REDIS_REST_*. */
export function redisFromEnv(env: Record<string, string | undefined> = process.env): RedisRest | null {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (!url?.trim() || !token?.trim()) return null;
  return { url: url.trim().replace(/\/+$/, ""), token: token.trim() };
}

// Deliberately simple: one @, no spaces, a dot in the domain. The real check is the email we send later.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed, lowercased email, or null when it doesn't look like one. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

type Fetch = typeof fetch;

async function pipeline(redis: RedisRest, commands: (string | number)[][], fetchImpl: Fetch): Promise<unknown[]> {
  const res = await fetchImpl(`${redis.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${redis.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands.map((c) => c.map(String))),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const out = (await res.json()) as { result?: unknown; error?: string }[];
  const failed = out.find((r) => r.error);
  if (failed) throw new Error(`redis: ${failed.error}`);
  return out.map((r) => r.result);
}

/** SHA-256 of the IP, so the rate-limit keys never hold a raw address. */
async function ipKey(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `bitbounty:waitlist:rl:${hex.slice(0, 32)}`;
}

export type JoinResult = "added" | "rate_limited";

/** Counts the attempt against the IP, then adds the email (first signup time wins). */
export async function joinWaitlist(
  redis: RedisRest,
  email: string,
  ip: string,
  { fetchImpl = fetch, now = Date.now() }: { fetchImpl?: Fetch; now?: number } = {},
): Promise<JoinResult> {
  const rl = await ipKey(ip);
  const [count] = await pipeline(redis, [["INCR", rl], ["EXPIRE", rl, 3600, "NX"]], fetchImpl);
  if (Number(count) > RATE_LIMIT_PER_HOUR) return "rate_limited";
  await pipeline(redis, [["ZADD", WAITLIST_KEY, "NX", now, email]], fetchImpl);
  return "added";
}
