import { describe, expect, it, vi } from "vitest";
import { joinWaitlist, normalizeEmail, RATE_LIMIT_PER_HOUR, redisFromEnv, WAITLIST_KEY } from "./waitlist";

const redis = { url: "https://redis.example", token: "tok" };

/** Fake Upstash: records each pipeline body and answers INCR with `count`. */
function fakeFetch(count: number) {
  const calls: string[][][] = [];
  const impl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const cmds = JSON.parse(String(init?.body)) as string[][];
    calls.push(cmds);
    return Response.json(cmds.map((c) => ({ result: c[0] === "INCR" ? count : 1 })));
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("waitlist", () => {
  it("normalizes emails and rejects junk", () => {
    expect(normalizeEmail("  Awa@Example.SN ")).toBe("awa@example.sn");
    for (const bad of ["", "awa", "awa@", "a b@c.d", "awa@example", 42, null, `${"a".repeat(250)}@x.io`]) expect(normalizeEmail(bad)).toBeNull();
  });

  it("reads the Vercel (KV_*) or Upstash (UPSTASH_*) env, else null", () => {
    expect(redisFromEnv({ KV_REST_API_URL: "https://a/", KV_REST_API_TOKEN: "t" })).toEqual({ url: "https://a", token: "t" });
    expect(redisFromEnv({ UPSTASH_REDIS_REST_URL: "https://b", UPSTASH_REDIS_REST_TOKEN: "u" })).toEqual({ url: "https://b", token: "u" });
    expect(redisFromEnv({ KV_REST_API_URL: "https://a" })).toBeNull();
  });

  it("adds the email with ZADD NX after counting the attempt against a hashed IP", async () => {
    const { impl, calls } = fakeFetch(1);
    expect(await joinWaitlist(redis, "awa@example.sn", "41.83.144.121", { fetchImpl: impl, now: 1000 })).toBe("added");
    expect(calls).toHaveLength(2);
    const [incr, expire] = calls[0]!;
    expect(incr![0]).toBe("INCR");
    expect(incr![1]).not.toContain("41.83");
    expect(expire).toEqual(["EXPIRE", incr![1], "3600", "NX"]);
    expect(calls[1]).toEqual([["ZADD", WAITLIST_KEY, "NX", "1000", "awa@example.sn"]]);
  });

  it("stops at the hourly limit without writing the email", async () => {
    const { impl, calls } = fakeFetch(RATE_LIMIT_PER_HOUR + 1);
    expect(await joinWaitlist(redis, "awa@example.sn", "1.2.3.4", { fetchImpl: impl })).toBe("rate_limited");
    expect(calls).toHaveLength(1);
  });

  it("throws when Upstash answers an error", async () => {
    const impl = (async () => Response.json([{ error: "WRONGPASS" }])) as unknown as typeof fetch;
    await expect(joinWaitlist(redis, "awa@example.sn", "1.2.3.4", { fetchImpl: impl })).rejects.toThrow("WRONGPASS");
  });
});
