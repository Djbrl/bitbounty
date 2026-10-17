// Fund page state machine (pure, tested). The client component wires it to fetch + timers.
import type { FundingRail, FundingSession } from "./data";

export type FundPhase = "paying" | "funded";

export interface FundState {
  phase: FundPhase;
  rail: FundingRail;
  /** One live session per rail, kept when switching tabs until it expires. */
  sessions: Partial<Record<FundingRail, FundingSession>>;
  /** Rail whose session is being created right now. */
  loading: FundingRail | null;
  error: string | null;
  /** Last known Lightning amount, so the summary shows sats on every tab. */
  sats: number | null;
}

export type FundAction =
  | { type: "select"; rail: FundingRail }
  | { type: "request"; rail: FundingRail }
  | { type: "session"; session: FundingSession }
  | { type: "error"; rail: FundingRail; error: string }
  | { type: "paid" };

export function initialFundState(alreadyFunded: boolean): FundState {
  return { phase: alreadyFunded ? "funded" : "paying", rail: "lightning", sessions: {}, loading: null, error: null, sats: null };
}

export function fundReducer(state: FundState, action: FundAction): FundState {
  if (state.phase === "funded") return state;
  switch (action.type) {
    case "select":
      return { ...state, rail: action.rail, error: null };
    case "request":
      return { ...state, loading: action.rail, error: null };
    case "session": {
      const s = action.session;
      return {
        ...state,
        sessions: { ...state.sessions, [s.rail]: s },
        loading: state.loading === s.rail ? null : state.loading,
        sats: s.rail === "lightning" ? s.amountSats : state.sats,
      };
    }
    case "error":
      return { ...state, loading: state.loading === action.rail ? null : state.loading, error: action.rail === state.rail ? action.error : state.error };
    case "paid":
      return { ...state, phase: "funded", loading: null, error: null };
  }
}

/** True when the current tab needs a new session (none yet, or the old one expired). */
export function needsSession(state: FundState, now: number): boolean {
  if (state.phase !== "paying" || state.loading === state.rail || state.error) return false;
  const s = state.sessions[state.rail];
  return !s || new Date(s.expiresAt).getTime() <= now;
}

/** Human message for an API error code. */
export function errorMessage(code: string): string {
  if (code === "already_funded") return "This bounty is already funded.";
  if (code === "bounty_not_found") return "This bounty does not exist.";
  if (code === "invalid_rail") return "This payment method is not available.";
  return "Could not reach BitBounty. Check your connection and try again.";
}
