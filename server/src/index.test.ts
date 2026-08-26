import { describe, expect, it } from "vitest";
import { healthCheck } from "./index.js";

describe("@nutrition/server entry point (build pipeline smoke test)", () => {
  it("healthCheck() resolves using the @nutrition/shared dependency", () => {
    expect(healthCheck()).toBe("server:ok+shared:ok");
  });
});
