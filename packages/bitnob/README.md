# @bitbounty/bitnob

Typed Bitnob API client (HMAC signing, retries, clear errors). Will become the open-source Bitnob SDK (task D5).

```ts
import { BitnobClient, readBitnobConfig } from "@bitbounty/bitnob";

const bitnob = new BitnobClient(readBitnobConfig()); // BITNOB_CLIENT_ID, BITNOB_CLIENT_SECRET
await bitnob.whoami();
const quote = await bitnob.createPayoutQuote({ from_asset: "USDT", to_currency: "XOF", country: "SN",
  source: "offchain", settlement_amount: "10000", payment_reason: "bounty", reference: `pay-${bountyId}` });
```

Calls: `whoami`, `createCustomer`, `createLightningInvoice`, `getLightningInvoice`, `createPayoutQuote`, `getBanks`, `createVirtualAccount`, `simulateDeposit`, `createTradingQuote`, and `request(method, path, body)` for anything else.
Errors: every failure throws `BitnobError` with `status` (0 = no answer), `code` (`UNAUTHORIZED`, `NETWORK`, `TIMEOUT`, `BAD_RESPONSE`, `CONFIG`, `HTTP_<n>`…), `detail`, `correlationId`.
Retries: network errors, 429 and 5xx, `retries` extra attempts (default 2), each re-signed with a fresh nonce. Writes are safe to retry because Bitnob dedupes on `reference`.

```bash
pnpm test        # unit tests, no network
pnpm smoke       # whoami + the 4 key calls against the sandbox (needs keys in ../../.env)
```
Details and sandbox results: [docs/bitnob-api.md](../../docs/bitnob-api.md).
