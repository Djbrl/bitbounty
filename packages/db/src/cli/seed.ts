import { createDb, requireDatabaseUrl } from "../client.js";
import { seed } from "../seed.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// The seed empties every table: refuse anything that isn't a local database
// unless SEED_ALLOW_REMOTE=1 (e.g. a disposable demo database).
const url = requireDatabaseUrl();
const host = new URL(url).hostname;
const allowRemote = process.env.SEED_ALLOW_REMOTE === "1";
if (process.env.NODE_ENV === "production" && !allowRemote) {
  throw new Error("Refusing to seed with NODE_ENV=production (set SEED_ALLOW_REMOTE=1 to force)");
}
if (!LOCAL_HOSTS.has(host) && !allowRemote) {
  throw new Error(`Refusing to seed remote database "${host}": it empties every table (set SEED_ALLOW_REMOTE=1 to force)`);
}

const { db, close } = createDb(url);
try {
  const counts = await seed(db);
  console.log("seeded", counts);
} finally {
  await close();
}
