import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// TODO(F3): switch to the @bitbounty/db package export once the workspace exists.
import { events, type EventRow } from "../../../../packages/db/src/schema/events.js";
import type { EventSource, EventStore, InsertResult, NewStoredEvent, StoredEvent } from "./event-store.js";

type Db = PgDatabase<PgQueryResultHKT, any>;

/** Postgres-backed EventStore. Dedupe relies on the unique (source, external_id) index. */
export class DrizzleEventStore implements EventStore {
  constructor(private db: Db) {}

  async insert(event: NewStoredEvent): Promise<InsertResult> {
    const [row] = await this.db
      .insert(events)
      .values({ ...event, payload: event.payload as object })
      .onConflictDoNothing({ target: [events.source, events.externalId] })
      .returning();
    if (row) return { inserted: true, event: toStored(row) };
    const existing = await this.get(event.source, event.externalId);
    if (!existing) throw new Error(`event ${event.source}:${event.externalId} vanished after conflict`);
    return { inserted: false, event: existing };
  }

  async markDone(id: number, error?: string | null): Promise<void> {
    await this.db
      .update(events)
      .set({ status: error ? "failed" : "processed", error: error ?? null, processedAt: new Date() })
      .where(eq(events.id, id));
  }

  async get(source: EventSource, externalId: string) {
    const [row] = await this.db
      .select()
      .from(events)
      .where(and(eq(events.source, source), eq(events.externalId, externalId)))
      .limit(1);
    return row ? toStored(row) : undefined;
  }
}

function toStored(row: EventRow): StoredEvent {
  return {
    id: row.id,
    source: row.source,
    externalId: row.externalId,
    type: row.type,
    action: row.action,
    repo: row.repo,
    installationId: row.installationId,
    payload: row.payload,
    receivedAt: row.receivedAt,
    status: row.status,
    processedAt: row.processedAt,
    error: row.error,
  };
}
