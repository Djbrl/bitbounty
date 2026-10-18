// L1: the marketing pages (today only the landing at `/`). Own stylesheet and fonts, everything
// under .bb-landing, so the app's tokens, fonts and pages are untouched (see landing.css).
import type { ReactNode } from "react";
import "./landing.css";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div lang="fr" className="bb-landing">
      {children}
    </div>
  );
}
