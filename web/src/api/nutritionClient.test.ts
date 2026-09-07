import { afterEach, describe, expect, it, vi } from "vitest";
import type { DietInsights, IsoDate, NutritionSummary } from "@nutrition/shared";
import { getDietInsights, getSummary } from "./nutritionClient.js";

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

const sampleDate: IsoDate = "2026-09-01";

const sampleNutritionSummary: NutritionSummary = {
  computedAt: "2026-09-01T00:00:00.000Z",
  bmr: 1500,
  activityCoefficient: 1.55,
  activityLevelLabel: "ふつう",
  tdee: 2325,
  dailyExpenditure: { date: sampleDate, value: 2325 },
  normalMode: {
    calorieTarget: 2325,
    pfcRatio: { proteinPct: 0.2, fatPct: 0.25, carbPct: 0.55 },
    pfc: {
      proteinG: 116,
      fatG: 65,
      carbG: 320,
      proteinKcal: 465,
      fatKcal: 585,
      carbKcal: 1280,
    },
    micronutrients: {
      vitaminAUg: 850,
      vitaminDUg: 8.5,
      vitaminB1Mg: 1.4,
      vitaminB2Mg: 1.6,
      vitaminCMg: 100,
      calciumMg: 800,
      ironMg: 7.5,
      fiberG: 21,
      saltEquivalentUpperLimitG: 7.5,
    },
  },
  dietMode: null,
};

const sampleDietInsights: DietInsights = {
  weightHistory: [{ date: "2026-08-25", weightKg: 65.2 }],
  weightProjection: [{ date: "2026-09-08", projectedWeightKg: 64.5 }],
  goalEta: { available: true, weeklyProgressKg: 0.3, estimatedWeeksToGoal: 8 },
  plateau: { status: "on_track" },
  exerciseSimulation: { available: false },
};

describe("nutritionClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getSummary", () => {
    it("issues a GET request to /api/nutrition/summary with the date query param and resolves the summary", async () => {
      stubFetchResolved(200, sampleNutritionSummary);

      const result = await getSummary(sampleDate);

      expect(fetch).toHaveBeenCalledWith(
        `/api/nutrition/summary?date=${sampleDate}`,
        expect.objectContaining({ method: "GET" }),
      );
      expect(result).toEqual({ ok: true, value: sampleNutritionSummary });
    });

    it("resolves a calculation_unavailable error result (not a thrown exception) on a 409 response", async () => {
      stubFetchResolved(409, {
        type: "calculation_unavailable",
        reason: "profile_missing",
        message: "プロフィールが未登録です。",
      });

      const result = await getSummary(sampleDate);

      expect(result).toEqual({
        ok: false,
        error: {
          type: "calculation_unavailable",
          reason: "profile_missing",
          message: "プロフィールが未登録です。",
        },
      });
    });
  });

  describe("getDietInsights", () => {
    it("issues a GET request to /api/nutrition/diet-insights with the date query param and resolves the insights", async () => {
      stubFetchResolved(200, sampleDietInsights);

      const result = await getDietInsights(sampleDate);

      expect(fetch).toHaveBeenCalledWith(
        `/api/nutrition/diet-insights?date=${sampleDate}`,
        expect.objectContaining({ method: "GET" }),
      );
      expect(result).toEqual({ ok: true, value: sampleDietInsights });
    });

    it.each([
      ["profile_missing", "プロフィールが未登録です。"],
      ["diet_mode_disabled", "ダイエットモードが無効です。"],
      ["incomplete_diet_mode_data", "ダイエットモードに必要なデータが不足しています。"],
    ] as const)(
      "resolves a calculation_unavailable error result with reason %s (not a thrown exception) on a 409 response",
      async (reason, message) => {
        stubFetchResolved(409, { type: "calculation_unavailable", reason, message });

        const result = await getDietInsights(sampleDate);

        expect(result).toEqual({
          ok: false,
          error: { type: "calculation_unavailable", reason, message },
        });
      },
    );
  });
});
