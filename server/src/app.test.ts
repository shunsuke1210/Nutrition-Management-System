import { describe, expect, it } from "vitest";
import { buildApp, registerRoutes } from "./app.js";
import type { NotFoundError, ValidationError } from "./shared/result.js";
import type { GenerationError, MenuPlanService } from "./menu-generation/menu-plan.service.js";
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

describe("registerRoutes (AppRouteDependencies.menuPlanService wiring, task 9.3)", () => {
  it("registers the menu-plan routes when AppRouteDependencies.menuPlanService is provided", async () => {
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

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it(
    "does not register the menu-plan routes (and does not throw) when menuPlanService is " +
      "omitted — matches index.ts's current registerRoutes(app, { profileService, " +
      "dailyLogService, nutritionService }) call, which this task does not modify",
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
});
