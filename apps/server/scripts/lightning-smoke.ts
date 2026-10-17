/**
 * B1 sandbox check: creates a Lightning invoice for a bounty and polls it every 3 s
 * until it's paid (then prints the funding.paid event) or expires.
 *   pnpm --filter @bitbounty/server lightning:smoke -- 1000
 * Pay the printed BOLT11 from a sandbox/test wallet. Reads Bitnob keys from the repo-root .env.
 */
import { BitnobClient, readBitnobConfig } from "@bitbounty/bitnob";
import { BitnobFunderCustomers, BitnobRates, InMemoryFundingStore, LightningFunding } from "../src/funding/index.js";

const amountXof = Number(process.argv.slice(2).find((a) => a !== "--") ?? "1000");
const client = new BitnobClient(readBitnobConfig());
const store = new InMemoryFundingStore();
let done = false;
const funding = new LightningFunding({
  client,
  store,
  rates: new BitnobRates(client),
  customers: new BitnobFunderCustomers(client),
  emit: (e) => {
    console.log("EVENT", JSON.stringify(e));
    done = true;
  },
});

const f = await funding.invoice({ bountyId: `smoke-${Date.now()}`, amountXof, funderId: "smoke" });
console.log(`invoice ${f.bitnobRef}: ${f.sourceAmount} sats for ${f.amountXof} + ${f.feeXof} + ${f.bufferXof} FCFA, expires ${f.expiresAt}`);
console.log(f.paymentRequest);
while (!done) {
  await new Promise((r) => setTimeout(r, 3_000));
  const now = await funding.check(f.id);
  process.stdout.write(`${now?.status} `);
  if (now?.status === "expired") break;
}
process.exit(0);
