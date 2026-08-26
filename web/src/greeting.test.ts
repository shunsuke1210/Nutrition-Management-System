import { describe, expect, it } from "vitest";
import { buildPlaceholderGreeting } from "./greeting.js";

describe("web placeholder logic (build pipeline smoke test)", () => {
  it("buildPlaceholderGreeting() resolves using the @nutrition/shared dependency", () => {
    expect(buildPlaceholderGreeting()).toBe("web:ok+shared:ok");
  });
});
