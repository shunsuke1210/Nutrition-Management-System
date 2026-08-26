import { describe, expect, it } from "vitest";
import { SHARED_PACKAGE_NAME, ping } from "./index.js";

describe("@nutrition/shared entry point (build pipeline smoke test)", () => {
  it("exports the package name constant", () => {
    expect(SHARED_PACKAGE_NAME).toBe("@nutrition/shared");
  });

  it("ping() resolves to the expected health-check value", () => {
    expect(ping()).toBe("shared:ok");
  });
});
