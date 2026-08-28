import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  CalculationUnavailableError,
  NutritionSummary,
  ProfileInput,
} from "@nutrition/shared";
import { buildApp } from "../app.js";
import { createConnection } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { createProfileRepository, type ProfileRepository } from "../profile/profile.repository.js";
import { createProfileService, type ProfileService } from "../profile/profile.service.js";
import { createDailyLogRepository } from "../daily-log/daily-log.repository.js";
import { createDailyLogService, type DailyLogService } from "../daily-log/daily-log.service.js";
import { createProfileGateway } from "./profile.gateway.js";
import { createDailyLogGateway } from "./daily-log.gateway.js";
import { createNutritionService } from "./nutrition.service.js";
import { registerNutritionRoutes } from "./nutrition.routes.js";

/**
 * `GET /api/nutrition/summary` の"真の"統合テスト（task 5.4）。
 *
 * `nutrition.routes.test.ts`（task 4.1）はフェイクの `NutritionService` を差し替えて
 * `NutritionController` のHTTP境界のみを検証しており、そのファイル自身のコメントが
 * 「実DBを裏付けとした統合（`ProfileGateway` / `DailyLogGateway` 経由の実データ）は
 * 後続タスクの対象である」と明記している。本ファイルがその後続タスクにあたる。
 *
 * ファイル構成の判断（CONCERNS参照）: `nutrition.routes.test.ts` を拡張して `describe`
 * ブロックを追加するのではなく、新規ファイルとして切り出した。理由:
 *   - `nutrition.routes.test.ts` は「`NutritionController` 単体をフェイクServiceで検証する」
 *     という一貫した境界を持つファイルであり、そのファイル自身が「実DB統合は後続タスク」と
 *     明言している。同一ファイルに実DB統合テストを混在させると、そのファイルの境界の説明
 *     （冒頭コメント）と矛盾する。
 *   - 本タスクの境界（Boundary: Integration）は `NutritionController` 単体ではなく、
 *     `NutritionController → NutritionService → ProfileGateway/DailyLogGateway →
 *     user-profileのProfileService/DailyLogService → ProfileRepository/DailyLogRepository →
 *     実SQLite` という全層を貫く検証であり、`profile.routes.test.ts` /
 *     `daily-log.routes.test.ts`（task 2.3, 3.3）が確立した「実一時SQLite + buildApp() +
 *     ルート登録 + app.inject()」という統合テストの型を、nutrition-engine側で踏襲する
 *     独立したテストスイートとして扱う方が一貫性がある。
 *   - 実際、`user-profile` 側でも `profile.repository.test.ts` / `profile.service.test.ts` /
 *     `profile.routes.test.ts` は境界（Repository単体 / Service単体 / Controller統合）ごとに
 *     ファイルが分かれており、「同一コンポーネントの単体テストと統合テストを同一ファイルに
 *     同居させる」という前例は実際には見当たらなかった（`profile.routes.test.ts` はすべて
 *     実Service/実DBのみで構成されている）。本ファイルもこの慣例に合わせ、
 *     「フェイクServiceでのController単体テスト」（`nutrition.routes.test.ts`）と
 *     「実Service/実DBでの全層統合テスト」（本ファイル）を別ファイルとして分離する。
 *
 * 決定論性テスト（5番目の検証項目）における `computedAt` の扱い（CONCERNS参照）:
 * `computedAt` は `NutritionService.getSummary` が呼び出しのたびに `new Date().toISOString()`
 * で設定する算出時刻であり、design.md 自身が「算出時刻（永続化されない）」と明記する通り、
 * 決定論的な計算結果そのものではない（Requirement 13.1 が要求する決定論性は「同一の入力
 * データに対して常に同一の計算結果を返す」ことであり、算出時刻というメタデータの再現性を
 * 求めるものではない）。そのため本ファイルでは `computedAt` を比較対象から除外し、
 * それ以外の全フィールドが複数回の呼び出し間で完全に一致することを検証する（フェイクタイマー
 * で時計を固定するアプローチも検討したが、`computedAt` を除外する方が13.1の意図に忠実であり、
 * かつテストの記述もシンプルになるためこちらを採用した）。
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

describe("GET /api/nutrition/summary integration (real user-profile + nutrition-engine chain)", () => {
  let tmpDir: string;
  let db: Database.Database;
  let app: FastifyInstance;
  let profileRepository: ProfileRepository;
  let profileService: ProfileService;
  let dailyLogService: DailyLogService;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-summary-integration-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    db = createConnection(dbPath);
    runMigrations(db);

    // design.md「栄養目標値の算出フロー」/ `server/src/index.ts`(`startServer`) と同じ
    // 構築順序: Repository → Service → Gateway → NutritionService。
    profileRepository = createProfileRepository(db);
    profileService = createProfileService(profileRepository);
    const dailyLogRepository = createDailyLogRepository(db);
    dailyLogService = createDailyLogService(dailyLogRepository);

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

  it("returns 409 profile_missing when no profile has been saved yet (Req 12.1)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/nutrition/summary?date=2026-08-20",
    });

    expect(response.statusCode).toBe(409);
    const body = response.json() as CalculationUnavailableError;
    expect(body.type).toBe("calculation_unavailable");
    expect(body.reason).toBe("profile_missing");
  });

  it(
    "returns 200 with a full NutritionSummary including a non-null dietMode " +
      "(calorieTarget/pfcRatio/pfc/guardrails) when dietModeEnabled is true and goal data is " +
      "complete (Req 3.1, 3.2, 3.3, 8.2)",
    async () => {
      const saveResult = profileService.saveProfile(
        buildValidProfileInput({
          dietModeEnabled: true,
          goalWeightKg: 60,
          goalPeriodWeeks: 12,
        })
      );
      expect(saveResult.ok).toBe(true);

      const response = await app.inject({
        method: "GET",
        url: "/api/nutrition/summary?date=2026-08-20",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as NutritionSummary;

      // Requirement 3.1-3.3: BMR/活動係数からTDEEが正の数値として算出されている。
      expect(body.bmr).toBeGreaterThan(0);
      expect(body.activityCoefficient).toBeGreaterThanOrEqual(1.2);
      expect(body.activityCoefficient).toBeLessThanOrEqual(1.9);
      expect(body.tdee).toBeGreaterThan(0);
      expect(body.tdee).toBeCloseTo(body.bmr * body.activityCoefficient);

      expect(body.dietMode).not.toBeNull();
      expect(typeof body.dietMode?.calorieTarget).toBe("number");
      expect(body.dietMode?.pfcRatio).toEqual({
        proteinPct: expect.any(Number),
        fatPct: expect.any(Number),
        carbPct: expect.any(Number),
      });
      expect(body.dietMode?.pfc).toEqual({
        proteinG: expect.any(Number),
        fatG: expect.any(Number),
        carbG: expect.any(Number),
        proteinKcal: expect.any(Number),
        fatKcal: expect.any(Number),
        carbKcal: expect.any(Number),
      });
      expect(body.dietMode?.guardrails.warnings).toBeInstanceOf(Array);
    }
  );

  it(
    "returns 409 incomplete_diet_mode_data when dietModeEnabled is true but goalWeightKg is " +
      "missing (Req 12.2)",
    async () => {
      // ProfileInputSchema.superRefine (shared/src/profile.schema.ts) requires goalWeightKg AND
      // goalPeriodWeeks whenever dietModeEnabled is true, so ProfileService.saveProfile (the
      // normal PUT /api/profile path) can never persist this "dietModeEnabled but goal data
      // incomplete" combination -- attempting it would fail validation before it reaches the
      // repository. NutritionService's incomplete_diet_mode_data check (design.md 12.2,
      // NutritionService Responsibilities & Constraints) exists as a DEFENSIVE check against
      // exactly this inconsistent-by-construction state, independent of user-profile's own
      // input validation. To prove that defensive check actually fires, this test constructs
      // the inconsistent state directly via ProfileRepository.upsert (bypassing
      // ProfileService.saveProfile's Zod validation entirely) -- ProfileRepository.upsert's
      // signature accepts a plain ProfileInput and does not re-run the superRefine invariant
      // (only ProfileService.saveProfile does), so this is a legitimate way to reach the state
      // the guard is meant to catch, without modifying any production code.
      profileRepository.upsert(
        buildValidProfileInput({
          dietModeEnabled: true,
          goalWeightKg: null,
          goalPeriodWeeks: 12,
        })
      );

      const response = await app.inject({
        method: "GET",
        url: "/api/nutrition/summary?date=2026-08-20",
      });

      expect(response.statusCode).toBe(409);
      const body = response.json() as CalculationUnavailableError;
      expect(body.type).toBe("calculation_unavailable");
      expect(body.reason).toBe("incomplete_diet_mode_data");
    }
  );

  it("returns 200 with dietMode: null when dietModeEnabled is false (Req 8.2)", async () => {
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
      url: "/api/nutrition/summary?date=2026-08-20",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as NutritionSummary;
    expect(body.dietMode).toBeNull();
  });

  it(
    "dailyExpenditure.value equals TDEE when no exercise log is recorded for the date, and " +
      "equals TDEE + estimatedCaloriesBurned once an exercise entry is logged for that same " +
      "date (Req 4.1, 4.2, 4.3)",
    async () => {
      const date = "2026-08-20";
      const saveResult = profileService.saveProfile(buildValidProfileInput());
      expect(saveResult.ok).toBe(true);

      const beforeResponse = await app.inject({
        method: "GET",
        url: `/api/nutrition/summary?date=${date}`,
      });
      expect(beforeResponse.statusCode).toBe(200);
      const beforeBody = beforeResponse.json() as NutritionSummary;

      // Req 4.2: no exercise log recorded for the date -> dailyExpenditure is TDEE as-is.
      // Compared against the SAME response's own tdee field (self-consistency check) rather
      // than re-deriving BMR/TDEE from the raw formula in the test, per the task brief.
      expect(beforeBody.dailyExpenditure.date).toBe(date);
      expect(beforeBody.dailyExpenditure.value).toBeCloseTo(beforeBody.tdee);

      const exerciseResult = dailyLogService.addExerciseEntry(date, {
        activityName: "ジョギング",
        durationMinutes: 30,
        estimatedCaloriesBurned: 250,
      });
      expect(exerciseResult.ok).toBe(true);

      const afterResponse = await app.inject({
        method: "GET",
        url: `/api/nutrition/summary?date=${date}`,
      });
      expect(afterResponse.statusCode).toBe(200);
      const afterBody = afterResponse.json() as NutritionSummary;

      // Req 4.1, 4.3: dailyExpenditure now exceeds TDEE by EXACTLY the logged amount (250kcal).
      // TDEE itself (profile-derived only) is unaffected by the exercise log.
      expect(afterBody.tdee).toBeCloseTo(beforeBody.tdee);
      expect(afterBody.dailyExpenditure.value).toBeCloseTo(afterBody.tdee + 250);
      expect(afterBody.dailyExpenditure.value - afterBody.tdee).toBeCloseTo(250);
    }
  );

  it(
    "returns identical NutritionSummary responses (all fields except computedAt) across " +
      "repeated calls against the same unchanged profile/log state (Req 13.1, 13.2)",
    async () => {
      const date = "2026-08-20";
      const saveResult = profileService.saveProfile(
        buildValidProfileInput({
          dietModeEnabled: true,
          goalWeightKg: 60,
          goalPeriodWeeks: 12,
        })
      );
      expect(saveResult.ok).toBe(true);

      const exerciseResult = dailyLogService.addExerciseEntry(date, {
        activityName: "ウォーキング",
        durationMinutes: 20,
        estimatedCaloriesBurned: 100,
      });
      expect(exerciseResult.ok).toBe(true);

      const first = await app.inject({ method: "GET", url: `/api/nutrition/summary?date=${date}` });
      const second = await app.inject({ method: "GET", url: `/api/nutrition/summary?date=${date}` });
      const third = await app.inject({ method: "GET", url: `/api/nutrition/summary?date=${date}` });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(third.statusCode).toBe(200);

      const { computedAt: computedAt1, ...rest1 } = first.json() as NutritionSummary;
      const { computedAt: computedAt2, ...rest2 } = second.json() as NutritionSummary;
      const { computedAt: computedAt3, ...rest3 } = third.json() as NutritionSummary;

      // computedAt is a wall-clock timestamp, not part of the deterministic calculation
      // itself (see file header comment) -- excluded from the equality check.
      expect(typeof computedAt1).toBe("string");
      expect(typeof computedAt2).toBe("string");
      expect(typeof computedAt3).toBe("string");
      expect(rest2).toEqual(rest1);
      expect(rest3).toEqual(rest1);
    }
  );
});
