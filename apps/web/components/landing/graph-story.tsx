"use client";
// L1: the landing's scroll story, ported from Djbrl/bitbounty-landing main.js. A git graph starts
// under the maintainer's laptop and grows with the scroll; the camera follows the active track,
// branches swing out with long smooth curves, each stop fades in as the line reaches it, and the
// line ends in a phone that lights up with the payout. The stops are server-rendered children.
import { useEffect, useRef, type ReactNode } from "react";

const NS = "http://www.w3.org/2000/svg";
const GREEN = "#1F9D55";
const PURPLE = "#8250DF";
const W = 12;
const T = 720;
const R = { fork: 860, out: 2320 }; // bounty/fund (right)
const L = { fork: 3820, out: 5960 }; // awa-sow/fix-retry (left, purple)
const MERGE = L.out + T;
const END = 7520;
const HEIGHT = 8320;
const PLAN = [
  { id: "post", lane: 0, y: 460, flip: false },
  { id: "fund", lane: 1, y: 1950, flip: true },
  { id: "claim", lane: 0, y: 3400, flip: false },
  { id: "push", lane: -1, y: 4900, flip: true },
  { id: "review", lane: -1, y: 5600, flip: false },
  { id: "merge", lane: 0, y: MERGE + 330, flip: true },
];

const clamp = (x: number) => Math.min(1, Math.max(0, x));
/** Smootherstep: 0 → 1 with flat ends. */
const smooth = (x: number) => {
  const c = clamp(x);
  return c * c * c * (c * (c * 6 - 15) + 10);
};

function el(name: string, attrs: Record<string, string | number>) {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  return n;
}

/** Horizontal position of the active track at height y, for a branch swing of B px. */
function trackX(y: number, B: number) {
  if (y >= R.fork && y < R.fork + T) return B * smooth((y - R.fork) / T);
  if (y >= R.fork + T && y < R.out) return B;
  if (y >= R.out && y < R.out + T) return B * (1 - smooth((y - R.out) / T));
  if (y >= L.fork && y < L.fork + T) return -B * smooth((y - L.fork) / T);
  if (y >= L.fork + T && y < L.out) return -B;
  if (y >= L.out && y < L.out + T) return -B * (1 - smooth((y - L.out) / T));
  return 0;
}

function branch(x: number, b: { fork: number; out: number }) {
  return (
    `M0,${b.fork} C0,${b.fork + T * 0.55} ${x},${b.fork + T * 0.45} ${x},${b.fork + T}` +
    ` L${x},${b.out} C${x},${b.out + T * 0.55} 0,${b.out + T * 0.45} 0,${b.out + T}`
  );
}

export function GraphStory({ children }: { children: ReactNode }) {
  const graphRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const graph = graphRef.current!;
    const canvas = canvasRef.current!;
    const svg = svgRef.current!;
    const endBox = canvas.querySelector<HTMLElement>(".g-end")!;
    const endPhone = canvas.querySelector<HTMLElement>(".end-phone")!;
    const stops: Record<string, HTMLElement> = {};
    canvas.querySelectorAll<HTMLElement>(".g-stop").forEach((n) => (stops[n.dataset.stop ?? ""] = n));

    let B = 600;
    let narrow = false;
    let clipRect: SVGElement | null = null;
    let cam = 0;
    let camTarget = 0;
    let frame = 0;
    let disposed = false;

    const screenOffset = (y: number, vw: number) =>
      narrow ? -(vw / 2 - 40) * smooth(y / 520) * (1 - smooth((y - (END - 900)) / 600)) : 0;

    function layout() {
      const vw = window.innerWidth;
      narrow = vw <= 760;
      B = narrow ? Math.round(vw * 0.85) : Math.max(520, Math.round(vw * 0.57));
      graph.style.height = `${HEIGHT}px`;
      svg.replaceChildren();
      const defs = el("defs", {});
      const clip = el("clipPath", { id: "reveal" });
      clipRect = el("rect", { x: -3 * B, y: -20, width: 6 * B, height: 0 });
      clip.appendChild(clipRect);
      defs.appendChild(clip);
      svg.appendChild(defs);
      const g = el("g", { "clip-path": "url(#reveal)", fill: "none", "stroke-linecap": "round" });
      svg.appendChild(g);
      g.appendChild(el("path", { d: `M0,0 L0,${MERGE}`, stroke: GREEN, "stroke-width": W }));
      g.appendChild(el("path", { d: branch(B, R), stroke: GREEN, "stroke-width": W }));
      g.appendChild(el("path", { d: branch(-B, L), stroke: PURPLE, "stroke-width": W }));
      g.appendChild(el("path", { d: `M0,${MERGE} L0,${END + 12}`, stroke: PURPLE, "stroke-width": W + 4 }));
      for (const p of PLAN) {
        if (p.id === "merge") continue;
        const c = p.lane === -1 ? PURPLE : GREEN;
        g.appendChild(el("circle", { cx: p.lane * B, cy: p.y, r: 22, fill: "#FFFFFF", stroke: c, "stroke-width": W }));
      }
      g.appendChild(el("circle", { cx: 0, cy: MERGE, r: 28, fill: PURPLE, stroke: "none" }));

      for (const p of PLAN) {
        const n = stops[p.id];
        if (!n) continue;
        n.classList.toggle("flip", p.flip && !narrow);
        n.style.top = `${p.y}px`;
        n.style.left = `${p.lane * B + (narrow ? 34 : 0)}px`;
      }
      endBox.style.top = `${END}px`;
      endBox.style.left = "0px";
      update(true);
    }

    const apply = () => {
      canvas.style.transform = `translateX(${cam.toFixed(1)}px)`;
    };

    function step() {
      const d = camTarget - cam;
      cam += d * 0.075;
      if (Math.abs(d) < 0.4) {
        cam = camTarget;
        frame = 0;
        apply();
        return;
      }
      apply();
      frame = requestAnimationFrame(step);
    }

    function update(jump: boolean) {
      const vw = window.innerWidth;
      const vh = window.innerHeight || 800;
      const r = graph.getBoundingClientRect();
      // The line starts growing with the very first pixel of scroll, ahead of the viewport,
      // then the viewport catches up and the tip settles at mid-screen.
      const mid = vh * 0.5 - r.top;
      const gap = Math.max(1, -(vh * 0.5 - (r.top + window.scrollY)));
      const lead = gap * (1 - smooth(window.scrollY / (3 * gap))); // slope > -1, so the tip only moves forward
      const playY = Math.max(0, mid + lead);
      clipRect?.setAttribute("height", String(Math.max(0, playY + 90)));
      for (const p of PLAN) stops[p.id]?.classList.toggle("on", playY > p.y - vh * 0.22);
      endPhone.classList.toggle("lit", playY > END + 140);
      const y = Math.min(Math.max(playY, 0), END);
      camTarget = -trackX(y, B) + screenOffset(y, vw);
      if (jump) {
        cam = camTarget;
        apply();
        return;
      }
      if (!frame) frame = requestAnimationFrame(step);
    }

    const onScroll = () => update(false);
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(layout, 120);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    void document.fonts?.ready.then(() => !disposed && layout());
    layout();

    return () => {
      disposed = true;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      clearTimeout(resizeTimer);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section id="how" className="graph-sec">
      <div className="graph" ref={graphRef}>
        <div className="graph-canvas" ref={canvasRef}>
          <svg className="graph-svg" ref={svgRef} aria-hidden="true"></svg>
          {children}
        </div>
      </div>
    </section>
  );
}
