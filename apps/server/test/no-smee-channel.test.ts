import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// CR7: smee channels have no auth, so a committed channel URL lets anyone read every webhook.
// The real one lives only in .env (WEBHOOK_PROXY_URL); placeholders like smee.io/<your-channel> are fine.
const REAL_CHANNEL = /smee\.io\/[A-Za-z0-9_-]{6,}/;
const repoRoot = join(import.meta.dirname, "..", "..", "..");

describe("smee channel URL", () => {
  it("is not committed in any tracked file", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
      .split("\0")
      .filter((f) => f && !/\.(png|jpe?g|gif|ico|webp|woff2?)$/i.test(f));

    const leaks = files.filter((f) => {
      try {
        return REAL_CHANNEL.test(readFileSync(join(repoRoot, f), "utf8"));
      } catch {
        return false; // listed but deleted in the working tree
      }
    });

    expect(leaks).toEqual([]);
  });
});
