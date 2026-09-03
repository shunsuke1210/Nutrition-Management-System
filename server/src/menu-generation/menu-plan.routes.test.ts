import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DayMenu, MealSlot, MealType, VerifiedNutritionValues, WeekMenuPlan } from "@nutrition/shared";
import { buildApp } from "../app.js";
import type { NotFoundError, Result } from "../shared/result.js";
import type { GenerationError, GenerationFailureReason, MenuPlanService } from "./menu-plan.service.js";
import { registerMenuPlanRoutes } from "./menu-plan.routes.js";

/**
 * `MenuPlanController`（`registerMenuPlanRoutes`）の統合テスト
 * （design.md: Domain: Menu Plan Generation > MenuPlanController、
 * Requirements 1.1, 6.1, 7.1, 11.3, 12.1-12.5, 13.1, 13.2）。
 *
 * `nutrition.routes.test.ts` / `daily-log.routes.test.ts` の precedent と同じ規約: 実際の
 * `buildApp()` に、挙動を差し替え可能なフェイクの `MenuPlanService` を渡して本ルートを登録し、
 * `app.inject()` でHTTP境界を実際に通過させて検証する。`MenuPlanService` 自身の
 * オーケストレーション（`menu-plan.service.test.ts` が既に検証済み）はフェイクに差し替える。
 *
 * このタスク（9.3）で最も見落としやすい規約: `weekStartDate` はフォーマット（YYYY-MM-DD）と
 * 実在するカレンダー日付であることに加え、月曜日始まりであることも本Controllerが検証する
 * （design.md #MenuPlanService Service Interface Preconditions: 「Controller層のZod検証を
 * 通過済み」）。"2026-01-06" はカレンダー上有効な日付だが火曜日であり、400として拒否される
 * べきことを明示的に確認する。
 */

const MEAL_TYPES: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack"];

/** 月曜日始まりの有効な週開始日（fixture）。 */
const MONDAY = "2026-01-05";
/** カレンダー上有効だが火曜日（月曜日始まりの規約に違反する）の日付。 */
const TUESDAY = "2026-01-06";

function buildFixtureNutrition(energyKcal: number): VerifiedNutritionValues {
  return {
    energyKcal,
    proteinG: 20,
    fatG: 15,
    carbG: 60,
    fiberG: 3,
    calciumMg: 50,
    ironMg: 1,
    vitaminAUg: 100,
    vitaminDUg: 2,
    vitaminB1Mg: 0.3,
    vitaminB2Mg: 0.3,
    vitaminCMg: 10,
    saltEquivalentG: 1,
  };
}

function buildFixtureMealSlot(dayIndex: number, mealType: MealType): MealSlot {
  return {
    mealType,
    dishName: `Dish-D${dayIndex}-${mealType}`,
    ingredients: [{ foodId: "F001", quantity: 100, unit: "g" }],
    nutrition: buildFixtureNutrition(500),
  };
}

function buildFixtureDayMenu(dayIndex: number, dayDate: string): DayMenu {
  return {
    dayDate,
    dayIndex,
    meals: MEAL_TYPES.map((mealType) => buildFixtureMealSlot(dayIndex, mealType)),
    dayNutrition: buildFixtureNutrition(2000),
    plannedKcal: 2000,
    targetKcal: 1900,
    varianceKcal: 100,
  };
}

function buildFixtureWeekMenuPlan(weekStartDate: string): WeekMenuPlan {
  return {
    weekStartDate,
    generatedAt: "2026-01-05T00:00:00.000Z",
    days: Array.from({ length: 7 }, (_, dayIndex) => buildFixtureDayMenu(dayIndex, weekStartDate)),
  };
}

function buildGenerationError(reason: GenerationFailureReason): GenerationError {
  return { type: "generation_failed", reason, message: `test fixture error for reason "${reason}"` };
}

interface FakeMenuPlanServiceConfig {
  generateWeek?: (weekStartDate: string) => Promise<Result<WeekMenuPlan, GenerationError>>;
  regenerateWeek?: (weekStartDate: string) => Promise<Result<WeekMenuPlan, GenerationError>>;
  regenerateDay?: (
    weekStartDate: string,
    dayIndex: number
  ) => Promise<Result<DayMenu, GenerationError | NotFoundError>>;
  getActivePlan?: (weekStartDate: string) => WeekMenuPlan | null;
}

/**
 * `MenuPlanService` の唯一の依存を差し替えるための、挙動を変更可能なフェイク
 * （`nutrition.routes.test.ts` の `createFakeNutritionService` と同じ規約）。各メソッドに
 * 渡された引数を記録し、`config` に対応する関数が渡されていないメソッドが意図せず呼び出された
 * 場合は例外を送出する（Zod検証で400になるべきリクエストがサービスまで到達していないことを
 * 検証できるようにするため）。
 */
function createFakeMenuPlanService(config: FakeMenuPlanServiceConfig = {}): MenuPlanService & {
  receivedGenerateWeek: string[];
  receivedRegenerateWeek: string[];
  receivedRegenerateDay: { weekStartDate: string; dayIndex: number }[];
  receivedGetActivePlan: string[];
} {
  const receivedGenerateWeek: string[] = [];
  const receivedRegenerateWeek: string[] = [];
  const receivedRegenerateDay: { weekStartDate: string; dayIndex: number }[] = [];
  const receivedGetActivePlan: string[] = [];

  return {
    receivedGenerateWeek,
    receivedRegenerateWeek,
    receivedRegenerateDay,
    receivedGetActivePlan,
    async generateWeek(weekStartDate) {
      receivedGenerateWeek.push(weekStartDate);
      if (!config.generateWeek) {
        throw new Error("generateWeek was not expected to be called in this test");
      }
      return config.generateWeek(weekStartDate);
    },
    async regenerateWeek(weekStartDate) {
      receivedRegenerateWeek.push(weekStartDate);
      if (!config.regenerateWeek) {
        throw new Error("regenerateWeek was not expected to be called in this test");
      }
      return config.regenerateWeek(weekStartDate);
    },
    async regenerateDay(weekStartDate, dayIndex) {
      receivedRegenerateDay.push({ weekStartDate, dayIndex });
      if (!config.regenerateDay) {
        throw new Error("regenerateDay was not expected to be called in this test");
      }
      return config.regenerateDay(weekStartDate, dayIndex);
    },
    getActivePlan(weekStartDate) {
      receivedGetActivePlan.push(weekStartDate);
      if (!config.getActivePlan) {
        throw new Error("getActivePlan was not expected to be called in this test");
      }
      return config.getActivePlan(weekStartDate);
    },
  };
}

/** design.md #MenuPlanService Service Interface。409（前提条件未達・重複要求）へ写像される3つの reason。 */
const CONFLICT_REASONS: readonly GenerationFailureReason[] = [
  "profile_missing",
  "nutrition_unavailable",
  "generation_in_progress",
];

/** 409以外の5つの reason。いずれもClaude APIまたは検証起因の失敗として502へ写像される。 */
const UPSTREAM_FAILURE_REASONS: readonly GenerationFailureReason[] = [
  "schema_validation_failed",
  "food_id_not_found",
  "unit_not_found",
  "claude_refusal",
  "claude_request_failed",
];

const ALL_REASONS: readonly GenerationFailureReason[] = [...CONFLICT_REASONS, ...UPSTREAM_FAILURE_REASONS];

describe("MenuPlanController (menu-plan.routes)", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  describe("weekStartDate validation (月曜日始まり + YYYY-MM-DD + 実在するカレンダー日付)", () => {
    it("POST /api/menu-plans/:weekStartDate/generate with a real-but-non-Monday date (2026-01-06, a Tuesday) returns 400 and never calls the service", async () => {
      const fakeService = createFakeMenuPlanService();
      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, fakeService);

      const response = await app.inject({
        method: "POST",
        url: `/api/menu-plans/${TUESDAY}/generate`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
      expect(body.type).toBe("validation");
      expect(body.fieldErrors.weekStartDate?.length).toBeGreaterThan(0);
      expect(fakeService.receivedGenerateWeek).toEqual([]);
    });

    it("GET /api/menu-plans/:weekStartDate with a real-but-non-Monday date (2026-01-06, a Tuesday) returns 400 and never calls the service", async () => {
      const fakeService = createFakeMenuPlanService();
      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, fakeService);

      const response = await app.inject({ method: "GET", url: `/api/menu-plans/${TUESDAY}` });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
      expect(body.type).toBe("validation");
      expect(body.fieldErrors.weekStartDate?.length).toBeGreaterThan(0);
      expect(fakeService.receivedGetActivePlan).toEqual([]);
    });

    it.each(["2026-13-40", "not-a-date"])(
      "POST /api/menu-plans/:weekStartDate/generate with an invalid date (%s) returns 400 and never calls the service",
      async (invalidDate) => {
        const fakeService = createFakeMenuPlanService();
        app = buildApp({ logger: false });
        registerMenuPlanRoutes(app, fakeService);

        const response = await app.inject({
          method: "POST",
          url: `/api/menu-plans/${invalidDate}/generate`,
        });

        expect(response.statusCode).toBe(400);
        const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
        expect(body.type).toBe("validation");
        expect(body.fieldErrors.weekStartDate?.length).toBeGreaterThan(0);
        expect(fakeService.receivedGenerateWeek).toEqual([]);
      }
    );

    it.each(["2026-13-40", "not-a-date"])(
      "GET /api/menu-plans/:weekStartDate with an invalid date (%s) returns 400 and never calls the service",
      async (invalidDate) => {
        const fakeService = createFakeMenuPlanService();
        app = buildApp({ logger: false });
        registerMenuPlanRoutes(app, fakeService);

        const response = await app.inject({ method: "GET", url: `/api/menu-plans/${invalidDate}` });

        expect(response.statusCode).toBe(400);
        const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
        expect(body.type).toBe("validation");
        expect(body.fieldErrors.weekStartDate?.length).toBeGreaterThan(0);
        expect(fakeService.receivedGetActivePlan).toEqual([]);
      }
    );

    it("POST /api/menu-plans/:weekStartDate/generate with a genuine Monday (2026-01-05) passes validation and reaches the service", async () => {
      const plan = buildFixtureWeekMenuPlan(MONDAY);
      const fakeService = createFakeMenuPlanService({
        generateWeek: async () => ({ ok: true, value: plan }),
      });
      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, fakeService);

      const response = await app.inject({ method: "POST", url: `/api/menu-plans/${MONDAY}/generate` });

      expect(response.statusCode).toBe(200);
      expect(fakeService.receivedGenerateWeek).toEqual([MONDAY]);
    });

    it("POST /api/menu-plans/:weekStartDate/regenerate with a real-but-non-Monday date returns 400 and never calls the service", async () => {
      const fakeService = createFakeMenuPlanService();
      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, fakeService);

      const response = await app.inject({
        method: "POST",
        url: `/api/menu-plans/${TUESDAY}/regenerate`,
      });

      expect(response.statusCode).toBe(400);
      expect(fakeService.receivedRegenerateWeek).toEqual([]);
    });

    it("POST /api/menu-plans/:weekStartDate/days/:dayIndex/regenerate with a real-but-non-Monday date returns 400 and never calls the service", async () => {
      const fakeService = createFakeMenuPlanService();
      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, fakeService);

      const response = await app.inject({
        method: "POST",
        url: `/api/menu-plans/${TUESDAY}/days/3/regenerate`,
      });

      expect(response.statusCode).toBe(400);
      expect(fakeService.receivedRegenerateDay).toEqual([]);
    });
  });

  describe("dayIndex validation (POST /api/menu-plans/:weekStartDate/days/:dayIndex/regenerate)", () => {
    it.each(["abc", "3.5"])("a non-integer dayIndex (%s) returns 400 and never calls the service", async (dayIndex) => {
      const fakeService = createFakeMenuPlanService();
      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, fakeService);

      const response = await app.inject({
        method: "POST",
        url: `/api/menu-plans/${MONDAY}/days/${dayIndex}/regenerate`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
      expect(body.type).toBe("validation");
      expect(body.fieldErrors.dayIndex?.length).toBeGreaterThan(0);
      expect(fakeService.receivedRegenerateDay).toEqual([]);
    });

    it.each(["-1", "7"])("an out-of-range dayIndex (%s) returns 400 and never calls the service", async (dayIndex) => {
      const fakeService = createFakeMenuPlanService();
      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, fakeService);

      const response = await app.inject({
        method: "POST",
        url: `/api/menu-plans/${MONDAY}/days/${dayIndex}/regenerate`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
      expect(body.type).toBe("validation");
      expect(body.fieldErrors.dayIndex?.length).toBeGreaterThan(0);
      expect(fakeService.receivedRegenerateDay).toEqual([]);
    });

    it.each([0, 3, 6])("a valid dayIndex (%i) passes validation and reaches the service", async (dayIndex) => {
      const day = buildFixtureDayMenu(dayIndex, MONDAY);
      const fakeService = createFakeMenuPlanService({
        regenerateDay: async () => ({ ok: true, value: day }),
      });
      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, fakeService);

      const response = await app.inject({
        method: "POST",
        url: `/api/menu-plans/${MONDAY}/days/${dayIndex}/regenerate`,
      });

      expect(response.statusCode).toBe(200);
      expect(fakeService.receivedRegenerateDay).toEqual([{ weekStartDate: MONDAY, dayIndex }]);
    });
  });

  describe("GenerationFailureReason → status code mapping (POST .../generate)", () => {
    it.each(ALL_REASONS)(
      'reason "%s" maps to the correct status code',
      async (reason) => {
        const error = buildGenerationError(reason);
        const fakeService = createFakeMenuPlanService({
          generateWeek: async () => ({ ok: false, error }),
        });
        app = buildApp({ logger: false });
        registerMenuPlanRoutes(app, fakeService);

        const response = await app.inject({ method: "POST", url: `/api/menu-plans/${MONDAY}/generate` });

        const expectedStatus = CONFLICT_REASONS.includes(reason) ? 409 : 502;
        expect(response.statusCode).toBe(expectedStatus);
        expect(response.json()).toEqual(error);
      }
    );
  });

  describe("GenerationFailureReason → status code mapping (POST .../regenerate, proving the mapping is not generate-specific)", () => {
    it.each(["profile_missing", "claude_refusal"] as const)(
      'reason "%s" maps to the correct status code',
      async (reason) => {
        const error = buildGenerationError(reason);
        const fakeService = createFakeMenuPlanService({
          regenerateWeek: async () => ({ ok: false, error }),
        });
        app = buildApp({ logger: false });
        registerMenuPlanRoutes(app, fakeService);

        const response = await app.inject({ method: "POST", url: `/api/menu-plans/${MONDAY}/regenerate` });

        const expectedStatus = CONFLICT_REASONS.includes(reason) ? 409 : 502;
        expect(response.statusCode).toBe(expectedStatus);
        expect(response.json()).toEqual(error);
      }
    );
  });

  describe("GenerationFailureReason → status code mapping (POST .../days/:dayIndex/regenerate, proving the mapping is not route-specific)", () => {
    it.each(["generation_in_progress", "unit_not_found"] as const)(
      'reason "%s" maps to the correct status code',
      async (reason) => {
        const error = buildGenerationError(reason);
        const fakeService = createFakeMenuPlanService({
          regenerateDay: async () => ({ ok: false, error }),
        });
        app = buildApp({ logger: false });
        registerMenuPlanRoutes(app, fakeService);

        const response = await app.inject({
          method: "POST",
          url: `/api/menu-plans/${MONDAY}/days/2/regenerate`,
        });

        const expectedStatus = CONFLICT_REASONS.includes(reason) ? 409 : 502;
        expect(response.statusCode).toBe(expectedStatus);
        expect(response.json()).toEqual(error);
      }
    );
  });

  describe("NotFoundError from regenerateDay (Req 7.4, design.md NotFoundError branch)", () => {
    it("returns 404 with the shape produced by app.ts's existing common error handler", async () => {
      const notFound: NotFoundError = {
        type: "not_found",
        message: `対象週（${MONDAY}）の有効な週間献立プランが見つかりません。`,
      };
      const fakeService = createFakeMenuPlanService({
        regenerateDay: async () => ({ ok: false, error: notFound }),
      });
      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, fakeService);

      const response = await app.inject({
        method: "POST",
        url: `/api/menu-plans/${MONDAY}/days/2/regenerate`,
      });

      expect(response.statusCode).toBe(404);
      // app.ts's setErrorHandler builds { type: "not_found", message } from the thrown error
      // (see app.ts isNotFoundError branch) — confirm the route's `throw` reaches it unmodified.
      expect(response.json()).toEqual({ type: "not_found", message: notFound.message });
    });
  });

  describe("success paths (200 + the service's value, spot-checked)", () => {
    it("POST /api/menu-plans/:weekStartDate/generate returns 200 with the WeekMenuPlan", async () => {
      const plan = buildFixtureWeekMenuPlan(MONDAY);
      const fakeService = createFakeMenuPlanService({
        generateWeek: async () => ({ ok: true, value: plan }),
      });
      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, fakeService);

      const response = await app.inject({ method: "POST", url: `/api/menu-plans/${MONDAY}/generate` });

      expect(response.statusCode).toBe(200);
      const body = response.json() as WeekMenuPlan;
      expect(body.weekStartDate).toBe(MONDAY);
      expect(body.days).toHaveLength(7);
    });

    it("POST /api/menu-plans/:weekStartDate/regenerate returns 200 with the WeekMenuPlan", async () => {
      const plan = buildFixtureWeekMenuPlan(MONDAY);
      const fakeService = createFakeMenuPlanService({
        regenerateWeek: async () => ({ ok: true, value: plan }),
      });
      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, fakeService);

      const response = await app.inject({ method: "POST", url: `/api/menu-plans/${MONDAY}/regenerate` });

      expect(response.statusCode).toBe(200);
      const body = response.json() as WeekMenuPlan;
      expect(body.weekStartDate).toBe(MONDAY);
      expect(body.days).toHaveLength(7);
    });

    it("POST /api/menu-plans/:weekStartDate/days/:dayIndex/regenerate returns 200 with the DayMenu", async () => {
      const day = buildFixtureDayMenu(2, MONDAY);
      const fakeService = createFakeMenuPlanService({
        regenerateDay: async () => ({ ok: true, value: day }),
      });
      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, fakeService);

      const response = await app.inject({
        method: "POST",
        url: `/api/menu-plans/${MONDAY}/days/2/regenerate`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as DayMenu;
      expect(body.dayIndex).toBe(2);
      expect(body.meals).toHaveLength(4);
    });

    it("GET /api/menu-plans/:weekStartDate returns 200 with the WeekMenuPlan when an active plan exists", async () => {
      const plan = buildFixtureWeekMenuPlan(MONDAY);
      const fakeService = createFakeMenuPlanService({
        getActivePlan: () => plan,
      });
      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, fakeService);

      const response = await app.inject({ method: "GET", url: `/api/menu-plans/${MONDAY}` });

      expect(response.statusCode).toBe(200);
      const body = response.json() as WeekMenuPlan;
      expect(body.weekStartDate).toBe(MONDAY);
      expect(body.days).toHaveLength(7);
      expect(fakeService.receivedGetActivePlan).toEqual([MONDAY]);
    });
  });

  describe("GET /api/menu-plans/:weekStartDate with no active plan (Req 11.3, design.md null-tolerant contract)", () => {
    it("returns 200 with a null body, NOT 404 (distinct from regenerateDay's 404-on-missing-plan behavior)", async () => {
      const fakeService = createFakeMenuPlanService({
        getActivePlan: () => null,
      });
      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, fakeService);

      const response = await app.inject({ method: "GET", url: `/api/menu-plans/${MONDAY}` });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toBeNull();
      expect(fakeService.receivedGetActivePlan).toEqual([MONDAY]);
    });
  });

  describe("single-user operation (Req 13.1, 13.2)", () => {
    it("does not require any Authorization header or cookie for the request to succeed", async () => {
      const plan = buildFixtureWeekMenuPlan(MONDAY);
      const fakeService = createFakeMenuPlanService({
        generateWeek: async () => ({ ok: true, value: plan }),
      });
      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, fakeService);

      const response = await app.inject({ method: "POST", url: `/api/menu-plans/${MONDAY}/generate` });

      expect(response.statusCode).toBe(200);
    });
  });
});
