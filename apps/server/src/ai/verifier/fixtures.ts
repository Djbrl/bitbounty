import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelAnswer } from "./schema.js";
import type { Verdict, VerifyInput } from "./types.js";

export interface VerifierFixture {
  file: string;
  name: string;
  /** Verdicts that count as correct for the real model. */
  expected: Verdict[];
  input: VerifyInput;
  /** What the scripted fake answers (the injection one plays a compromised model). */
  fakeAnswer: ModelAnswer;
}

/** The fixtures live next to the sources (src/), also when running from dist/. */
export function fixturesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here.replace(/([/\\])dist([/\\])/, "$1src$2"), "__fixtures__");
}

export function loadFixtures(dir = fixturesDir()): VerifierFixture[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, ...(JSON.parse(readFileSync(join(dir, file), "utf8")) as Omit<VerifierFixture, "file">) }));
}
