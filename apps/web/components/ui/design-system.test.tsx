// U0: the design-system components added on top of the W1 base (ui.test.tsx).
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Amount, formatNgn, formatSats, formatXof } from "./amount";
import { Avatar } from "./avatar";
import { Button, buttonClass } from "./button";
import { Chip } from "./chip";
import { ProgressSteps } from "./progress-steps";
import { EmptyState, Skeleton } from "./states";
import { Toast } from "./toast";
import { ToastProvider, useToast } from "./toaster";

const html = renderToStaticMarkup;

describe("tokens", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

  it("uses the landing palette for the light theme", () => {
    for (const [token, hex] of [
      ["paper", "#f5f6f3"],
      ["sheet", "#ffffff"],
      ["ink", "#0b1f17"],
      ["ink-2", "#13291f"],
      ["ink-soft", "#2c4337"],
      ["muted", "#5b7366"],
      ["line-dark", "#2b4b3b"],
      ["chip", "#eef0ea"],
      ["mint", "#9dc4ae"],
      ["money", "#167a45"],
      ["money-bright", "#3cc77e"],
      ["amber", "#f2a007"],
      ["agent", "#8250df"],
    ]) {
      expect(css).toContain(`--bb-${token}: ${hex};`);
    }
  });

  it("is light whatever the OS says; dark only under data-theme (live projector)", () => {
    expect(css).not.toContain("prefers-color-scheme");
    const light = [...css.slice(0, css.indexOf('[data-theme="dark"] {')).matchAll(/^\s+--bb-([\w-]+):/gm)].map((m) => m[1]);
    const forced = css.slice(css.indexOf('[data-theme="dark"] {'), css.indexOf("@theme inline {"));
    const names = (block: string) => [...block.matchAll(/--bb-([\w-]+):/g)].map((m) => m[1]).sort();
    expect(names(forced).length).toBeGreaterThan(15);
    for (const n of names(forced)) expect(light).toContain(n);
  });

  it("uses purple for claim/PR states and focus rings, green stays the primary", () => {
    expect(css).toContain("--bb-claim: #7444d4;");
    expect(css).toMatch(/:focus-visible \{\s+outline: 2px solid var\(--bb-agent\)/);
  });

  it("keeps Verified (bright) and Paid (money-solid) apart in dark mode", () => {
    const forced = css.slice(css.indexOf('[data-theme="dark"] {'), css.indexOf("@theme inline {"));
    const value = (name: string) => forced.match(new RegExp(`--bb-${name}: (#[0-9a-f]{6});`))?.[1];
    expect(value("bright")).toBeDefined();
    expect(value("bright")).not.toBe(value("money"));
  });
});

describe("Button", () => {
  it("is a pill in every variant, with the landing green as primary", () => {
    expect(buttonClass()).toContain("rounded-full");
    expect(buttonClass()).toContain("bg-money");
    expect(buttonClass({ variant: "dark" })).toContain("bg-ink text-paper");
    expect(buttonClass({ variant: "ghost" })).toContain("text-money");
    expect(html(<Button variant="secondary">Re-scan</Button>)).toContain("border-rule");
  });
});

describe("Chip", () => {
  it("is a plain label without selected/onClick", () => {
    const out = html(<Chip>Go</Chip>);
    expect(out.startsWith("<span")).toBe(true);
    expect(out).not.toContain("aria-pressed");
  });

  it("is a toggle button with aria-pressed when selected is set", () => {
    expect(html(<Chip selected>All</Chip>)).toMatch(/^<button type="button" aria-pressed="true"[^>]*bg-ink text-paper/);
    expect(html(<Chip selected={false}>Go</Chip>)).toContain('aria-pressed="false"');
  });

  it("is a plain button, not a toggle, with only onClick", () => {
    const out = html(<Chip onClick={() => {}}>Clear</Chip>);
    expect(out.startsWith("<button")).toBe(true);
    expect(out).not.toContain("aria-pressed");
  });
});

describe("Amount", () => {
  const F = formatXof(10000);
  const S = formatSats(15300);

  it("shows FCFA alone by default (one span, as in W1)", () => {
    expect(html(<Amount xof={10000} />)).toBe(
      html(<span className="font-display leading-none tracking-[-0.03em] tabular-nums text-xl font-extrabold">{F}</span>),
    );
  });

  it("puts FCFA big and sats small when sats are known", () => {
    const out = html(<Amount xof={10000} sats={15300} />);
    expect(out.indexOf(F)).toBeGreaterThan(-1);
    expect(out.indexOf(F)).toBeLessThan(out.indexOf(S));
    expect(out).toContain("font-mono");
  });

  it("puts the preferred currency first, FCFA second, and falls back to FCFA when unknown", () => {
    const sats = html(<Amount xof={10000} sats={15300} currency="sats" />);
    expect(sats.indexOf(S)).toBeGreaterThan(-1);
    expect(sats.indexOf(S)).toBeLessThan(sats.indexOf(F));
    const ngn = html(<Amount xof={10000} ngn={24500} currency="ngn" />);
    expect(ngn.indexOf(formatNgn(24500))).toBeGreaterThan(-1);
    expect(ngn.indexOf(formatNgn(24500))).toBeLessThan(ngn.indexOf(F));
    expect(html(<Amount xof={10000} currency="ngn" />)).toBe(html(<Amount xof={10000} />));
    expect(formatNgn(1234567)).toBe("₦1 234 567");
  });
});

describe("Avatar", () => {
  it("is decorative initials by default, a photo with src", () => {
    expect(html(<Avatar initials="awa" />)).toContain('aria-hidden="true"');
    expect(html(<Avatar initials="awa" />)).toContain(">AW<");
    expect(html(<Avatar initials="A" src="https://avatars.githubusercontent.com/u/1" />)).toContain('<img src="https://avatars.githubusercontent.com/u/1" alt=""');
  });

  it("draws the tier ring and takes an accessible name", () => {
    const out = html(<Avatar initials="FS" tier="gold" label="@fatou, Gold tier" />);
    expect(out).toContain('data-tier="gold"');
    expect(out).toContain("border-tier-gold");
    expect(out).toContain('role="img" aria-label="@fatou, Gold tier"');
  });
});

describe("ProgressSteps", () => {
  it("marks done steps, the current step and numbers the rest", () => {
    const out = html(<ProgressSteps current={1} steps={[{ label: "Rôle", done: true }, { label: "Stack" }, { label: "Paiement" }]} />);
    expect(out.match(/data-done="true"/g)).toHaveLength(1);
    expect(out).toContain('aria-current="step"');
    expect(out).toContain("(done)");
    expect(out).toContain(">3</i>");
    expect(out.match(/<li/g)).toHaveLength(3);
  });
});

describe("EmptyState, Skeleton", () => {
  it("renders the title, body and action in a dashed box", () => {
    const out = html(<EmptyState title="Nothing yet" action={<a href="/">Go</a>}>Soon.</EmptyState>);
    expect(out).toContain("border-dashed");
    expect(out).toContain("Nothing yet");
    expect(out).toContain("Soon.");
    expect(out).toContain('<a href="/">Go</a>');
  });

  it("hides skeletons from screen readers and stops the pulse for reduced motion", () => {
    const out = html(<Skeleton className="h-4 w-20" />);
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain("motion-reduce:animate-none");
    expect(out).toContain("h-4 w-20");
  });
});

describe("Toast", () => {
  it("announces errors as alerts and the rest as status", () => {
    expect(html(<Toast tone="error" title="Payout failed" />)).toContain('role="alert"');
    expect(html(<Toast tone="success" title="Funded" />)).toContain('role="status"');
    expect(html(<Toast title="x" />)).not.toContain("Dismiss");
    expect(html(<Toast title="x" onClose={() => {}} />)).toContain('aria-label="Dismiss"');
  });

  it("useToast needs the provider", () => {
    function Probe() {
      return <span>{typeof useToast()}</span>;
    }
    expect(() => html(<Probe />)).toThrow(/ToastProvider/);
    expect(html(<ToastProvider><Probe /></ToastProvider>)).toContain("<span>function</span>");
  });
});
