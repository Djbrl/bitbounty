import { redirect } from "next/navigation";

/** The W1 catalogue moved to /dev/ui (U0 design system, light and dark side by side). */
export default function DevPage() {
  redirect("/dev/ui");
}
