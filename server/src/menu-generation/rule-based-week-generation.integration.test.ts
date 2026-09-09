import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  ProfileInput,
  RecipeDetail,
  RestrictionType,
  ShoppingList,
  WeekMenuPlan,
} from "@nutrition/shared";
import { buildApp } from "../app.js";
import { createConnection } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";

import { createProfileRepository } from "../profile/profile.repository.js";
import { createProfileService, type ProfileService } from "../profile/profile.service.js";
import { createDailyLogRepository } from "../daily-log/daily-log.repository.js";
import { createDailyLogService } from "../daily-log/daily-log.service.js";

// nutrition-engine's OWN gateways/service (server/src/nutrition/) -- DIFFERENT from
// menu-generation's own gateways of similar names (see the imports below).
import { createProfileGateway as createNutritionEngineProfileGateway } from "../nutrition/profile.gateway.js";
import { createDailyLogGateway as createNutritionEngineDailyLogGateway } from "../nutrition/daily-log.gateway.js";
import { createNutritionService } from "../nutrition/nutrition.service.js";

// menu-generation's own Gateways (server/src/menu-generation/).
import { createProfileGateway as createMenuProfileGateway } from "./profile.gateway.js";
import { createNutritionGateway as createMenuNutritionGateway } from "./nutrition.gateway.js";
import { createPlannedCalorieGateway } from "./planned-calorie.gateway.js";

import {
  createFoodCompositionRepository,
  type FoodCompositionRepository,
} from "./food-composition.repository.js";
import { createUnitConversionService } from "./unit-conversion.service.js";
import { createNutritionVerificationService } from "./nutrition-verification.service.js";
import { createMenuPlanRepository, type MenuPlanRepository } from "./menu-plan.repository.js";
import { createFeedbackRepository } from "./feedback.repository.js";
import { createFeedbackService, type FeedbackService } from "./feedback.service.js";
import { createRecipeDetailRepository } from "./recipe-detail.repository.js";
import { createRecipeDetailService, type RecipeDetailService } from "./recipe-detail.service.js";
import { createShoppingListService, type ShoppingListService } from "./shopping-list.service.js";
import {
  createEatingOutSuggestionService,
  type EatingOutSuggestionService,
} from "./eating-out-suggestion.service.js";
import { createRuleBasedMenuGenerator } from "./rule-based-menu.generator.js";
import { RULE_BASED_RECIPES } from "./rule-based-recipe.data.js";
import { createMenuPlanService, type MenuPlanService } from "./menu-plan.service.js";
import { registerMenuPlanRoutes } from "./menu-plan.routes.js";
import { registerMealSlotRoutes } from "./meal-slot.routes.js";

/**
 * `RuleBasedMenuGenerator`（task 17.3-17.5、非AI献立生成）の"真の"結合テスト（task 17.6）。
 *
 * `week-generation.integration.test.ts`（task 12.1）が確立したprecedent（実一時SQLite +
 * `createConnection`/`runMigrations` + `server/src/index.ts`(`startServer`)と同じ順序で構築した
 * Repository→Service→Gatewayの実チェーン + `app.inject()`）をそのまま踏襲するが、唯一かつ最大の
 * 違いは **フェイクの`AnthropicMessagesClient`が一切登場しない** ことである。
 * `RuleBasedMenuGenerator`はAI・ネットワークを一切呼ばない決定論的な`MenuGenerator`実装
 * （`rule-based-menu.generator.ts`冒頭コメント参照）であるため、`server/src/index.ts`の実際の
 * composition root（task 17.5）が行っているのと同じく、`createRuleBasedMenuGenerator({
 * foodCompositionRepository })` を`MenuPlanService`/`RecipeDetailService`双方へそのまま渡す。
 * これにより本テストは、既存の`week-generation.integration.test.ts`
 * （Claude実装をフェイクのAnthropicクライアントでラップする、task 12.1時点の構成）とは
 * 明確に異なる対象——現在実際にcomposition rootが配線している非AI経路そのもの——を検証する。
 * 既存ファイルは一切変更しない（TASK_BRIEF指示どおり）。
 *
 * ## 実在する食品ID・データについて
 * `rule-based-recipe.data.ts`（task 17.2）は実在する`food_items`（`010_seed_food_items.sql`）
 * からのみ食品IDを採用しているため、単位はすべて`"g"`（`UnitConversionService.toGrams`が
 * `unit_conversions`テーブルへ一切アクセスせず常に成功する安全な単位、`rule-based-recipe.data.ts`
 * 冒頭コメント参照）であり、`unit_conversions`のシード状況に依存せず決定論的に検証を成功させられる。
 *
 * ## 「米」をNG食材にすると週間生成全体が失敗するという実データ上の発見と、その是正について
 * 本テストの初版作成時、`RULE_BASED_RECIPES`のdinner（夕食）12件が**全件**`tags`に"米"を含む
 * ことが判明した。`RuleBasedMenuGenerator`の必須フィルタ（`filterMandatoryCandidates`、
 * `mealType`一致・NG食材除外は安全性のため絶対に緩めない設計）はこの場合dinner枠の候補を
 * 0件まで絞り込むため、`ngIngredients: ["米"]`を設定したプロフィールでの週間生成が
 * 必ず`schema_validation_failed`で失敗していた。`server/src/index.ts`でClaude版がコメント
 * アウト済みでフォールバック手段が存在しないことも踏まえ、レビューはこれを「本task 17.6が
 * 是正すべき重大な実害」と判定した（米アレルギー・低糖質志向等で"米"をNG食材登録するのは
 * 十分自然な入力であり、その瞬間に週間献立生成機能全体が決定論的かつ恒久的に使用不能になるため）。
 * 同様に、当初のdinner 12件は`restrictionSuitability`に`low_carb`を含むものが0件であり、
 * `restrictionType: "low_carb"`を選んだユーザーは夕食について常に`filterByRestriction`の
 * フォールバック（制限を無視した全候補からの選定）をサイレントに受け取っていた。
 *
 * この指摘を受け、`rule-based-recipe.data.ts`のdinnerに"米"を使わず`low_carb`にも適合する
 * 候補を2件追加した（`鶏むね肉と彩り野菜のグリル`・`鮭のハーブソテーと温野菜`、
 * `rule-based-recipe.data.ts`冒頭コメント「task 17.6是正」参照）。これにより下記の
 * 「NG食材:'米'」テストは失敗を検証する専用テストから、正しく除外されたうえで生成が成功する
 * ことを検証するテストへ更新した。`rule-based-recipe.data.test.ts`にも、この2点（"米"を含まない
 * 夕食エントリ・`low_carb`適合の夕食エントリがそれぞれ最低1件存在すること）の回帰防止テストを
 * 追加済み。
 */

// --- ユーザープロフィールのフィクスチャ（week-generation.integration.test.ts と同じ形状） ---

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

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

// 卵（鶏卵、全卵・生 / 全卵・ゆで）の実在食品ID。`rule-based-recipe.data.ts`を精査した結果、
// この2つのfoodIdはいずれも必ず`tags: ["卵", ...]`を含むエントリからのみ出現する
// （目玉焼きトースト・ハムエッグ・フレンチトースト・スクランブルエッグとソーセージ・
// 野菜たっぷり豆腐チャンプルー・ゆで卵の6件、全て確認済み）。
const EGG_RAW_FOOD_ID = "12004";
const EGG_BOILED_FOOD_ID = "12005";

// ごはん（精白米・うるち米）の実在食品ID。`rule-based-recipe.data.ts`を精査した結果、
// "米"タグを持つ全エントリはこのfoodIdのみを使う（他に米由来のfoodIdは登場しない）。
const RICE_FOOD_ID = "01088";

function findRecipeEntryByDishName(dishName: string) {
  return RULE_BASED_RECIPES.find((entry) => entry.dishName === dishName) ?? null;
}

/**
 * `server/src/index.ts`(`startServer`)と同じ構築順序でRepository→Service→Gatewayの実チェーンを
 * 組み立てる（`RuleBasedMenuGenerator`をアダプタとして注入する点のみが、Claude版を使う既存の
 * 結合テストと異なる）。
 */
function buildChain(db: Database.Database) {
  // 1. user-profile side.
  const profileRepository = createProfileRepository(db);
  const profileService = createProfileService(profileRepository);

  // 2. user-profile's daily-log side.
  const dailyLogRepository = createDailyLogRepository(db);
  const dailyLogService = createDailyLogService(dailyLogRepository);

  // 3. nutrition-engine side.
  const nutritionEngineProfileGateway = createNutritionEngineProfileGateway(profileService);
  const nutritionEngineDailyLogGateway = createNutritionEngineDailyLogGateway(dailyLogService);
  const nutritionService = createNutritionService(
    nutritionEngineProfileGateway,
    nutritionEngineDailyLogGateway
  );

  // 4. menu-generation's own Gateways.
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
  const menuPlanRepository = createMenuPlanRepository(db, unitConversionService);

  // 7. 満足度フィードバック。
  const feedbackRepository = createFeedbackRepository(db);
  const feedbackService = createFeedbackService(feedbackRepository, menuPlanRepository);

  // 8. レシピ詳細の永続化。
  const recipeDetailRepository = createRecipeDetailRepository(db, unitConversionService);

  // 9. `MenuGenerator`: AIを一切使わない`RuleBasedMenuGenerator`（本テストの主題）。
  // `server/src/index.ts`と同様、`MenuPlanService`/`RecipeDetailService`の両方へ同一インスタンスを
  // 渡す（`random`は既定の`Math.random`のまま、選定ロジック自体の決定論性ではなく実DBとの結合を
  // 検証するのが本テストの目的のため）。
  const menuGenerator = createRuleBasedMenuGenerator({ foodCompositionRepository });

  const menuPlanService: MenuPlanService = createMenuPlanService({
    profileGateway: menuProfileGateway,
    nutritionGateway: menuNutritionGateway,
    plannedCalorieGateway,
    feedbackService,
    menuGenerator,
    nutritionVerificationService,
    menuPlanRepository,
  });

  const recipeDetailService: RecipeDetailService = createRecipeDetailService({
    menuPlanRepository,
    profileGateway: menuProfileGateway,
    menuGenerator,
    nutritionVerificationService,
    recipeDetailRepository,
    foodCompositionRepository,
  });

  const shoppingListService: ShoppingListService = createShoppingListService(
    menuPlanRepository,
    foodCompositionRepository,
    unitConversionService
  );

  const eatingOutSuggestionService: EatingOutSuggestionService = createEatingOutSuggestionService(
    menuPlanRepository,
    menuProfileGateway
  );

  return {
    profileService,
    foodCompositionRepository,
    menuPlanRepository,
    menuPlanService,
    recipeDetailService,
    shoppingListService,
    feedbackService,
    eatingOutSuggestionService,
  };
}

// ============================================================
// Part 1: MenuPlanService（RuleBasedMenuGenerator注入）を直接呼び出す結合テスト。
// 実DBへの永続化・再取得、NG食材フィルタ、食事制限フィルタを検証する。
// ============================================================

describe("MenuPlanService with RuleBasedMenuGenerator (real DB, real food_items, no Claude API)", () => {
  const WEEK_START = "2026-02-02"; // 実在する月曜日始まりの週。

  let tmpDir: string;
  let db: Database.Database;
  let profileService: ProfileService;
  let menuPlanRepository: MenuPlanRepository;
  let menuPlanService: MenuPlanService;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "rule-based-week-generation-integration-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    db = createConnection(dbPath);
    runMigrations(db);

    const chain = buildChain(db);
    profileService = chain.profileService;
    menuPlanRepository = chain.menuPlanRepository;
    menuPlanService = chain.menuPlanService;
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it(
    "generates a full week via RuleBasedMenuGenerator for a baseline profile (no NG " +
      "ingredients, restrictionType: none), persists exactly 28 meal_slots rows, and re-fetching " +
      "via menuPlanRepository.getActivePlan restores the identical WeekMenuPlan",
    async () => {
      const saveResult = profileService.saveProfile(buildValidProfileInput());
      expect(saveResult.ok).toBe(true);

      const generateResult = await menuPlanService.generateWeek(WEEK_START);
      if (!generateResult.ok) {
        throw new Error(`unexpected generateWeek failure: ${JSON.stringify(generateResult.error)}`);
      }
      const plan = generateResult.value;

      expect(plan.weekStartDate).toBe(WEEK_START);
      expect(plan.days).toHaveLength(7);
      for (const day of plan.days) {
        expect(day.meals).toHaveLength(4);
        for (const meal of day.meals) {
          expect(meal.ingredients.length).toBeGreaterThan(0);
          // 生成された料理名が実際にRULE_BASED_RECIPESに存在する（AIを一切呼ばず、
          // キュレーション済みDBから選定されたことの直接的な証拠）。
          expect(findRecipeEntryByDishName(meal.dishName)).not.toBeNull();
        }
      }

      // 28食枠すべてが実DBへ永続化されたことを直接クエリで確認する。
      const slotCount = db.prepare(`SELECT COUNT(*) AS count FROM meal_slots`).get() as {
        count: number;
      };
      expect(slotCount.count).toBe(28);

      // 再取得（menuPlanRepository.getActivePlan）で同一内容が復元できることを確認する。
      const refetched = menuPlanRepository.getActivePlan(WEEK_START);
      expect(refetched).not.toBeNull();
      expect(refetched).toEqual(plan);
    },
    20000
  );

  it(
    "with ngIngredients: ['卵'], every one of the 28 generated meal slots' ingredients excludes " +
      "both egg food IDs (12004/12005), and the underlying RULE_BASED_RECIPES entry for each " +
      "selected dish is confirmed NOT tagged '卵' (proves the tag-based NG filter, not " +
      "coincidence, drove the exclusion)",
    async () => {
      const saveResult = profileService.saveProfile(buildValidProfileInput({ ngIngredients: ["卵"] }));
      expect(saveResult.ok).toBe(true);

      const generateResult = await menuPlanService.generateWeek(WEEK_START);
      if (!generateResult.ok) {
        throw new Error(`unexpected generateWeek failure: ${JSON.stringify(generateResult.error)}`);
      }
      const plan = generateResult.value;
      expect(plan.days).toHaveLength(7);

      for (const day of plan.days) {
        for (const meal of day.meals) {
          for (const ingredient of meal.ingredients) {
            expect(ingredient.foodId).not.toBe(EGG_RAW_FOOD_ID);
            expect(ingredient.foodId).not.toBe(EGG_BOILED_FOOD_ID);
          }

          const entry = findRecipeEntryByDishName(meal.dishName);
          expect(entry).not.toBeNull();
          expect(entry?.tags ?? []).not.toContain("卵");
        }
      }
    },
    20000
  );

  it(
    "with ngIngredients: ['米'], generateWeek SUCCEEDS (task 17.6 remediation: " +
      "rule-based-recipe.data.ts now has 2 rice-free dinner entries specifically so this no " +
      "longer exhausts dinner's mandatory candidate pool -- previously ALL 12 original dinner " +
      "entries were tagged '米', which meant registering '米' as an NG ingredient deterministically " +
      "and permanently broke weekly menu generation entirely; see the file-header comment). Every " +
      "one of the 28 generated meal slots' ingredients excludes foodId '01088' (ごはん, the only " +
      "rice ingredient used anywhere in RULE_BASED_RECIPES), and every dinner slot is confirmed " +
      "(by reverse lookup) to be one of the two newly-added rice-free dinner entries",
    async () => {
      const saveResult = profileService.saveProfile(buildValidProfileInput({ ngIngredients: ["米"] }));
      expect(saveResult.ok).toBe(true);

      const generateResult = await menuPlanService.generateWeek(WEEK_START);
      if (!generateResult.ok) {
        throw new Error(`unexpected generateWeek failure: ${JSON.stringify(generateResult.error)}`);
      }
      const plan = generateResult.value;
      expect(plan.days).toHaveLength(7);

      const RICE_FREE_DINNER_DISH_NAMES = ["鶏むね肉と彩り野菜のグリル", "鮭のハーブソテーと温野菜"];

      for (const day of plan.days) {
        for (const meal of day.meals) {
          for (const ingredient of meal.ingredients) {
            expect(ingredient.foodId).not.toBe(RICE_FOOD_ID);
          }

          const entry = findRecipeEntryByDishName(meal.dishName);
          expect(entry).not.toBeNull();
          expect(entry?.tags ?? []).not.toContain("米");

          if (meal.mealType === "dinner") {
            expect(RICE_FREE_DINNER_DISH_NAMES).toContain(meal.dishName);
          }
        }
      }
    },
    20000
  );

  it(
    "succeeds (does not error) for restrictionType 'low_fat', 'high_protein', and " +
      "'calorie_only' respectively",
    async () => {
      const restrictionTypesToCheck: RestrictionType[] = ["low_fat", "high_protein", "calorie_only"];

      for (const restrictionType of restrictionTypesToCheck) {
        // 各restrictionTypeごとに独立した週開始日を使う（同一DB内で複数回generateWeekを呼ぶため、
        // 週が重複すると2回目以降はreplaceWeekが「置き換え」扱いになるだけで問題はないが、
        // 各ケースを独立に検証できるよう明示的に日付をずらす）。
        const weekStart = restrictionType === "low_fat"
          ? "2026-02-09"
          : restrictionType === "high_protein"
            ? "2026-02-16"
            : "2026-02-23";

        const saveResult = profileService.saveProfile(
          buildValidProfileInput({ restrictionType, restrictionIntensity: "standard" })
        );
        expect(saveResult.ok).toBe(true);

        const generateResult = await menuPlanService.generateWeek(weekStart);
        if (!generateResult.ok) {
          throw new Error(
            `unexpected generateWeek failure for restrictionType=${restrictionType}: ` +
              JSON.stringify(generateResult.error)
          );
        }
        expect(generateResult.value.days).toHaveLength(7);
        for (const day of generateResult.value.days) {
          expect(day.meals).toHaveLength(4);
        }
      }
    },
    20000
  );

  it(
    "with restrictionType 'low_carb', generation succeeds and EVERY dish across all 7 days and " +
      "all 4 mealTypes (dinner included) is confirmed (by reverse lookup into RULE_BASED_RECIPES) " +
      "to have 'low_carb' in its restrictionSuitability (task 17.6 remediation: dinner previously " +
      "had ZERO low_carb-tagged entries, so users selecting restrictionType 'low_carb' silently " +
      "received RuleBasedMenuGenerator's soft-fallback -- i.e. the restriction was ignored -- for " +
      "dinner every single time; rule-based-recipe.data.ts now has 2 rice-free dinner entries " +
      "that are also low_carb-suitable, so the restricted candidate set for dinner is no longer " +
      "empty and the fallback no longer engages)",
    async () => {
      const saveResult = profileService.saveProfile(
        buildValidProfileInput({ restrictionType: "low_carb", restrictionIntensity: "standard" })
      );
      expect(saveResult.ok).toBe(true);

      const generateResult = await menuPlanService.generateWeek(WEEK_START);
      if (!generateResult.ok) {
        throw new Error(`unexpected generateWeek failure: ${JSON.stringify(generateResult.error)}`);
      }
      const plan = generateResult.value;
      expect(plan.days).toHaveLength(7);

      for (const day of plan.days) {
        for (const meal of day.meals) {
          const entry = findRecipeEntryByDishName(meal.dishName);
          expect(entry).not.toBeNull();
          expect(entry?.restrictionSuitability ?? []).toContain("low_carb");
        }
      }
    },
    20000
  );
});

// ============================================================
// Part 2: 実HTTPチェーン結合テスト（generate → shopping-list → recipe-detail）。
// `RuleBasedMenuGenerator`はネットワーク呼び出しを一切行わないため、Claude層のフェイクは
// 一切不要（`shopping-list-eating-out.integration.test.ts`が必要としていた「呼ばれたら例外を
// 投げるフェイクAnthropicクライアント」自体が本テストには存在しない）。
// ============================================================

describe(
  "HTTP round trip: POST /generate -> GET /shopping-list -> POST /recipe-detail " +
    "(RuleBasedMenuGenerator, real DB, real full-stack chain, no Claude API involved at all)",
  () => {
    const WEEK_START = "2026-03-02"; // 実在する月曜日始まりの週（Part 1とは別の週）。

    let tmpDir: string;
    let db: Database.Database;
    let app: FastifyInstance;
    let profileService: ProfileService;

    beforeEach(() => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), "rule-based-week-generation-http-integration-test-"));
      const dbPath = path.join(tmpDir, "test.db");
      db = createConnection(dbPath);
      runMigrations(db);

      const chain = buildChain(db);
      profileService = chain.profileService;

      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, chain.menuPlanService, chain.shoppingListService);
      registerMealSlotRoutes(
        app,
        chain.recipeDetailService,
        chain.feedbackService,
        chain.eatingOutSuggestionService
      );
    });

    afterEach(async () => {
      await app.close();
      db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it(
      "completes generate -> shopping-list -> recipe-detail with 200 responses whose bodies " +
        "are structurally valid (shopping list items classified into valid categories with " +
        "positive quantities; recipe detail carries non-empty steps/ingredients/names and 1-2 " +
        "supplementary suggestions)",
      async () => {
        const saveResult = profileService.saveProfile(buildValidProfileInput());
        expect(saveResult.ok).toBe(true);

        const generateResponse = await app.inject({
          method: "POST",
          url: `/api/menu-plans/${WEEK_START}/generate`,
        });
        expect(generateResponse.statusCode).toBe(200);
        const plan = generateResponse.json() as WeekMenuPlan;
        expect(plan.weekStartDate).toBe(WEEK_START);
        expect(plan.days).toHaveLength(7);
        for (const day of plan.days) {
          expect(day.meals).toHaveLength(4);
        }

        const slotCount = db.prepare(`SELECT COUNT(*) AS count FROM meal_slots`).get() as {
          count: number;
        };
        expect(slotCount.count).toBe(28);

        const shoppingListResponse = await app.inject({
          method: "GET",
          url: `/api/menu-plans/${WEEK_START}/shopping-list`,
        });
        expect(shoppingListResponse.statusCode).toBe(200);
        const shoppingList = shoppingListResponse.json() as ShoppingList;
        expect(shoppingList.weekStartDate).toBe(WEEK_START);
        expect(shoppingList.items.length).toBeGreaterThan(0);

        const VALID_CATEGORIES = ["野菜・きのこ", "肉・魚", "乳製品・卵・豆", "調味料・その他"];
        for (const item of shoppingList.items) {
          expect(VALID_CATEGORIES).toContain(item.category);
          expect(item.quantityGrams).toBeGreaterThan(0);
          expect(item.name.length).toBeGreaterThan(0);
        }

        // day0の朝食枠のレシピ詳細を生成する（4mealTypeいずれも必ず存在するため、
        // どのmealTypeを選んでも成立するが、代表として朝食を選ぶ）。
        const recipeDetailResponse = await app.inject({
          method: "POST",
          url: `/api/menu-plans/${WEEK_START}/days/0/meals/breakfast/recipe-detail`,
        });
        expect(recipeDetailResponse.statusCode).toBe(200);
        const recipeDetail = recipeDetailResponse.json() as RecipeDetail;
        expect(recipeDetail.servings).toBeGreaterThan(0);
        expect(recipeDetail.cookingTimeMinutes).toBeGreaterThan(0);
        expect(recipeDetail.steps.length).toBeGreaterThan(0);
        expect(recipeDetail.ingredients.length).toBeGreaterThan(0);
        for (const ingredient of recipeDetail.ingredients) {
          expect(ingredient.name.length).toBeGreaterThan(0);
        }
        expect(recipeDetail.supplementarySuggestions.length).toBeGreaterThanOrEqual(1);
        expect(recipeDetail.supplementarySuggestions.length).toBeLessThanOrEqual(2);
        for (const suggestion of recipeDetail.supplementarySuggestions) {
          expect(suggestion.dishName.length).toBeGreaterThan(0);
          for (const ingredient of suggestion.ingredients) {
            expect(ingredient.name.length).toBeGreaterThan(0);
          }
        }
      },
      20000
    );
  }
);
