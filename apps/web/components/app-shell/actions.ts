"use server";
// U2: the Maintainer ⇄ Hunter switch. Saves the mode, then lands on that workspace's home.
import { redirect } from "next/navigation";
import { saveMode } from "./data";
import { parseMode } from "./mode";

export async function switchMode(formData: FormData): Promise<void> {
  const mode = parseMode(formData.get("mode"));
  if (!mode) return;
  await saveMode(mode);
  redirect(`/app/${mode}`);
}
