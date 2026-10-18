import { describe, expect, it } from "vitest";
import { BitnobFunderCustomers, safePart } from "../src/funding/customers.js";

describe("funder customer email (Bitnob validates it)", () => {
  it("never puts a ':' in the email or reference (github:login funder ids)", async () => {
    const calls: { email: string; reference?: string }[] = [];
    const customers = new BitnobFunderCustomers({
      createCustomer: async (input) => {
        calls.push({ email: input.email, reference: input.reference });
        return { id: "cus_1" } as never;
      },
    });
    await customers.customerId("github:Djbrl");
    await customers.customerId("github:Djbrl", { first_name: "D" } as never);
    for (const c of calls) {
      expect(c.email).toMatch(/^[A-Za-z0-9._+-]+@bitbounty\.invalid$/);
      expect(c.reference ?? "").not.toContain(":");
    }
    expect(calls[0]?.email).toBe("funder-github-Djbrl@bitbounty.invalid");
  });

  it("keeps safe ids unchanged", () => {
    expect(safePart("12345")).toBe("12345");
    expect(safePart("user.name_x-1")).toBe("user.name_x-1");
  });
});
