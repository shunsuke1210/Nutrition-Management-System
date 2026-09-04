import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { EatingOutSuggestionResult, MealType, RecipeDetail } from "@nutrition/shared";
import { buildApp } from "../app.js";
import type { NotFoundError, Result, ValidationError } from "../shared/result.js";
import type { GenerationError, GenerationFailureReason } from "./menu-plan.service.js";
import type { RecipeDetailService } from "./recipe-detail.service.js";
import type { FeedbackService } from "./feedback.service.js";
import type { EatingOutSuggestionService } from "./eating-out-suggestion.service.js";
import { registerMealSlotRoutes } from "./meal-slot.routes.js";

/**
 * `MealSlotController`（`registerMealSlotRoutes`）の統合テスト（task 10.2）。
 *
 * design.md #MealSlotController、Requirements 8.1, 9.1, 10.1, 10.4, 13.1, 13.2。
 * `menu-plan.routes.test.ts`（task 9.3）と同じ規約: 実際の `buildApp()` に、挙動を
 * 差し替え可能なフェイクの `RecipeDetailService` / `FeedbackService` を渡して本ルートを
 * 登録し、`app.inject()` でHTTP境界を実際に通過させて検証する。両Serviceのオーケストレーション
 * 自体（`recipe-detail.service.test.ts` / `feedback.service.test.ts` が既に検証済み）は
 * フェイクに差し替える。
 *
 * `weekStartDate` の月曜日始まり検証は `menu-plan.routes.test.ts` と同じ規約で確認する
 * （"2026-01-06" はカレンダー上有効だが火曜日であり400として拒否される）。
 */

const MONDAY = "2026-01-05";
const TUESDAY = "2026-01-06";
const DAY_INDEX = 2;
const MEAL_TYPE: MealType = "lunch";

function buildFixtureRecipeDetail(): RecipeDetail {
  return {
    mealSlotId: 42,
    servings: 2,
    cookingTimeMinutes: 20,
    steps: ["下ごしらえをする", "炒める"],
    nutrition: { energyKcal: 500, proteinG: 20, fatG: 15, carbG: 60 },
    supplementarySuggestions: [
      {
        dishName: "副菜A",
        ingredients: [{ foodId: "F001", quantity: 50, unit: "g" }],
        nutritionDelta: { energyKcal: 80, proteinG: 5, fatG: 2, carbG: 10 },
      },
    ],
  };
}

function buildGenerationError(reason: GenerationFailureReason): GenerationError {
  return { type: "generation_failed", reason, message: `test fixture error for reason "${reason}"` };
}

function buildNotFoundError(): NotFoundError {
  return {
    type: "not_found",
    message: `指定された食事枠が有効な献立プラン内に見つかりません（weekStartDate: ${MONDAY}, dayIndex: ${DAY_INDEX}, mealType: ${MEAL_TYPE}）`,
  };
}

interface FakeRecipeDetailServiceConfig {
  generateForMealSlot?: (
    weekStartDate: string,
    dayIndex: number,
    mealType: MealType
  ) => Promise<Result<RecipeDetail, GenerationError | NotFoundError>>;
}

/**
 * `RecipeDetailService` の唯一のメソッドを差し替えるための、挙動を変更可能なフェイク
 * （`menu-plan.routes.test.ts` の `createFakeMenuPlanService` と同じ規約）。渡された引数を
 * 記録し、`config.generateForMealSlot` が渡されていない場合に呼び出されたら例外を送出する。
 */
function createFakeRecipeDetailService(config: FakeRecipeDetailServiceConfig = {}): RecipeDetailService & {
  received: { weekStartDate: string; dayIndex: number; mealType: MealType }[];
} {
  const received: { weekStartDate: string; dayIndex: number; mealType: MealType }[] = [];

  return {
    received,
    async generateForMealSlot(weekStartDate, dayIndex, mealType) {
      received.push({ weekStartDate, dayIndex, mealType });
      if (!config.generateForMealSlot) {
        throw new Error("generateForMealSlot was not expected to be called in this test");
      }
      return config.generateForMealSlot(weekStartDate, dayIndex, mealType);
    },
  };
}

interface FakeFeedbackServiceConfig {
  recordFeedback?: (
    weekStartDate: string,
    dayIndex: number,
    mealType: MealType,
    input: { liked: boolean }
  ) => Result<void, ValidationError | NotFoundError>;
}

/**
 * `FeedbackService` を差し替えるための、挙動を変更可能なフェイク。`recordFeedback` に渡された
 * 引数（`liked` を含む）をすべて記録する（要件6: 引数の配線検証に使う）。`getDislikedSummary` は
 * `MealSlotController` から一切呼ばれないため、呼び出されたら例外を送出する。
 */
function createFakeFeedbackService(config: FakeFeedbackServiceConfig = {}): FeedbackService & {
  received: { weekStartDate: string; dayIndex: number; mealType: MealType; liked: boolean }[];
} {
  const received: { weekStartDate: string; dayIndex: number; mealType: MealType; liked: boolean }[] = [];

  return {
    received,
    recordFeedback(weekStartDate, dayIndex, mealType, input) {
      received.push({ weekStartDate, dayIndex, mealType, liked: input.liked });
      if (!config.recordFeedback) {
        throw new Error("recordFeedback was not expected to be called in this test");
      }
      return config.recordFeedback(weekStartDate, dayIndex, mealType, input);
    },
    getDislikedSummary() {
      throw new Error("getDislikedSummary was not expected to be called in this test");
    },
  };
}

interface FakeEatingOutSuggestionServiceConfig {
  suggestForMealSlot?: (
    weekStartDate: string,
    dayIndex: number,
    mealType: MealType
  ) => Result<EatingOutSuggestionResult, NotFoundError>;
}

/**
 * `EatingOutSuggestionService` を差し替えるための、挙動を変更可能なフェイク（task 13.6）。
 * `suggestForMealSlot`（`eating-out-suggestion.service.ts`参照）は同期関数（`Promise`を返さない）
 * であり、`GenerationError`を一切返し得ない（`Result<EatingOutSuggestionResult, NotFoundError>`のみ）。
 * `createFakeRecipeDetailService`/`createFakeFeedbackService`と同じ「渡された引数を記録し、
 * `config.suggestForMealSlot`が渡されていない場合に呼び出されたら例外を送出する」規約に揃える。
 */
function createFakeEatingOutSuggestionService(
  config: FakeEatingOutSuggestionServiceConfig = {}
): EatingOutSuggestionService & {
  received: { weekStartDate: string; dayIndex: number; mealType: MealType }[];
} {
  const received: { weekStartDate: string; dayIndex: number; mealType: MealType }[] = [];

  return {
    received,
    suggestForMealSlot(weekStartDate, dayIndex, mealType) {
      received.push({ weekStartDate, dayIndex, mealType });
      if (!config.suggestForMealSlot) {
        throw new Error("suggestForMealSlot was not expected to be called in this test");
      }
      return config.suggestForMealSlot(weekStartDate, dayIndex, mealType);
    },
  };
}

/** design.md #MenuPlanService Service Interface。409へ写像される3つの reason。 */
const CONFLICT_REASONS: readonly GenerationFailureReason[] = [
  "profile_missing",
  "nutrition_unavailable",
  "generation_in_progress",
];

const RECIPE_DETAIL_URL = `/api/menu-plans/${MONDAY}/days/${DAY_INDEX}/meals/${MEAL_TYPE}/recipe-detail`;
const FEEDBACK_URL = `/api/menu-plans/${MONDAY}/days/${DAY_INDEX}/meals/${MEAL_TYPE}/feedback`;
const EATING_OUT_SUGGESTION_URL = `/api/menu-plans/${MONDAY}/days/${DAY_INDEX}/meals/${MEAL_TYPE}/eating-out-suggestion`;

function registerFakes(
  recipeDetailConfig: FakeRecipeDetailServiceConfig = {},
  feedbackConfig: FakeFeedbackServiceConfig = {},
  eatingOutSuggestionConfig: FakeEatingOutSuggestionServiceConfig = {}
): {
  app: FastifyInstance;
  recipeDetailService: ReturnType<typeof createFakeRecipeDetailService>;
  feedbackService: ReturnType<typeof createFakeFeedbackService>;
  eatingOutSuggestionService: ReturnType<typeof createFakeEatingOutSuggestionService>;
} {
  const recipeDetailService = createFakeRecipeDetailService(recipeDetailConfig);
  const feedbackService = createFakeFeedbackService(feedbackConfig);
  const eatingOutSuggestionService = createFakeEatingOutSuggestionService(eatingOutSuggestionConfig);
  const app = buildApp({ logger: false });
  registerMealSlotRoutes(app, recipeDetailService, feedbackService, eatingOutSuggestionService);
  return { app, recipeDetailService, feedbackService, eatingOutSuggestionService };
}

describe("MealSlotController (meal-slot.routes)", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  describe("path param validation (weekStartDate / dayIndex / mealType), both routes", () => {
    it("POST .../recipe-detail with a real-but-non-Monday weekStartDate (2026-01-06, a Tuesday) returns 400 and never calls the service", async () => {
      const fakes = registerFakes();
      app = fakes.app;

      const response = await app.inject({
        method: "POST",
        url: `/api/menu-plans/${TUESDAY}/days/${DAY_INDEX}/meals/${MEAL_TYPE}/recipe-detail`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
      expect(body.type).toBe("validation");
      expect(body.fieldErrors.weekStartDate?.length).toBeGreaterThan(0);
      expect(fakes.recipeDetailService.received).toEqual([]);
    });

    it("POST .../feedback with a real-but-non-Monday weekStartDate (2026-01-06, a Tuesday) returns 400 and never calls the service", async () => {
      const fakes = registerFakes();
      app = fakes.app;

      const response = await app.inject({
        method: "POST",
        url: `/api/menu-plans/${TUESDAY}/days/${DAY_INDEX}/meals/${MEAL_TYPE}/feedback`,
        payload: { liked: true },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
      expect(body.type).toBe("validation");
      expect(body.fieldErrors.weekStartDate?.length).toBeGreaterThan(0);
      expect(fakes.feedbackService.received).toEqual([]);
    });

    it.each(["2026-13-40", "not-a-date"])(
      "POST .../recipe-detail with an invalid weekStartDate format (%s) returns 400 and never calls the service",
      async (invalidDate) => {
        const fakes = registerFakes();
        app = fakes.app;

        const response = await app.inject({
          method: "POST",
          url: `/api/menu-plans/${invalidDate}/days/${DAY_INDEX}/meals/${MEAL_TYPE}/recipe-detail`,
        });

        expect(response.statusCode).toBe(400);
        expect(fakes.recipeDetailService.received).toEqual([]);
      }
    );

    it.each(["abc", "3.5", "-1", "7"])(
      "POST .../recipe-detail with an invalid dayIndex (%s) returns 400 and never calls the service",
      async (dayIndex) => {
        const fakes = registerFakes();
        app = fakes.app;

        const response = await app.inject({
          method: "POST",
          url: `/api/menu-plans/${MONDAY}/days/${dayIndex}/meals/${MEAL_TYPE}/recipe-detail`,
        });

        expect(response.statusCode).toBe(400);
        const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
        expect(body.type).toBe("validation");
        expect(body.fieldErrors.dayIndex?.length).toBeGreaterThan(0);
        expect(fakes.recipeDetailService.received).toEqual([]);
      }
    );

    it.each(["abc", "8"])(
      "POST .../feedback with an invalid dayIndex (%s) returns 400 and never calls the service",
      async (dayIndex) => {
        const fakes = registerFakes();
        app = fakes.app;

        const response = await app.inject({
          method: "POST",
          url: `/api/menu-plans/${MONDAY}/days/${dayIndex}/meals/${MEAL_TYPE}/feedback`,
          payload: { liked: true },
        });

        expect(response.statusCode).toBe(400);
        expect(fakes.feedbackService.received).toEqual([]);
      }
    );

    it("POST .../recipe-detail with an invalid mealType (not one of the 4 real enum values) returns 400 and never calls the service", async () => {
      const fakes = registerFakes();
      app = fakes.app;

      const response = await app.inject({
        method: "POST",
        url: `/api/menu-plans/${MONDAY}/days/${DAY_INDEX}/meals/brunch/recipe-detail`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
      expect(body.type).toBe("validation");
      expect(body.fieldErrors.mealType?.length).toBeGreaterThan(0);
      expect(fakes.recipeDetailService.received).toEqual([]);
    });

    it("POST .../feedback with an invalid mealType (not one of the 4 real enum values) returns 400 and never calls the service", async () => {
      const fakes = registerFakes();
      app = fakes.app;

      const response = await app.inject({
        method: "POST",
        url: `/api/menu-plans/${MONDAY}/days/${DAY_INDEX}/meals/brunch/feedback`,
        payload: { liked: true },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
      expect(body.type).toBe("validation");
      expect(body.fieldErrors.mealType?.length).toBeGreaterThan(0);
      expect(fakes.feedbackService.received).toEqual([]);
    });

    it("GET .../eating-out-suggestion with an invalid mealType (not one of the 4 real enum values) returns 400 and never calls the service (task 13.6, reuses the shared MealSlotParamsSchema)", async () => {
      const fakes = registerFakes();
      app = fakes.app;

      const response = await app.inject({
        method: "GET",
        url: `/api/menu-plans/${MONDAY}/days/${DAY_INDEX}/meals/brunch/eating-out-suggestion`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
      expect(body.type).toBe("validation");
      expect(body.fieldErrors.mealType?.length).toBeGreaterThan(0);
      expect(fakes.eatingOutSuggestionService.received).toEqual([]);
    });

    it("GET .../eating-out-suggestion with a real-but-non-Monday weekStartDate (2026-01-06, a Tuesday) returns 400 and never calls the service (task 13.6)", async () => {
      const fakes = registerFakes();
      app = fakes.app;

      const response = await app.inject({
        method: "GET",
        url: `/api/menu-plans/${TUESDAY}/days/${DAY_INDEX}/meals/${MEAL_TYPE}/eating-out-suggestion`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
      expect(body.type).toBe("validation");
      expect(body.fieldErrors.weekStartDate?.length).toBeGreaterThan(0);
      expect(fakes.eatingOutSuggestionService.received).toEqual([]);
    });
  });

  describe("feedback request body validation (400)", () => {
    it("missing `liked` returns 400 and never calls the service", async () => {
      const fakes = registerFakes();
      app = fakes.app;

      const response = await app.inject({
        method: "POST",
        url: FEEDBACK_URL,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
      expect(body.type).toBe("validation");
      expect(body.fieldErrors.liked?.length).toBeGreaterThan(0);
      expect(fakes.feedbackService.received).toEqual([]);
    });

    it("a non-boolean `liked` (a string) returns 400 and never calls the service", async () => {
      const fakes = registerFakes();
      app = fakes.app;

      const response = await app.inject({
        method: "POST",
        url: FEEDBACK_URL,
        payload: { liked: "yes" },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
      expect(body.type).toBe("validation");
      expect(body.fieldErrors.liked?.length).toBeGreaterThan(0);
      expect(fakes.feedbackService.received).toEqual([]);
    });

    it("extra unexpected fields are ignored (permissive parsing, matching Zod's default non-strict object behavior) and the request still succeeds", async () => {
      const fakes = registerFakes({}, { recordFeedback: () => ({ ok: true, value: undefined }) });
      app = fakes.app;

      const response = await app.inject({
        method: "POST",
        url: FEEDBACK_URL,
        payload: { liked: true, somethingUnexpected: "ignored" },
      });

      expect(response.statusCode).toBe(204);
      expect(fakes.feedbackService.received).toEqual([
        { weekStartDate: MONDAY, dayIndex: DAY_INDEX, mealType: MEAL_TYPE, liked: true },
      ]);
    });
  });

  describe("NotFoundError from either service (meal slot does not exist)", () => {
    it("recipe-detail route returns 404 with the standard {type: 'not_found', message} shape", async () => {
      const notFound = buildNotFoundError();
      const fakes = registerFakes({ generateForMealSlot: async () => ({ ok: false, error: notFound }) });
      app = fakes.app;

      const response = await app.inject({ method: "POST", url: RECIPE_DETAIL_URL });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ type: "not_found", message: notFound.message });
    });

    it("feedback route returns 404 with the standard {type: 'not_found', message} shape", async () => {
      const notFound = buildNotFoundError();
      const fakes = registerFakes({}, { recordFeedback: () => ({ ok: false, error: notFound }) });
      app = fakes.app;

      const response = await app.inject({ method: "POST", url: FEEDBACK_URL, payload: { liked: false } });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ type: "not_found", message: notFound.message });
    });

    it("eating-out-suggestion route returns 404 with the standard {type: 'not_found', message} shape (task 13.6)", async () => {
      const notFound = buildNotFoundError();
      const fakes = registerFakes({}, {}, { suggestForMealSlot: () => ({ ok: false, error: notFound }) });
      app = fakes.app;

      const response = await app.inject({ method: "GET", url: EATING_OUT_SUGGESTION_URL });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ type: "not_found", message: notFound.message });
    });
  });

  describe("GenerationError from recipeDetailService.generateForMealSlot → 409/502 mapping", () => {
    it('reason "profile_missing" maps to 409', async () => {
      const error = buildGenerationError("profile_missing");
      const fakes = registerFakes({ generateForMealSlot: async () => ({ ok: false, error }) });
      app = fakes.app;

      const response = await app.inject({ method: "POST", url: RECIPE_DETAIL_URL });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual(error);
    });

    it('reason "claude_refusal" maps to 502', async () => {
      const error = buildGenerationError("claude_refusal");
      const fakes = registerFakes({ generateForMealSlot: async () => ({ ok: false, error }) });
      app = fakes.app;

      const response = await app.inject({ method: "POST", url: RECIPE_DETAIL_URL });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual(error);
    });

    it.each(
      [
        "profile_missing",
        "nutrition_unavailable",
        "schema_validation_failed",
        "food_id_not_found",
        "unit_not_found",
        "claude_refusal",
        "claude_request_failed",
        "generation_in_progress",
      ] as const
    )('reason "%s" maps to the correct status code (full 8-reason table)', async (reason) => {
      const error = buildGenerationError(reason);
      const fakes = registerFakes({ generateForMealSlot: async () => ({ ok: false, error }) });
      app = fakes.app;

      const response = await app.inject({ method: "POST", url: RECIPE_DETAIL_URL });

      const expectedStatus = CONFLICT_REASONS.includes(reason) ? 409 : 502;
      expect(response.statusCode).toBe(expectedStatus);
      expect(response.json()).toEqual(error);
    });
  });

  describe("success paths", () => {
    it("POST .../recipe-detail returns 200 with the RecipeDetail", async () => {
      const detail = buildFixtureRecipeDetail();
      const fakes = registerFakes({ generateForMealSlot: async () => ({ ok: true, value: detail }) });
      app = fakes.app;

      const response = await app.inject({ method: "POST", url: RECIPE_DETAIL_URL });

      expect(response.statusCode).toBe(200);
      const body = response.json() as RecipeDetail;
      expect(body.mealSlotId).toBe(detail.mealSlotId);
      expect(body.servings).toBe(detail.servings);
      expect(body.cookingTimeMinutes).toBe(detail.cookingTimeMinutes);
      expect(body.steps).toEqual(detail.steps);
      expect(body.supplementarySuggestions).toHaveLength(1);
      expect(fakes.recipeDetailService.received).toEqual([
        { weekStartDate: MONDAY, dayIndex: DAY_INDEX, mealType: MEAL_TYPE },
      ]);
    });

    it("POST .../feedback returns 204 with a genuinely empty body (not 'null' or '{}') on success", async () => {
      const fakes = registerFakes({}, { recordFeedback: () => ({ ok: true, value: undefined }) });
      app = fakes.app;

      const response = await app.inject({ method: "POST", url: FEEDBACK_URL, payload: { liked: true } });

      expect(response.statusCode).toBe(204);
      expect(response.rawPayload.length).toBe(0);
      expect(response.body).toBe("");
    });
  });

  describe("recordFeedback argument threading (weekStartDate/dayIndex/mealType from the URL, liked from the body)", () => {
    it("passes the correct arguments through to feedbackService.recordFeedback, not swapped/miswired", async () => {
      const fakes = registerFakes({}, { recordFeedback: () => ({ ok: true, value: undefined }) });
      app = fakes.app;

      const response = await app.inject({
        method: "POST",
        url: `/api/menu-plans/${MONDAY}/days/5/meals/dinner/feedback`,
        payload: { liked: false },
      });

      expect(response.statusCode).toBe(204);
      expect(fakes.feedbackService.received).toEqual([
        { weekStartDate: MONDAY, dayIndex: 5, mealType: "dinner", liked: false },
      ]);
    });
  });

  describe("GET .../eating-out-suggestion (task 13.6, Requirement 15.6)", () => {
    it("returns 200 with the exact EatingOutSuggestionResult body, including a legitimately negative proteinDeltaG (task 13.5's own real reference data: 親子丼→かけうどん = -18.5g)", async () => {
      const suggestionResult: EatingOutSuggestionResult = {
        suggestion: {
          typicalMenuName: "親子丼（並盛）",
          typicalMenuKcal: 650,
          alternativeMenuName: "かけうどん（並）",
          alternativeMenuKcal: 299,
          proteinDeltaG: -18.5,
        },
      };
      const fakes = registerFakes(
        {},
        {},
        { suggestForMealSlot: () => ({ ok: true, value: suggestionResult }) }
      );
      app = fakes.app;

      const response = await app.inject({ method: "GET", url: EATING_OUT_SUGGESTION_URL });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(suggestionResult);
      const body = response.json() as EatingOutSuggestionResult;
      // proteinDeltaG being negative is legitimate, expected data (design.md/EatingOutSuggestionSchema
      // comment: the alternative menu can genuinely be lower-protein) — it must NOT be treated as
      // an error case or otherwise mangled by the controller.
      expect(body.suggestion?.typicalMenuName).toBe("親子丼（並盛）");
      expect(body.suggestion?.typicalMenuKcal).toBe(650);
      expect(body.suggestion?.alternativeMenuName).toBe("かけうどん（並）");
      expect(body.suggestion?.alternativeMenuKcal).toBe(299);
      expect(body.suggestion?.proteinDeltaG).toBe(-18.5);
    });

    it("returns 200 with the exact JSON body {\"suggestion\": null} (NOT a bare null body) when no eligible candidate exists", async () => {
      const fakes = registerFakes(
        {},
        {},
        { suggestForMealSlot: () => ({ ok: true, value: { suggestion: null } }) }
      );
      app = fakes.app;

      const response = await app.inject({ method: "GET", url: EATING_OUT_SUGGESTION_URL });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(JSON.stringify({ suggestion: null }));
      const body = response.json() as EatingOutSuggestionResult;
      expect(body).toEqual({ suggestion: null });
      expect(body).not.toBeNull();
    });

    it("passes the correct weekStartDate/dayIndex/mealType from the URL through to eatingOutSuggestionService.suggestForMealSlot (not swapped/hardcoded)", async () => {
      const fakes = registerFakes(
        {},
        {},
        { suggestForMealSlot: () => ({ ok: true, value: { suggestion: null } }) }
      );
      app = fakes.app;

      const response = await app.inject({
        method: "GET",
        url: `/api/menu-plans/${MONDAY}/days/5/meals/dinner/eating-out-suggestion`,
      });

      expect(response.statusCode).toBe(200);
      expect(fakes.eatingOutSuggestionService.received).toEqual([
        { weekStartDate: MONDAY, dayIndex: 5, mealType: "dinner" },
      ]);
    });
  });

  describe("single-user operation (Req 13.1, 13.2)", () => {
    it("does not require any Authorization header or cookie for the request to succeed", async () => {
      const detail = buildFixtureRecipeDetail();
      const fakes = registerFakes({ generateForMealSlot: async () => ({ ok: true, value: detail }) });
      app = fakes.app;

      const response = await app.inject({ method: "POST", url: RECIPE_DETAIL_URL });

      expect(response.statusCode).toBe(200);
    });
  });
});
