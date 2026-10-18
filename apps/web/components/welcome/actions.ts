"use server";
// U1: /welcome reuses U2's mode storage (bb_mode cookie + POST /api/me/mode) and sets the bb_lang cookie
// the /app shell reads.
import { cookies } from "next/headers";
import { saveMode } from "../app-shell/data";
import { LANG_COOKIE, parseLang, parseMode } from "../app-shell/mode";

export async function saveWelcomeMode(raw: string): Promise<boolean> {
  const mode = parseMode(raw);
  if (!mode) return false;
  await saveMode(mode);
  return true;
}

export async function saveWelcomeLang(raw: string): Promise<void> {
  (await cookies()).set(LANG_COOKIE, parseLang(raw), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}
