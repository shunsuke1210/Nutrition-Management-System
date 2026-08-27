import { afterEach, describe, expect, it, vi } from "vitest";
import type { DailyLogEntry, ExerciseLogEntry } from "@nutrition/shared";
import { addExerciseEntry, getDailyLog, removeExerciseEntry, saveDailyLog } from "./dailyLogClient.js";

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

const sampleEntry: DailyLogEntry = {
  date: "2026-08-26",
  weightKg: 68.6,
  bodyFatPct: 27.5,
  plannedKcal: 1650,
  manualOverrideKcal: null,
  calorieIntakeActual: 1650,
  calorieIntakeSource: "planned",
  exerciseEntries: [],
};

const sampleExerciseEntry: ExerciseLogEntry = {
  id: 1,
  activityName: "ウォーキング",
  durationMinutes: 30,
  estimatedCaloriesBurned: 120,
};

describe("dailyLogClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getDailyLog() issues a GET request to /api/daily-logs/:date and resolves to the stored entry", async () => {
    stubFetchResolved(200, sampleEntry);

    const result = await getDailyLog("2026-08-26");

    expect(fetch).toHaveBeenCalledWith("/api/daily-logs/2026-08-26", expect.objectContaining({ method: "GET" }));
    expect(result).toEqual({ ok: true, value: sampleEntry });
  });

  it("getDailyLog() resolves to ok:true with null when no record exists for that date", async () => {
    stubFetchResolved(200, null);

    const result = await getDailyLog("2026-08-26");

    expect(result).toEqual({ ok: true, value: null });
  });

  it("saveDailyLog() issues a PUT request to /api/daily-logs/:date with the given fields as the JSON body", async () => {
    stubFetchResolved(200, sampleEntry);

    const result = await saveDailyLog("2026-08-26", { weightKg: 68.6, bodyFatPct: 27.5 });

    expect(fetch).toHaveBeenCalledWith(
      "/api/daily-logs/2026-08-26",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ weightKg: 68.6, bodyFatPct: 27.5 }) }),
    );
    expect(result).toEqual({ ok: true, value: sampleEntry });
  });

  it("saveDailyLog() resolves to a validation error result when the server rejects the input", async () => {
    stubFetchResolved(400, {
      type: "validation",
      fieldErrors: { weightKg: ["must be positive"] },
    });

    const result = await saveDailyLog("2026-08-26", { weightKg: -1 });

    expect(result).toEqual({
      ok: false,
      error: { type: "validation", fieldErrors: { weightKg: ["must be positive"] } },
    });
  });

  it("addExerciseEntry() issues a POST request to /api/daily-logs/:date/exercise-entries with the entry input", async () => {
    stubFetchResolved(200, sampleExerciseEntry);

    const input = { activityName: "ウォーキング", durationMinutes: 30, estimatedCaloriesBurned: 120 };
    const result = await addExerciseEntry("2026-08-26", input);

    expect(fetch).toHaveBeenCalledWith(
      "/api/daily-logs/2026-08-26/exercise-entries",
      expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
    );
    expect(result).toEqual({ ok: true, value: sampleExerciseEntry });
  });

  it("removeExerciseEntry() issues a DELETE request to /api/daily-logs/:date/exercise-entries/:entryId", async () => {
    stubFetchResolved(204, undefined);

    const result = await removeExerciseEntry("2026-08-26", 1);

    expect(fetch).toHaveBeenCalledWith(
      "/api/daily-logs/2026-08-26/exercise-entries/1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("removeExerciseEntry() resolves to a not_found error result when the entry does not exist", async () => {
    stubFetchResolved(404, { type: "not_found", message: "Exercise entry 1 not found for date 2026-08-26" });

    const result = await removeExerciseEntry("2026-08-26", 1);

    expect(result).toEqual({
      ok: false,
      error: { type: "not_found", message: "Exercise entry 1 not found for date 2026-08-26" },
    });
  });
});
