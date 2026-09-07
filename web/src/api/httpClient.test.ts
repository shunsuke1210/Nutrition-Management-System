import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./httpClient.js";

function stubFetchResolved(status: number, json: unknown): void {
  const ok = status >= 200 && status < 300;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status,
      ok,
      json: vi.fn().mockResolvedValue(json),
    } as unknown as Response),
  );
}

describe("apiRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an ok result with the parsed value on a 2xx response", async () => {
    stubFetchResolved(200, { id: 1 });

    const result = await apiRequest<{ id: number }>("/api/profile");

    expect(result).toEqual({ ok: true, value: { id: 1 } });
  });

  it("returns an ok result with undefined value for a 204 No Content response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 204,
        ok: true,
        json: vi.fn(),
      } as unknown as Response),
    );

    const result = await apiRequest<void>("/api/daily-logs/2026-08-26/exercise-entries/1", {
      method: "DELETE",
    });

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("returns a validation error result matching a 400 validation error body", async () => {
    stubFetchResolved(400, {
      type: "validation",
      fieldErrors: { heightCm: ["must be positive"] },
    });

    const result = await apiRequest("/api/profile", { method: "PUT", body: {} });

    expect(result).toEqual({
      ok: false,
      error: { type: "validation", fieldErrors: { heightCm: ["must be positive"] } },
    });
  });

  it("returns a not_found error result matching a 404 not_found error body", async () => {
    stubFetchResolved(404, { type: "not_found", message: "entry not found" });

    const result = await apiRequest(
      "/api/daily-logs/2026-08-26/exercise-entries/999",
      { method: "DELETE" },
    );

    expect(result).toEqual({
      ok: false,
      error: { type: "not_found", message: "entry not found" },
    });
  });

  it("returns a calculation_unavailable error result (with reason intact) matching a 409 calculation_unavailable error body", async () => {
    stubFetchResolved(409, {
      type: "calculation_unavailable",
      reason: "profile_missing",
      message: "プロフィールが未登録です。",
    });

    const result = await apiRequest("/api/nutrition/summary?date=2026-09-01");

    expect(result).toEqual({
      ok: false,
      error: {
        type: "calculation_unavailable",
        reason: "profile_missing",
        message: "プロフィールが未登録です。",
      },
    });
  });

  it("preserves a different calculation_unavailable reason on a 409 response without collapsing it to unknown", async () => {
    stubFetchResolved(409, {
      type: "calculation_unavailable",
      reason: "diet_mode_disabled",
      message: "ダイエットモードが無効です。",
    });

    const result = await apiRequest("/api/nutrition/diet-insights?date=2026-09-01");

    expect(result).toEqual({
      ok: false,
      error: {
        type: "calculation_unavailable",
        reason: "diet_mode_disabled",
        message: "ダイエットモードが無効です。",
      },
    });
  });

  it("returns a generation_failed error result (with reason intact) matching a 409 generation_failed error body", async () => {
    stubFetchResolved(409, {
      type: "generation_failed",
      reason: "generation_in_progress",
      message: "既に生成処理が実行中です。",
    });

    const result = await apiRequest("/api/menu-plans/2026-09-07/regenerate");

    expect(result).toEqual({
      ok: false,
      error: {
        type: "generation_failed",
        reason: "generation_in_progress",
        message: "既に生成処理が実行中です。",
      },
    });
  });

  it("preserves a different generation_failed reason on a 502 response without collapsing it to unknown", async () => {
    stubFetchResolved(502, {
      type: "generation_failed",
      reason: "claude_request_failed",
      message: "献立生成に失敗しました。",
    });

    const result = await apiRequest("/api/menu-plans/2026-09-07/days/0/regenerate");

    expect(result).toEqual({
      ok: false,
      error: {
        type: "generation_failed",
        reason: "claude_request_failed",
        message: "献立生成に失敗しました。",
      },
    });
  });

  it("returns an unknown error result for a 500 response", async () => {
    stubFetchResolved(500, { type: "internal", message: "Internal Server Error" });

    const result = await apiRequest("/api/profile");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("unknown");
    }
  });

  it("returns an unknown error result when the network request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await apiRequest("/api/profile");

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === "unknown") {
      expect(result.error.message).toBe("network down");
    } else {
      expect.fail("expected an unknown error result");
    }
  });

  it("sends the method and a JSON-encoded body for non-GET requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: vi.fn().mockResolvedValue({ id: 1 }),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/profile", { method: "PUT", body: { heightCm: 170 } });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/profile",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ heightCm: 170 }),
      }),
    );
  });
});
