import { Hono, type Context } from "hono";
import { TestPayoutError, type TestPayoutService } from "./test-payout.js";

export interface TestPayoutRoutesOptions {
  service: TestPayoutService;
  /** The signed-in user (W9 session). null → 401. */
  getUserId: (c: Context) => string | null | Promise<string | null>;
}

const STATUS: Record<TestPayoutError["code"], 400 | 404 | 409 | 422 | 423 | 429 | 502> = {
  NO_ACCOUNT: 404,
  ALREADY_VERIFIED: 409,
  LOCKED: 423,
  TOO_MANY_TESTS: 429,
  SEND_FAILED: 502,
  NO_TEST: 409,
  NUMBER_CHANGED: 409,
  INVALID_AMOUNT: 400,
  WRONG_AMOUNT: 422,
};

/**
 * POST /api/me/payout-account/test     → sends the test amount (never returns it)
 * POST /api/me/payout-account/confirm  {amount} → verifies it
 */
export function testPayoutRoutes({ service, getUserId }: TestPayoutRoutesOptions) {
  const app = new Hono();

  app.post("/api/me/payout-account/test", async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: "sign in first" }, 401);
    try {
      const test = await service.send(userId);
      return c.json({ status: "sent", sentAt: test.sentAt, phone: test.phoneE164, provider: test.provider });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post("/api/me/payout-account/confirm", async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: "sign in first" }, 401);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON", code: "INVALID_AMOUNT" }, 400);
    }
    const amount = typeof body === "object" && body !== null ? (body as { amount?: unknown }).amount : undefined;
    try {
      const account = await service.confirm(userId, amount);
      return c.json({ status: account.status, verifiedAt: account.verifiedAt });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  return app;
}

function errorResponse(c: Context, err: unknown) {
  if (!(err instanceof TestPayoutError)) throw err;
  return c.json(
    { error: err.message, code: err.code, triesLeft: err.triesLeft, lockedUntil: err.lockedUntil },
    STATUS[err.code],
  );
}
