/**
 * Storage for inbound webhook events: audit log + dedupe on the delivery id.
 * Shape matches the `events` table in `@bitbounty/db` (packages/db/src/schema.ts)
 * (shared with the Bitnob receiver, B5, via `source`).
 */

export type EventSource = "github" | "bitnob" | "system";
export type EventStatus = "received" | "processed" | "failed";

export interface NewStoredEvent {
  source: EventSource;
  /** GitHub: the `X-GitHub-Delivery` header. Unique per source. */
  externalId: string;
  /** GitHub: the `X-GitHub-Event` header, e.g. `issue_comment`. */
  type: string;
  action: string | null;
  /** `owner/name`, when the payload has a repository. */
  repo: string | null;
  installationId: number | null;
  payload: unknown;
  receivedAt: Date;
}

export interface StoredEvent extends NewStoredEvent {
  id: number;
  status: EventStatus;
  processedAt: Date | null;
  error: string | null;
}

export interface InsertResult {
  /** true if this call created the row; false if the delivery id was already stored. */
  inserted: boolean;
  event: StoredEvent;
}

export interface EventStore {
  /** Inserts the event, or returns the existing row if (source, externalId) is already stored. */
  insert(event: NewStoredEvent): Promise<InsertResult>;
  /** Records the dispatch outcome. `error` set → status `failed`, else `processed`. */
  markDone(id: number, error?: string | null): Promise<void>;
  get(source: EventSource, externalId: string): Promise<StoredEvent | undefined>;
}

/** In-memory store for tests and the offline demo. */
export class InMemoryEventStore implements EventStore {
  private rows = new Map<string, StoredEvent>();
  private nextId = 1;

  private key(source: EventSource, externalId: string) {
    return `${source}:${externalId}`;
  }

  async insert(event: NewStoredEvent): Promise<InsertResult> {
    const k = this.key(event.source, event.externalId);
    const existing = this.rows.get(k);
    if (existing) return { inserted: false, event: existing };
    const row: StoredEvent = {
      ...event,
      id: this.nextId++,
      status: "received",
      processedAt: null,
      error: null,
    };
    this.rows.set(k, row);
    return { inserted: true, event: row };
  }

  async markDone(id: number, error?: string | null): Promise<void> {
    for (const row of this.rows.values()) {
      if (row.id !== id) continue;
      row.status = error ? "failed" : "processed";
      row.error = error ?? null;
      row.processedAt = new Date();
      return;
    }
  }

  async get(source: EventSource, externalId: string) {
    return this.rows.get(this.key(source, externalId));
  }

  all(): StoredEvent[] {
    return [...this.rows.values()];
  }
}
