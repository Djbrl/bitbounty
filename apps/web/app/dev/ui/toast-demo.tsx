"use client";

import { Button, useToast } from "@/components/ui";

/** /dev/ui only: fires a real toast through the ToastProvider mounted in the root layout. */
export function ToastDemo() {
  const toast = useToast();
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => toast({ tone: "success", title: "Bounty funded", children: "10 000 F held for bitnob-js #41." })}
    >
      Show a toast
    </Button>
  );
}
