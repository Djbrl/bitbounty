import type { StoredEvent } from "./event-store.js";

/**
 * Hook point for G3 (comments → commands), G4 (PR detection / merge) and A2 (checks).
 *
 *   dispatcher.on("issue_comment", async (e) => { ... })        // any action
 *   dispatcher.on("pull_request.closed", async (e) => { ... })  // one action
 *   dispatcher.on("*", async (e) => { ... })                    // everything
 *
 * Handlers receive the stored event (payload is GitHub's raw JSON). A handler that
 * throws marks the event `failed`; GitHub's redelivery then re-dispatches it.
 */
export type GithubEventHandler = (event: StoredEvent) => void | Promise<void>;

export class GithubDispatcher {
  private handlers = new Map<string, GithubEventHandler[]>();

  on(key: string, handler: GithubEventHandler): this {
    const list = this.handlers.get(key) ?? [];
    list.push(handler);
    this.handlers.set(key, list);
    return this;
  }

  async dispatch(event: StoredEvent): Promise<void> {
    const keys = ["*", event.type];
    if (event.action) keys.push(`${event.type}.${event.action}`);
    for (const key of keys) {
      for (const handler of this.handlers.get(key) ?? []) {
        await handler(event);
      }
    }
  }
}
