import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { CalculationUnavailableError, DietInsights, NutritionSummary } from "@nutrition/shared";
import { buildApp } from "../app.js";
import type { Result } from "../shared/result.js";
import type { NutritionService } from "./nutrition.service.js";
import { registerNutritionRoutes } from "./nutrition.routes.js";

/**
 * `NutritionController`（`registerNutritionRoutes`）の統合テスト
 * （design.md: Domain: Nutrition Calculation > NutritionController、
 * Requirements 12.1, 12.2, 13.1, 13.2, 13.3, 13.4）。
 *
 * `buildApp()` から得た実際のFastifyインスタンスに、フェイクの `NutritionService`
 * （挙動をテストごとに差し替え可能）を渡して本ルートを登録し、`app.inject()` で
 * HTTP境界を実際に通過させることで検証する（`profile.routes.test.ts` の task 2.3
 * precedent と同じ規約）。実DBを裏付けとした統合（`ProfileGateway` / `DailyLogGateway`
 * 経由の実データ）は後続タスクの対象であり、本タスクでは `NutritionService` 自体は
 * フェイクに差し替える。
 *
 * 本テストファイル自身がこのタスク専用の登録用エントリポイントであり、
 * `server/src/app.ts` / `server/src/index.ts` 自体は変更しない（task 4.1 の境界）。
 */

function buildNutritionSummary(date: string): NutritionSummary {
  return {
    computedAt: "2026-08-20T00:00:00.000Z",
    bmr: 1648.75,
    activityCoefficient: 1.2,
    activityLevelLabel: "かなり運動不足",
    tdee: 1978.5,
    dailyExpenditure: { date, value: 1978.5 },
    normalMode: {
      calorieTarget: 1978.5,
      pfcRatio: { proteinPct: 0.2, fatPct: 0.25, carbPct: 0.55 },
      pfc: {
        proteinG: 98.925,
        fatG: 54.9583,
        carbG: 272.03,
        proteinKcal: 395.7,
        fatKcal: 494.625,
        carbKcal: 1088.175,
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
}

/** design.md DietInsightsCalculator Service Interface通りの `DietInsights` 値のフィクスチャ。
 * `/api/nutrition/diet-insights` の200レスポンスがフェイクサービスの返す値をそのまま
 * 透過することを検証するためのサンプル値であり、個々のフィールドの算出ロジック自体は
 * `DietInsightsCalculator`（task 6.3）のユニットテストの対象であって本ファイルでは検証しない。 */
function buildDietInsights(): DietInsights {
  return {
    weightHistory: [
      { date: "2026-07-01", weightKg: 70.0 },
      { date: "2026-08-01", weightKg: 68.5 },
    ],
    weightProjection: [
      { date: "2026-08-08", projectedWeightKg: 68.2 },
      { date: "2026-08-15", projectedWeightKg: 67.9 },
    ],
    goalEta: { available: true, weeklyProgressKg: 0.3, estimatedWeeksToGoal: 10 },
    plateau: { status: "on_track" },
    exerciseSimulation: {
      available: true,
      scenarioLabel: "週3回・30分の運動を追加",
      dietOnlyWeeksToGoal: 10,
      dietPlusExerciseWeeksToGoal: 8,
    },
  };
}

/** `NutritionService` の唯一の依存を差し替えるための、挙動を変更可能なフェイク。
 * `getSummary` / `getDietInsights` それぞれに渡された日付を記録し、日付の受け渡し
 * （クエリ省略時の当日デフォルトを含む）が正しいことを検証できるようにする。
 * `dietInsightsResultForDate` は省略可能（`/summary` 専用のテストでは使用しないため）。
 * 省略時に `getDietInsights` が呼び出された場合は、意図しない呼び出しを検知できるよう
 * 例外を送出する。 */
function createFakeNutritionService(
  resultForDate: (date: string) => Result<NutritionSummary, CalculationUnavailableError>,
  dietInsightsResultForDate?: (date: string) => Result<DietInsights, CalculationUnavailableError>
): NutritionService & { receivedDates: string[]; receivedDietInsightsDates: string[] } {
  const receivedDates: string[] = [];
  const receivedDietInsightsDates: string[] = [];
  return {
    receivedDates,
    receivedDietInsightsDates,
    getSummary(date) {
      receivedDates.push(date);
      return resultForDate(date);
    },
    getDietInsights(date) {
      receivedDietInsightsDates.push(date);
      if (!dietInsightsResultForDate) {
        throw new Error(
          "getDietInsights was not expected to be called in this test (no dietInsightsResultForDate provided)"
        );
      }
      return dietInsightsResultForDate(date);
    },
  };
}

describe("NutritionController (nutrition.routes)", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
  });

  it("GET /api/nutrition/summary?date=2026-08-20 returns 200 with the NutritionSummary from the service (Req 13.1, 13.2)", async () => {
    const summary = buildNutritionSummary("2026-08-20");
    const fakeService = createFakeNutritionService(() => ({ ok: true, value: summary }));
    app = buildApp({ logger: false });
    registerNutritionRoutes(app, fakeService);

    const response = await app.inject({
      method: "GET",
      url: "/api/nutrition/summary?date=2026-08-20",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(summary);
    expect(fakeService.receivedDates).toEqual(["2026-08-20"]);
  });

  it(
    "GET /api/nutrition/summary without a date query param defaults to today's actual local " +
      "date (省略時は当日日付, design.md API Contract)",
    async () => {
      vi.useFakeTimers();
      // ローカルの日付コンストラクタで固定することで、実行環境のタイムゾーンに関わらず
      // 「今日の暦日」が一意に定まるようにする（UTCとローカルの境界時刻を避けるため正午に固定）。
      vi.setSystemTime(new Date(2026, 7, 26, 12, 0, 0));
      const expectedToday = "2026-08-26";

      const summary = buildNutritionSummary(expectedToday);
      const fakeService = createFakeNutritionService(() => ({ ok: true, value: summary }));
      app = buildApp({ logger: false });
      registerNutritionRoutes(app, fakeService);

      const response = await app.inject({ method: "GET", url: "/api/nutrition/summary" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(summary);
      expect(fakeService.receivedDates).toEqual([expectedToday]);
    }
  );

  it("GET /api/nutrition/summary?date=2026/01/01 (slash-separated, invalid format) returns 400 with a validation error body", async () => {
    const fakeService = createFakeNutritionService(() => ({
      ok: true,
      value: buildNutritionSummary("2026-08-20"),
    }));
    app = buildApp({ logger: false });
    registerNutritionRoutes(app, fakeService);

    const response = await app.inject({
      method: "GET",
      url: "/api/nutrition/summary",
      query: { date: "2026/01/01" },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
    expect(body.type).toBe("validation");
    expect(body.fieldErrors.date?.length).toBeGreaterThan(0);
    expect(fakeService.receivedDates).toEqual([]);
  });

  it("GET /api/nutrition/summary?date=not-a-date returns 400 with a validation error body", async () => {
    const fakeService = createFakeNutritionService(() => ({
      ok: true,
      value: buildNutritionSummary("2026-08-20"),
    }));
    app = buildApp({ logger: false });
    registerNutritionRoutes(app, fakeService);

    const response = await app.inject({
      method: "GET",
      url: "/api/nutrition/summary",
      query: { date: "not-a-date" },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
    expect(body.type).toBe("validation");
    expect(body.fieldErrors.date?.length).toBeGreaterThan(0);
    expect(fakeService.receivedDates).toEqual([]);
  });

  it("returns 409 with the CalculationUnavailableError body when the service reports profile_missing (Req 12.1)", async () => {
    const error: CalculationUnavailableError = {
      type: "calculation_unavailable",
      reason: "profile_missing",
      message: "プロフィールが未登録のため、栄養目標値を算出できません。",
    };
    const fakeService = createFakeNutritionService(() => ({ ok: false, error }));
    app = buildApp({ logger: false });
    registerNutritionRoutes(app, fakeService);

    const response = await app.inject({
      method: "GET",
      url: "/api/nutrition/summary?date=2026-08-20",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual(error);
    expect((response.json() as CalculationUnavailableError).reason).toBe("profile_missing");
  });

  it("returns 409 with the CalculationUnavailableError body when the service reports incomplete_diet_mode_data (Req 12.2)", async () => {
    const error: CalculationUnavailableError = {
      type: "calculation_unavailable",
      reason: "incomplete_diet_mode_data",
      message: "ダイエットモードが有効ですが、目標体重または目標達成期間が未設定です。",
    };
    const fakeService = createFakeNutritionService(() => ({ ok: false, error }));
    app = buildApp({ logger: false });
    registerNutritionRoutes(app, fakeService);

    const response = await app.inject({
      method: "GET",
      url: "/api/nutrition/summary?date=2026-08-20",
    });

    expect(response.statusCode).toBe(409);
    const body = response.json() as CalculationUnavailableError;
    expect(body.reason).toBe("incomplete_diet_mode_data");
  });

  it("does not require any Authorization header or cookie for the request to succeed (Req 13.3)", async () => {
    // No auth header/cookie is ever set in any request across this file, and every request
    // above succeeds when the input itself is valid — this test makes that assertion explicit,
    // mirroring profile.routes.test.ts's established pattern for the same requirement family.
    const summary = buildNutritionSummary("2026-08-20");
    const fakeService = createFakeNutritionService(() => ({ ok: true, value: summary }));
    app = buildApp({ logger: false });
    registerNutritionRoutes(app, fakeService);

    const response = await app.inject({
      method: "GET",
      url: "/api/nutrition/summary?date=2026-08-20",
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("NutritionController (nutrition.routes) - GET /api/nutrition/diet-insights", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
  });

  it("GET /api/nutrition/diet-insights?date=2026-08-20 returns 200 with the DietInsights from the service (Req 14.6)", async () => {
    const insights = buildDietInsights();
    const fakeService = createFakeNutritionService(
      () => ({ ok: true, value: {} as NutritionSummary }),
      () => ({ ok: true, value: insights })
    );
    app = buildApp({ logger: false });
    registerNutritionRoutes(app, fakeService);

    const response = await app.inject({
      method: "GET",
      url: "/api/nutrition/diet-insights?date=2026-08-20",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(insights);
    expect(fakeService.receivedDietInsightsDates).toEqual(["2026-08-20"]);
  });

  it(
    "GET /api/nutrition/diet-insights without a date query param defaults to today's actual " +
      "local date (省略時は当日日付, design.md API Contract)",
    async () => {
      vi.useFakeTimers();
      // ローカルの日付コンストラクタで固定することで、実行環境のタイムゾーンに関わらず
      // 「今日の暦日」が一意に定まるようにする（UTCとローカルの境界時刻を避けるため正午に固定）。
      vi.setSystemTime(new Date(2026, 7, 26, 12, 0, 0));
      const expectedToday = "2026-08-26";

      const insights = buildDietInsights();
      const fakeService = createFakeNutritionService(
        () => ({ ok: true, value: {} as NutritionSummary }),
        () => ({ ok: true, value: insights })
      );
      app = buildApp({ logger: false });
      registerNutritionRoutes(app, fakeService);

      const response = await app.inject({ method: "GET", url: "/api/nutrition/diet-insights" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(insights);
      expect(fakeService.receivedDietInsightsDates).toEqual([expectedToday]);
    }
  );

  it("GET /api/nutrition/diet-insights?date=not-a-date returns 400 with a validation error body", async () => {
    const fakeService = createFakeNutritionService(
      () => ({ ok: true, value: {} as NutritionSummary }),
      () => ({ ok: true, value: buildDietInsights() })
    );
    app = buildApp({ logger: false });
    registerNutritionRoutes(app, fakeService);

    const response = await app.inject({
      method: "GET",
      url: "/api/nutrition/diet-insights",
      query: { date: "not-a-date" },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
    expect(body.type).toBe("validation");
    expect(body.fieldErrors.date?.length).toBeGreaterThan(0);
    expect(fakeService.receivedDietInsightsDates).toEqual([]);
  });

  it("GET /api/nutrition/diet-insights?date=2026/01/01 (slash-separated, invalid format) returns 400 with a validation error body", async () => {
    const fakeService = createFakeNutritionService(
      () => ({ ok: true, value: {} as NutritionSummary }),
      () => ({ ok: true, value: buildDietInsights() })
    );
    app = buildApp({ logger: false });
    registerNutritionRoutes(app, fakeService);

    const response = await app.inject({
      method: "GET",
      url: "/api/nutrition/diet-insights",
      query: { date: "2026/01/01" },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
    expect(body.type).toBe("validation");
    expect(body.fieldErrors.date?.length).toBeGreaterThan(0);
    expect(fakeService.receivedDietInsightsDates).toEqual([]);
  });

  it("returns 409 with the CalculationUnavailableError body when the service reports profile_missing (Req 12.1)", async () => {
    const error: CalculationUnavailableError = {
      type: "calculation_unavailable",
      reason: "profile_missing",
      message: "プロフィールが未登録のため、ダイエットインサイトを算出できません。先にプロフィールを登録してください。",
    };
    const fakeService = createFakeNutritionService(
      () => ({ ok: true, value: {} as NutritionSummary }),
      () => ({ ok: false, error })
    );
    app = buildApp({ logger: false });
    registerNutritionRoutes(app, fakeService);

    const response = await app.inject({
      method: "GET",
      url: "/api/nutrition/diet-insights?date=2026-08-20",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual(error);
    expect((response.json() as CalculationUnavailableError).reason).toBe("profile_missing");
  });

  it("returns 409 with the CalculationUnavailableError body when the service reports diet_mode_disabled (Req 14.2)", async () => {
    const error: CalculationUnavailableError = {
      type: "calculation_unavailable",
      reason: "diet_mode_disabled",
      message: "ダイエットモードが無効なため、ダイエットインサイトを算出できません。ダイエットモードを有効にしてください。",
    };
    const fakeService = createFakeNutritionService(
      () => ({ ok: true, value: {} as NutritionSummary }),
      () => ({ ok: false, error })
    );
    app = buildApp({ logger: false });
    registerNutritionRoutes(app, fakeService);

    const response = await app.inject({
      method: "GET",
      url: "/api/nutrition/diet-insights?date=2026-08-20",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual(error);
    expect((response.json() as CalculationUnavailableError).reason).toBe("diet_mode_disabled");
  });

  it("does not require any Authorization header or cookie for the request to succeed (Req 13.3)", async () => {
    const insights = buildDietInsights();
    const fakeService = createFakeNutritionService(
      () => ({ ok: true, value: {} as NutritionSummary }),
      () => ({ ok: true, value: insights })
    );
    app = buildApp({ logger: false });
    registerNutritionRoutes(app, fakeService);

    const response = await app.inject({
      method: "GET",
      url: "/api/nutrition/diet-insights?date=2026-08-20",
    });

    expect(response.statusCode).toBe(200);
  });
});
