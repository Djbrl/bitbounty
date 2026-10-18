"use client";

import { buttonClass } from "../ui/button";

/** "Imprimer": the receipt page has print styles (actions and nav hidden, card flattened). */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass({ variant: "secondary", block: true })}>
      Imprimer / PDF
    </button>
  );
}
