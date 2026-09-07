import { afterEach, describe, expect, it, vi } from "vitest";
import type { EatingOutSuggestionResult, IsoDate, RecipeDetail } from "@nutrition/shared";
import { generateRecipeDetail, getEatingOutSuggestion, submitFeedback } from "./mealSlotClient.js";

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

function stubFetchNoContent(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status: 204,
      ok: true,
      json: vi.fn().mockResolvedValue(undefined),
    } as unknown as Response),
  );
}

const sampleWeekStartDate: IsoDate = "2026-09-07";
const sampleDayIndex = 0;
const sampleMealType = "lunch" as const;

const sampleRecipeDetail: RecipeDetail = {
  mealSlotId: 42,
  servings: 2,
  cookingTimeMinutes: 20,
  steps: ["野菜を切る。", "炒める。"],
  nutrition: {
    energyKcal: 450,
    proteinG: 25,
    fatG: 15,
    carbG: 50,
  },
  supplementarySuggestions: [
    {
      dishName: "小松菜の胡麻和え",
      ingredients: [{ foodId: "food-komatsuna", quantity: 60, unit: "g" }],
      nutritionDelta: {
        energyKcal: 40,
        proteinG: 3,
        fatG: 2,
        carbG: 4,
      },
    },
  ],
};

const sampleEatingOutSuggestionResult: EatingOutSuggestionResult = {
  suggestion: {
    typicalMenuName: "親子丼",
    typicalMenuKcal: 750,
    alternativeMenuName: "かけうどん",
    alternativeMenuKcal: 450,
    proteinDeltaG: -18.5,
  },
};

describe("mealSlotClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("generateRecipeDetail", () => {
    it("issues a POST request to the recipe-detail endpoint with all 3 params and resolves the recipe detail", async () => {
      stubFetchResolved(200, sampleRecipeDetail);

      const result = await generateRecipeDetail(sampleWeekStartDate, sampleDayIndex, sampleMealType);

      expect(fetch).toHaveBeenCalledWith(
        `/api/menu-plans/${sampleWeekStartDate}/days/${sampleDayIndex}/meals/${sampleMealType}/recipe-detail`,
        expect.objectContaining({ method: "POST" }),
      );
      expect(result).toEqual({ ok: true, value: sampleRecipeDetail });
    });

    it("resolves a generation_failed error result (with reason intact) on a 409 response", async () => {
      stubFetchResolved(409, {
        type: "generation_failed",
        reason: "profile_missing",
        message: "プロフィールが未登録です。",
      });

      const result = await generateRecipeDetail(sampleWeekStartDate, sampleDayIndex, sampleMealType);

      expect(result).toEqual({
        ok: false,
        error: {
          type: "generation_failed",
          reason: "profile_missing",
          message: "プロフィールが未登録です。",
        },
      });
    });

    it("resolves a generation_failed error result (with reason intact) on a 502 response", async () => {
      stubFetchResolved(502, {
        type: "generation_failed",
        reason: "claude_request_failed",
        message: "レシピ詳細の生成に失敗しました。",
      });

      const result = await generateRecipeDetail(sampleWeekStartDate, sampleDayIndex, sampleMealType);

      expect(result).toEqual({
        ok: false,
        error: {
          type: "generation_failed",
          reason: "claude_request_failed",
          message: "レシピ詳細の生成に失敗しました。",
        },
      });
    });

    it("resolves a not_found error result on a 404 response (no such meal slot)", async () => {
      stubFetchResolved(404, {
        type: "not_found",
        message: "対象の食事枠が見つかりません。",
      });

      const result = await generateRecipeDetail(sampleWeekStartDate, sampleDayIndex, sampleMealType);

      expect(result).toEqual({
        ok: false,
        error: { type: "not_found", message: "対象の食事枠が見つかりません。" },
      });
    });
  });

  describe("submitFeedback", () => {
    it("issues a POST request with liked:true in the JSON body and resolves ok:true with value:undefined on 204", async () => {
      stubFetchNoContent();

      const result = await submitFeedback(sampleWeekStartDate, sampleDayIndex, sampleMealType, true);

      expect(fetch).toHaveBeenCalledWith(
        `/api/menu-plans/${sampleWeekStartDate}/days/${sampleDayIndex}/meals/${sampleMealType}/feedback`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ liked: true }),
        }),
      );
      expect(result).toEqual({ ok: true, value: undefined });
    });

    it("issues a POST request with liked:false in the JSON body and resolves ok:true with value:undefined on 204", async () => {
      stubFetchNoContent();

      const result = await submitFeedback(sampleWeekStartDate, sampleDayIndex, sampleMealType, false);

      expect(fetch).toHaveBeenCalledWith(
        `/api/menu-plans/${sampleWeekStartDate}/days/${sampleDayIndex}/meals/${sampleMealType}/feedback`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ liked: false }),
        }),
      );
      expect(result).toEqual({ ok: true, value: undefined });
    });

    it("resolves a not_found error result on a 404 response (no such meal slot)", async () => {
      stubFetchResolved(404, {
        type: "not_found",
        message: "対象の食事枠が見つかりません。",
      });

      const result = await submitFeedback(sampleWeekStartDate, sampleDayIndex, sampleMealType, true);

      expect(result).toEqual({
        ok: false,
        error: { type: "not_found", message: "対象の食事枠が見つかりません。" },
      });
    });
  });

  describe("getEatingOutSuggestion", () => {
    it("issues a GET request to the eating-out-suggestion endpoint and resolves the suggestion", async () => {
      stubFetchResolved(200, sampleEatingOutSuggestionResult);

      const result = await getEatingOutSuggestion(sampleWeekStartDate, sampleDayIndex, sampleMealType);

      expect(fetch).toHaveBeenCalledWith(
        `/api/menu-plans/${sampleWeekStartDate}/days/${sampleDayIndex}/meals/${sampleMealType}/eating-out-suggestion`,
        expect.objectContaining({ method: "GET" }),
      );
      expect(result).toEqual({ ok: true, value: sampleEatingOutSuggestionResult });
    });

    it("resolves ok:true with value:{suggestion:null} when there is no alternative candidate (not an error, not a bare null body)", async () => {
      stubFetchResolved(200, { suggestion: null });

      const result = await getEatingOutSuggestion(sampleWeekStartDate, sampleDayIndex, sampleMealType);

      expect(result).toEqual({ ok: true, value: { suggestion: null } });
    });

    it("resolves a not_found error result on a 404 response (no such meal slot for the target day)", async () => {
      stubFetchResolved(404, {
        type: "not_found",
        message: "対象の食事枠が見つかりません。",
      });

      const result = await getEatingOutSuggestion(sampleWeekStartDate, sampleDayIndex, sampleMealType);

      expect(result).toEqual({
        ok: false,
        error: { type: "not_found", message: "対象の食事枠が見つかりません。" },
      });
    });
  });
});
