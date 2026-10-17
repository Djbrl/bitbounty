/**
 * B3 sandbox check: sends a random 100–199 F test payout through Bitnob, then validates it.
 *   pnpm --filter @bitbounty/server test-payout:smoke -- +221771234567 wave "Awa Diop"
 * Refuses to run unless GET /api/whoami says environment=sandbox. In-memory stores.
 * The amount is printed here only because this is a sandbox dry run (the API never returns it).
 */
import { BitnobClient, readBitnobConfig } from "@bitbounty/bitnob";
import type { PayoutProvider } from "@bitbounty/core";
import { InMemoryPayoutAccountStore, InMemoryTestPayoutStore, TestPayoutService } from "../src/onboarding/index.js";

const [phoneE164, provider = "wave", accountName = "BitBounty Test"] = process.argv.slice(2).filter((a) => a !== "--");
if (!phoneE164 || !["wave", "orange", "free"].includes(provider)) {
  console.error('usage: test-payout:smoke -- <+221…> <wave|orange|free> "<account name>"');
  process.exit(1);
}

const client = new BitnobClient(readBitnobConfig());
const who = await client.whoami();
console.log(`whoami environment=${who.environment}`);
if (who.environment !== "sandbox") {
  console.error("not a sandbox key: refusing to send a test payout");
  process.exit(1);
}

const accounts = new InMemoryPayoutAccountStore();
const tests = new InMemoryTestPayoutStore();
await accounts.save({
  userId: "smoke",
  country: "SN",
  provider: provider as PayoutProvider,
  phoneE164,
  accountName,
  status: "pending",
  testAmountXof: null,
  verifiedAt: null,
  lockedUntil: null,
});
const service = new TestPayoutService({
  rails: client,
  accounts,
  tests,
  callbackUrl: process.env.BITNOB_CALLBACK_URL || "https://example.com/webhooks/bitnob",
  fromAsset: (process.env.BITNOB_PAYOUT_ASSET as "USDT" | "BTC" | undefined) ?? "USDT",
});

try {
  const test = await service.smsVerifiedThenSend("smoke");
  console.log(`sent reference=${test.reference} amount=${test.amountXof} F`);
  const wrong = test.amountXof === 199 ? 198 : test.amountXof + 1;
  await service.confirm("smoke", String(wrong)).catch((e: { code?: string; attemptsLeft?: number }) =>
    console.log(`wrong amount → ${e.code} attemptsLeft=${e.attemptsLeft}`),
  );
  const account = await service.confirm("smoke", `${test.amountXof} FCFA`);
  console.log(`right amount → status=${account.status} verifiedAt=${account.verifiedAt}`);
} catch (err) {
  console.error(`failed: ${err instanceof Error ? err.message : String(err)}`);
  console.error(`stored error: ${(await tests.list("smoke")).at(-1)?.error ?? "-"}`);
  process.exit(1);
}
process.exit(0);
