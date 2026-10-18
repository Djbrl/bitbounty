"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cx, formatSats, formatXof, statusMeta, TONE_DOT, type BountyStatus } from "../ui";
import {
  applyTransition,
  countInFlight,
  countPaid,
  groupByColumn,
  routeStage,
  shortRepo,
  totalPaid,
  type LiveCard,
  type LiveRoute,
  type LiveSnapshot,
  type LiveState,
  type LiveTransition,
} from "./live-data";
import { connectLive, liveUrl, type LiveConnection } from "./live-stream";
import styles from "./live.module.css";

export interface LiveBoardProps {
  initial: LiveSnapshot;
  /** Mock stream speed (`/live?speed=4`). */
  speed?: number;
  /** Set false to render the static snapshot only (tests, screenshots). */
  stream?: boolean;
}

interface Toast {
  key: number;
  card: LiveCard;
  text: string;
}

// SSR-safe layout effect (the server render just skips it).
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const FLIP_MS = 750;

type CardRef = (el: HTMLElement | null) => void | (() => void);

/** Full-screen kanban for the projector: cards slide between lanes as transitions arrive. */
export function LiveBoard({ initial, speed = 1, stream = true }: LiveBoardProps) {
  const [state, setState] = useState<LiveState>({ columns: initial.columns, cards: initial.cards });
  const [conn, setConn] = useState<LiveConnection>(stream ? "connecting" : "live");
  const [last, setLast] = useState<LiveTransition | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastSeq = useRef(0);
  const cardsRef = useRef(state.cards);
  useEffect(() => {
    cardsRef.current = state.cards;
  }, [state.cards]);

  useEffect(() => {
    if (!stream) return;
    return connectLive(liveUrl(speed), {
      onSnapshot: (s) => {
        setState({ columns: s.columns?.length ? s.columns : initial.columns, cards: s.cards ?? [] });
        setLast(null);
      },
      onTransition: (ev) => {
        const card = cardsRef.current.find((c) => c.bountyId === ev.bountyId);
        setState((prev) => applyTransition(prev, ev));
        setLast(ev);
        if (ev.to === "paid" && card) setToast({ key: ++toastSeq.current, card: { ...card, status: "paid" }, text: ev.text });
      },
      onConnection: setConn,
    });
  }, [stream, speed, initial.columns]);

  // Auto-dismiss the payout toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), Math.max(3000, 7000 / speed));
    return () => clearTimeout(t);
  }, [toast, speed]);

  const flip = useFlip(state.cards);
  const lanes = groupByColumn(state);
  const paidXof = totalPaid(state.cards);
  const routeStatus = initial.route ? state.cards.find((c) => c.bountyId === initial.route?.bountyId)?.status : undefined;

  return (
    <div className="relative flex min-h-dvh flex-col gap-[clamp(14px,1.6vw,28px)] overflow-x-clip bg-forest px-4 py-5 text-white sm:px-[clamp(16px,2.2vw,44px)] sm:py-[clamp(18px,2vw,36px)]">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h1 className="m-0 text-[clamp(1.7rem,2.6vw,3.2rem)] font-extrabold tracking-tight">BitBounty · live</h1>
        <ConnectionPill conn={conn} />
      </header>

      <p aria-live="polite" className="m-0 min-h-[1.6em] truncate font-mono text-[clamp(0.85rem,1vw,1.25rem)] text-white/70">
        {last ? last.text : "Waiting for the next webhook…"}
      </p>

      <section
        aria-label="Bounty lanes"
        className="grid flex-1 grid-cols-1 gap-[clamp(10px,0.9vw,18px)] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      >
        {lanes.map((lane) => (
          <Lane key={lane.status} status={lane.status} cards={lane.cards} hotId={last?.bountyId ?? null} flip={flip} />
        ))}
      </section>

      <footer className="grid gap-[clamp(10px,0.9vw,18px)] lg:grid-cols-[1.2fr_1fr]">
        {initial.route ? <RoutePanel route={initial.route} stage={routeStage(routeStatus)} /> : <div />}
        <div className="grid grid-cols-3 gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-[clamp(12px,1vw,20px)]">
          <BigCount value={String(countPaid(state.cards))} label="paid" />
          <BigCount value={formatXof(paidXof)} label="paid out in FCFA" bumpKey={paidXof} />
          <BigCount value={String(countInFlight(state))} label="in flight" />
        </div>
      </footer>

      {toast && <PayoutToast key={toast.key} toast={toast} />}
    </div>
  );
}

function ConnectionPill({ conn }: { conn: LiveConnection }) {
  const live = conn === "live";
  return (
    <span
      role="status"
      className={cx(
        "inline-flex items-center gap-2 font-mono text-[clamp(0.8rem,0.95vw,1.15rem)] font-semibold uppercase tracking-wider",
        live ? "text-money-bright" : "text-pending",
      )}
    >
      <i aria-hidden className={cx("inline-block size-2.5 shrink-0 animate-pulse rounded-full", live ? "bg-money-bright" : "bg-pending")} />
      {live ? "Live" : conn === "connecting" ? "Connecting…" : "Reconnecting…"}
      <span className="text-white/50 normal-case tracking-normal">· Code &amp; Chain Dakar</span>
    </span>
  );
}

function Lane({
  status,
  cards,
  hotId,
  flip,
}: {
  status: BountyStatus;
  cards: LiveCard[];
  hotId: string | null;
  flip: (id: string) => CardRef;
}) {
  const meta = statusMeta(status);
  // Always on the dark forest background: the green and ink tones read as bright green there.
  const dot = ["money", "money-solid", "bright", "ink"].includes(meta.tone) ? "bg-money-bright" : TONE_DOT[meta.tone];
  return (
    <div
      data-lane={status}
      className="flex min-h-[clamp(120px,22vh,320px)] flex-col gap-[clamp(8px,0.6vw,12px)] rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-[clamp(10px,0.8vw,16px)]"
    >
      <h2 className="m-0 flex items-center gap-2 font-mono text-[clamp(0.8rem,0.85vw,1.1rem)] font-medium uppercase tracking-[0.08em] text-white/65">
        <i aria-hidden className={cx("inline-block size-2.5 shrink-0 rounded-full", dot)} />
        {meta.label}
        <span className="ml-auto tabular-nums text-white/45">{cards.length}</span>
      </h2>
      {cards.map((card) => (
        <LiveCardView key={card.bountyId} card={card} hot={card.bountyId === hotId} ref={flip(card.bountyId)} />
      ))}
    </div>
  );
}

function LiveCardView({ card, hot, ref }: { card: LiveCard; hot: boolean; ref: CardRef }) {
  const paid = card.status === "paid";
  return (
    <article
      ref={ref}
      data-card={card.bountyId}
      className={cx(
        "relative grid gap-1 rounded-[10px] border bg-white/[0.07] px-[clamp(10px,0.8vw,16px)] py-[clamp(8px,0.6vw,12px)] will-change-transform",
        hot ? cx("z-10 border-money-bright", styles.hot) : "border-white/12",
        paid && "bg-money-bright/[0.12]",
      )}
    >
      <span className="truncate font-mono text-[clamp(0.72rem,0.75vw,0.95rem)] text-white/55">{shortRepo(card.repoFullName)}</span>
      <b className="line-clamp-2 text-[clamp(0.95rem,1.05vw,1.4rem)] font-semibold leading-snug">{card.issueTitle}</b>
      <span className="flex flex-wrap items-baseline gap-x-2 text-[clamp(0.85rem,0.9vw,1.2rem)]">
        <span className={cx("font-display font-extrabold tabular-nums", paid ? "text-money-bright" : "text-white")}>
          {paid ? "+" : ""}
          {formatXof(card.amountXof)}
        </span>
        <span className="truncate text-white/60">
          {card.who ? `${paid ? "→ " : ""}@${card.who}${card.city ? ` · ${card.city}` : ""}` : "open to claims"}
        </span>
      </span>
    </article>
  );
}

function RoutePanel({ route, stage }: { route: LiveRoute; stage: 0 | 1 | 2 }) {
  const nodes = [
    { big: `₦${formatXof(route.ngn).replace(/\s*F$/, "")}`, small: "bank transfer · Lagos" },
    { big: "₿", small: "bitcoin" },
    { big: formatXof(route.xof), small: `${route.sats ? formatSats(route.sats) : "Lightning"} · Dakar` },
  ];
  return (
    <div className="grid gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-[clamp(12px,1vw,20px)]">
      <span className="font-mono text-[clamp(0.75rem,0.8vw,1rem)] font-medium uppercase tracking-[0.08em] text-white/65">Lagos → Dakar</span>
      <div className="grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2">
        {nodes.map((n, i) => (
          <RouteNode key={n.small} big={n.big} small={n.small} on={i <= stage} seg={i < nodes.length - 1} segOn={i < stage} />
        ))}
      </div>
    </div>
  );
}

function RouteNode({ big, small, on, seg, segOn }: { big: string; small: string; on: boolean; seg: boolean; segOn: boolean }) {
  return (
    <>
      <div
        className={cx(
          "rounded-lg border px-[clamp(6px,0.6vw,12px)] py-1.5 text-center text-[clamp(0.7rem,0.8vw,1rem)] transition-colors duration-500",
          on ? "border-money-bright/60 bg-money-bright/[0.12]" : "border-white/12 bg-white/[0.05] text-white/55",
        )}
      >
        <b className="block font-display text-[clamp(0.9rem,1.05vw,1.35rem)] tabular-nums">{big}</b>
        {small}
      </div>
      {seg && (
        <div
          aria-hidden
          className={cx("h-0.5 transition-opacity duration-500", segOn ? "opacity-100" : "opacity-30")}
          style={{ background: "repeating-linear-gradient(90deg, var(--bb-money-bright) 0 6px, transparent 6px 10px)" }}
        />
      )}
    </>
  );
}

function BigCount({ value, label, bumpKey }: { value: string; label: string; bumpKey?: number }) {
  return (
    <div className="min-w-0">
      <b
        key={bumpKey}
        className={cx(
          "block truncate font-display text-[clamp(1.4rem,2.4vw,3.2rem)] font-extrabold leading-none tabular-nums text-money-bright",
          bumpKey !== undefined && styles.bump,
        )}
      >
        {value}
      </b>
      <span className="text-[clamp(0.75rem,0.85vw,1.1rem)] text-white/65">{label}</span>
    </div>
  );
}

function PayoutToast({ toast }: { toast: Toast }) {
  const { card } = toast;
  return (
    <div
      role="status"
      aria-live="assertive"
      className={cx(
        "fixed inset-x-4 bottom-4 z-50 grid gap-1 rounded-2xl border border-money-bright bg-forest/95 p-[clamp(14px,1.2vw,24px)] shadow-2xl backdrop-blur sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-[min(640px,44vw)] sm:min-w-[380px]",
        styles.toast,
      )}
    >
      <span className="font-mono text-[clamp(0.75rem,0.85vw,1.05rem)] uppercase tracking-[0.08em] text-money-bright">Payout sent</span>
      <b className="font-display text-[clamp(2rem,3.4vw,4.4rem)] font-extrabold leading-none tabular-nums text-money-bright">
        +{formatXof(card.amountXof)}
      </b>
      <span className="text-[clamp(0.95rem,1.1vw,1.45rem)] font-semibold">
        {card.who ? `@${card.who}` : shortRepo(card.repoFullName)}
        {card.city ? ` · ${card.city}` : ""}
      </span>
      <span className="text-[clamp(0.85rem,0.9vw,1.15rem)] text-white/70">{toast.text}</span>
    </div>
  );
}

/**
 * FLIP: remember each card's page position; after a render that moved it, start it at the old spot
 * (transform) and transition the transform away. Plain CSS transitions, no animation library.
 */
function useFlip(cards: LiveCard[]) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const pos = useRef(new Map<string, { x: number; y: number }>());
  const refs = useRef(new Map<string, CardRef>());

  const measure = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY };
  };

  useIsoLayoutEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    for (const [id, el] of nodes.current) {
      // Measure without any in-flight transform so the stored position is the real slot.
      const inline = el.style.transform;
      el.style.transform = "";
      const next = measure(el);
      const prev = pos.current.get(id);
      pos.current.set(id, next);
      if (!prev || reduce) continue;
      const dx = prev.x - next.x;
      const dy = prev.y - next.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        el.style.transform = inline;
        continue;
      }
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      void el.offsetWidth; // commit the start frame
      el.style.transition = `transform ${FLIP_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
      el.style.transform = "";
    }
  }, [cards]);

  // Lanes reflow on resize: re-baseline positions so the next move starts from the right place.
  useEffect(() => {
    const rebase = () => {
      for (const [id, el] of nodes.current) pos.current.set(id, measure(el));
    };
    window.addEventListener("resize", rebase);
    return () => window.removeEventListener("resize", rebase);
  }, []);

  return (id: string) => {
    let fn = refs.current.get(id);
    if (!fn) {
      fn = (el) => {
        if (!el) return;
        nodes.current.set(id, el);
        // A card that changes lane is a new DOM node (new parent). Its last position stays in `pos`,
        // so the new node starts from where the old one was; only forget the node itself.
        return () => {
          if (nodes.current.get(id) === el) nodes.current.delete(id);
        };
      };
      refs.current.set(id, fn);
    }
    return fn;
  };
}
