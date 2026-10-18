"use client";
// First-visit guided tour (no dependency): spotlights `[data-tour="<id>"]` targets one by one with a
// popover card. Missing/hidden targets are skipped. Completion is stored per mode in localStorage;
// the "?" button relaunches it.
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { Lang, UserMode } from "../app-shell/mode";
import { presentSteps, TOUR_UI, tourStorageKey, tourSteps, type TourStep } from "./steps";

/** First visible element carrying `data-tour=target` (the sidebar and bottom bar can both carry "nav"). */
function findTarget(target: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`);
  for (const el of Array.from(all)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function readDone(mode: UserMode): boolean {
  try {
    return window.localStorage.getItem(tourStorageKey(mode)) === "1";
  } catch {
    return false;
  }
}

function writeDone(mode: UserMode) {
  try {
    window.localStorage.setItem(tourStorageKey(mode), "1");
  } catch {
    /* private mode: the tour just shows again next time */
  }
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const CARD_W = 320;

export function Tour({ mode, lang }: { mode: UserMode; lang: Lang }) {
  const ui = TOUR_UI[lang];
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [vw, setVw] = useState(1024);
  const [vh, setVh] = useState(768);

  const start = useCallback(() => {
    const found = presentSteps(tourSteps(mode, lang), (t) => findTarget(t) !== null);
    if (found.length === 0) return;
    setIndex(0);
    setSteps(found);
  }, [mode, lang]);

  const finish = useCallback(() => {
    writeDone(mode);
    setSteps(null);
    setBox(null);
  }, [mode]);

  // First visit: start once the page has painted (other widgets may render late).
  useEffect(() => {
    if (readDone(mode)) return;
    const id = window.setTimeout(start, 700);
    return () => window.clearTimeout(id);
  }, [mode, start]);

  const step = steps?.[index];

  // Scroll the target into view and follow it on scroll/resize.
  useEffect(() => {
    if (!step) return;
    const el = findTarget(step.target);
    if (!el) {
      // Target vanished since start: skip it.
      if (steps && index < steps.length - 1) setIndex((i) => i + 1);
      else finish();
      return;
    }
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
      setVw(window.innerWidth);
      setVh(window.innerHeight);
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      document.removeEventListener("keydown", onKey);
    };
  }, [step, steps, index, finish]);

  const next = () => {
    if (!steps) return;
    if (index < steps.length - 1) setIndex(index + 1);
    else finish();
  };

  const motion = "motion-safe:transition-all motion-safe:duration-200";
  const mobile = vw < 640;
  let cardStyle: CSSProperties = {};
  if (box && !mobile) {
    const below = box.top + box.height + 12;
    const fitsBelow = below + 180 < vh;
    const top = fitsBelow ? below : Math.max(12, box.top - 12 - 180);
    const left = Math.min(Math.max(12, box.left), vw - CARD_W - 12);
    cardStyle = { top, left, width: CARD_W };
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        aria-label={ui.launch}
        title={ui.launch}
        className="fixed bottom-24 right-4 z-40 grid size-10 place-items-center rounded-full border border-rule bg-sheet text-base font-bold text-ink shadow-md hover:bg-chip focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent md:bottom-6 md:right-6"
      >
        ?
      </button>
      {steps && step && box ? (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
          {/* Spotlight: a transparent hole with a huge shadow dimming everything else. */}
          <div
            aria-hidden
            className={`pointer-events-none fixed rounded-xl outline-2 outline-offset-2 outline-agent ${motion}`}
            style={{ ...box, boxShadow: "0 0 0 9999px rgba(10, 10, 12, 0.55)" }}
          />
          <div
            className={`fixed grid gap-3 rounded-[var(--radius-card)] border border-rule bg-sheet p-4 text-ink shadow-xl ${
              mobile ? "inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))]" : ""
            } ${motion}`}
            style={cardStyle}
          >
            <p className="text-xs text-muted">{ui.step(index + 1, steps.length)}</p>
            <h2 id="tour-title" className="text-base font-semibold">
              {step.title}
            </h2>
            <p id="tour-body" className="text-sm text-ink-soft">
              {step.body}
            </p>
            <div className="flex items-center justify-between gap-3">
              <div className="flex gap-1.5" aria-hidden>
                {steps.map((s, i) => (
                  <span key={s.target} className={`size-2 rounded-full ${i === index ? "bg-ink" : "bg-rule"}`} />
                ))}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={finish} className="rounded-full px-3 py-1.5 text-sm text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-agent">
                  {ui.skip}
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={next}
                  className="rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent"
                >
                  {index < steps.length - 1 ? ui.next : ui.done}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
