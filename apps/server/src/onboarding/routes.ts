import { Hono, type Context } from "hono";
import { TestPayoutError, type TestPayoutService } from "./test-payout.js";

export interface TestPayoutRoutesOptions {
  service: TestPayoutService;
  /** The signed-in user (W9 session). null → 401. */
  getUserId: (c: Context) => string | null | Promise<string | null>;
  /** Checks the 6-digit SMS code (not B3's job: the SMS sender plugs in here). */
  checkSmsCode: (userId: string, code: string) => boolean | Promise<boolean>;
  /** Builds the `Me` body W4 expects (same as GET /api/me). Defaults to `{ payoutAccount }` only. */
  getMe?: (userId: string) => Promise<object>;
}

/** W4's error codes (apps/web/components/onboarding): `{ error, attemptsLeft?, lockedUntil? }`. */
const ERRORS: Record<TestPayoutError["code"], { status: 400 | 404 | 409 | 422 | 423 | 429 | 502; error: string }> = {
  NO_ACCOUNT: { status: 404, error: "no_account" },
  ALREADY_VERIFIED: { status: 409, error: "already_verified" },
  SMS_NOT_VERIFIED: { status: 409, error: "sms_not_verified" },
  LOCKED: { status: 423, error: "locked" },
  TOO_MANY_TESTS: { status: 429, error: "too_many_tests" },
  SEND_FAILED: { status: 502, error: "send_failed" },
  NO_TEST: { status: 409, error: "no_test" },
  NUMBER_CHANGED: { status: 409, error: "number_changed" },
  INVALID_AMOUNT: { status: 400, error: "invalid_amount" },
  WRONG_AMOUNT: { status: 422, error: "wrong_amount" },
};

/**
 * W4's contract (apps/web/components/onboarding/api.ts, apps/web/lib/mock-api.ts):
 * POST /api/me/payout-account/sms     {code}   → SMS ok, then the test amount is sent → Me + testPayoutSent
 * POST /api/me/payout-account/confirm {amount} → Me (verified) | 422 wrong_amount + attemptsLeft | 423 locked
 * The amount and the full number are never returned.
 */
export function testPayoutRoutes({ service, getUserId, checkSmsCode, getMe }: TestPayoutRoutesOptions) {
  const app = new Hono();
  const me = getMe ?? (async (userId: string) => ({ payoutAccount: await service.accountView(userId) }));

  app.post("/api/me/payout-account/sms", async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: "unauthorized" }, 401);
    const code = (await readJson(c))?.code;
    if (typeof code !== "string" && typeof code !== "number") return c.json({ error: "wrong_code" }, 422);
    if (!(await checkSmsCode(userId, String(code)))) return c.json({ error: "wrong_code" }, 422);
    try {
      await service.smsVerifiedThenSend(userId);
      return c.json({ ...(await me(userId)), testPayoutSent: true });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post("/api/me/payout-account/confirm", async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: "unauthorized" }, 401);
    const body = await readJson(c);
    if (!body) return c.json({ error: "invalid_amount" }, 400);
    try {
      await service.confirm(userId, body.amount);
      return c.json(await me(userId));
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  return app;
}

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function errorResponse(c: Context, err: unknown) {
  if (!(err instanceof TestPayoutError)) throw err;
  const { status, error } = ERRORS[err.code];
  return c.json({ error, message: err.message, attemptsLeft: err.attemptsLeft, lockedUntil: err.lockedUntil }, status);
}
