import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { CalculationUnavailableError, DietInsights, ProfileInput } from "@nutrition/shared";
import { buildApp } from "../app.js";
import { createConnection } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { createProfileRepository, type ProfileRepository } from "../profile/profile.repository.js";
import { createProfileService, type ProfileService } from "../profile/profile.service.js";
import { createDailyLogRepository } from "../daily-log/daily-log.repository.js";
import { createDailyLogService } from "../daily-log/daily-log.service.js";
import { createProfileGateway } from "./profile.gateway.js";
import { createDailyLogGateway, type DailyLogGateway, type WeightLogPoint } from "./daily-log.gateway.js";
import { createNutritionService } from "./nutrition.service.js";
import { registerNutritionRoutes } from "./nutrition.routes.js";

/**
 * `GET /api/nutrition/diet-insights` の統合テスト（task 7.2）。
 *
 * 本ファイルはタスクの2つの検証項目それぞれに異なる技法を使う、意図的なハイブリッド構成:
 *
 * 1つ目のdescribeブロック（プロフィール未登録/ダイエットモード無効/ダイエットモード目標欠落の
 * 3つの409シナリオ）は、`nutrition.summary.integration.test.ts`（task 5.4）と全く同じ「フェイク
 * 一切なしの実チェーン」（実一時SQLite + 実Repository→実Service→実Gateway→実NutritionService +
 * 実`buildApp()`/ルート登録 + `app.inject()`）を踏襲する。`incomplete_diet_mode_data` の構築には
 * 5.4がレビュー済みで承認した「`profileRepository.upsert(...)` を直接呼び出すことで
 * `ProfileService.saveProfile` のZod検証（`ProfileInputSchema.superRefine`）を経由せず、
 * 本来到達不能な整合性違反状態を作る」技法をそのまま再利用する（同一の理由: `NutritionService`
 * 側の防御的チェックは通常のPUT経路では到達できない状態に対する保険であり、それを実際に検証
 * するにはこの技法以外に手段がない）。
 *
 * 2つ目のdescribeブロック（「順調な減少」「停滞」「データ不足」の3つの体重ログパターン）は、
 * タスク本文が明示する「体重ログをモック化した」という指示に従い、`DailyLogGateway` という
 * 最も狭い境界だけをフェイクに置き換える。プロフィール側（`ProfileGateway`→実`ProfileService`→
 * 実`ProfileRepository`→実DB）は実チェーンのままとし、`NutritionService.getDietInsights` →
 * `DietInsightsCalculator.calculate` の実装自体は一切モック化しない。これにより
 * 「実際の配線が、コントロールされた体重ログ入力を正しいHTTPレスポンス形状まで通す」ことを
 * 実際に証明できる（`NutritionService`/`DietInsightsCalculator`自体を丸ごとフェイクにする
 * `nutrition.routes.test.ts`のアプローチでは、この配線自体は検証できない）。
 *
 * 3つの体重ログパターンの期待値は、`diet-insights.calculator.test.ts`（tasks 6.3/7.1）が
 * 既に手計算で検証済みのフィクスチャ（on_track/plateaured/データ不足の各ケース）をそのまま
 * 再利用する。新たな回帰計算を本ファイルで導出せず、既に承認済みの数値との整合性を保つことで
 * リスクを下げる（本ファイルの目的は回帰計算そのものの正しさの再検証ではなく、実際の
 * HTTPレスポンスにその数値が正しく反映されることの検証であるため）。
 */

function buildValidProfileInput(overrides: Partial<ProfileInput> = {}): ProfileInput {
  return {
    heightCm: 170,
    weightKg: 65,
    age: 30,
    gender: "male",
    bodyFatPct: null,
    medicalNotes: null,
    pregnancyStatus: "none",
    sleepHours: 7,
    alcoholHabit: "occasional",
    smokingHabit: "non_smoker",
    cookingSkill: null,
    cookingTimePreference: null,
    budgetPreference: null,
    jobActivityLevel: "mixed",
    commuteMethod: "transit",
    averageDailySteps: 6000,
    exerciseRoutine: [],
    ngIngredients: [],
    preferredIngredients: [],
    restrictionType: "none",
    restrictionIntensity: null,
    restrictionNotes: null,
    dietModeEnabled: false,
    goalWeightKg: null,
    goalPeriodWeeks: null,
    ...overrides,
  };
}

describe(
  "GET /api/nutrition/diet-insights integration - error scenarios " +
    "(real user-profile + nutrition-engine chain, no mocks, mirrors task 5.4)",
  () => {
    let tmpDir: string;
    let db: Database.Database;
    let app: FastifyInstance;
    let profileRepository: ProfileRepository;
    let profileService: ProfileService;

    beforeEach(() => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), "diet-insights-integration-test-"));
      const dbPath = path.join(tmpDir, "test.db");
      db = createConnection(dbPath);
      runMigrations(db);

      // design.md「栄養目標値の算出フロー」/ `server/src/index.ts`(`startServer`) と同じ
      // 構築順序: Repository → Service → Gateway → NutritionService。
      profileRepository = createProfileRepository(db);
      profileService = createProfileService(profileRepository);
      const dailyLogRepository = createDailyLogRepository(db);
      const dailyLogService = createDailyLogService(dailyLogRepository);

      const profileGateway = createProfileGateway(profileService);
      const dailyLogGateway = createDailyLogGateway(dailyLogService);
      const nutritionService = createNutritionService(profileGateway, dailyLogGateway);

      app = buildApp({ logger: false });
      registerNutritionRoutes(app, nutritionService);
    });

    afterEach(async () => {
      await app.close();
      db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns 409 profile_missing when no profile has been saved yet (Req 12.1, 14.2)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/nutrition/diet-insights?date=2026-08-20",
      });

      expect(response.statusCode).toBe(409);
      const body = response.json() as CalculationUnavailableError;
      expect(body.type).toBe("calculation_unavailable");
      expect(body.reason).toBe("profile_missing");
    });

    it("returns 409 diet_mode_disabled when a profile exists but dietModeEnabled is false (Req 14.2)", async () => {
      const saveResult = profileService.saveProfile(
        buildValidProfileInput({
          dietModeEnabled: false,
          goalWeightKg: null,
          goalPeriodWeeks: null,
        })
      );
      expect(saveResult.ok).toBe(true);

      const response = await app.inject({
        method: "GET",
        url: "/api/nutrition/diet-insights?date=2026-08-20",
      });

      expect(response.statusCode).toBe(409);
      const body = response.json() as CalculationUnavailableError;
      expect(body.type).toBe("calculation_unavailable");
      expect(body.reason).toBe("diet_mode_disabled");
    });

    it(
      "returns 409 incomplete_diet_mode_data when dietModeEnabled is true but goalWeightKg is " +
        "missing (Req 12.2, 14.2)",
      async () => {
        // ProfileInputSchema.superRefine (shared/src/profile.schema.ts) requires goalWeightKg AND
        // goalPeriodWeeks whenever dietModeEnabled is true, so ProfileService.saveProfile (the
        // normal PUT /api/profile path) can never persist this "dietModeEnabled but goal data
        // incomplete" combination. NutritionService.getDietInsights's incomplete_diet_mode_data
        // check (design.md #NutritionService, Requirement 14.2) exists as a DEFENSIVE check
        // against exactly this inconsistent-by-construction state, independent of user-profile's
        // own input validation. To prove that defensive check actually fires, this test
        // constructs the inconsistent state directly via ProfileRepository.upsert (bypassing
        // ProfileService.saveProfile's Zod validation entirely) -- this is the same technique
        // task 5.4 used (and had reviewed/approved) for the analogous incomplete_diet_mode_data
        // scenario on GET /api/nutrition/summary.
        profileRepository.upsert(
          buildValidProfileInput({
            dietModeEnabled: true,
            goalWeightKg: null,
            goalPeriodWeeks: 12,
          })
        );

        const response = await app.inject({
          method: "GET",
          url: "/api/nutrition/diet-insights?date=2026-08-20",
        });

        expect(response.statusCode).toBe(409);
        const body = response.json() as CalculationUnavailableError;
        expect(body.type).toBe("calculation_unavailable");
        expect(body.reason).toBe("incomplete_diet_mode_data");
      }
    );
  }
);

/**
 * `NutritionService`唯一の`DailyLogGateway`依存だけを差し替える、挙動を固定したフェイク。
 * `getWeightLogsInRange`は引数（`from`/`to`）に関わらず常に`weightLogs`をそのまま返す
 * （範囲計算自体は`nutrition.service.test.ts`のユニットテストで既に検証済みのため、本ファイルは
 * その結果として「渡された体重ログがどう扱われるか」だけをコントロールする）。
 * `getDietInsights`は`getExerciseEntriesForDate`を呼び出さないため、呼ばれたら失敗させる
 * （`daily-log.gateway.test.ts`のフェイク`DailyLogService`と同じ「未使用メソッドは例外」規約）。
 */
function createFakeWeightLogDailyLogGateway(weightLogs: WeightLogPoint[]): DailyLogGateway {
  return {
    getExerciseEntriesForDate: () => {
      throw new Error(
        "createFakeWeightLogDailyLogGateway: getExerciseEntriesForDate was not expected to be " +
          "called by NutritionService.getDietInsights"
      );
    },
    getWeightLogsInRange: () => weightLogs,
  };
}

describe(
  "GET /api/nutrition/diet-insights integration - weight-log-mocked scenarios " +
    "(real profile chain + real NutritionService/DietInsightsCalculator, only the weight-log " +
    "source faked at the DailyLogGateway seam)",
  () => {
    let tmpDir: string;
    let db: Database.Database;
    let profileService: ProfileService;
    let app: FastifyInstance | undefined;

    beforeEach(() => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), "diet-insights-integration-mocked-test-"));
      const dbPath = path.join(tmpDir, "test.db");
      db = createConnection(dbPath);
      runMigrations(db);

      // プロフィール側は実チェーン（実Repository→実Service→実Gateway）のまま。
      const profileRepository = createProfileRepository(db);
      profileService = createProfileService(profileRepository);
      app = undefined;
    });

    afterEach(async () => {
      if (app) {
        await app.close();
      }
      db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    /**
     * 実`ProfileGateway`（渡された`profileService`に依存）と、`weightLogs`を固定で返す
     * フェイク`DailyLogGateway`だけを組み合わせて、実`NutritionService`/実`buildApp()`/
     * 実ルート登録を配線する。`NutritionService.getDietInsights`自体・
     * `DietInsightsCalculator.calculate`自体はいずれもフェイクにしない。
     */
    function buildAppWithFakeWeightLogs(weightLogs: WeightLogPoint[]): FastifyInstance {
      const profileGateway = createProfileGateway(profileService);
      const fakeDailyLogGateway = createFakeWeightLogDailyLogGateway(weightLogs);
      const nutritionService = createNutritionService(profileGateway, fakeDailyLogGateway);

      const builtApp = buildApp({ logger: false });
      registerNutritionRoutes(builtApp, nutritionService);
      return builtApp;
    }

    it(
      "「順調な減少」(on_track): mirrors diet-insights.calculator.test.ts's hand-verified " +
        "on_track fixture, threaded through the real route -> NutritionService -> " +
        "DietInsightsCalculator chain with only the weight-log source faked (Req 14.1, 14.5, 14.6)",
      async () => {
        // diet-insights.calculator.test.ts「減量方向・順調（on_track）」ケースのフィクスチャを
        // そのまま再利用する: currentWeightKg=88, goalWeightKg=70, asOfDate=2026-01-15。
        const saveResult = profileService.saveProfile(
          buildValidProfileInput({
            weightKg: 88,
            dietModeEnabled: true,
            goalWeightKg: 70,
            goalPeriodWeeks: 12,
          })
        );
        expect(saveResult.ok).toBe(true);

        const weightLogs: WeightLogPoint[] = [
          { date: "2026-01-01", weightKg: 80 },
          { date: "2026-01-08", weightKg: null },
          { date: "2026-01-15", weightKg: 78 },
        ];
        app = buildAppWithFakeWeightLogs(weightLogs);

        const response = await app.inject({
          method: "GET",
          url: "/api/nutrition/diet-insights?date=2026-01-15",
        });

        expect(response.statusCode).toBe(200);
        const body = response.json() as DietInsights;

        // 14.6: 実測推移(weightHistory)と将来予測(weightProjection)が別配列で区別されている。
        // null記録(2026-01-08)は除外される。
        expect(body.weightHistory).toEqual([
          { date: "2026-01-01", weightKg: 80 },
          { date: "2026-01-15", weightKg: 78 },
        ]);

        // 15.1: directionSign=+1, weeklyProgressKg=1, estimatedWeeksToGoal=|88-70|/1=18
        expect(body.goalEta).toEqual({
          available: true,
          weeklyProgressKg: 1,
          estimatedWeeksToGoal: 18,
        });

        // 14.4: 直近記録日(2026-01-15)起点に4週分、weeklyRateOfChangeKg(-1)を累積加算
        expect(body.weightProjection).toEqual([
          { date: "2026-01-22", projectedWeightKg: 77 },
          { date: "2026-01-29", projectedWeightKg: 76 },
          { date: "2026-02-05", projectedWeightKg: 75 },
          { date: "2026-02-12", projectedWeightKg: 74 },
        ]);

        // 16.1, 16.4: 短期ペースが長期ペースの30%閾値以上 -> on_track
        expect(body.plateau).toEqual({ status: "on_track" });

        // 17.1, 17.3, 17.4
        expect(body.exerciseSimulation.available).toBe(true);
        if (body.exerciseSimulation.available) {
          expect(body.exerciseSimulation.scenarioLabel).toBe("週3回・30分の運動を追加");
          expect(body.exerciseSimulation.dietOnlyWeeksToGoal).toBe(18);
          expect(body.exerciseSimulation.dietPlusExerciseWeeksToGoal).toBeCloseTo(16.651249, 5);
        }
      }
    );

    it(
      "「停滞」(plateaued): mirrors diet-insights.calculator.test.ts's hand-verified plateaued " +
        "fixture, threaded through the real route -> NutritionService -> DietInsightsCalculator " +
        "chain with only the weight-log source faked (Req 14.1, 14.5, 14.6, 16.3)",
      async () => {
        // diet-insights.calculator.test.ts「減量方向・停滞（plateaued）」ケースのフィクスチャを
        // そのまま再利用する: currentWeightKg=88, goalWeightKg=61, asOfDate=2026-04-12。
        const saveResult = profileService.saveProfile(
          buildValidProfileInput({
            weightKg: 88,
            dietModeEnabled: true,
            goalWeightKg: 61,
            goalPeriodWeeks: 20,
          })
        );
        expect(saveResult.ok).toBe(true);

        const weightLogs: WeightLogPoint[] = [
          { date: "2026-03-01", weightKg: 100 },
          { date: "2026-03-15", weightKg: 97 },
          { date: "2026-03-29", weightKg: 94 },
          { date: "2026-04-12", weightKg: 93.8 },
        ];
        app = buildAppWithFakeWeightLogs(weightLogs);

        const response = await app.inject({
          method: "GET",
          url: "/api/nutrition/diet-insights?date=2026-04-12",
        });

        expect(response.statusCode).toBe(200);
        const body = response.json() as DietInsights;

        expect(body.weightHistory).toEqual(weightLogs);

        // 15.1: weeklyProgressKg=1.08 (循環小数の丸めが絡むためtoBeCloseTo), estimatedWeeksToGoal=25
        expect(body.goalEta.available).toBe(true);
        if (body.goalEta.available) {
          expect(body.goalEta.weeklyProgressKg).toBeCloseTo(1.08, 9);
          expect(body.goalEta.estimatedWeeksToGoal).toBeCloseTo(25, 9);
        }

        // 14.4: 直近記録日(2026-04-12, 93.8kg)起点、weeklyRateOfChangeKg(-1.08)を累積加算
        expect(body.weightProjection[0]).toEqual({
          date: "2026-04-19",
          projectedWeightKg: expect.closeTo(92.72, 9),
        });
        expect(body.weightProjection[1]).toEqual({
          date: "2026-04-26",
          projectedWeightKg: expect.closeTo(91.64, 9),
        });
        expect(body.weightProjection[2]).toEqual({
          date: "2026-05-03",
          projectedWeightKg: expect.closeTo(90.56, 9),
        });
        expect(body.weightProjection[3]).toEqual({
          date: "2026-05-10",
          projectedWeightKg: expect.closeTo(89.48, 9),
        });

        // 16.3: 短期ペース(0.1)が長期ペース(1.08)の30%閾値(0.324)を明確に下回る -> plateaued
        expect(body.plateau.status).toBe("plateaued");
        if (body.plateau.status === "plateaued") {
          expect(typeof body.plateau.message).toBe("string");
          expect(body.plateau.message.length).toBeGreaterThan(0);
        }

        // 17.1, 17.3, 17.4
        expect(body.exerciseSimulation.available).toBe(true);
        if (body.exerciseSimulation.available) {
          expect(body.exerciseSimulation.dietOnlyWeeksToGoal).toBeCloseTo(25, 9);
          expect(body.exerciseSimulation.dietPlusExerciseWeeksToGoal).toBeCloseTo(23.255814, 5);
        }
      }
    );

    it(
      "「データ不足」(insufficient_data): mirrors diet-insights.calculator.test.ts's hand-verified " +
        "insufficient-data fixture (1 usable point after null-filtering) and returns a 200 " +
        "(not a 409) with the full data-insufficient DietInsights shape (Req 14.5)",
      async () => {
        // diet-insights.calculator.test.ts「体重記録が1件のみの場合（null記録は前処理で除外される,
        // 14.5）」ケースのフィクスチャをそのまま再利用する。dietModeEnabled/goalWeight/goalPeriod
        // 自体は完備している（=incomplete_diet_mode_dataの409とは別概念であることを明確化する）。
        const saveResult = profileService.saveProfile(
          buildValidProfileInput({
            weightKg: 70,
            dietModeEnabled: true,
            goalWeightKg: 65,
            goalPeriodWeeks: 16,
          })
        );
        expect(saveResult.ok).toBe(true);

        const weightLogs: WeightLogPoint[] = [
          { date: "2026-01-01", weightKg: 70 },
          { date: "2026-01-05", weightKg: null },
        ];
        app = buildAppWithFakeWeightLogs(weightLogs);

        const response = await app.inject({
          method: "GET",
          url: "/api/nutrition/diet-insights?date=2026-01-10",
        });

        // 14.5: データ不足はエラー(409)ではなく200 + データ不足を表す結果として提示される。
        expect(response.statusCode).toBe(200);
        const body = response.json() as DietInsights;

        expect(body).toEqual({
          weightHistory: [{ date: "2026-01-01", weightKg: 70 }],
          weightProjection: [],
          goalEta: { available: false },
          plateau: { status: "insufficient_data" },
          exerciseSimulation: { available: false },
        });
      }
    );
  }
);
