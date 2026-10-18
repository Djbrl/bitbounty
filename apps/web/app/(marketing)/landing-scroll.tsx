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
const T = 720;
const R = { fork: 860, out: 2320 }; // bounty/fund (right)
const L = { fork: 3820, out: 5960 }; // fix-thousands branch (left, purple)
const MERGE = L.out + T;
const END = 7520;
const HEIGHT = 8320;
const PLAN = [
  { id: "post", lane: 0, y: 460 },
  { id: "fund", lane: 1, y: 1950, flip: true },
  { id: "claim", lane: 0, y: 3400 },
  { id: "push", lane: -1, y: 4900, flip: true },
  { id: "review", lane: -1, y: 5600 },
  { id: "merge", lane: 0, y: MERGE + 330, flip: true },
];
const MAP_MASK = [
  "......########..........", "....############........", "...##############.......", "..################......",
  ".##################.....", "####################....", "#####################...", "######################..",
  ".#####################..", "..####################..", "....##################..", "......###############...",
  ".......##############...", ".......#############....", ".......############.....", "........###########.....",
  "........##########...##.", ".........#########..##..", ".........########...##..", "..........#######.......",
  "..........######........", "...........####.........", "............##..........",
];
// Tech hubs (approximate positions on the dot grid). Dakar is the story's pin.
const HUBS: [string, number, number][] = [
  ["Abidjan", 5, 9], ["Accra", 8, 9], ["Lagos", 10, 9], ["Nairobi", 18, 11], ["Kigali", 15, 12], ["Le Caire", 17, 1], ["Johannesburg", 13, 19],
];

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

/** Git-graph story: the line grows with scroll, the camera follows the active track. Returns a cleanup. */
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
  let B = 600;
  let narrow = false;
  let clipRect: SVGElement | null = null;
  let cam = 0;
  let camTarget = 0;
  let animating = false;
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
    return -(vw / 2 - 40) * smooth(y / 520) * (1 - smooth((y - (END - 900)) / 600));
  }
  function branch(x: number, b: { fork: number; out: number }) {
    return `M0,${b.fork} C0,${b.fork + T * 0.55} ${x},${b.fork + T * 0.45} ${x},${b.fork + T} L${x},${b.out} C${x},${b.out + T * 0.55} 0,${b.out + T * 0.45} 0,${b.out + T}`;
  }
  function drawMap() {
    const m = document.getElementById("mapDots");
    if (!m) return;
    m.replaceChildren();
    MAP_MASK.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) if (row[c] === "#") m.appendChild(el("circle", { cx: 6 + c * 10, cy: 6 + r * 10, r: 3.3, fill: "#CFD8D2" }));
    });
    HUBS.forEach((h, i) => {
      const c = el("circle", { cx: 6 + h[1] * 10, cy: 6 + h[2] * 10, r: 4.6, fill: "#3CC77E", class: "map-hub" });
      c.style.animationDelay = `${i * 0.25}s`;
      m.appendChild(c);
    });
    const px = 6;
    const py = 56;
    m.appendChild(el("circle", { cx: px, cy: py, r: 16, fill: "#1F9D55", opacity: "0.18", class: "map-pulse" }));
    m.appendChild(el("circle", { cx: px, cy: py, r: 7, fill: "#1F9D55" }));
    const t = el("text", { x: px + 14, y: py - 10, fill: "#0B1F17", "font-size": "13", "font-weight": "700" });
    t.style.fontFamily = "var(--body)";
    t.textContent = "Dakar";
    m.appendChild(t);
  }
  function layout() {
    if (!alive) return;
    const vw = window.innerWidth;
    narrow = vw <= 760;
    B = narrow ? Math.round(vw * 0.85) : Math.max(520, Math.round(vw * 0.57));
    graph!.style.height = `${HEIGHT}px`;
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
    g.appendChild(el("path", { d: `M0,${MERGE} L0,${END + 12}`, stroke: PURPLE, "stroke-width": W + 4 }));
    PLAN.forEach((p) => {
      if (p.id === "merge") return;
      const c = p.lane === -1 ? PURPLE : GREEN;
      g.appendChild(el("circle", { cx: p.lane * B, cy: p.y, r: 22, fill: "#FFFFFF", stroke: c, "stroke-width": W }));
    });
    g.appendChild(el("circle", { cx: 0, cy: MERGE, r: 28, fill: PURPLE, stroke: "none" }));
    PLAN.forEach((p) => {
      const n = stops[p.id];
      if (!n) return;
      n.classList.toggle("flip", !!p.flip && !narrow);
      n.style.top = `${p.y}px`;
      n.style.left = `${p.lane * B + (narrow ? 34 : 0)}px`;
    });
    endBox!.style.top = `${END}px`;
    endBox!.style.left = "0px";
    drawMap();
    update(true);
  }
  function apply() {
    canvas!.style.transform = `translateX(${cam.toFixed(1)}px)`;
  }
  function step() {
    if (!alive) return;
    const d = camTarget - cam;
    cam += d * 0.075;
    if (Math.abs(d) < 0.4) {
      cam = camTarget;
      animating = false;
      apply();
      return;
    }
    apply();
    requestAnimationFrame(step);
  }
  function update(jump: boolean) {
    const vw = window.innerWidth;
    const vh = window.innerHeight || 800;
    const r = graph!.getBoundingClientRect();
    // The line starts growing with the very first pixel of scroll, ahead of the viewport,
    // then the viewport catches up and the tip settles at mid-screen.
    const mid = vh * 0.5 - r.top;
    const gap = Math.max(1, -(vh * 0.5 - (r.top + window.scrollY)));
    const lead = gap * (1 - smooth(window.scrollY / (3 * gap))); // slope > -1, so the tip only moves forward
    const playY = Math.max(0, mid + lead);
    if (clipRect) clipRect.setAttribute("height", String(Math.max(0, playY + 90)));
    PLAN.forEach((p) => stops[p.id]?.classList.toggle("on", playY > p.y - vh * 0.22));
    endPhone!.classList.toggle("lit", playY > END + 140);
    const y = Math.min(Math.max(playY, 0), END);
    camTarget = -trackX(y) + screenOffset(y, vw);
    if (jump) {
      cam = camTarget;
      apply();
      return;
    }
    if (!animating) {
      animating = true;
      requestAnimationFrame(step);
    }
  }

  const onScroll = () => update(false);
  let rt: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => {
    clearTimeout(rt);
    rt = setTimeout(layout, 120);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  if (document.fonts?.ready) void document.fonts.ready.then(layout);
  layout();
  return () => {
    alive = false;
    clearTimeout(rt);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
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
