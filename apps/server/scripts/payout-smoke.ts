/**
 * B2 sandbox check. Refuses to run unless Bitnob's whoami says `environment: sandbox`.
 *
 *   # read-only: whoami, bank directory, bank_code resolution, one quote (nothing is initialized or finalized)
 *   pnpm --filter @bitbounty/server payout:smoke -- --dry-run +221771234567 wave "Awa Diop" 137
 *
 *   # full pipeline (quote → initialize → FINALIZE): a human runs this, never an agent
 *   pnpm --filter @bitbounty/server payout:smoke -- +221771234567 wave "Awa Diop" 137
 *
 * Reads BITNOB_CLIENT_ID / BITNOB_CLIENT_SECRET / BITNOB_SN_BANK_CODES from the repo-root .env.
 * In-memory store; polls Bitnob every 5 s until the payout succeeds or fails (max 3 attempts, 2 min).
 */
import { BitnobClient, readBitnobConfig } from "@bitbounty/bitnob";
import type { PayoutProvider } from "@bitbounty/core";
import { BankCodes, InMemoryPayoutStore, PayoutService, maskPhone, readBankCodeFallback } from "../src/payouts/index.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const dryRun = args.includes("--dry-run");
const [phoneE164, provider = "wave", accountName = "BitBounty Test", amount = "137"] = args.filter((a) => a !== "--dry-run");
if (!phoneE164 || !["wave", "orange", "free"].includes(provider)) {
  console.error('usage: payout:smoke -- [--dry-run] <+221…> <wave|orange|free> "<account name>" [amount XOF]');
  process.exit(1);
}

const client = new BitnobClient(readBitnobConfig());
const me = await client.whoami();
if (me.environment !== "sandbox") {
  console.error(`refusing to run: Bitnob credentials are for environment=${String(me.environment)}, not sandbox`);
  process.exit(1);
}
console.log(`whoami: environment=sandbox client=${me.client_name}`);

if (dryRun) {
  const banks = await client.getBanks("SN");
  console.log(`banks/SN: ${banks == null ? "null" : `${banks.length} entries`}`);
  try {
    const code = await new BankCodes(client, readBankCodeFallback()).resolve("SN", provider as PayoutProvider);
    console.log(`bank_code for ${provider}: ${code}`);
  } catch (err) {
    console.log(`bank_code for ${provider}: MISSING (${err instanceof Error ? err.message : String(err)})`);
  }
  const quote = await client.createPayoutQuote({
    from_asset: (process.env.BITNOB_PAYOUT_ASSET as "USDT" | "BTC" | undefined) ?? "USDT",
    to_currency: "XOF",
    country: "SN",
    source: "offchain",
    settlement_amount: amount,
    payment_reason: "bounty",
    reference: `smoke-dry-${Date.now()}`,
  });
  const matches = Number(quote.settlement_amount) === Number(amount);
  console.log(
    `quote ${quote.quote_id}: status=${quote.status} settlement_amount=${quote.settlement_amount} XOF ` +
      `(${matches ? "matches" : "DOES NOT match"} ${amount}) amount=${quote.amount} ${quote.from_asset} expires_at=${quote.expires_at}`,
  );
  console.log(`dry run: nothing initialized or finalized for ${maskPhone(phoneE164)}`);
  process.exit(matches ? 0 : 1);
}

const store = new InMemoryPayoutStore();
const service = new PayoutService({
  rails: client,
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
