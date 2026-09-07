import { afterEach, describe, expect, it, vi } from "vitest";
import type { DayMenu, IsoDate, ShoppingList, WeekMenuPlan } from "@nutrition/shared";
import { getShoppingList, getWeekPlan, regenerateDay, regenerateWeek } from "./menuPlanClient.js";

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

const sampleWeekStartDate: IsoDate = "2026-09-07";

const sampleDayMenu: DayMenu = {
  dayDate: "2026-09-07",
  dayIndex: 0,
  meals: [
    {
      mealType: "breakfast",
      dishName: "鮭の塩焼き定食",
      ingredients: [{ foodId: "food-salmon", quantity: 80, unit: "g" }],
      nutrition: {
        energyKcal: 450,
        proteinG: 25,
        fatG: 15,
        carbG: 50,
        fiberG: 3,
        calciumMg: 30,
        ironMg: 1.2,
        vitaminAUg: 20,
        vitaminDUg: 8,
        vitaminB1Mg: 0.2,
        vitaminB2Mg: 0.3,
        vitaminCMg: 10,
        saltEquivalentG: 2,
      },
    },
  ],
  dayNutrition: {
    energyKcal: 2000,
    proteinG: 100,
    fatG: 60,
    carbG: 250,
    fiberG: 20,
    calciumMg: 700,
    ironMg: 7,
    vitaminAUg: 800,
    vitaminDUg: 8,
    vitaminB1Mg: 1.2,
    vitaminB2Mg: 1.4,
    vitaminCMg: 90,
    saltEquivalentG: 7,
  },
  plannedKcal: 2000,
  targetKcal: 2000,
  varianceKcal: 0,
};

const sampleWeekMenuPlan: WeekMenuPlan = {
  weekStartDate: sampleWeekStartDate,
  generatedAt: "2026-09-07T00:00:00.000Z",
  days: [sampleDayMenu],
};

const sampleShoppingList: ShoppingList = {
  weekStartDate: sampleWeekStartDate,
  items: [
    {
      foodId: "food-hakusai",
      name: "白菜",
      category: "野菜・きのこ",
      quantityGrams: 500,
      displayQuantity: 0.5,
      displayUnit: "玉",
    },
  ],
};

describe("menuPlanClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getWeekPlan", () => {
    it("issues a GET request to /api/menu-plans/:weekStartDate and resolves the week plan", async () => {
      stubFetchResolved(200, sampleWeekMenuPlan);

      const result = await getWeekPlan(sampleWeekStartDate);

      expect(fetch).toHaveBeenCalledWith(
        `/api/menu-plans/${sampleWeekStartDate}`,
        expect.objectContaining({ method: "GET" }),
      );
      expect(result).toEqual({ ok: true, value: sampleWeekMenuPlan });
    });

    it("resolves ok:true with value:null when the target week has no active plan yet (not an error)", async () => {
      stubFetchResolved(200, null);

      const result = await getWeekPlan(sampleWeekStartDate);

      expect(result).toEqual({ ok: true, value: null });
    });
  });

  describe("regenerateWeek", () => {
    it("issues a POST request to /api/menu-plans/:weekStartDate/regenerate and resolves the regenerated week plan", async () => {
      stubFetchResolved(200, sampleWeekMenuPlan);

      const result = await regenerateWeek(sampleWeekStartDate);

      expect(fetch).toHaveBeenCalledWith(
        `/api/menu-plans/${sampleWeekStartDate}/regenerate`,
        expect.objectContaining({ method: "POST" }),
      );
      expect(result).toEqual({ ok: true, value: sampleWeekMenuPlan });
    });

    it("resolves a generation_failed error result (with reason intact) on a 409 response", async () => {
      stubFetchResolved(409, {
        type: "generation_failed",
        reason: "generation_in_progress",
        message: "既に生成処理が実行中です。",
      });

      const result = await regenerateWeek(sampleWeekStartDate);

      expect(result).toEqual({
        ok: false,
        error: {
          type: "generation_failed",
          reason: "generation_in_progress",
          message: "既に生成処理が実行中です。",
        },
      });
    });
  });

  describe("regenerateDay", () => {
    it("issues a POST request to /api/menu-plans/:weekStartDate/days/:dayIndex/regenerate and resolves the regenerated day menu", async () => {
      stubFetchResolved(200, sampleDayMenu);

      const result = await regenerateDay(sampleWeekStartDate, 0);

      expect(fetch).toHaveBeenCalledWith(
        `/api/menu-plans/${sampleWeekStartDate}/days/0/regenerate`,
        expect.objectContaining({ method: "POST" }),
      );
      expect(result).toEqual({ ok: true, value: sampleDayMenu });
    });

    it("resolves a generation_failed error result (with reason intact) on a 502 response", async () => {
      stubFetchResolved(502, {
        type: "generation_failed",
        reason: "claude_request_failed",
        message: "献立生成に失敗しました。",
      });

      const result = await regenerateDay(sampleWeekStartDate, 0);

      expect(result).toEqual({
        ok: false,
        error: {
          type: "generation_failed",
          reason: "claude_request_failed",
          message: "献立生成に失敗しました。",
        },
      });
    });

    it("resolves a not_found error result on a 404 response (no active plan for the target week)", async () => {
      stubFetchResolved(404, {
        type: "not_found",
        message: "対象週の週間献立プランが見つかりません。",
      });

      const result = await regenerateDay(sampleWeekStartDate, 0);

      expect(result).toEqual({
        ok: false,
        error: { type: "not_found", message: "対象週の週間献立プランが見つかりません。" },
      });
    });
  });

  describe("getShoppingList", () => {
    it("issues a GET request to /api/menu-plans/:weekStartDate/shopping-list and resolves the shopping list", async () => {
      stubFetchResolved(200, sampleShoppingList);

      const result = await getShoppingList(sampleWeekStartDate);

      expect(fetch).toHaveBeenCalledWith(
        `/api/menu-plans/${sampleWeekStartDate}/shopping-list`,
        expect.objectContaining({ method: "GET" }),
      );
      expect(result).toEqual({ ok: true, value: sampleShoppingList });
    });

    it("resolves ok:true with value:null when the target week's menu plan has not been generated yet (not an error)", async () => {
      stubFetchResolved(200, null);

      const result = await getShoppingList(sampleWeekStartDate);

      expect(result).toEqual({ ok: true, value: null });
    });
  });
});
