import { describe, expect, it } from "vitest";
import { isLightningAddress, maskLightningAddress, parseLightningAddress } from "../src/index.js";

describe("Lightning Address (LUD-16)", () => {
  it("parses and lower-cases user@domain", () => {
    expect(parseLightningAddress(" Awa.Diop@Blink.SV ")).toEqual({ user: "awa.diop", domain: "blink.sv" });
    expect(parseLightningAddress("a+tips_1-x@wallet.of.satoshi.com")).toEqual({ user: "a+tips_1-x", domain: "wallet.of.satoshi.com" });
  });

  it.each(["", "awa", "@blink.sv", "awa@", "awa@@blink.sv", "a@b@c.sv", "awa@blink", "aw a@blink.sv", "awa@-blink.sv", "awa@blink.sv/x", "awa@localhost:8787", 42, null])(
    "refuses %j",
    (v) => {
      expect(parseLightningAddress(v)).toBeNull();
      expect(isLightningAddress(v)).toBe(false);
    },
  );

  it("accepts localhost / 127.0.0.1 with a port only when allowLocal is set", () => {
    expect(parseLightningAddress("dev@127.0.0.1:8787", { allowLocal: true })).toEqual({ user: "dev", domain: "127.0.0.1:8787" });
    expect(parseLightningAddress("dev@localhost", { allowLocal: true })).toEqual({ user: "dev", domain: "localhost" });
    expect(parseLightningAddress("dev@10.0.0.1:80", { allowLocal: true })).toBeNull();
    expect(parseLightningAddress("dev@127.0.0.1:99999", { allowLocal: true })).toBeNull();
  });

  it("masks for logs", () => {
    expect(maskLightningAddress("awa.diop@blink.sv")).toBe("aw***@blink.sv");
    expect(maskLightningAddress("a@blink.sv")).toBe("a***@blink.sv");
    expect(maskLightningAddress("nope")).toBe("***");
  });
});
