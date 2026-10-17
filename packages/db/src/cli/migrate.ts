import { createDb, requireDatabaseUrl } from "../client.js";
import { runMigrations } from "../migrate.js";

const { db, close } = createDb(requireDatabaseUrl());
try {
  await runMigrations(db);
  console.log("migrations applied");
} finally {
  await close();
}
