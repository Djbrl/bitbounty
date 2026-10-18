"use client";
// L1: the landing's scroll story, ported from Djbrl/bitbounty-landing main.js. Runs once the static
// markup is in the DOM, and undoes its listeners (and the smooth-scroll on <html>) on unmount so app
// pages are not affected. Also swaps the CTAs to "Ouvrir l'app" for signed-in visitors.
import { useEffect } from "react";
import { loadHeaderSession } from "../../components/auth/HeaderUser";
import { LANDING_CONFIG, OPEN_APP_HREF, OPEN_APP_LABEL } from "./landing-markup";

const NS = "http://www.w3.org/2000/svg";
const GREEN = "#1F9D55";
const PURPLE = "#8250DF";
const W = 12;
// The story's order and lanes. The y of each stop is computed in layout() from the measured
// height of its content, so gaps stay tight whatever the viewport (stacked cards on mobile).
type Stop = { id: string; lane: number; flip?: boolean; y: number; h: number };
const PLAN: Stop[] = [
  { id: "post", lane: 0, y: 0, h: 0 },
  { id: "fund", lane: 1, flip: true, y: 0, h: 0 },
  { id: "claim", lane: 0, y: 0, h: 0 },
  { id: "pr", lane: -1, flip: true, y: 0, h: 0 },
  { id: "review", lane: -1, y: 0, h: 0 },
  { id: "merge", lane: 0, flip: true, y: 0, h: 0 },
];
/** Where the drawn tip of the line sits, as a fraction of the viewport height. */
const TIP = 0.6;
/** A stop lights up once this share of it has come up into view (capped for very tall stops). */
const SHOW = 0.65;
const clamp = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  x = clamp(x);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
function el(name: string, attrs: Record<string, string | number>): SVGElement {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  return n;
}

function mountTrailer() {
  const id = LANDING_CONFIG.trailerYoutubeId;
  const v = document.getElementById("video");
  if (!v || !id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return;
  const f = document.createElement("iframe");
  f.src = `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
  f.title = "BitBounty trailer";
  f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
  f.allowFullscreen = true;
  v.replaceChildren(f);
}

/**
 * Git-graph story: the line grows with scroll and its tip rides at ~60% of the viewport, each stop
 * lights up as it comes into comfortable view, and the camera pans to follow the branch. Stops are
 * laid out from their measured heights (tight gaps). One rAF per frame: read the graph's rect once,
 * then write. Returns a cleanup.
 */
function startGraph(): () => void {
  const graph = document.getElementById("graph");
  const canvas = document.getElementById("graphCanvas");
  const svg = document.getElementById("graphSvg");
  const endBox = document.getElementById("gEnd");
  const endPhone = document.getElementById("endPhone");
  if (!graph || !canvas || !svg || !endBox || !endPhone) return () => {};
  const stops: Record<string, HTMLElement> = {};
  canvas.querySelectorAll<HTMLElement>(".g-stop").forEach((n) => {
    stops[n.getAttribute("data-stop") ?? ""] = n;
  });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let B = 600;
  let T = 520; // height of a branch's S-curve
  let narrow = false;
  const R = { fork: 0, out: 0 }; // bounty/fund (right, green)
  const L = { fork: 0, out: 0 }; // fix-thousands (left, purple)
  let MERGE = 0;
  let END = 0;
  let PHONE = 0; // graph y of the phone's top
  let PHONE_H = 590;
  let clipRect: SVGElement | null = null;
  let cam = 0;
  let camTarget = 0;
  let shownCam = NaN;
  let lastTip = NaN;
  let raf = 0;
  let alive = true;

  function trackX(y: number) {
    if (y >= R.fork && y < R.fork + T) return B * smooth((y - R.fork) / T);
    if (y >= R.fork + T && y < R.out) return B;
    if (y >= R.out && y < R.out + T) return B * (1 - smooth((y - R.out) / T));
    if (y >= L.fork && y < L.fork + T) return -B * smooth((y - L.fork) / T);
    if (y >= L.fork + T && y < L.out) return -B;
    if (y >= L.out && y < L.out + T) return -B * (1 - smooth((y - L.out) / T));
    return 0;
  }
  function screenOffset(y: number, vw: number) {
    if (!narrow) return 0;
    return -(vw / 2 - 40) * smooth(y / 360) * (1 - smooth((y - (END - 600)) / 480));
  }
  function branch(x: number, b: { fork: number; out: number }) {
    return `M0,${b.fork} C0,${b.fork + T * 0.55} ${x},${b.fork + T * 0.45} ${x},${b.fork + T} L${x},${b.out} C${x},${b.out + T * 0.55} 0,${b.out + T * 0.45} 0,${b.out + T}`;
  }
  function layout() {
    if (!alive) return;
    const vw = window.innerWidth;
    narrow = vw <= 760;
    B = narrow ? Math.round(vw * 0.85) : Math.max(520, Math.round(vw * 0.57));
    T = narrow ? 360 : 520;
    const G = narrow ? 96 : 110; // gap between two stops on the same lane
    // Place horizontally first (flip changes the grid, so the height), then measure.
    PLAN.forEach((p) => {
      const n = stops[p.id];
      if (!n) return;
      n.classList.toggle("flip", !!p.flip && !narrow);
      n.style.left = `${p.lane * B + (narrow ? 34 : 0)}px`;
      p.h = n.offsetHeight;
    });
    const [post, fund, claim, pr, review, merge] = PLAN as [Stop, Stop, Stop, Stop, Stop, Stop];
    const half = (p: Stop) => p.h / 2;
    // A stop sits clear of a curve once the curve is ~90% across (it eases in and out).
    post.y = (narrow ? 80 : 100) + half(post);
    R.fork = post.y + half(post);
    fund.y = R.fork + T * 0.9 + half(fund);
    R.out = fund.y + half(fund);
    claim.y = R.out + T * 0.9 + half(claim);
    L.fork = claim.y + half(claim);
    pr.y = L.fork + T * 0.9 + half(pr);
    review.y = pr.y + half(pr) + G + half(review);
    L.out = review.y + half(review);
    MERGE = L.out + T;
    merge.y = MERGE + 60 + half(merge);
    END = merge.y + half(merge) + G;
    endBox!.style.top = `${END}px`;
    endBox!.style.left = "0px";
    PHONE = END + endPhone!.offsetTop;
    PHONE_H = endPhone!.offsetHeight || 590;
    graph!.style.height = `${Math.round(END + endBox!.offsetHeight + (narrow ? 90 : 130))}px`;
    svg!.replaceChildren();
    const defs = el("defs", {});
    const clip = el("clipPath", { id: "reveal" });
    clipRect = el("rect", { x: -3 * B, y: -20, width: 6 * B, height: 0 });
    clip.appendChild(clipRect);
    defs.appendChild(clip);
    svg!.appendChild(defs);
    const g = el("g", { "clip-path": "url(#reveal)", fill: "none", "stroke-linecap": "round" });
    svg!.appendChild(g);
    g.appendChild(el("path", { d: `M0,0 L0,${MERGE}`, stroke: GREEN, "stroke-width": W }));
    g.appendChild(el("path", { d: branch(B, R), stroke: GREEN, "stroke-width": W }));
    g.appendChild(el("path", { d: branch(-B, L), stroke: PURPLE, "stroke-width": W }));
    g.appendChild(el("path", { d: `M0,${MERGE} L0,${PHONE + 40}`, stroke: PURPLE, "stroke-width": W + 4 }));
    PLAN.forEach((p) => {
      if (p.id === "merge") return;
      const c = p.lane === -1 ? PURPLE : GREEN;
      g.appendChild(el("circle", { cx: p.lane * B, cy: p.y, r: 22, fill: "#FFFFFF", stroke: c, "stroke-width": W }));
    });
    g.appendChild(el("circle", { cx: 0, cy: MERGE, r: 28, fill: PURPLE, stroke: "none" }));
    PLAN.forEach((p) => {
      const n = stops[p.id];
      if (n) n.style.top = `${p.y}px`;
    });
    lastTip = NaN;
    frame(true);
  }
  function frame(jump = false) {
    raf = 0;
    if (!alive) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight || 800;
    const top = graph!.getBoundingClientRect().top; // the only layout read per frame
    // The tip rides at TIP of the viewport. Before the graph gets there, a stub right under the hero
    // grows from the first pixel of scroll, so some green line shows above the fold.
    const tip = reduced
      ? PHONE + 40
      : Math.min(PHONE + 40, Math.max(TIP * vh - top, 150 + window.scrollY * 0.5));
    if (clipRect && tip !== lastTip) {
      clipRect.setAttribute("height", String(Math.max(0, tip + 20)));
      lastTip = tip;
    }
    for (const p of PLAN) {
      // Lit once SHOW of the stop is in view (at most 45% of the screen, for tall stops).
      const seen = vh - (top + p.y - p.h / 2);
      stops[p.id]?.classList.toggle("on", reduced || seen > Math.min(p.h * SHOW, vh * 0.45));
    }
    // The phone buzzes as soon as it is mostly in view.
    endPhone!.classList.toggle("lit", reduced || vh - (top + PHONE) > Math.min(PHONE_H * 0.72, vh * 0.6));
    // The camera looks a little ahead of the tip, so a branch's stop is centred as it fades in.
    const y = Math.min(Math.max(tip + vh * 0.12, 0), END);
    camTarget = -trackX(y) + screenOffset(y, vw);
    const d = camTarget - cam;
    if (jump || reduced || Math.abs(d) < 0.4) cam = camTarget;
    else cam += d * 0.12;
    if (cam !== shownCam) {
      canvas!.style.transform = `translate3d(${cam.toFixed(1)}px,0,0)`;
      shownCam = cam;
    }
    if (cam !== camTarget) schedule();
  }
  function schedule() {
    if (!raf && alive) raf = requestAnimationFrame(() => frame());
  }

  let rt: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => {
    clearTimeout(rt);
    rt = setTimeout(layout, 120);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", onResize);
  window.addEventListener("load", layout);
  if (document.fonts?.ready) void document.fonts.ready.then(layout);
  layout();
  return () => {
    alive = false;
    clearTimeout(rt);
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("load", layout);
  };
}

/** Signed-in visitors: primary CTAs become "Ouvrir l'app" (no sign-in needed). */
async function swapCtasIfSignedIn(isAlive: () => boolean) {
  const session = await loadHeaderSession();
  if (!isAlive() || session.kind !== "in") return;
  document.querySelectorAll<HTMLAnchorElement>(".bb-landing [data-app-cta]").forEach((a) => {
    a.href = OPEN_APP_HREF;
    a.textContent = OPEN_APP_LABEL;
    a.removeAttribute("target");
    a.removeAttribute("rel");
  });
}

export function LandingScroll() {
  useEffect(() => {
    let alive = true;
    const html = document.documentElement;
    const prevScroll = html.style.scrollBehavior;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) html.style.scrollBehavior = "smooth";
    mountTrailer();
    const stop = startGraph();
    void swapCtasIfSignedIn(() => alive);
    return () => {
      alive = false;
      stop();
      html.style.scrollBehavior = prevScroll;
    };
  }, []);
  return null;
}
