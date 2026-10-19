// POST /api/waitlist {email, website?}: adds the email to the waitlist (lib/waitlist.ts).
// Takes precedence over the /api/[...path] proxy, so it works while the API server is down.
// Answers the same way for a new and an already-listed email, so the list can't be probed.
import { joinWaitlist, normalizeEmail, redisFromEnv } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: unknown; website?: unknown } | null;
  if (!body) return Response.json({ error: "bad_request" }, { status: 400 });
  // Honeypot: the hidden "website" field is empty for people; bots fill it. Pretend it worked.
  if (typeof body.website === "string" && body.website.trim()) return Response.json({ ok: true });

  const email = normalizeEmail(body.email);
  if (!email) return Response.json({ error: "invalid_email" }, { status: 400 });

  const redis = redisFromEnv();
  if (!redis) return Response.json({ error: "unavailable" }, { status: 503 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    const result = await joinWaitlist(redis, email, ip);
    if (result === "rate_limited") return Response.json({ error: "rate_limited" }, { status: 429 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`[waitlist] store failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
