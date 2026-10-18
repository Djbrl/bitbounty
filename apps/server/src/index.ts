import { runMigrations } from "@bitbounty/db";
import { serve } from "@hono/node-server";
import { app, database, startPayouts } from "./app.js";

// Apply pending migrations before taking traffic (idempotent; the Docker server relies on it).
if (database) {
  await runMigrations(database.db);
  console.log("[db] migrations applied");
}

// B6: payouts resume only once the schema is up to date.
startPayouts();

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`bitbounty-server listening on http://localhost:${info.port}`);
});
