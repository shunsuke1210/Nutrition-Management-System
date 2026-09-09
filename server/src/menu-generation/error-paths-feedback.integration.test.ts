import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DayMenu, MealSlot, MealType, ProfileInput, VerifiedNutritionValues } from "@nutrition/shared";
import { buildApp } from "../app.js";
import { createConnection } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";

import { createProfileRepository, type ProfileRepository } from "../profile/profile.repository.js";
import { createProfileService, type ProfileService } from "../profile/profile.service.js";
import { createDailyLogRepository } from "../daily-log/daily-log.repository.js";
import { createDailyLogService, type DailyLogService } from "../daily-log/daily-log.service.js";

// nutrition-engine's OWN gateways/service (server/src/nutrition/) -- DIFFERENT from
// menu-generation's own gateways of similar names (see the imports below). Aliased to avoid
// a name collision with menu-generation's `createProfileGateway`.
import { createProfileGateway as createNutritionEngineProfileGateway } from "../nutrition/profile.gateway.js";
import { createDailyLogGateway as createNutritionEngineDailyLogGateway } from "../nutrition/daily-log.gateway.js";
import { createNutritionService } from "../nutrition/nutrition.service.js";

// menu-generation's own Gateways (server/src/menu-generation/) -- wrap the SAME
// profileService/nutritionService/dailyLogService instances built above.
import { createProfileGateway as createMenuProfileGateway } from "./profile.gateway.js";
import { createNutritionGateway as createMenuNutritionGateway } from "./nutrition.gateway.js";
import { createPlannedCalorieGateway } from "./planned-calorie.gateway.js";

import { createFoodCompositionRepository } from "./food-composition.repository.js";
import { createUnitConversionService } from "./unit-conversion.service.js";
import { createNutritionVerificationService } from "./nutrition-verification.service.js";
import { createMenuPlanRepository, type MenuPlanRepository } from "./menu-plan.repository.js";
import { createFeedbackRepository } from "./feedback.repository.js";
import { createFeedbackService, type FeedbackService } from "./feedback.service.js";
import { createRecipeDetailRepository } from "./recipe-detail.repository.js";
import { createRecipeDetailService } from "./recipe-detail.service.js";
import {
  createClaudeMenuClient,
  WEEKLY_GENERATION_TOOL_NAME,
  type AnthropicMessagesClient,
} from "./claude-menu.client.js";
import { createClaudeMenuGenerator } from "./claude-menu.generator.js";
import { createMenuPlanService, type MenuPlanService, type GenerationError } from "./menu-plan.service.js";
import { registerMenuPlanRoutes } from "./menu-plan.routes.js";
import { registerMealSlotRoutes } from "./meal-slot.routes.js";

/**
 * task 12.3（結合テスト最終タスク）— エラーパス・フィードバック反映の統合テスト。
 *
 * `week-generation.integration.test.ts`（task 12.1）・
 * `day-regeneration-recipe-detail.integration.test.ts`（task 12.2）が確立した precedent
 * （実一時SQLite + `createConnection`/`runMigrations` + 実Repository→Service→Gatewayの
 * フルチェーン + `buildApp()` + ルート登録 + `app.inject()`、唯一フェイク化する依存は
 * `AnthropicMessagesClient` のみ）をそのまま踏襲する。task 12.1/12.2のファイルは一切変更しない
 * （本タスクは新規ファイルの追加のみ）。
 *
 * 本ファイルの境界（task 12.3のタスクブリーフより）:
 *   1. `profile_missing` → 409（Req 12.1）
 *   2. `nutrition_unavailable` → 409（Req 12.2）
 *   3. `schema_validation_failed` → 502（Req 12.3）
 *   （1-3のいずれについても、献立が永続化されないことを確認する）
 *   4. フィードバック（Req 10.3）: task 12.1は `feedbackService.recordFeedback` を直接呼び出す
 *      経路を選んだ（scope-narrowing、12.1自身のコメント参照）。本タスクはその"閉じられて
 *      いなかったギャップ"を埋め、実際のHTTP `POST .../feedback` エンドポイント経由でフィード
 *      バックを記録し、それが実際のHTTP `POST .../regenerate` のClaudeプロンプトに反映される
 *      ことを検証する。これには `registerMealSlotRoutes`（task 12.2が確立した構築パターン）が
 *      必要（`RecipeDetailService` はfeedbackルートの登録要件を満たすためだけに実構築するが、
 *      本ファイルはレシピ詳細生成そのものは一切行使しない）。
 *
 * Requirement 12.5（generation_in_progress）について: このタスクのブリーフ自身が明示する
 * とおり、12.5（インメモリロック）は既に `menu-plan.service.test.ts`（task 9.1/9.2）でフェイクを
 * 用いて十分に単体テスト済みである。本ファイルは新たな実結合レベルの同時実行テストを追加しない
 * （ブリーフの「既存のService単体テストで十分と判断すればその旨を明記する」という指示に従う）。
 *
 * ## 実在する食品ID・単位コードについて
 * `week-generation.integration.test.ts`/`day-regeneration-recipe-detail.integration.test.ts` と
 * 同一の8件（`010_seed_food_items.sql` が実際に投入した食品ID）を用いる。単位は常に "g" を用いる。
 */

// --- ユーザープロフィールのフィクスチャ（task 12.1/12.2と同一形状） ---

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

// --- 実在する食品ID（010_seed_food_items.sql、task 12.1/12.2の REAL_FOOD_IDS と同一） ---

const REAL_FOOD_IDS: readonly string[] = [
  "01088",
  "12004",
  "01006",
  "01015",
  "01020",
  "01026",
  "01031",
  "01034",
];

function pickRealFoodId(offset: number): string {
  const foodId = REAL_FOOD_IDS[offset % REAL_FOOD_IDS.length];
  if (foodId === undefined) {
    throw new Error("fixture error: REAL_FOOD_IDS is empty");
  }
  return foodId;
}

const MEAL_TYPES: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack"];

const WEEK_START = "2026-05-04"; // 実在する月曜日始まりの週（2026-05-04は月曜日）。

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return date.toISOString().slice(0, 10);
}

// --- フェイクの Anthropic Messages API 応答フィクスチャ（task 12.1/12.2 と同じ最小限の形状） ---

function toolUseBlock(name: string, input: unknown) {
  return { type: "tool_use" as const, id: "toolu_test", name, input };
}

function buildFakeMessage(content: unknown[]): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    stop_reason: "tool_use",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 100,
      output_tokens: 100,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
    content,
  } as unknown as Anthropic.Message;
}

/**
 * `generationLabel` で全料理名を装飾した、正常（7日分）な週間tool_use入力を構築する
 * （task 12.1の `buildWeeklyToolInput` と同一の形状）。
 */
function buildWeeklyToolInput(generationLabel: string) {
  const days = Array.from({ length: 7 }, (_, dayIndex) => ({
    dayIndex,
    meals: MEAL_TYPES.map((mealType, mealIndex) => ({
      mealType,
      dishName: `${generationLabel}-day${dayIndex}-${mealType}`,
      ingredients: [
        { food_id: pickRealFoodId(dayIndex + mealIndex), quantity: 120, unit: "g" },
        { food_id: pickRealFoodId(dayIndex + mealIndex + 1), quantity: 80, unit: "g" },
      ],
    })),
  }));
  return { days };
}

/**
 * `claude-menu.client.test.ts`（task 6.2）の
 * 「generateWeekはdaysが6件（7件要求）の場合にtype: schema_validation_failedを返す」ケースと
 * 同じ種類の壊れ方（7件要求のところ6件しか返さない）を再現する、意図的に不正な週間tool_use入力。
 */
function buildMalformedWeeklyToolInput(): unknown {
  const valid = buildWeeklyToolInput("malformed") as { days: unknown[] };
  return { days: valid.days.slice(0, 6) };
}

/**
 * `AnthropicMessagesClient` のフェイク。唯一フェイク化するClaude API層本体
 * （タスクブリーフ参照）。`WEEKLY_GENERATION_TOOL_NAME` のみに対応する（本ファイルは週間
 * 生成/再生成のみを行使する。日単位再生成・レシピ詳細生成のtool名は未対応のまま例外を投げる、
 * task 12.1/12.2と対称的な設計判断）。
 *
 * `weeklyToolInput`（省略時は判別可能な正常データを返す `buildWeeklyToolInput` を使う）を
 * 差し替え可能にすることで、schema_validation_failedシナリオ（意図的に不正な入力を返す）と
 * 正常シナリオ（generate/regenerateの成功パス）の両方を同じフェイク実装で表現できるようにする。
 */
function createFakeAnthropicClient(
  capturedRequests: Anthropic.MessageCreateParamsNonStreaming[],
  options: { weeklyToolInput?: (generationLabel: string) => unknown }
): AnthropicMessagesClient {
  let generationCallCount = 0;
  return {
    messages: {
      create: async (params) => {
        capturedRequests.push(params);
        const toolChoice = params.tool_choice;
        const toolName = toolChoice && toolChoice.type === "tool" ? toolChoice.name : undefined;

        if (toolName === WEEKLY_GENERATION_TOOL_NAME) {
          generationCallCount += 1;
          // `options.weeklyToolInput` はこの `create` 呼び出しの"たびに"（生成時に一度だけ
          // ではなく）動的に参照する。これにより、`beforeEach` でオブジェクト（`options`）を
          // 一度だけ構築したあと、個々の it() が `app.inject` を呼ぶ直前に
          // `fakeAnthropicOptions.weeklyToolInput` を差し替えても（schema_validation_failed
          // シナリオのように）、その変更が実際にこのクロージャに反映される
          // （生成時に関数参照を固定してしまうと、後からのオプション変更が無視されてしまう
          // というバグを避けるための意図的な実装）。
          const buildInput = options.weeklyToolInput ?? buildWeeklyToolInput;
          const input = buildInput(`gen${generationCallCount}`);
          return buildFakeMessage([toolUseBlock(WEEKLY_GENERATION_TOOL_NAME, input)]);
        }

        throw new Error(
          `error-paths-feedback.integration.test の fake AnthropicMessagesClient: ` +
            `未対応のtool_choiceを受け取りました（本テストは週間生成/再生成のみを行使する対象）: ` +
            `${JSON.stringify(toolChoice)}`
        );
      },
    },
  };
}

// --- シード投入する初期週のフィクスチャ（フィードバック統合テスト用、
//     menuPlanRepository.replaceWeek への直接投入。task 12.2の確立したパターン） ---

const SEED_BASE_NUTRITION: VerifiedNutritionValues = {
  energyKcal: 500,
  proteinG: 20,
  fatG: 15,
  carbG: 60,
  fiberG: 5,
  calciumMg: 100,
  ironMg: 2,
  vitaminAUg: 200,
  vitaminDUg: 2,
  vitaminB1Mg: 0.3,
  vitaminB2Mg: 0.4,
  vitaminCMg: 20,
  saltEquivalentG: 1.5,
};

/** 「はっきりと識別可能な」不人気料理: フィードバックが正しく反映されたことをその内容自体で確認できるようにする。 */
const DISLIKED_DISH_NAME = "UNIQUE-DISLIKED-DISH-natto-curry-surprise";
const DISLIKED_FOOD_ID = pickRealFoodId(0);
const DISLIKED_SECOND_FOOD_ID = pickRealFoodId(1);

function buildSeededMealSlot(dayIndex: number, mealType: MealType): MealSlot {
  const mealIndex = MEAL_TYPES.indexOf(mealType);
  if (dayIndex === 0 && mealType === "breakfast") {
    return {
      mealType,
      dishName: DISLIKED_DISH_NAME,
      ingredients: [
        { foodId: DISLIKED_FOOD_ID, quantity: 100, unit: "g" },
        { foodId: DISLIKED_SECOND_FOOD_ID, quantity: 50, unit: "g" },
      ],
      nutrition: SEED_BASE_NUTRITION,
    };
  }
  return {
    mealType,
    dishName: `seed-day${dayIndex}-${mealType}`,
    ingredients: [
      { foodId: pickRealFoodId(dayIndex * 3 + mealIndex + 2), quantity: 100, unit: "g" },
      { foodId: pickRealFoodId(dayIndex * 3 + mealIndex + 3), quantity: 50, unit: "g" },
    ],
    nutrition: SEED_BASE_NUTRITION,
  };
}

function buildSeededDayMenu(dayIndex: number): DayMenu {
  const meals = MEAL_TYPES.map((mealType) => buildSeededMealSlot(dayIndex, mealType));
  return {
    dayDate: addDays(WEEK_START, dayIndex),
    dayIndex,
    meals,
    dayNutrition: SEED_BASE_NUTRITION,
    plannedKcal: SEED_BASE_NUTRITION.energyKcal * 4,
    targetKcal: 2000,
    varianceKcal: SEED_BASE_NUTRITION.energyKcal * 4 - 2000,
  };
}

function buildSeededWeek(): DayMenu[] {
  return [0, 1, 2, 3, 4, 5, 6].map((dayIndex) => buildSeededDayMenu(dayIndex));
}

describe(
  "menu-generation error paths and feedback-reflects-in-regenerate integration " +
    "(real full-stack chain, Claude mocked) — task 12.3",
  () => {
    let tmpDir: string;
    let db: Database.Database;
    let app: FastifyInstance;
    let profileRepository: ProfileRepository;
    let profileService: ProfileService;
    let dailyLogService: DailyLogService;
    let feedbackService: FeedbackService;
    let menuPlanRepository: MenuPlanRepository;
    let menuPlanService: MenuPlanService;
    let capturedRequests: Anthropic.MessageCreateParamsNonStreaming[];
    let fakeAnthropicOptions: { weeklyToolInput?: (generationLabel: string) => unknown };

    beforeEach(() => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), "error-paths-feedback-integration-test-"));
      const dbPath = path.join(tmpDir, "test.db");
      db = createConnection(dbPath);
      runMigrations(db);

      // `server/src/index.ts`(`startServer`) と同じ構築順序（task 12.1/12.2と同一）:
      // Repository → Service → Gateway → 上位Service。

      // 1. user-profile side.
      profileRepository = createProfileRepository(db);
      profileService = createProfileService(profileRepository);

      // 2. user-profile's daily-log side.
      const dailyLogRepository = createDailyLogRepository(db);
      dailyLogService = createDailyLogService(dailyLogRepository);

      // 3. nutrition-engine side (server/src/nutrition/ の独自のGateway/Service)。
      const nutritionEngineProfileGateway = createNutritionEngineProfileGateway(profileService);
      const nutritionEngineDailyLogGateway = createNutritionEngineDailyLogGateway(dailyLogService);
      const nutritionService = createNutritionService(
        nutritionEngineProfileGateway,
        nutritionEngineDailyLogGateway
      );

      // 4. menu-generation's own Gateways (同じ profileService/nutritionService/dailyLogService
      //    をラップする)。
      const menuProfileGateway = createMenuProfileGateway(profileService);
      const menuNutritionGateway = createMenuNutritionGateway(nutritionService);
      const plannedCalorieGateway = createPlannedCalorieGateway(dailyLogService);

      // 5. 食品成分DB・単位換算・栄養価検証。
      const foodCompositionRepository = createFoodCompositionRepository(db);
      const unitConversionService = createUnitConversionService(foodCompositionRepository);
      const nutritionVerificationService = createNutritionVerificationService(
        foodCompositionRepository,
        unitConversionService
      );

      // 6. 献立プランの永続化。
      menuPlanRepository = createMenuPlanRepository(db, unitConversionService);

      // 7. 満足度フィードバック。
      const feedbackRepository = createFeedbackRepository(db);
      feedbackService = createFeedbackService(feedbackRepository, menuPlanRepository);

      // 8. レシピ詳細の永続化・Service（`registerMealSlotRoutes` の構築要件を満たすためだけに
      //    実構築する。本ファイルはレシピ詳細生成そのものは一切行使しない）。
      const recipeDetailRepository = createRecipeDetailRepository(db, unitConversionService);

      // 9. 唯一フェイク化する依存: Claude API層（AnthropicMessagesClientのみ）。
      //    `fakeAnthropicOptions` は各 it() が個別に設定し（デフォルトは正常な7日分の応答）、
      //    `beforeEach` はその変更を毎テスト前にリセットする。
      capturedRequests = [];
      fakeAnthropicOptions = {};
      const fakeAnthropicClient = createFakeAnthropicClient(capturedRequests, fakeAnthropicOptions);
      const claudeMenuClient = createClaudeMenuClient(foodCompositionRepository, fakeAnthropicClient);
      const menuGenerator = createClaudeMenuGenerator(claudeMenuClient);

      // 10. RecipeDetailServiceのオーケストレーション（構築要件を満たすためだけ）。
      const recipeDetailService = createRecipeDetailService({
        menuPlanRepository,
        profileGateway: menuProfileGateway,
        menuGenerator,
        nutritionVerificationService,
        recipeDetailRepository,
      });

      // 11. MenuPlanServiceのオーケストレーション。
      menuPlanService = createMenuPlanService({
        profileGateway: menuProfileGateway,
        nutritionGateway: menuNutritionGateway,
        plannedCalorieGateway,
        feedbackService,
        menuGenerator,
        nutritionVerificationService,
        menuPlanRepository,
      });

      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, menuPlanService);
      registerMealSlotRoutes(app, recipeDetailService, feedbackService);
    });

    afterEach(async () => {
      await app.close();
      db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("POST /:week/generate returns 409 profile_missing when no profile has been saved, and persists nothing (Req 12.1)", async () => {
      // プロフィールは一切保存しない。

      const response = await app.inject({
        method: "POST",
        url: `/api/menu-plans/${WEEK_START}/generate`,
      });

      expect(response.statusCode).toBe(409);
      const body = response.json() as GenerationError;
      expect(body.type).toBe("generation_failed");
      expect(body.reason).toBe("profile_missing");

      // 献立が永続化されていないことを確認する（Req 12.3の「献立が永続化されないこと」は
      // 3シナリオ共通の要件）。
      expect(menuPlanRepository.getActivePlan(WEEK_START)).toBeNull();
      const slotCount = db.prepare(`SELECT COUNT(*) AS count FROM meal_slots`).get() as {
        count: number;
      };
      expect(slotCount.count).toBe(0);
    });

    it(
      "POST /:week/generate returns 409 nutrition_unavailable when the profile exists but " +
        "dietModeEnabled is true with incomplete goal data (real incomplete_diet_mode_data " +
        "trigger verified against NutritionService's own logic), and persists nothing (Req 12.2)",
      async () => {
        // `nutrition.service.ts`（server/src/nutrition/nutrition.service.ts、getSummaryの
        // ステップ9）を読んで確認済みの、実際に incomplete_diet_mode_data を発生させる唯一の
        // 条件: dietModeEnabled: true かつ (goalWeightKg === null または goalPeriodWeeks === null)。
        //
        // 通常の `ProfileService.saveProfile`（`PUT /api/profile` と同じ経路）は
        // `ProfileInputSchema.superRefine`（shared/src/profile.schema.ts）により
        // 「dietModeEnabled が true の場合、goalWeightKg/goalPeriodWeeks は必須」という制約を
        // 検証時に強制するため、この矛盾した状態を正規の入口からは作れない。
        // `nutrition.summary.integration.test.ts`（task 5.4）が確立した precedent と全く同じ
        // 回避策で、`profileRepository.upsert`（`ProfileService.saveProfile` のZod検証を経ない
        // 直接呼び出し）でこの状態を構成する。これはNutritionServiceの防御的チェック自体を
        // 検証するための正当な手段であり、本番コードは一切変更しない。
        profileRepository.upsert(
          buildValidProfileInput({
            dietModeEnabled: true,
            goalWeightKg: null,
            goalPeriodWeeks: 12,
          })
        );

        const response = await app.inject({
          method: "POST",
          url: `/api/menu-plans/${WEEK_START}/generate`,
        });

        expect(response.statusCode).toBe(409);
        const body = response.json() as GenerationError;
        expect(body.type).toBe("generation_failed");
        expect(body.reason).toBe("nutrition_unavailable");

        expect(menuPlanRepository.getActivePlan(WEEK_START)).toBeNull();
        const slotCount = db.prepare(`SELECT COUNT(*) AS count FROM meal_slots`).get() as {
          count: number;
        };
        expect(slotCount.count).toBe(0);
      }
    );

    it(
      "POST /:week/generate returns 502 schema_validation_failed when the Claude mock returns " +
        "only 6 days (7 required, same malformation kind as claude-menu.client.test.ts's own " +
        "unit test), and persists nothing (Req 12.3)",
      async () => {
        const saveResult = profileService.saveProfile(buildValidProfileInput());
        expect(saveResult.ok).toBe(true);

        // このテストのみ、フェイクのAnthropicクライアントを「6日分しか返さない」不正な応答に
        // 差し替える（`beforeEach` はデフォルトで正常な7日分の応答を使う `fakeAnthropicOptions`
        // を渡しているため、ここで上書きしてから改めて構築し直す必要がある）。
        fakeAnthropicOptions.weeklyToolInput = () => buildMalformedWeeklyToolInput();

        const response = await app.inject({
          method: "POST",
          url: `/api/menu-plans/${WEEK_START}/generate`,
        });

        expect(response.statusCode).toBe(502);
        const body = response.json() as GenerationError;
        expect(body.type).toBe("generation_failed");
        expect(body.reason).toBe("schema_validation_failed");

        expect(menuPlanRepository.getActivePlan(WEEK_START)).toBeNull();
        const slotCount = db.prepare(`SELECT COUNT(*) AS count FROM meal_slots`).get() as {
          count: number;
        };
        expect(slotCount.count).toBe(0);
      }
    );

    it(
      "the REAL HTTP feedback endpoint (POST .../feedback) records a disliked meal, and its " +
        "dish name + food IDs genuinely reach the Claude prompt of a subsequent REAL HTTP " +
        "regenerate call (Req 10.3, closing the gap task 12.1 explicitly left open)",
      async () => {
        const saveResult = profileService.saveProfile(buildValidProfileInput());
        expect(saveResult.ok).toBe(true);

        // 初期週は task 12.2 が確立した効率的なパターン（menuPlanRepository.replaceWeek への
        // 直接投入）でシードする。週間生成フロー自体は task 12.1 が既に十分検証済みのため、
        // ここで再検証する必要はない。dayIndex 0 の breakfast に、はっきりと識別可能な
        // 料理名・食品IDを仕込む（DISLIKED_DISH_NAME / DISLIKED_FOOD_ID）。
        const seededDays = buildSeededWeek();
        menuPlanRepository.replaceWeek(WEEK_START, seededDays);

        const beforeSlotCount = db.prepare(`SELECT COUNT(*) AS count FROM meal_slots`).get() as {
          count: number;
        };
        expect(beforeSlotCount.count).toBe(28);

        // 実HTTPのフィードバックエンドポイント経由で「苦手」を記録する（feedbackServiceの
        // 直接呼び出しではない。task 12.1が明示的に残した経路のギャップをここで閉じる）。
        const feedbackResponse = await app.inject({
          method: "POST",
          url: `/api/menu-plans/${WEEK_START}/days/0/meals/breakfast/feedback`,
          payload: { liked: false },
        });
        expect(feedbackResponse.statusCode).toBe(204);

        // 実HTTPの再生成エンドポイントを同じ週に対して呼び出す。
        const regenerateResponse = await app.inject({
          method: "POST",
          url: `/api/menu-plans/${WEEK_START}/regenerate`,
        });
        expect(regenerateResponse.statusCode).toBe(200);

        // regenerate はこのテストで唯一のWEEKLY_GENERATION_TOOL_NAME呼び出しである
        // （seedはHTTP/Claudeを経由しないため）。
        const weeklyToolRequests = capturedRequests.filter((params) => {
          const toolChoice = params.tool_choice;
          return toolChoice?.type === "tool" && toolChoice.name === WEEKLY_GENERATION_TOOL_NAME;
        });
        expect(weeklyToolRequests).toHaveLength(1);

        const regenerateRequest = weeklyToolRequests[0];
        expect(regenerateRequest).toBeDefined();
        const regenerateSystemPrompt = String(regenerateRequest?.system ?? "");

        // 実際にHTTP feedbackエンドポイント → FeedbackService.recordFeedback → 実DB書き込み →
        // HTTP regenerateエンドポイント → MenuPlanService.regenerateWeek →
        // FeedbackService.getDislikedSummary() → MenuPromptBuilder.buildWeeklyPrompt →
        // ClaudeMenuClient.generateWeek の実リクエストという全チェーンを経て、識別可能な
        // 「苦手」料理名・食材の食品IDがプロンプトに反映されたことを確認する。
        expect(regenerateSystemPrompt).toContain(DISLIKED_DISH_NAME);
        expect(regenerateSystemPrompt).toContain(DISLIKED_FOOD_ID);
        expect(regenerateSystemPrompt).toContain(DISLIKED_SECOND_FOOD_ID);
      }
    );
  }
);
