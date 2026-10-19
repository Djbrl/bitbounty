// Prints the waitlist as CSV (email,signed_up_at). Reads the store's env from the shell or from
// apps/web/.env.local (made by `vercel env pull .env.local` in apps/web). Never commit that file.
//   node scripts/export-waitlist.mjs > waitlist.csv
import { readFileSync } from "node:fs";

const env = { ...process.env };
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=("?)(.*)\2$/);
    if (m && !env[m[1]]) env[m[1]] = m[3];
  }
} catch {}

const url = (env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL ?? "").replace(/\/+$/, "");
const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) {
  console.error("Missing KV_REST_API_URL / KV_REST_API_TOKEN (run `vercel env pull .env.local` in apps/web).");
  process.exit(1);
}

const res = await fetch(`${url}/zrange/bitbounty:waitlist/0/-1/WITHSCORES`, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) throw new Error(`Upstash answered ${res.status}`);
const { result = [] } = await res.json();
console.log("email,signed_up_at");
for (let i = 0; i < result.length; i += 2) console.log(`${result[i]},${new Date(Number(result[i + 1])).toISOString()}`);
console.error(`${result.length / 2} email(s)`);
