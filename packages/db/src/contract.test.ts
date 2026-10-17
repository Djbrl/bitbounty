import { BOUNTY_STATUSES } from "@bitbounty/core";
import { describe, expect, it } from "vitest";
import { bountyStatus } from "./schema.js";

describe("contract", () => {
  it("stores exactly the bounty statuses of @bitbounty/core", () => {
    expect(bountyStatus.enumValues).toEqual([...BOUNTY_STATUSES]);
  });
});
