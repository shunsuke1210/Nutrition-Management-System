import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { MealType, ProfileInput, WeekMenuPlan } from "@nutrition/shared";
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
import {
  createClaudeMenuClient,
  WEEKLY_GENERATION_TOOL_NAME,
  type AnthropicMessagesClient,
} from "./claude-menu.client.js";
import { createClaudeMenuGenerator } from "./claude-menu.generator.js";
import { createMenuPlanService, type MenuPlanService } from "./menu-plan.service.js";
import { registerMenuPlanRoutes } from "./menu-plan.routes.js";

/**
 * `POST /api/menu-plans/:week/generate` と `POST /api/menu-plans/:week/regenerate` の
 * "真の"統合テスト（task 12.1）。
 *
 * `nutrition.summary.integration.test.ts`（task 5.4）が確立した precedent（実一時SQLite +
 * `createConnection`/`runMigrations` + `server/src/index.ts`(`startServer`) と同じ順序で
 * 構築したRepository→Service→Gatewayの実チェーン + `buildApp()` + ルート登録 +
 * `app.inject()`）をそのまま踏襲し、`menu-plan.routes.test.ts`（フェイクの `MenuPlanService`
 * で `MenuPlanController` のHTTP境界のみを検証する既存ファイル）とは別ファイルとして追加する。
 * 理由も同じ: `menu-plan.routes.test.ts` は「Controller単体をフェイクServiceで検証する」という
 * 一貫した境界を持ち、そこに実DB統合テストを混在させるとその境界の一貫性を崩す。本タスクの
 * 境界は `MenuPlanController → MenuPlanService → ProfileGateway/NutritionGateway/
 * PlannedCalorieGateway/FeedbackService/NutritionVerificationService/MenuPlanRepository →
 * user-profileのProfileService/DailyLogService・nutrition-engineのNutritionService →
 * 実SQLite` という全層を貫く検証であり、`nutrition.summary.integration.test.ts` が
 * nutrition-engine側で確立したこの型を menu-generation 側で踏襲する。
 *
 * ## 唯一フェイク化する依存: Claude API層
 * `ClaudeMenuClient` 自体（tool定義構築・`strict: true`・Zod再検証ロジック）は実装をそのまま
 * 使う（`createClaudeMenuClient`）。フェイク化するのは `AnthropicMessagesClient`
 * （`{messages: {create(params)}}` という最小契約、task 6.2のテスト容易性のためのDI境界）の
 * みであり、`claude-menu.client.test.ts` が確立した `buildFakeMessage`/`toolUseBlock` と
 * 同じ最小限のフィクスチャ形状を用いる。
 *
 * ## 実在する食品ID・単位コードについて
 * フェイクの `AnthropicMessagesClient.messages.create` が返す `tool_use.input` の食材は、
 * `010_seed_food_items.sql` が実際に投入した食品ID（`menu-plan.repository.test.ts` の
 * `FOOD_IDS` フィクスチャと同一の8件: "01088"/"12004"/"01006"/"01015"/"01020"/"01026"/
 * "01031"/"01034"）を用いる。単位は常に "g" を用いる
 * （`UnitConversionService.toGrams` は `unitCode === "g"` の場合 `unit_conversions` テーブルへ
 * 一切アクセスせず常に成功するため、`011_seed_unit_conversions.sql` の投入状況に依存せず
 * 決定論的に検証を成功させられる）。これにより `NutritionVerificationService.verifyDish` は
 * 実際の `food_items` 行に対して本物の栄養価計算を行い、フェイク化された食品IDによる
 * 見せかけの成功ではなく、真に検証を通過する。
 */

// --- ユーザープロフィールのフィクスチャ（nutrition.summary.integration.test.ts の
//     buildValidProfileInput と同じ形状。既に「計算可能なnutrition summaryを生成する」ことが
//     確認済みのフィクスチャを再利用する） ---

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

// --- 実在する食品ID（010_seed_food_items.sql、menu-plan.repository.test.ts の FOOD_IDS と同一） ---

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

const WEEK_START = "2026-01-05"; // 実在する月曜日始まりの週（2026-01-05は月曜日）。

// --- フェイクの Anthropic Messages API 応答フィクスチャ（claude-menu.client.test.ts の
//     buildFakeMessage/toolUseBlock と同じ最小限の形状） ---

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
 * `generationLabel`（呼び出しごとに一意な文字列、例: "gen1"/"gen2"）で全料理名を装飾した
 * 週間tool_use入力（wire形状: `{days:[{dayIndex, meals:[{mealType, dishName,
 * ingredients:[{food_id, quantity, unit}]}]}]}`）を構築する。各呼び出しの結果を判別可能に
 * することで、regenerate後に「新しい献立に置き換わった」ことを内容の変化として検証できる
 * （行数だけでなく実際の中身が変わったことの証拠）。
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
 * `AnthropicMessagesClient` のフェイク。唯一フェイク化するClaude API層本体
 * （タスクブリーフ参照）。`params.tool_choice.name` を検査して要求されたtoolを判別し
 * （このテストは週間生成/再生成のみを行使するため `WEEKLY_GENERATION_TOOL_NAME` のみに
 * 対応する。task 12.2/12.3 が日単位/レシピ生成の分岐を追加する際の拡張余地として、
 * 未対応のtool名は例外を投げて即座に失敗を顕在化させる）、呼び出しごとに内容が判別可能な
 * 週間献立を返す。また全リクエストの `params` を `capturedRequests` に記録し、
 * regenerate時のプロンプトに苦手サマリが反映されたことをテストが直接検証できるようにする。
 */
function createFakeAnthropicClient(
  capturedRequests: Anthropic.MessageCreateParamsNonStreaming[]
): AnthropicMessagesClient {
  let generationCallCount = 0;
  return {
    messages: {
      create: async (params) => {
        capturedRequests.push(params);
        const toolChoice = params.tool_choice;
        const toolName =
          toolChoice && toolChoice.type === "tool" ? toolChoice.name : undefined;

        if (toolName === WEEKLY_GENERATION_TOOL_NAME) {
          generationCallCount += 1;
          const input = buildWeeklyToolInput(`gen${generationCallCount}`);
          return buildFakeMessage([toolUseBlock(WEEKLY_GENERATION_TOOL_NAME, input)]);
        }

        throw new Error(
          `week-generation.integration.test の fake AnthropicMessagesClient: ` +
            `未対応のtool_choiceを受け取りました（本テストは週間生成/再生成のみを行使する対象）: ` +
            `${JSON.stringify(toolChoice)}`
        );
      },
    },
  };
}

describe("POST /api/menu-plans/:week/generate and /regenerate integration (real full-stack chain, Claude mocked)", () => {
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
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "week-generation-integration-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    db = createConnection(dbPath);
    runMigrations(db);

    // `server/src/index.ts`(`startServer`) と同じ構築順序: Repository → Service → Gateway →
    // 上位Service。

    // 1. user-profile side.
    const profileRepository = createProfileRepository(db);
    profileService = createProfileService(profileRepository);

    // 2. user-profile's daily-log side.
    const dailyLogRepository = createDailyLogRepository(db);
    dailyLogService = createDailyLogService(dailyLogRepository);

    // 3. nutrition-engine side (server/src/nutrition/ の独自のGateway/Service。
    //    menu-generation側の同名パターンのGatewayとは別物)。
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

    // 8. 唯一フェイク化する依存: Claude API層（AnthropicMessagesClientのみ）。
    capturedRequests = [];
    const fakeAnthropicClient = createFakeAnthropicClient(capturedRequests);
    const claudeMenuClient = createClaudeMenuClient(foodCompositionRepository, fakeAnthropicClient);
    const menuGenerator = createClaudeMenuGenerator(claudeMenuClient);

    // 9. MenuPlanServiceのオーケストレーション。
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
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it(
    "POST /:week/generate persists exactly 28 meal_slots rows (7 days x 4 meals) and " +
      "submits a real, positive planned calorie value to the daily log for all 7 days " +
      "(Req 1.1, 1.3, 11.1, 11.2)",
    async () => {
      const saveResult = profileService.saveProfile(buildValidProfileInput());
      expect(saveResult.ok).toBe(true);

      const response = await app.inject({
        method: "POST",
        url: `/api/menu-plans/${WEEK_START}/generate`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as WeekMenuPlan;
      expect(body.weekStartDate).toBe(WEEK_START);
      expect(body.days).toHaveLength(7);
      for (const day of body.days) {
        expect(day.meals).toHaveLength(4);
      }

      // Requirement 1.1: 28食枠すべてが永続化されたことを、実DBへの直接クエリで確認する。
      const slotCount = db.prepare(`SELECT COUNT(*) AS count FROM meal_slots`).get() as {
        count: number;
      };
      expect(slotCount.count).toBe(28);

      // 実DBからも同じプランが取得できることを確認する（Requirement 1.3: 永続化）。
      const persisted = menuPlanRepository.getActivePlan(WEEK_START);
      expect(persisted).not.toBeNull();
      expect(persisted?.days).toHaveLength(7);

      // Requirement 11.1, 11.2: PlannedCalorieGateway.submitPlannedCalories が全7日について
      // 呼ばれたことを、そのGateway自体をスパイするのではなく、実DBへの観測可能な効果
      // （user-profileのdaily_logsに実際の正の計画摂取カロリー値が反映されていること）
      // として検証する。
      for (const day of body.days) {
        const log = dailyLogService.getLog(day.dayDate);
        expect(log).not.toBeNull();
        expect(log?.plannedKcal).not.toBeNull();
        expect(log?.plannedKcal).toBeGreaterThan(0);
        expect(log?.plannedKcal).toBeCloseTo(day.plannedKcal);
      }
    },
    20000
  );

  it(
    "POST /:week/regenerate REPLACES the prior plan (still exactly 28 meal_slots rows, not 56) " +
      "and the disliked feedback's dish name/food ID genuinely reaches the Claude prompt " +
      "(Req 6.1, 6.2, 6.3)",
    async () => {
      const saveResult = profileService.saveProfile(buildValidProfileInput());
      expect(saveResult.ok).toBe(true);

      const generateResponse = await app.inject({
        method: "POST",
        url: `/api/menu-plans/${WEEK_START}/generate`,
      });
      expect(generateResponse.statusCode).toBe(200);
      const firstPlan = generateResponse.json() as WeekMenuPlan;

      const firstDay0 = firstPlan.days.find((day) => day.dayIndex === 0);
      expect(firstDay0).toBeDefined();
      const dislikedMeal = firstDay0?.meals.find((meal) => meal.mealType === "breakfast");
      expect(dislikedMeal).toBeDefined();

      // 「苦手」フィードバックを、実際に生成された食事枠に対して記録する
      // （feedbackService.recordFeedback を直接呼び出す — task brief が許容する2つの経路の
      // うち、meal-slot.routes.ts の登録（RecipeDetailServiceの追加構築を要する）を伴わない
      // 経路。このタスクの境界は generate/regenerate の2フローのみであるため、
      // registerMealSlotRoutes 相当のチェーンは意図的に構築しない）。
      const feedbackResult = feedbackService.recordFeedback(WEEK_START, 0, "breakfast", {
        liked: false,
      });
      expect(feedbackResult.ok).toBe(true);

      const beforeRegenerateCount = db.prepare(`SELECT COUNT(*) AS count FROM meal_slots`).get() as {
        count: number;
      };
      expect(beforeRegenerateCount.count).toBe(28);

      const regenerateResponse = await app.inject({
        method: "POST",
        url: `/api/menu-plans/${WEEK_START}/regenerate`,
      });
      expect(regenerateResponse.statusCode).toBe(200);
      const secondPlan = regenerateResponse.json() as WeekMenuPlan;
      expect(secondPlan.days).toHaveLength(7);

      // Requirement 6.1: 既存の28食枠分の献立が「置き換わる」ことを、重複永続化されていない
      // （56件になっていない）ことで確認する。
      const afterRegenerateCount = db.prepare(`SELECT COUNT(*) AS count FROM meal_slots`).get() as {
        count: number;
      };
      expect(afterRegenerateCount.count).toBe(28);

      // 単に行数が同じであるだけでなく、内容自体が新しい献立に置き換わったことを確認する
      // （フェイクのAnthropicクライアントは呼び出しごとに判別可能な料理名を返すため）。
      const secondDay0 = secondPlan.days.find((day) => day.dayIndex === 0);
      const secondDislikedMeal = secondDay0?.meals.find((meal) => meal.mealType === "breakfast");
      expect(secondDislikedMeal).toBeDefined();
      expect(secondDislikedMeal?.dishName).not.toBe(dislikedMeal?.dishName);

      // Requirement 6.3: 影響を受けた日について提供済みの計画摂取カロリー値が更新されている。
      const updatedLog = dailyLogService.getLog(secondDay0?.dayDate ?? WEEK_START);
      expect(updatedLog?.plannedKcal).toBeCloseTo(secondDay0?.plannedKcal ?? -1);

      // Requirement 6.2: 苦手サマリが再生成のプロンプトに反映されたことを、フェイクの
      // AnthropicMessagesClientが実際に受け取ったリクエストのcaptureから直接確認する
      // （スパイの呼び出し有無ではなく、プロンプトの実内容そのものを検証する）。
      const weeklyToolRequests = capturedRequests.filter((params) => {
        const toolChoice = params.tool_choice;
        return toolChoice?.type === "tool" && toolChoice.name === WEEKLY_GENERATION_TOOL_NAME;
      });
      // 1回目 = generate、2回目 = regenerate。
      expect(weeklyToolRequests).toHaveLength(2);

      const regenerateRequest = weeklyToolRequests[1];
      expect(regenerateRequest).toBeDefined();
      const regenerateSystemPrompt = String(regenerateRequest?.system ?? "");

      expect(regenerateSystemPrompt).toContain(dislikedMeal?.dishName ?? "__missing_dish_name__");
      for (const ingredient of dislikedMeal?.ingredients ?? []) {
        expect(regenerateSystemPrompt).toContain(ingredient.foodId);
      }
    },
    20000
  );
});
