import { describe, expect, it } from "vitest";
import { buildApp, registerRoutes } from "./app.js";
import type { NotFoundError, ValidationError } from "./shared/result.js";
import type { GenerationError, MenuPlanService } from "./menu-generation/menu-plan.service.js";
import type { ShoppingListService } from "./menu-generation/shopping-list.service.js";
import type { RecipeDetailService } from "./menu-generation/recipe-detail.service.js";
import type { FeedbackService } from "./menu-generation/feedback.service.js";
import type { EatingOutSuggestionService } from "./menu-generation/eating-out-suggestion.service.js";
import type { ProfileService } from "./profile/profile.service.js";
import type { DailyLogService } from "./daily-log/daily-log.service.js";
import type { NutritionService } from "./nutrition/nutrition.service.js";

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

  it(
    "does NOT recognize a GenerationError-shaped thrown object (falls through to the generic " +
      "500 handler) — confirms setErrorHandler was not modified for menu-generation's " +
      "GenerationError (task 9.3: the 409/502 mapping lives in menu-plan.routes.ts itself, " +
      "via reply.status().send(), not via a new branch in this shared handler, mirroring the " +
      "precedent nutrition.routes.ts already established for CalculationUnavailableError)",
    async () => {
      const app = buildApp({ logger: false });
      app.get("/__test-only/generation-error", () => {
        const error: GenerationError = {
          type: "generation_failed",
          reason: "profile_missing",
          message: "test fixture GenerationError",
        };
        throw error;
      });

      const response = await app.inject({ method: "GET", url: "/__test-only/generation-error" });

      expect(response.statusCode).toBe(500);
      const body = response.json() as { type?: string; message?: string };
      expect(body.type).not.toBe("generation_failed");
      expect(body.message ?? "").not.toContain("test fixture GenerationError");
    }
  );
});

/** `ProfileService`/`DailyLogService`/`NutritionService` の唯一の依存を差し替えるためのフェイク。
 * これらのサービスは以下の `registerRoutes` 配線テストの対象外（`menuPlanService` の
 * optional配線のみを検証する）であるため、呼び出された場合は例外を送出する
 * （意図しない呼び出しを検知できるようにするため、`nutrition.routes.test.ts` の
 * `createFakeNutritionService` と同じ「未使用のメソッドは例外を送出する」規約）。 */
function createUnusedProfileService(): ProfileService {
  return {
    getProfile() {
      throw new Error("getProfile was not expected to be called in this test");
    },
    saveProfile() {
      throw new Error("saveProfile was not expected to be called in this test");
    },
  };
}

function createUnusedDailyLogService(): DailyLogService {
  return {
    getLog() {
      throw new Error("getLog was not expected to be called in this test");
    },
    getLogsInRange() {
      throw new Error("getLogsInRange was not expected to be called in this test");
    },
    upsertLog() {
      throw new Error("upsertLog was not expected to be called in this test");
    },
    setPlannedCalories() {
      throw new Error("setPlannedCalories was not expected to be called in this test");
    },
    addExerciseEntry() {
      throw new Error("addExerciseEntry was not expected to be called in this test");
    },
    removeExerciseEntry() {
      throw new Error("removeExerciseEntry was not expected to be called in this test");
    },
  };
}

function createUnusedNutritionService(): NutritionService {
  return {
    getSummary() {
      throw new Error("getSummary was not expected to be called in this test");
    },
    getDietInsights() {
      throw new Error("getDietInsights was not expected to be called in this test");
    },
  };
}

function createFakeMenuPlanService(): MenuPlanService {
  return {
    async generateWeek(weekStartDate) {
      return {
        ok: true,
        value: { weekStartDate, generatedAt: "2026-01-05T00:00:00.000Z", days: [] },
      };
    },
    async regenerateWeek(weekStartDate) {
      return {
        ok: true,
        value: { weekStartDate, generatedAt: "2026-01-05T00:00:00.000Z", days: [] },
      };
    },
    async regenerateDay() {
      throw new Error("regenerateDay was not expected to be called in this test");
    },
    getActivePlan() {
      return null;
    },
  };
}

/** `MenuPlanController`の買い物リストエンドポイント（task 13.3）配線テスト用のフェイク `ShoppingListService`。 */
function createFakeShoppingListService(): ShoppingListService {
  return {
    buildForWeek() {
      return null;
    },
  };
}

/** `MealSlotController`（task 10.2）配線テスト用のフェイク `RecipeDetailService`。 */
function createFakeRecipeDetailService(): RecipeDetailService {
  return {
    async generateForMealSlot(_weekStartDate, dayIndex) {
      return {
        ok: true,
        value: {
          mealSlotId: dayIndex,
          servings: 1,
          cookingTimeMinutes: 10,
          steps: ["step"],
          // task 16.1（Requirement 4.8）で新設。対象食事枠自身の食材を食材名解決したもの。
          ingredients: [{ foodId: "main-food", quantity: 100, unit: "g", name: "main-food-name" }],
          nutrition: { energyKcal: 100, proteinG: 1, fatG: 1, carbG: 1 },
          supplementarySuggestions: [
            {
              dishName: "side",
              ingredients: [],
              nutritionDelta: { energyKcal: 1, proteinG: 1, fatG: 1, carbG: 1 },
            },
          ],
        },
      };
    },
  };
}

/** `MealSlotController`（task 10.2）配線テスト用のフェイク `FeedbackService`。 */
function createFakeFeedbackService(): FeedbackService {
  return {
    recordFeedback() {
      return { ok: true, value: undefined };
    },
    getDislikedSummary() {
      throw new Error("getDislikedSummary was not expected to be called in this test");
    },
  };
}

/** `MealSlotController`の外食代替提案エンドポイント（task 13.6）配線テスト用のフェイク `EatingOutSuggestionService`。 */
function createFakeEatingOutSuggestionService(): EatingOutSuggestionService {
  return {
    suggestForMealSlot() {
      return { ok: true, value: { suggestion: null } };
    },
  };
}

describe("registerRoutes (AppRouteDependencies.menuPlanService/shoppingListService wiring, task 9.3/13.3)", () => {
  it("registers the menu-plan routes when both menuPlanService and shoppingListService are provided", async () => {
    const app = buildApp({ logger: false });
    registerRoutes(app, {
      profileService: createUnusedProfileService(),
      dailyLogService: createUnusedDailyLogService(),
      nutritionService: createUnusedNutritionService(),
      menuPlanService: createFakeMenuPlanService(),
      shoppingListService: createFakeShoppingListService(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/menu-plans/2026-01-05/generate",
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("registers the new shopping-list endpoint (task 13.3) when both services are provided", async () => {
    const app = buildApp({ logger: false });
    registerRoutes(app, {
      profileService: createUnusedProfileService(),
      dailyLogService: createUnusedDailyLogService(),
      nutritionService: createUnusedNutritionService(),
      menuPlanService: createFakeMenuPlanService(),
      shoppingListService: createFakeShoppingListService(),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/menu-plans/2026-01-05/shopping-list",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toBeNull();
    await app.close();
  });

  it(
    "does not register the menu-plan routes (and does not throw) when both menuPlanService " +
      "and shoppingListService are omitted — matches index.ts's current " +
      "registerRoutes(app, { profileService, dailyLogService, nutritionService }) call, " +
      "which this task does not modify",
    async () => {
      const app = buildApp({ logger: false });
      registerRoutes(app, {
        profileService: createUnusedProfileService(),
        dailyLogService: createUnusedDailyLogService(),
        nutritionService: createUnusedNutritionService(),
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/menu-plans/2026-01-05/generate",
      });

      expect(response.statusCode).toBe(404);
      await app.close();
    }
  );

  it(
    "does not register the menu-plan routes when only menuPlanService is provided without " +
      "shoppingListService (both are required together, since registerMenuPlanRoutes now " +
      "takes shoppingListService as a required positional argument alongside menuPlanService, " +
      "matching design.md's ShoppingListService P0 outbound dependency of MenuPlanController)",
    async () => {
      const app = buildApp({ logger: false });
      registerRoutes(app, {
        profileService: createUnusedProfileService(),
        dailyLogService: createUnusedDailyLogService(),
        nutritionService: createUnusedNutritionService(),
        menuPlanService: createFakeMenuPlanService(),
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/menu-plans/2026-01-05/generate",
      });

      expect(response.statusCode).toBe(404);
      await app.close();
    }
  );

  it(
    "does not register the menu-plan routes when only shoppingListService is provided " +
      "without menuPlanService",
    async () => {
      const app = buildApp({ logger: false });
      registerRoutes(app, {
        profileService: createUnusedProfileService(),
        dailyLogService: createUnusedDailyLogService(),
        nutritionService: createUnusedNutritionService(),
        shoppingListService: createFakeShoppingListService(),
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/menu-plans/2026-01-05/shopping-list",
      });

      expect(response.statusCode).toBe(404);
      await app.close();
    }
  );
});

describe(
  "registerRoutes (AppRouteDependencies.recipeDetailService/feedbackService/" +
    "eatingOutSuggestionService wiring, task 10.2/13.6)",
  () => {
    it(
      "registers the meal-slot routes when recipeDetailService, feedbackService, and " +
        "eatingOutSuggestionService are all provided",
      async () => {
        const app = buildApp({ logger: false });
        registerRoutes(app, {
          profileService: createUnusedProfileService(),
          dailyLogService: createUnusedDailyLogService(),
          nutritionService: createUnusedNutritionService(),
          recipeDetailService: createFakeRecipeDetailService(),
          feedbackService: createFakeFeedbackService(),
          eatingOutSuggestionService: createFakeEatingOutSuggestionService(),
        });

        const response = await app.inject({
          method: "POST",
          url: "/api/menu-plans/2026-01-05/days/2/meals/lunch/recipe-detail",
        });

        expect(response.statusCode).toBe(200);
        await app.close();
      }
    );

    it(
      "registers the new eating-out-suggestion endpoint (task 13.6) when all three services " +
        "are provided",
      async () => {
        const app = buildApp({ logger: false });
        registerRoutes(app, {
          profileService: createUnusedProfileService(),
          dailyLogService: createUnusedDailyLogService(),
          nutritionService: createUnusedNutritionService(),
          recipeDetailService: createFakeRecipeDetailService(),
          feedbackService: createFakeFeedbackService(),
          eatingOutSuggestionService: createFakeEatingOutSuggestionService(),
        });

        const response = await app.inject({
          method: "GET",
          url: "/api/menu-plans/2026-01-05/days/2/meals/lunch/eating-out-suggestion",
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ suggestion: null });
        await app.close();
      }
    );

    it(
      "does not register the meal-slot routes (and does not throw) when recipeDetailService/" +
        "feedbackService/eatingOutSuggestionService are all omitted — matches index.ts's " +
        "current registerRoutes(app, { profileService, dailyLogService, nutritionService }) " +
        "call, which this task does not modify",
      async () => {
        const app = buildApp({ logger: false });
        registerRoutes(app, {
          profileService: createUnusedProfileService(),
          dailyLogService: createUnusedDailyLogService(),
          nutritionService: createUnusedNutritionService(),
        });

        const response = await app.inject({
          method: "POST",
          url: "/api/menu-plans/2026-01-05/days/2/meals/lunch/recipe-detail",
        });

        expect(response.statusCode).toBe(404);
        await app.close();
      }
    );

    it(
      "does not register the meal-slot routes when only recipeDetailService/feedbackService " +
        "are provided but eatingOutSuggestionService is missing (all three are now required " +
        "together, since registerMealSlotRoutes takes eatingOutSuggestionService as a required " +
        "positional argument alongside recipeDetailService/feedbackService)",
      async () => {
        const app = buildApp({ logger: false });
        registerRoutes(app, {
          profileService: createUnusedProfileService(),
          dailyLogService: createUnusedDailyLogService(),
          nutritionService: createUnusedNutritionService(),
          recipeDetailService: createFakeRecipeDetailService(),
          feedbackService: createFakeFeedbackService(),
        });

        const response = await app.inject({
          method: "POST",
          url: "/api/menu-plans/2026-01-05/days/2/meals/lunch/recipe-detail",
        });

        expect(response.statusCode).toBe(404);
        await app.close();
      }
    );

    it(
      "does not register the meal-slot routes when only one of recipeDetailService/" +
        "feedbackService is provided (all three are required together)",
      async () => {
        const app = buildApp({ logger: false });
        registerRoutes(app, {
          profileService: createUnusedProfileService(),
          dailyLogService: createUnusedDailyLogService(),
          nutritionService: createUnusedNutritionService(),
          recipeDetailService: createFakeRecipeDetailService(),
        });

        const response = await app.inject({
          method: "POST",
          url: "/api/menu-plans/2026-01-05/days/2/meals/lunch/recipe-detail",
        });

        expect(response.statusCode).toBe(404);
        await app.close();
      }
    );
  }
);
