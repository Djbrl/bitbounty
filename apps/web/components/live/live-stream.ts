// SSE client for `GET /api/live`: one `snapshot` {columns, cards, route?}, then `transition` events
// (a naira-funded bounty's transition carries its `route`, I4).
// Reconnects with backoff when the stream drops; every (re)connect starts with a fresh snapshot,
// so the board resyncs on its own. I1 keeps the same URL and event names.
import { reconnectDelay, type LiveState, type LiveTransition } from "./live-data";

export type LiveConnection = "connecting" | "live" | "reconnecting";

/** The server's snapshot has `route` (null when no naira-funded bounty is on the board); the fixture stream has none. */
export type LiveSnapshotMessage = LiveState & { route?: unknown };

export interface LiveHandlers {
  onSnapshot: (s: LiveSnapshotMessage) => void;
  onTransition: (ev: LiveTransition) => void;
  onConnection: (c: LiveConnection) => void;
}

/** Minimal EventSource surface, so tests can pass a fake. */
export interface EventSourceLike {
  addEventListener(type: string, fn: (e: MessageEvent) => void): void;
  onopen: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
  close(): void;
}

export function liveUrl(speed = 1): string {
  return speed === 1 ? "/api/live" : `/api/live?speed=${speed}`;
}

/** Opens the stream; returns a function that closes it for good. */
export function connectLive(
  url: string,
  h: LiveHandlers,
  make: (url: string) => EventSourceLike = (u) => new EventSource(u) as unknown as EventSourceLike,
  schedule: (fn: () => void, ms: number) => unknown = setTimeout,
): () => void {
  let es: EventSourceLike | null = null;
  let attempt = 0;
  let stopped = false;

  const parse = <T>(e: MessageEvent): T | null => {
    try {
      return JSON.parse(String(e.data)) as T;
    } catch {
      return null;
    }
  };

  const open = () => {
    if (stopped) return;
    h.onConnection(attempt === 0 ? "connecting" : "reconnecting");
    es = make(url);
    es.onopen = () => h.onConnection("live");
    es.addEventListener("snapshot", (e) => {
      const s = parse<LiveSnapshotMessage>(e);
      if (!s) return;
      attempt = 0;
      h.onConnection("live");
      h.onSnapshot(s);
    });
    es.addEventListener("transition", (e) => {
      const ev = parse<LiveTransition>(e);
      if (ev) h.onTransition(ev);
    });
    // Take over from the browser's own retry so the backoff (and the status pill) are ours.
    es.onerror = () => {
      es?.close();
      es = null;
      if (stopped) return;
      h.onConnection("reconnecting");
      schedule(open, reconnectDelay(attempt++));
    };
  };

  open();
  return () => {
    stopped = true;
    es?.close();
    es = null;
  };
}
