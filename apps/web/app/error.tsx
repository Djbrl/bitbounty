"use client";

// I1: any page whose data can't be loaded (server down, too slow, 5xx) lands here instead of a blank 500.
import { useEffect } from "react";
import { Button } from "@/components/ui";
import { ErrorState } from "@/components/ui/states";
import { errorText } from "@/lib/api";

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ErrorState
      message={errorText(error)}
      action={
        <div>
          <Button onClick={reset}>Réessayer</Button>
        </div>
      }
    />
  );
}
