"use client";
// Waitlist signup on the maintenance page: posts to /api/waitlist (stored in Upstash, see lib/waitlist.ts).
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

type State = "idle" | "sending" | "done" | "error";

const MESSAGES: Record<string, string> = {
  invalid_email: "Cette adresse email ne semble pas valide.",
  rate_limited: "Trop d'essais depuis cette connexion. Réessayez dans une heure.",
};
const FALLBACK = "L'inscription n'a pas marché. Réessayez dans un instant.";

export function WaitlistForm({ contactEmail }: { contactEmail: string }) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), website: data.get("website") }),
      });
      if (res.ok) return setState("done");
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(MESSAGES[body.error ?? ""] ?? (contactEmail ? `${FALLBACK} Ou écrivez-nous à ${contactEmail}.` : FALLBACK));
    } catch {
      setError(FALLBACK);
    }
    setState("error");
  }

  if (state === "done") {
    return (
      <p role="status" className="rounded-2xl bg-money-soft px-4 py-3 text-sm font-semibold text-money">
        C&apos;est noté. On vous écrit dès que BitBounty est de retour.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-2">
      <label htmlFor="waitlist-email" className="text-sm font-semibold">
        Votre email
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="waitlist-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          placeholder="vous@exemple.com"
          className="min-w-0 flex-1 rounded-full border border-rule bg-sheet px-4 py-2.5 text-sm placeholder:text-muted focus-visible:outline-2 focus-visible:outline-money"
        />
        {/* Honeypot: hidden from people and screen readers, filled by bots. */}
        <input name="website" type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
        <Button type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Envoi…" : "Rejoindre la liste d'attente"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <p className="text-xs text-muted">Votre email sert uniquement à vous prévenir du retour de BitBounty.</p>
    </form>
  );
}
