import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  DayMenu,
  MealSlot,
  MealType,
  ProfileInput,
  RecipeDetail,
  VerifiedNutritionValues,
} from "@nutrition/shared";
import { buildApp } from "../app.js";
import { createConnection } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";

import { createProfileRepository } from "../profile/profile.repository.js";
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
  DAILY_GENERATION_TOOL_NAME,
  RECIPE_GENERATION_TOOL_NAME,
  type AnthropicMessagesClient,
} from "./claude-menu.client.js";
import { createMenuPlanService, type MenuPlanService } from "./menu-plan.service.js";
import { registerMenuPlanRoutes } from "./menu-plan.routes.js";
import { registerMealSlotRoutes } from "./meal-slot.routes.js";

/**
 * `POST /api/menu-plans/:week/days/:dayIndex/regenerate` と
 * `POST /api/menu-plans/:week/days/:dayIndex/meals/:mealType/recipe-detail` の"真の"統合テスト
 * （task 12.2）。
 *
 * `week-generation.integration.test.ts`（task 12.1）が確立したprecedent（実一時SQLite +
 * `createConnection`/`runMigrations` + `server/src/index.ts`(`startServer`) と同じ順序で
 * 構築したRepository→Service→Gatewayの実チェーン + `buildApp()` + ルート登録 +
 * `app.inject()`）をそのまま踏襲し、唯一フェイク化する依存はClaude API層
 * （`AnthropicMessagesClient`）のみである。task 12.1のファイルは変更しない（本タスクは
 * 追加のみ）。
 *
 * ## 唯一フェイク化する依存: Claude API層
 * `ClaudeMenuClient` 自体（tool定義構築・`strict: true`・Zod再検証ロジック）は実装をそのまま
 * 使う（`createClaudeMenuClient`）。フェイク化するのは `AnthropicMessagesClient` のみであり、
 * `claude-menu.client.test.ts` / `week-generation.integration.test.ts` が確立した
 * `buildFakeMessage`/`toolUseBlock` と同じ最小限のフィクスチャ形状を用いる。
 *
 * 本ファイルのフェイクは `DAILY_GENERATION_TOOL_NAME`（日単位再生成）と
 * `RECIPE_GENERATION_TOOL_NAME`（レシピ詳細+補助副菜生成）の2つのtool名にのみ対応する
 * （`WEEKLY_GENERATION_TOOL_NAME` には対応しない）。理由は次の「初期データの投入方法」を参照。
 *
 * ## 初期データの投入方法: HTTP経由の /generate ではなく直接Repository呼び出し
 * task 12.1は `generate` エンドポイントそのものを検証対象としたため、実際にHTTP + Claudeモック
 * 経由の週間生成フローを通す必要があった。一方、本タスクの検証対象は「日単位再生成」と
 * 「レシピ詳細生成」の2フローのみであり、週間生成フロー自体は既にtask 12.1で十分に検証済みで
 * ある。したがって本ファイルは初期の週間データを `menuPlanRepository.replaceWeek(weekStartDate,
 * days)` への直接呼び出し（HTTP・Claude経由を一切通さない）で投入する。これによりテストが
 * 高速・決定論的になり、かつ本タスクが実際に検証すべき対象（日単位再生成・レシピ詳細生成）に
 * スコープを正しく限定できる。この結果、フェイクのAnthropicクライアントは
 * `WEEKLY_GENERATION_TOOL_NAME` を行使する必要がなく、未対応のtool名として例外を投げる
 * （`week-generation.integration.test.ts` が `WEEKLY_GENERATION_TOOL_NAME` のみに対応し、
 * 日単位/レシピ生成の分岐を未対応として例外を投げるのと対称的な設計判断）。
 *
 * ## 実在する食品ID・単位コードについて
 * `menu-plan.repository.test.ts` の `FOOD_IDS` フィクスチャおよび
 * `week-generation.integration.test.ts` の `REAL_FOOD_IDS` と同一の8件
 * （`010_seed_food_items.sql` が実際に投入した食品ID）を用いる。単位は常に "g" を用いる
 * （`UnitConversionService.toGrams` は `unitCode === "g"` の場合 `unit_conversions` テーブルへ
 * 一切アクセスせず常に成功するため、決定論的に検証を成功させられる）。これにより
 * `menuPlanRepository.replaceWeek` によるシード投入も、`NutritionVerificationService.verifyDish`
 * によるレシピ詳細生成時の補助副菜検証も、実際の `food_items` 行に対して真に成功する。
 */

// --- ユーザープロフィールのフィクスチャ（week-generation.integration.test.ts と同一形状） ---

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

// --- 実在する食品ID（010_seed_food_items.sql、week-generation.integration.test.ts の
//     REAL_FOOD_IDS と同一） ---

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

const WEEK_START = "2026-03-02"; // 実在する月曜日始まりの週（2026-03-02は月曜日）。

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return date.toISOString().slice(0, 10);
}

// --- シード投入する初期週のフィクスチャ（menuPlanRepository.replaceWeek への直接投入用） ---

/** 食種ごとの基準栄養価（13項目）。`dayIndex` を `energyKcal` に加算し、日ごとに区別可能にする。 */
const BASE_NUTRITION: Record<MealType, VerifiedNutritionValues> = {
  breakfast: {
    energyKcal: 400,
    proteinG: 18,
    fatG: 12,
    carbG: 55,
    fiberG: 4,
    calciumMg: 120,
    ironMg: 2.5,
    vitaminAUg: 180,
    vitaminDUg: 1.5,
    vitaminB1Mg: 0.25,
    vitaminB2Mg: 0.5,
    vitaminCMg: 30,
    saltEquivalentG: 1.25,
  },
  lunch: {
    energyKcal: 650,
    proteinG: 32,
    fatG: 22,
    carbG: 78,
    fiberG: 6.5,
    calciumMg: 90,
    ironMg: 3.25,
    vitaminAUg: 260,
    vitaminDUg: 2.25,
    vitaminB1Mg: 0.5,
    vitaminB2Mg: 0.75,
    vitaminCMg: 45,
    saltEquivalentG: 2.5,
  },
  dinner: {
    energyKcal: 700,
    proteinG: 40,
    fatG: 26,
    carbG: 80,
    fiberG: 7.25,
    calciumMg: 210,
    ironMg: 4.5,
    vitaminAUg: 320,
    vitaminDUg: 5.5,
    vitaminB1Mg: 0.75,
    vitaminB2Mg: 0.25,
    vitaminCMg: 60,
    saltEquivalentG: 3.25,
  },
  snack: {
    energyKcal: 150,
    proteinG: 6,
    fatG: 6.5,
    carbG: 18,
    fiberG: 1.5,
    calciumMg: 150,
    ironMg: 0.25,
    vitaminAUg: 40,
    vitaminDUg: 0.5,
    vitaminB1Mg: 0.25,
    vitaminB2Mg: 0.5,
    vitaminCMg: 15,
    saltEquivalentG: 0.25,
  },
};

function seededMealNutrition(mealType: MealType, dayIndex: number): VerifiedNutritionValues {
  const base = BASE_NUTRITION[mealType];
  return { ...base, energyKcal: base.energyKcal + dayIndex };
}

/** テスト側の独立した合算実装（実装側の関数を再利用しない）。 */
function sumNutrition(values: readonly VerifiedNutritionValues[]): VerifiedNutritionValues {
  return values.reduce<VerifiedNutritionValues>(
    (total, value) => ({
      energyKcal: total.energyKcal + value.energyKcal,
      proteinG: total.proteinG + value.proteinG,
      fatG: total.fatG + value.fatG,
      carbG: total.carbG + value.carbG,
      fiberG: total.fiberG + value.fiberG,
      calciumMg: total.calciumMg + value.calciumMg,
      ironMg: total.ironMg + value.ironMg,
      vitaminAUg: total.vitaminAUg + value.vitaminAUg,
      vitaminDUg: total.vitaminDUg + value.vitaminDUg,
      vitaminB1Mg: total.vitaminB1Mg + value.vitaminB1Mg,
      vitaminB2Mg: total.vitaminB2Mg + value.vitaminB2Mg,
      vitaminCMg: total.vitaminCMg + value.vitaminCMg,
      saltEquivalentG: total.saltEquivalentG + value.saltEquivalentG,
    }),
    {
      energyKcal: 0,
      proteinG: 0,
      fatG: 0,
      carbG: 0,
      fiberG: 0,
      calciumMg: 0,
      ironMg: 0,
      vitaminAUg: 0,
      vitaminDUg: 0,
      vitaminB1Mg: 0,
      vitaminB2Mg: 0,
      vitaminCMg: 0,
      saltEquivalentG: 0,
    }
  );
}

const SEED_TARGET_KCAL = 2100;

/**
 * `dishName` に `dayIndex` を埋め込み、`ingredients` の食品IDも `dayIndex` に応じてずらすことで、
 * 7日分すべてが相互に判別可能なシードデータを構築する（日単位再生成後に「他日の内容が誤って
 * 混入していないか」を内容そのもので検証できるようにするため）。
 */
function buildSeededMealSlot(dayIndex: number, mealType: MealType): MealSlot {
  const mealIndex = MEAL_TYPES.indexOf(mealType);
  return {
    mealType,
    dishName: `seed-day${dayIndex}-${mealType}`,
    ingredients: [
      { foodId: pickRealFoodId(dayIndex * 3 + mealIndex), quantity: 100, unit: "g" },
      { foodId: pickRealFoodId(dayIndex * 3 + mealIndex + 1), quantity: 50, unit: "g" },
    ],
    nutrition: seededMealNutrition(mealType, dayIndex),
  };
}

function buildSeededDayMenu(dayIndex: number): DayMenu {
  const meals = MEAL_TYPES.map((mealType) => buildSeededMealSlot(dayIndex, mealType));
  const dayNutrition = sumNutrition(meals.map((meal) => meal.nutrition));
  return {
    dayDate: addDays(WEEK_START, dayIndex),
    dayIndex,
    meals,
    dayNutrition,
    plannedKcal: dayNutrition.energyKcal,
    targetKcal: SEED_TARGET_KCAL,
    varianceKcal: dayNutrition.energyKcal - SEED_TARGET_KCAL,
  };
}

/** シード投入する7日分の週（`menuPlanRepository.replaceWeek` へ直接渡す）。 */
function buildSeededWeek(): DayMenu[] {
  return [0, 1, 2, 3, 4, 5, 6].map((dayIndex) => buildSeededDayMenu(dayIndex));
}

// --- フェイクの Anthropic Messages API 応答フィクスチャ ---

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

interface WireIngredient {
  food_id: string;
  quantity: number;
  unit: string;
}

/** wire形状（snake_case）の食材を、Repository読み取り結果と同じcamelCase形状へ変換する。 */
function expectedIngredientsFromWire(
  wireIngredients: readonly WireIngredient[]
): { foodId: string; quantity: number; unit: string }[] {
  return wireIngredients.map((ingredient) => ({
    foodId: ingredient.food_id,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
  }));
}

/**
 * `generationLabel`（呼び出しごとに一意な文字列、例: "daily-gen1"）で全料理名を装飾した
 * 日単位tool_use入力（wire形状: `{meals:[{mealType, dishName, ingredients:[{food_id, quantity,
 * unit}]}]}`）を構築する。シード投入した食品IDのオフセット（`dayIndex * 3 + mealIndex`系）とは
 * 重ならないオフセット（`mealIndex + 5` 系）を用いることで、再生成結果がシードデータと
 * 混同されないようにする。
 */
function buildDailyToolInput(generationLabel: string) {
  return {
    meals: MEAL_TYPES.map((mealType, mealIndex) => ({
      mealType,
      dishName: `${generationLabel}-${mealType}`,
      ingredients: [
        { food_id: pickRealFoodId(mealIndex + 5), quantity: 120, unit: "g" },
        { food_id: pickRealFoodId(mealIndex + 6), quantity: 80, unit: "g" },
      ],
    })),
  };
}

/** 補助副菜提案の件数（design.md #RecipeGenerationToolResult: 「1〜2件」のうち、本フェイクは2件を返す）。 */
const SUPPLEMENTARY_SUGGESTION_COUNT = 2;

/**
 * `generationLabel` で装飾したレシピ詳細tool_use入力（wire形状: `{servings,
 * cookingTimeMinutes, steps, supplementarySuggestions:[{dishName, ingredients}]}`）を構築する。
 */
function buildRecipeToolInput(generationLabel: string) {
  return {
    servings: 2,
    cookingTimeMinutes: 25,
    steps: [
      `${generationLabel}: 材料を切る`,
      `${generationLabel}: 炒める`,
      `${generationLabel}: 盛り付ける`,
    ],
    supplementarySuggestions: Array.from({ length: SUPPLEMENTARY_SUGGESTION_COUNT }, (_, index) => ({
      dishName: `${generationLabel}-supplementary${index}`,
      ingredients: [{ food_id: pickRealFoodId(index + 2), quantity: 60, unit: "g" }],
    })),
  };
}

/**
 * `AnthropicMessagesClient` のフェイク。唯一フェイク化するClaude API層本体
 * （タスクブリーフ参照）。`params.tool_choice.name` を検査して要求されたtoolを判別し
 * （本テストは日単位再生成/レシピ詳細生成のみを行使するため `DAILY_GENERATION_TOOL_NAME` /
 * `RECIPE_GENERATION_TOOL_NAME` の2つにのみ対応する。ファイル冒頭コメント「初期データの
 * 投入方法」参照）、呼び出しごとに内容が判別可能な献立/レシピを返す。全リクエストの
 * `params` を `capturedRequests` に記録する（week-generation.integration.test.ts と同じ規約）。
 */
function createFakeAnthropicClient(
  capturedRequests: Anthropic.MessageCreateParamsNonStreaming[]
): AnthropicMessagesClient {
  let dailyCallCount = 0;
  let recipeCallCount = 0;
  return {
    messages: {
      create: async (params) => {
        capturedRequests.push(params);
        const toolChoice = params.tool_choice;
        const toolName =
          toolChoice && toolChoice.type === "tool" ? toolChoice.name : undefined;

        if (toolName === DAILY_GENERATION_TOOL_NAME) {
          dailyCallCount += 1;
          const input = buildDailyToolInput(`daily-gen${dailyCallCount}`);
          return buildFakeMessage([toolUseBlock(DAILY_GENERATION_TOOL_NAME, input)]);
        }

        if (toolName === RECIPE_GENERATION_TOOL_NAME) {
          recipeCallCount += 1;
          const input = buildRecipeToolInput(`recipe-gen${recipeCallCount}`);
          return buildFakeMessage([toolUseBlock(RECIPE_GENERATION_TOOL_NAME, input)]);
        }

        throw new Error(
          `day-regeneration-recipe-detail.integration.test の fake AnthropicMessagesClient: ` +
            `未対応のtool_choiceを受け取りました（本テストは日単位再生成/レシピ詳細生成のみを` +
            `行使する対象。週間生成は初期データを直接Repository経由で投入するため行使しない）: ` +
            `${JSON.stringify(toolChoice)}`
        );
      },
    },
  };
}

describe(
  "POST /:week/days/:dayIndex/regenerate and " +
    "/:week/days/:dayIndex/meals/:mealType/recipe-detail integration " +
    "(real full-stack chain, Claude mocked, seeded via direct Repository call)",
  () => {
    let tmpDir: string;
    let db: Database.Database;
    let app: FastifyInstance;
    let profileService: ProfileService;
    let dailyLogService: DailyLogService;
    let feedbackService: FeedbackService;
    let menuPlanRepository: MenuPlanRepository;
    let menuPlanService: MenuPlanService;
    let capturedRequests: Anthropic.MessageCreateParamsNonStreaming[];

    beforeEach(() => {
      tmpDir = mkdtempSync(
        path.join(os.tmpdir(), "day-regen-recipe-detail-integration-test-")
      );
      const dbPath = path.join(tmpDir, "test.db");
      db = createConnection(dbPath);
      runMigrations(db);

      // `server/src/index.ts`(`startServer`) と同じ構築順序: Repository → Service → Gateway →
      // 上位Service（week-generation.integration.test.ts と同一の構築順序）。

      // 1. user-profile side.
      const profileRepository = createProfileRepository(db);
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

      // 8. レシピ詳細の永続化（task 12.1のチェーンに対する本タスクの追加分）。
      const recipeDetailRepository = createRecipeDetailRepository(db, unitConversionService);

      // 9. 唯一フェイク化する依存: Claude API層（AnthropicMessagesClientのみ）。
      capturedRequests = [];
      const fakeAnthropicClient = createFakeAnthropicClient(capturedRequests);
      const claudeMenuClient = createClaudeMenuClient(foodCompositionRepository, fakeAnthropicClient);

      // 10. MenuPlanServiceのオーケストレーション（日単位再生成）。
      menuPlanService = createMenuPlanService({
        profileGateway: menuProfileGateway,
        nutritionGateway: menuNutritionGateway,
        plannedCalorieGateway,
        feedbackService,
        claudeMenuClient,
        nutritionVerificationService,
        menuPlanRepository,
      });

      // 11. RecipeDetailServiceのオーケストレーション（レシピ詳細+補助副菜生成）。
      const recipeDetailService = createRecipeDetailService({
        menuPlanRepository,
        profileGateway: menuProfileGateway,
        claudeMenuClient,
        nutritionVerificationService,
        recipeDetailRepository,
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

    it(
      "POST /:week/days/:dayIndex/regenerate replaces ONLY the target day's 4 meal_slots " +
        "(new dishName/foodIds reflect the Claude-mocked daily generation result) while the " +
        "other 6 days remain byte-for-byte unchanged (Req 7.1, 7.4)",
      async () => {
        const saveResult = profileService.saveProfile(buildValidProfileInput());
        expect(saveResult.ok).toBe(true);

        // シードは HTTP/Claude を経由せず、menuPlanRepository.replaceWeek への直接呼び出しで
        // 投入する（ファイル冒頭コメント「初期データの投入方法」参照）。
        const seededDays = buildSeededWeek();
        const seededPlan = menuPlanRepository.replaceWeek(WEEK_START, seededDays);
        expect(seededPlan.days).toHaveLength(7);

        const beforeSlotCount = db.prepare(`SELECT COUNT(*) AS count FROM meal_slots`).get() as {
          count: number;
        };
        expect(beforeSlotCount.count).toBe(28);

        const TARGET_DAY_INDEX = 3;

        const response = await app.inject({
          method: "POST",
          url: `/api/menu-plans/${WEEK_START}/days/${TARGET_DAY_INDEX}/regenerate`,
        });

        expect(response.statusCode).toBe(200);
        const body = response.json() as DayMenu;
        expect(body.dayIndex).toBe(TARGET_DAY_INDEX);
        expect(body.meals).toHaveLength(4);

        // フェイクのAnthropicクライアントは1回目のDAILY_GENERATION_TOOL_NAME呼び出しに
        // "daily-gen1"ラベルを用いる（このテストは日単位再生成を1回のみ行使する）。
        const expectedDailyInput = buildDailyToolInput("daily-gen1");

        // Requirement 7.4: レスポンスが対象日の"新しい"（Claudeモックの）献立を反映している
        // ことを、内容そのもの（dishName・食品ID）の一致で確認する。
        for (const expectedMeal of expectedDailyInput.meals) {
          const actualMeal = body.meals.find((meal) => meal.mealType === expectedMeal.mealType);
          expect(actualMeal).toBeDefined();
          expect(actualMeal?.dishName).toBe(expectedMeal.dishName);
          expect(actualMeal?.ingredients).toEqual(
            expectedIngredientsFromWire(expectedMeal.ingredients)
          );
          // シードデータの料理名とは異なる（=置き換わったことの追加確認）。
          const seededMeal = seededDays[TARGET_DAY_INDEX]?.meals.find(
            (meal) => meal.mealType === expectedMeal.mealType
          );
          expect(actualMeal?.dishName).not.toBe(seededMeal?.dishName);
        }

        // Requirement 7.4: meal_slotsの総数は変わらない（対象日の4件が削除→再挿入されただけで、
        // 重複永続化されていない）。
        const afterSlotCount = db.prepare(`SELECT COUNT(*) AS count FROM meal_slots`).get() as {
          count: number;
        };
        expect(afterSlotCount.count).toBe(28);

        const persisted = menuPlanRepository.getActivePlan(WEEK_START);
        expect(persisted).not.toBeNull();
        expect(persisted?.days).toHaveLength(7);

        const persistedTargetDay = persisted?.days.find((day) => day.dayIndex === TARGET_DAY_INDEX);
        expect(persistedTargetDay).toBeDefined();
        for (const expectedMeal of expectedDailyInput.meals) {
          const persistedMeal = persistedTargetDay?.meals.find(
            (meal) => meal.mealType === expectedMeal.mealType
          );
          expect(persistedMeal?.dishName).toBe(expectedMeal.dishName);
          expect(persistedMeal?.ingredients).toEqual(
            expectedIngredientsFromWire(expectedMeal.ingredients)
          );
        }

        // Requirement 7.1: 残り6日は完全に不変であることを、dishName・食品ID・栄養価
        // （13項目すべて）を含む `meals` 配列全体のバイト単位（deep-equal）一致で確認する。
        // 単に「4食枠ある」だけでなく、シード投入時の内容そのものと厳密に一致することを見る。
        for (const seededDay of seededDays) {
          if (seededDay.dayIndex === TARGET_DAY_INDEX) {
            continue;
          }
          const persistedDay = persisted?.days.find((day) => day.dayIndex === seededDay.dayIndex);
          expect(persistedDay).toBeDefined();
          expect(persistedDay?.meals).toEqual(seededDay.meals);
          expect(persistedDay?.plannedKcal).toBe(seededDay.plannedKcal);
          expect(persistedDay?.targetKcal).toBe(seededDay.targetKcal);
        }

        // Note (scope): Requirement 7.4's other clause -- "当該日について提供済みの計画摂取
        // カロリー値を更新する" (PlannedCalorieGateway.submitPlannedCalories is called for the
        // regenerated day) -- is deliberately NOT re-verified here via the real DailyLogService.
        // That call-count/args/failure-swallowing/lock-interaction behavior is already
        // thoroughly unit-tested with a fake PlannedCalorieGateway in
        // `menu-plan.service.test.ts`'s `regenerateDay` describe block; this file's own scope
        // (per its task brief) is the two flows named in task 12.2's text (day-replace isolation
        // and recipe-detail/nutrition-unchanged), not a re-proof of every sub-clause already
        // covered elsewhere. `dailyLogService` is still wired for real (not faked) since
        // `MenuPlanService`'s real orchestration calls it regardless.
      },
      20000
    );

    it(
      "POST /:week/days/:dayIndex/meals/:mealType/recipe-detail returns recipe steps AND " +
        "1-2 supplementary suggestions in the SAME response, while the target meal slot's " +
        "dishName/ingredients/nutrition remain byte-for-byte unchanged (Req 8.1, 8.3, 9.1)",
      async () => {
        const saveResult = profileService.saveProfile(buildValidProfileInput());
        expect(saveResult.ok).toBe(true);

        const seededDays = buildSeededWeek();
        menuPlanRepository.replaceWeek(WEEK_START, seededDays);

        const TARGET_DAY_INDEX = 2;
        const TARGET_MEAL_TYPE: MealType = "lunch";

        const before = menuPlanRepository.findMealSlot(WEEK_START, TARGET_DAY_INDEX, TARGET_MEAL_TYPE);
        expect(before).not.toBeNull();
        // 独立したディープコピーを保持する（後で「同一オブジェクト参照ゆえに一致して見える」
        // という見せかけの一致を避けるため）。
        const beforeSnapshot = JSON.parse(
          JSON.stringify({
            dishName: before?.dishName,
            ingredients: before?.ingredients,
            nutrition: before?.nutrition,
          })
        ) as { dishName: string; ingredients: unknown; nutrition: VerifiedNutritionValues };

        const response = await app.inject({
          method: "POST",
          url: `/api/menu-plans/${WEEK_START}/days/${TARGET_DAY_INDEX}/meals/${TARGET_MEAL_TYPE}/recipe-detail`,
        });

        expect(response.statusCode).toBe(200);
        const body = response.json() as RecipeDetail;
        expect(body.mealSlotId).toBe(before?.id);

        // フェイクのAnthropicクライアントは1回目のRECIPE_GENERATION_TOOL_NAME呼び出しに
        // "recipe-gen1"ラベルを用いる（このテストはレシピ詳細生成を1回のみ行使する）。
        const expectedRecipeInput = buildRecipeToolInput("recipe-gen1");

        // Requirement 8.1, 8.2: 調理手順・人前・目安調理時間がレスポンスに含まれる。
        expect(body.servings).toBe(expectedRecipeInput.servings);
        expect(body.cookingTimeMinutes).toBe(expectedRecipeInput.cookingTimeMinutes);
        expect(body.steps).toEqual(expectedRecipeInput.steps);

        // Requirement 8.2: 対象食事枠自身の栄養内訳（エネルギー量・PFC量）が同一レスポンスに
        // 含まれ、値は変更前の食事枠の値そのものである。
        expect(body.nutrition).toEqual({
          energyKcal: beforeSnapshot.nutrition.energyKcal,
          proteinG: beforeSnapshot.nutrition.proteinG,
          fatG: beforeSnapshot.nutrition.fatG,
          carbG: beforeSnapshot.nutrition.carbG,
        });

        // Requirement 9.1: 「同一レスポンス」に1〜2件の補助副菜提案が含まれる
        // （レシピ手順と別レスポンスではないことを明示的に確認する）。
        expect(body.supplementarySuggestions.length).toBeGreaterThanOrEqual(1);
        expect(body.supplementarySuggestions.length).toBeLessThanOrEqual(2);
        expect(body.supplementarySuggestions).toHaveLength(SUPPLEMENTARY_SUGGESTION_COUNT);

        body.supplementarySuggestions.forEach((suggestion, index) => {
          const expectedSuggestion = expectedRecipeInput.supplementarySuggestions[index];
          expect(expectedSuggestion).toBeDefined();
          expect(suggestion.dishName).toBe(expectedSuggestion?.dishName);
          expect(suggestion.ingredients).toEqual(
            expectedIngredientsFromWire(expectedSuggestion?.ingredients ?? [])
          );
          // Requirement 9.3: 各候補の栄養増分（エネルギー量・PFC量）が数値として提供される
          // （実際の食品成分DBに対する検証済みの値。具体値はDBデータに依存するため形状のみ検証）。
          expect(suggestion.nutritionDelta).toEqual({
            energyKcal: expect.any(Number),
            proteinG: expect.any(Number),
            fatG: expect.any(Number),
            carbG: expect.any(Number),
          });
        });

        // Requirement 8.3: 対象食事枠の栄養価は変更されない。dishName・ingredients・nutritionが
        // 呼び出し前後でバイト単位で一致することを、実DBへの再クエリで確認する。
        const after = menuPlanRepository.findMealSlot(WEEK_START, TARGET_DAY_INDEX, TARGET_MEAL_TYPE);
        expect(after).not.toBeNull();
        expect(after?.dishName).toBe(beforeSnapshot.dishName);
        expect(after?.ingredients).toEqual(beforeSnapshot.ingredients);
        expect(after?.nutrition).toEqual(beforeSnapshot.nutrition);

        // meal_slotsの総数も変わらない（レシピ詳細生成は新たな食事枠を追加しない）。
        const slotCount = db.prepare(`SELECT COUNT(*) AS count FROM meal_slots`).get() as {
          count: number;
        };
        expect(slotCount.count).toBe(28);
      },
      20000
    );
  }
);
