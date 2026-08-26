import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { NotFoundError, ValidationError } from "./shared/result.js";

describe("buildApp", () => {
  it("responds with a reasonable status for a request to an unregistered path (health check)", async () => {
    const app = buildApp({ logger: false });

    const response = await app.inject({ method: "GET", url: "/no-such-path" });

    expect(response.statusCode).toBe(404);
  });

  it("maps a thrown ValidationError to HTTP 400 with the field errors in the response body", async () => {
    const app = buildApp({ logger: false });
    app.get("/__test-only/validation-error", () => {
      const error: ValidationError = {
        type: "validation",
        fieldErrors: { heightCm: ["heightCm is required"] },
      };
      throw error;
    });

    const response = await app.inject({ method: "GET", url: "/__test-only/validation-error" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      type: "validation",
      fieldErrors: { heightCm: ["heightCm is required"] },
    });
  });

  it("maps a thrown NotFoundError to HTTP 404 with a message in the response body", async () => {
    const app = buildApp({ logger: false });
    app.get("/__test-only/not-found-error", () => {
      const error: NotFoundError = {
        type: "not_found",
        message: "exercise entry not found",
      };
      throw error;
    });

    const response = await app.inject({ method: "GET", url: "/__test-only/not-found-error" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      type: "not_found",
      message: "exercise entry not found",
    });
  });

  it("maps an unexpected error to HTTP 500 without leaking internal error details", async () => {
    const app = buildApp({ logger: false });
    app.get("/__test-only/unexpected-error", () => {
      throw new Error("secret connection string: postgres://user:pw@host/db");
    });

    const response = await app.inject({ method: "GET", url: "/__test-only/unexpected-error" });

    expect(response.statusCode).toBe(500);
    const body = response.json() as { message?: string };
    expect(body.message ?? "").not.toContain("secret connection string");
  });

  it("allows future route modules to register onto the app returned by buildApp", async () => {
    const app = buildApp({ logger: false });
    app.get("/__test-only/ping", () => ({ pong: true }));

    const response = await app.inject({ method: "GET", url: "/__test-only/ping" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ pong: true });
  });
});
