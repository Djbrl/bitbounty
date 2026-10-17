import { bigint, index, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Inbound webhook audit log + dedupe (docs/plan.md §3 "events").
 * Written by the GitHub receiver (F6, source `github`) and the Bitnob receiver
 * (B5, source `bitnob`). `external_id` = X-GitHub-Delivery / Bitnob event id.
 */
export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    source: text("source", { enum: ["github", "bitnob", "system"] }).notNull(),
    externalId: text("external_id").notNull(),
    type: text("type").notNull(),
    action: text("action"),
    repo: text("repo"),
    installationId: bigint("installation_id", { mode: "number" }),
    payload: jsonb("payload").notNull(),
    status: text("status", { enum: ["received", "processed", "failed"] })
      .notNull()
      .default("received"),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("events_source_external_id_uq").on(t.source, t.externalId),
    index("events_type_idx").on(t.type, t.action),
  ],
);

export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
