/**
 * B2 sandbox check: pays a mobile money number through the real payout pipeline.
 *   pnpm --filter @bitbounty/server payout:smoke -- +221771234567 wave "Awa Diop" 137
 * Reads BITNOB_CLIENT_ID / BITNOB_CLIENT_SECRET from the repo-root .env. In-memory store,
 * polls Bitnob every 5 s until the payout succeeds or fails (max 3 attempts, 2 min).
 */
import { BitnobClient, readBitnobConfig } from "@bitbounty/bitnob";
import type { PayoutProvider } from "@bitbounty/core";
import { InMemoryPayoutStore, PayoutService } from "../src/payouts/index.js";

const [phoneE164, provider = "wave", accountName = "BitBounty Test", amount = "137"] = process.argv.slice(2).filter((a) => a !== "--");
if (!phoneE164 || !["wave", "orange", "free"].includes(provider)) {
  console.error('usage: payout:smoke -- <+221…> <wave|orange|free> "<account name>" [amount XOF]');
  process.exit(1);
}

const store = new InMemoryPayoutStore();
const service = new PayoutService({
  rails: new BitnobClient(readBitnobConfig()),
  store,
  emit: (e) => console.log(`event ${e.type}`, JSON.stringify(e)),
  getBeneficiary: async () => ({ provider: provider as PayoutProvider, phoneE164, accountName, country: "SN" }),
  callbackUrl: process.env.BITNOB_CALLBACK_URL || "https://example.com/webhooks/bitnob",
  fromAsset: (process.env.BITNOB_PAYOUT_ASSET as "USDT" | "BTC" | undefined) ?? "USDT",
  retryDelaysMs: [3_000],
});

const bountyId = `smoke-${Date.now()}`;
await service.start({ bountyId, userId: "smoke", amountXof: Number(amount) });

const deadline = Date.now() + 120_000;
for (;;) {
  const row = (await store.getByBounty(bountyId))!;
  console.log(`status=${row.status} attempt=${row.attempts} quote=${row.quoteId ?? "-"} payout=${row.bitnobPayoutId ?? "-"}${row.lastError ? ` error=${row.lastError}` : ""}`);
  if (row.status === "succeeded" || row.status === "failed" || Date.now() > deadline) break;
  await new Promise((r) => setTimeout(r, 5_000));
  await service.poll();
}
process.exit(0);
