# @bitbounty/bitnob

Typed client for the Bitnob API: HMAC signing, retries and typed errors. Bitnob's official Node SDK is listed as "coming soon", so we wrote our own.

```ts
import { BitnobClient, readBitnobConfig } from "@bitbounty/bitnob";

const bitnob = new BitnobClient(readBitnobConfig()); // BITNOB_CLIENT_ID, BITNOB_CLIENT_SECRET, BITNOB_BASE_URL
await bitnob.whoami();                                // { environment: "sandbox" | "production", ... }
const invoice = await bitnob.createLightningInvoice({ customer_id, amount: 2218, description, expiry: 900, reference: `fund-${bountyId}-1` });
```

- **Calls:** `whoami`, `createCustomer`, Lightning (`createLightningInvoice`, `getLightningInvoice`, `simulateLightningPayment`, `payLightningInvoice`, `getLightningPayment`, `findLightningPayment`, `decodeLightningInvoice`), rates (`getExchangeRate`, `getTradingPrice`), naira (`createVirtualAccount`, `simulateDeposit`, `createTradingQuote`, `createTradingOrder`, `getTradingOrder`), and `request(method, path, body)` for anything else. The mobile money payout calls (`createPayoutQuote`, `initializePayout`, `finalizePayout`, `getPayout`, `getBanks`) are still there but BitBounty no longer uses them.
- **Errors:** every failure throws `BitnobError` with `status` (0 = no answer), `code` (`UNAUTHORIZED`, `NETWORK`, `TIMEOUT`, `BAD_RESPONSE`, `CONFIG`, `HTTP_<n>`…), `detail` and `correlationId`. It never contains the secret.
- **Retries:** network errors, 429 and 5xx, 2 extra attempts by default, each re-signed with a fresh timestamp and nonce. `Retry-After` is honoured (capped at 30 s). 4xx are never retried. Writes are safe to retry because Bitnob dedupes on `reference`; calls that must go out once (`payLightningInvoice`) pass `{ retries: 0 }`.
- **Secret:** kept in a `#private` field, so `inspect(client)` and `JSON.stringify(client)` never show it.
- **Proxy mode:** with `BITNOB_PROXY_TOKEN` set and `BITNOB_BASE_URL` pointing at a BitBounty server's `/dev/bitnob`, the client sends a bearer token instead of signing (see [docs/bitnob-api.md](../../docs/bitnob-api.md#sandbox-proxy-for-the-team)).

## Test
```sh
pnpm test        # unit tests, no network
pnpm smoke       # whoami + the key calls against the sandbox (keys in the repo-root .env)
pnpm smoke --env-file /path/to/.env
```
The smoke script stops unless `whoami` says `environment=sandbox`. Sandbox results: [docs/bitnob-api.md](../../docs/bitnob-api.md).
