import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  DayMenu,
  EatingOutSuggestionResult,
  MealSlot,
  MealType,
  ProfileInput,
  ShoppingList,
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

import {
  createFoodCompositionRepository,
  type FoodCompositionRepository,
} from "./food-composition.repository.js";
import { createUnitConversionService } from "./unit-conversion.service.js";
import { createNutritionVerificationService } from "./nutrition-verification.service.js";
import { createMenuPlanRepository, type MenuPlanRepository } from "./menu-plan.repository.js";
import { createFeedbackRepository } from "./feedback.repository.js";
import { createFeedbackService } from "./feedback.service.js";
import { createRecipeDetailRepository } from "./recipe-detail.repository.js";
import { createRecipeDetailService } from "./recipe-detail.service.js";
import { createClaudeMenuClient, type AnthropicMessagesClient } from "./claude-menu.client.js";
import { createMenuPlanService } from "./menu-plan.service.js";
import { createShoppingListService } from "./shopping-list.service.js";
import { createEatingOutSuggestionService } from "./eating-out-suggestion.service.js";
import { registerMenuPlanRoutes } from "./menu-plan.routes.js";
import { registerMealSlotRoutes } from "./meal-slot.routes.js";

/**
 * `GET /api/menu-plans/:weekStartDate/shopping-list` と
 * `GET /api/menu-plans/:weekStartDate/days/:dayIndex/meals/:mealType/eating-out-suggestion` の
 * "真の"統合テスト（task 14.3, 最終タスク）。
 *
 * `day-regeneration-recipe-detail.integration.test.ts`（task 12.2）が確立したprecedent
 * （実一時SQLite + `createConnection`/`runMigrations` + `server/src/index.ts`(`startServer`)
 * と同じ順序で構築したRepository→Service→Gatewayの実チェーン + `buildApp()` + ルート登録 +
 * `app.inject()`）をそのまま踏襲する。task 12.2のファイルは変更しない（本タスクは追加のみ）。
 *
 * ## Claude APIを一切行使しないのに、なぜフルチェーンが必要なのか
 * `ShoppingListService`（task 13.1）・`EatingOutSuggestionService`（task 13.5）はいずれも
 * Claude APIを一切呼ばない決定論的なServiceである。しかし `app.ts` の `registerRoutes` は
 * ルートファイル単位で「all-or-nothing」のゲート条件を持つ（`app.ts`の`AppRouteDependencies`
 * コメント参照）:
 *   - `registerMenuPlanRoutes`（`shopping-list`ルートを含む）は `menuPlanService &&
 *     shoppingListService` の両方が揃って初めて呼ばれる。
 *   - `registerMealSlotRoutes`（`eating-out-suggestion`ルートを含む）は `recipeDetailService
 *     && feedbackService && eatingOutSuggestionService` の3つ全てが揃って初めて呼ばれる。
 * したがって本テストが検証したい2エンドポイントを実際にHTTPで叩けるようにするには、
 * 呼び出されることのない `MenuPlanService`/`RecipeDetailService`/`FeedbackService`
 * （とそれらが要求する `ClaudeMenuClient`・ひいてはフェイクの`AnthropicMessagesClient`）も
 * 含め、task 12.2と実質的に同一のフルチェーンを構築する必要がある。フェイクの
 * `AnthropicMessagesClient` は「呼ばれたら例外を投げる」だけの最小スタブとする
 * （本テストの2エンドポイントはいずれもClaude API層に到達しないため、万一呼ばれた場合は
 * DI配線自体の誤りを意味する）。
 *
 * ## 初期データの投入方法: 直接Repository呼び出し
 * task 12.2と同じ理由（週間生成フロー自体はtask 12.1で既に十分に検証済み）により、本テストも
 * 初期の週間データを `menuPlanRepository.replaceWeek(weekStartDate, days)` への直接呼び出しで
 * 投入する（HTTP・Claudeを一切経由しない）。
 *
 * ## 実在する食品ID・単位コードについて
 * task 12.1/12.2と同一の8件の実在食品IDのうち7件（`010_seed_food_items.sql`）＋
 * `food-composition.repository.test.ts`が使用実績を持つ別の実在1件を用いる。
 * `"12004"`（鶏卵・全卵・生、`food_items.category = "卵類"`）は
 * `unit_conversions`（`011_seed_unit_conversions.sql`）に食材固有エントリ
 * `("12004", "個", 50)` を持つため、本テストの買い物リスト集約シナリオで
 * "個"単位からの実際のグラム換算（`UnitConversionService.toGrams`が`unit_conversions`
 * テーブルへ実際にアクセスする経路）を経由させる。残り7件のうち6件は
 * `food_items.category = "主食"`、1件（`"11220"`、鶏むね肉（皮なし・生））は
 * `food_items.category = "肉類"`である（`010_seed_food_items.sql`が定める8件のうち
 * `"01034"`（ロールパン）は`display_unit_code = "個"`が設定されているにもかかわらず
 * 対応する`unit_conversions`エントリ`("01034", "個", ...)`が`011_seed_unit_conversions.sql`に
 * 存在しないという、本タスクのboundary外の既存シードデータの欠落が実在するため、本ファイルは
 * 意図的に`"01034"`を避け、代わりに`"11220"`を採用する）。`category-display-groups.data.ts`の
 * `CATEGORY_DISPLAY_GROUPS`マッピングにより「卵類」は「乳製品・卵・豆」、「主食」は
 * （4グループのいずれとも一致しないため）「調味料・その他」、「肉類」は「肉・魚」へ解決される。
 * この3つの異なる表示グループが実際に出現することをもって、分類が本当にDB由来のカテゴリ文字列に
 * 基づいて行われている（ハードコードされていない）ことを確認する。
 */

// --- ユーザープロフィールのフィクスチャ（day-regeneration-recipe-detail.integration.test.ts と同一形状） ---

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

// --- 実在する食品ID（010_seed_food_items.sql、task 12.1/12.2 の REAL_FOOD_IDS と同一8件） ---

const EGG_FOOD_ID = "12004"; // 鶏卵（全卵・生）、food_items.category = "卵類"、display_unit_code = "個"。
const MEAT_FOOD_ID = "11220"; // 鶏むね肉（皮なし・生）、food_items.category = "肉類"、display_unit_code = NULL。
const NON_EGG_FOOD_IDS: readonly string[] = [
  "01088",
  "01006",
  "01015",
  "01020",
  "01026",
  "01031",
  MEAT_FOOD_ID,
]; // 先頭6件は food_items.category = "主食"、最後の1件（MEAT_FOOD_ID）のみ "肉類"。

const MEAL_TYPES: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack"];

const WEEK_START = "2026-04-06"; // 実在する月曜日始まりの週。
const NO_PLAN_WEEK_START = "2026-04-13"; // 同じく実在する月曜日始まりの週だが、あえてプランを一切投入しない（要件14.6用）。

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return date.toISOString().slice(0, 10);
}

// --- 買い物リストの集約対象: 食品ID "12004"（鶏卵）を3つの異なる食事枠に、
//     異なる数量・異なる単位でわざと重複させる（要件14.1, 14.2の「28食枠分の食材が正しく
//     集約」をHTTP層で確認するための仕込み）。 ---

interface EggOccurrence {
  dayIndex: number;
  mealType: MealType;
  quantity: number;
  unit: string;
  grams: number; // 手計算済みの正規化後グラム量（"個" は unit_conversions 経由、"g" はそのまま）。
}

const EGG_OCCURRENCES: readonly EggOccurrence[] = [
  { dayIndex: 0, mealType: "breakfast", quantity: 2, unit: "個", grams: 100 }, // 2個 × 50g/個 = 100g
  { dayIndex: 2, mealType: "lunch", quantity: 30, unit: "g", grams: 30 },
  { dayIndex: 5, mealType: "snack", quantity: 20, unit: "g", grams: 20 },
];

/** `EGG_OCCURRENCES` の手計算済みグラム量の合計（要件14.2の合算結果として期待する値）。 */
const EXPECTED_EGG_TOTAL_GRAMS = EGG_OCCURRENCES.reduce((sum, occurrence) => sum + occurrence.grams, 0); // 150

function findEggOccurrence(dayIndex: number, mealType: MealType): EggOccurrence | null {
  return (
    EGG_OCCURRENCES.find(
      (occurrence) => occurrence.dayIndex === dayIndex && occurrence.mealType === mealType
    ) ?? null
  );
}

// --- 外食代替提案の対象食事枠: day3の夕食を、EATING_OUT_REFERENCE_DATAのdinner候補群から
//     「カロリー以下で最も近い」ものが一意に定まるようエネルギー量を選ぶ（要件15.1-15.3）。
//
// eating-out-reference.data.ts のdinner候補（alternativeMenuKcal, 手計算済み）:
//   牛めし→銀鮭の塩焼定食(499) / 親子丼→かけうどん(299) / しょうが焼定食→銀鮭の塩焼定食(499) /
//   ハンバーグ定食→銀鮭の塩焼定食(499) / とんかつ定食→釜玉うどん(381) /
//   カルボナーラ→和風きのこパスタ(550) / 味噌ラーメン→醤油ラーメン(500) /
//   ビッグマック→ハンバーガー(259) / ポークカレー→フィレオフィッシュ(338) /
//   オムライス→銀鮭の塩焼定食(499)
// energyKcal を700にすると10件全てが「alternativeMenuKcal <= 700」の対象となり、その中の
// 最大値は550（カルボナーラ→和風きのこパスタ）で一意に定まる（他候補は全て550未満）。 ---

const TARGET_DAY_INDEX = 3;
const TARGET_MEAL_TYPE: MealType = "dinner";
const TARGET_ENERGY_KCAL = 700;

const EXPECTED_SUGGESTION = {
  typicalMenuName: "カルボナーラ",
  typicalMenuKcal: 800,
  alternativeMenuName: "和風きのこパスタ",
  alternativeMenuKcal: 550,
  proteinDeltaG: 16.0 - 24.0, // alternativeMenuProteinG(16.0) - typicalMenuProteinG(24.0) = -8.0
};

// --- シード投入する栄養価（買い物リスト/外食代替提案いずれのロジックも `ingredients` と
//     `nutrition.energyKcal` 以外の値には依存しないため、大半の食事枠は同一の妥当な
//     プレースホルダ値を用いる。対象食事枠（day3夕食）のみ energyKcal を上書きする）。 ---

const GENERIC_NUTRITION: VerifiedNutritionValues = {
  energyKcal: 500,
  proteinG: 20,
  fatG: 15,
  carbG: 60,
  fiberG: 3,
  calciumMg: 80,
  ironMg: 2,
  vitaminAUg: 100,
  vitaminDUg: 1,
  vitaminB1Mg: 0.2,
  vitaminB2Mg: 0.3,
  vitaminCMg: 20,
  saltEquivalentG: 1.5,
};

const TARGET_SLOT_NUTRITION: VerifiedNutritionValues = {
  ...GENERIC_NUTRITION,
  energyKcal: TARGET_ENERGY_KCAL,
};

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

/**
 * 卵の重複3件・対象食事枠1件を除く残り24食枠に割り当てる非卵の実在食品IDを、
 * `(dayIndex, mealIndex)` から決定論的に選ぶ（可変カウンタを使わず、常に同じ入力に対して
 * 同じ食品IDを返す）。
 */
function nonEggFoodIdFor(dayIndex: number, mealIndex: number): string {
  const offset = dayIndex * MEAL_TYPES.length + mealIndex;
  const foodId = NON_EGG_FOOD_IDS[offset % NON_EGG_FOOD_IDS.length];
  if (foodId === undefined) {
    throw new Error("fixture error: NON_EGG_FOOD_IDS is empty");
  }
  return foodId;
}

function buildMealSlot(dayIndex: number, mealType: MealType): MealSlot {
  const mealIndex = MEAL_TYPES.indexOf(mealType);

  const eggOccurrence = findEggOccurrence(dayIndex, mealType);
  if (eggOccurrence) {
    return {
      mealType,
      dishName: `day${dayIndex}-${mealType}-egg`,
      ingredients: [{ foodId: EGG_FOOD_ID, quantity: eggOccurrence.quantity, unit: eggOccurrence.unit }],
      nutrition: GENERIC_NUTRITION,
    };
  }

  if (dayIndex === TARGET_DAY_INDEX && mealType === TARGET_MEAL_TYPE) {
    return {
      mealType,
      dishName: `day${dayIndex}-${mealType}-target`,
      ingredients: [{ foodId: nonEggFoodIdFor(dayIndex, mealIndex), quantity: 200, unit: "g" }],
      nutrition: TARGET_SLOT_NUTRITION,
    };
  }

  return {
    mealType,
    dishName: `day${dayIndex}-${mealType}-generic`,
    ingredients: [{ foodId: nonEggFoodIdFor(dayIndex, mealIndex), quantity: 100, unit: "g" }],
    nutrition: GENERIC_NUTRITION,
  };
}

const SEED_TARGET_KCAL = 2000;

function buildSeededDayMenu(dayIndex: number): DayMenu {
  const meals = MEAL_TYPES.map((mealType) => buildMealSlot(dayIndex, mealType));
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

/** シード投入する7日分の週（28食枠、`menuPlanRepository.replaceWeek` へ直接渡す）。 */
function buildSeededWeek(): DayMenu[] {
  return [0, 1, 2, 3, 4, 5, 6].map((dayIndex) => buildSeededDayMenu(dayIndex));
}

// --- task 15.2（NO-GO是正）: display_unit_code設定済みだが対応する食材固有の
//     unit_conversionsエントリが存在しない実データ（'01034' ロールパン）を用いた、
//     グレースフルデグレードの実チェーン証明。上記コメント「実在する食品ID・単位コードについて」
//     が説明する通り、本ファイルの他のテストは意図的に'01034'を避けているため、
//     専用の最小限の週（他テストの28食枠フィクスチャとは独立）を別途用意する。 ---

const ROLL_BREAD_FOOD_ID = "01034"; // ロールパン。display_unit_code='個'だが、011_seed_unit_conversions.sqlに
// 対応する("01034", "個", ...)エントリが存在しない（信頼できる出典が確認できず投入見送り、task 2.2）。
const ROLL_BREAD_WEEK_START = "2026-04-20"; // 実在する月曜日始まりの週。他テストの週と重複しない専用週。
const ROLL_BREAD_QUANTITY_G = 60; // 実際に使用された分量（unitは"g"、findUnitConversionを経由しない量として指定）。

/**
 * `ROLL_BREAD_FOOD_ID`を1食枠（day0のbreakfast）のみに配置し、残り27食枠は
 * `MEAT_FOOD_ID`（display_unit_code=NULL、確実にunit_conversions欠落と無関係）で埋めた
 * 最小限の週を組み立てる。
 */
function buildRollBreadMealSlot(dayIndex: number, mealType: MealType): MealSlot {
  if (dayIndex === 0 && mealType === "breakfast") {
    return {
      mealType,
      dishName: `day${dayIndex}-${mealType}-rollbread`,
      ingredients: [{ foodId: ROLL_BREAD_FOOD_ID, quantity: ROLL_BREAD_QUANTITY_G, unit: "g" }],
      nutrition: GENERIC_NUTRITION,
    };
  }
  return {
    mealType,
    dishName: `day${dayIndex}-${mealType}-filler`,
    ingredients: [{ foodId: MEAT_FOOD_ID, quantity: 100, unit: "g" }],
    nutrition: GENERIC_NUTRITION,
  };
}

function buildRollBreadDayMenu(dayIndex: number): DayMenu {
  const meals = MEAL_TYPES.map((mealType) => buildRollBreadMealSlot(dayIndex, mealType));
  const dayNutrition = sumNutrition(meals.map((meal) => meal.nutrition));
  return {
    dayDate: addDays(ROLL_BREAD_WEEK_START, dayIndex),
    dayIndex,
    meals,
    dayNutrition,
    plannedKcal: dayNutrition.energyKcal,
    targetKcal: SEED_TARGET_KCAL,
    varianceKcal: dayNutrition.energyKcal - SEED_TARGET_KCAL,
  };
}

/** シード投入する7日分の週（`ROLL_BREAD_FOOD_ID`を1食枠のみ含む、task 15.2専用フィクスチャ）。 */
function buildRollBreadWeek(): DayMenu[] {
  return [0, 1, 2, 3, 4, 5, 6].map((dayIndex) => buildRollBreadDayMenu(dayIndex));
}

// --- フェイクの Anthropic Messages API クライアント ---

/**
 * 唯一フェイク化するClaude API層。本テストの2エンドポイント（買い物リスト・外食代替提案）は
 * いずれも `AnthropicMessagesClient` へ到達しないため、呼ばれた場合は例外を投げる最小スタブと
 * する（ファイル冒頭コメント「Claude APIを一切行使しないのに、なぜフルチェーンが必要なのか」
 * 参照）。呼ばれること自体がテスト設定の誤りを示す有用なアサーションになる。
 */
function createFakeAnthropicClient(): AnthropicMessagesClient {
  return {
    messages: {
      create: (params) => {
        throw new Error(
          "shopping-list-eating-out.integration.test の fake AnthropicMessagesClient: " +
            "呼び出されるべきではありません（本テストは買い物リスト/外食代替提案という" +
            "Claude APIを一切呼ばない2つの読み取り専用エンドポイントのみを検証対象とする。" +
            "呼び出された場合はDIチェーンの配線が誤っている）: " +
            `${JSON.stringify(params.tool_choice)}`
        );
      },
    },
  };
}

describe(
  "GET /:weekStartDate/shopping-list and " +
    "/:weekStartDate/days/:dayIndex/meals/:mealType/eating-out-suggestion integration " +
    "(real full-stack chain, Claude fake never invoked, seeded via direct Repository call)",
  () => {
    let tmpDir: string;
    let db: Database.Database;
    let app: FastifyInstance;
    let profileService: ProfileService;
    let dailyLogService: DailyLogService;
    let menuPlanRepository: MenuPlanRepository;
    let foodCompositionRepository: FoodCompositionRepository;

    beforeEach(() => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), "shopping-list-eating-out-integration-test-"));
      const dbPath = path.join(tmpDir, "test.db");
      db = createConnection(dbPath);
      runMigrations(db);

      // `server/src/index.ts`(`startServer`) と同じ構築順序: Repository → Service → Gateway →
      // 上位Service（day-regeneration-recipe-detail.integration.test.ts と同一の構築順序）。

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
      foodCompositionRepository = createFoodCompositionRepository(db);
      const unitConversionService = createUnitConversionService(foodCompositionRepository);
      const nutritionVerificationService = createNutritionVerificationService(
        foodCompositionRepository,
        unitConversionService
      );

      // 6. 献立プランの永続化。
      menuPlanRepository = createMenuPlanRepository(db, unitConversionService);

      // 7. 満足度フィードバック。
      const feedbackRepository = createFeedbackRepository(db);
      const feedbackService = createFeedbackService(feedbackRepository, menuPlanRepository);

      // 8. レシピ詳細の永続化。
      const recipeDetailRepository = createRecipeDetailRepository(db, unitConversionService);

      // 9. 唯一フェイク化する依存: Claude API層（呼ばれたら例外を投げる最小スタブ）。
      const fakeAnthropicClient = createFakeAnthropicClient();
      const claudeMenuClient = createClaudeMenuClient(foodCompositionRepository, fakeAnthropicClient);

      // 10. MenuPlanService（本テストは呼び出さないが、`registerMenuPlanRoutes`の
      //     all-or-nothingゲート条件を満たすためだけに構築する。ファイル冒頭コメント参照）。
      const menuPlanService = createMenuPlanService({
        profileGateway: menuProfileGateway,
        nutritionGateway: menuNutritionGateway,
        plannedCalorieGateway,
        feedbackService,
        claudeMenuClient,
        nutritionVerificationService,
        menuPlanRepository,
      });

      // 11. RecipeDetailService（同上、`registerMealSlotRoutes`のゲート条件を満たすためだけに
      //     構築する。本テストは呼び出さない）。
      const recipeDetailService = createRecipeDetailService({
        menuPlanRepository,
        profileGateway: menuProfileGateway,
        claudeMenuClient,
        nutritionVerificationService,
        recipeDetailRepository,
      });

      // 12. ShoppingListService（本テストが実際に検証する対象の1つ、task 13.1）。
      const shoppingListService = createShoppingListService(
        menuPlanRepository,
        foodCompositionRepository,
        unitConversionService
      );

      // 13. EatingOutSuggestionService（本テストが実際に検証する対象のもう1つ、task 13.5）。
      const eatingOutSuggestionService = createEatingOutSuggestionService(
        menuPlanRepository,
        menuProfileGateway
      );

      app = buildApp({ logger: false });
      registerMenuPlanRoutes(app, menuPlanService, shoppingListService);
      registerMealSlotRoutes(app, recipeDetailService, feedbackService, eatingOutSuggestionService);
    });

    afterEach(async () => {
      await app.close();
      db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it(
      "GET /:weekStartDate/shopping-list aggregates a food ID repeated (with different " +
        "quantities/units) across 3 of the 28 seeded meal slots into exactly ONE item with the " +
        "correctly SUMMED quantityGrams, and classifies items into valid display categories " +
        "(Req 14.1, 14.2, 14.3, 14.4)",
      async () => {
        const saveResult = profileService.saveProfile(buildValidProfileInput());
        expect(saveResult.ok).toBe(true);

        // シードは HTTP/Claude を経由せず、menuPlanRepository.replaceWeek への直接呼び出しで
        // 投入する（ファイル冒頭コメント「初期データの投入方法」参照）。
        const seededDays = buildSeededWeek();
        const seededPlan = menuPlanRepository.replaceWeek(WEEK_START, seededDays);
        expect(seededPlan.days).toHaveLength(7);

        const slotCount = db.prepare(`SELECT COUNT(*) AS count FROM meal_slots`).get() as {
          count: number;
        };
        expect(slotCount.count).toBe(28);

        const response = await app.inject({
          method: "GET",
          url: `/api/menu-plans/${WEEK_START}/shopping-list`,
        });

        expect(response.statusCode).toBe(200);
        const body = response.json() as ShoppingList;
        expect(body.weekStartDate).toBe(WEEK_START);

        // Requirement 14.1, 14.2: 重複させた食品ID "12004"（鶏卵）が正確に1件の品目として
        // 集約されており、かつ手計算済みの合計グラム量（100g + 30g + 20g = 150g、うち100gは
        // "個"単位からの実際のunit_conversions経由の換算結果）と一致する。
        const eggItems = body.items.filter((item) => item.foodId === EGG_FOOD_ID);
        expect(eggItems).toHaveLength(1);
        const eggItem = eggItems[0];
        expect(eggItem).toBeDefined();
        expect(eggItem?.quantityGrams).toBe(EXPECTED_EGG_TOTAL_GRAMS);
        expect(eggItem?.quantityGrams).toBe(150);

        // Requirement 14.3: 食品成分参照データから解決した品目名を含む。
        expect(eggItem?.name).toBe("鶏卵（全卵・生）");

        // Requirement 14.4: 「卵類」は「乳製品・卵・豆」へ分類される（category-display-groups.data.ts
        // のマッピング。ハードコードされた固定文字列ではなく、実際のDBの
        // food_items.category値に基づいて分類されたことを確認する）。
        expect(eggItem?.category).toBe("乳製品・卵・豆");

        // 対照として、別のfoodId（"主食"カテゴリ）が「調味料・その他」へ、さらに別のfoodId
        // （"肉類"カテゴリ）が「肉・魚」へ分類されることも確認する（3つの異なる食品カテゴリから
        // 3つの異なる表示グループが導出されており、分類ロジックが実際に機能していることの
        // 追加証拠）。
        const staplingItem = body.items.find((item) => item.foodId === "01088");
        expect(staplingItem).toBeDefined();
        expect(staplingItem?.category).toBe("調味料・その他");

        const meatItem = body.items.find((item) => item.foodId === MEAT_FOOD_ID);
        expect(meatItem).toBeDefined();
        expect(meatItem?.category).toBe("肉・魚");

        // Requirement 14.4: 全品目のcategoryが4つの固定表示グループのいずれかである
        // （分類が実際にこの4値の範囲内に収まっている、"正しく分類された"ことの一般的な確認）。
        const VALID_CATEGORIES = ["野菜・きのこ", "肉・魚", "乳製品・卵・豆", "調味料・その他"];
        for (const item of body.items) {
          expect(VALID_CATEGORIES).toContain(item.category);
          expect(item.quantityGrams).toBeGreaterThan(0);
        }

        // 買い物リストに現れる食品IDの集合は、シード投入した8種類の実在食品IDと完全一致する
        // （28食枠全体が正しく走査対象になっている、要件14.1の追加確認）。
        const itemFoodIds = body.items.map((item) => item.foodId).sort();
        const expectedFoodIds = [EGG_FOOD_ID, ...NON_EGG_FOOD_IDS].sort();
        expect(itemFoodIds).toEqual(expectedFoodIds);
      }
    );

    it(
      "GET /:weekStartDate/shopping-list returns 200 + literal null (not 404) when no active " +
        "plan exists for the requested week (Req 14.6)",
      async () => {
        const saveResult = profileService.saveProfile(buildValidProfileInput());
        expect(saveResult.ok).toBe(true);

        // WEEK_START にのみプランを投入し、NO_PLAN_WEEK_START には一切投入しない。
        const seededDays = buildSeededWeek();
        menuPlanRepository.replaceWeek(WEEK_START, seededDays);

        const response = await app.inject({
          method: "GET",
          url: `/api/menu-plans/${NO_PLAN_WEEK_START}/shopping-list`,
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toBeNull();
      }
    );

    it(
      "GET /:weekStartDate/shopping-list returns 200 (not 500) for a plan containing a real " +
        "food item whose display_unit_code has no matching food-specific unit_conversions row " +
        "('01034' ロールパン, task 15.2 NO-GO是正), with that item falling back to gram " +
        "display instead of the endpoint throwing (Req 14.7)",
      async () => {
        const saveResult = profileService.saveProfile(buildValidProfileInput());
        expect(saveResult.ok).toBe(true);

        // 事前確認: '01034'がこのタスクの前提（display_unit_code='個'、対応する
        // food-specificなunit_conversionsエントリが存在しない）を実際に満たしていること自体を、
        // 実DB越しに独立して確認する（fixtureの前提が壊れていないことの検証）。
        const rollBreadFood = foodCompositionRepository.findById(ROLL_BREAD_FOOD_ID);
        expect(rollBreadFood?.displayUnitCode).toBe("個");
        expect(foodCompositionRepository.findUnitConversion(ROLL_BREAD_FOOD_ID, "個")).toBeNull();

        // シードは HTTP/Claude を経由せず、menuPlanRepository.replaceWeek への直接呼び出しで
        // 投入する（ファイル冒頭コメント「初期データの投入方法」参照）。
        const seededDays = buildRollBreadWeek();
        const seededPlan = menuPlanRepository.replaceWeek(ROLL_BREAD_WEEK_START, seededDays);
        expect(seededPlan.days).toHaveLength(7);

        const response = await app.inject({
          method: "GET",
          url: `/api/menu-plans/${ROLL_BREAD_WEEK_START}/shopping-list`,
        });

        // 修正前はここで500（ShoppingListService.buildItemがunit_conversionsエントリ欠落を
        // 不変条件違反として例外を投げ、app.tsの汎用エラーハンドラが500へ変換していた）。
        expect(response.statusCode).toBe(200);
        const body = response.json() as ShoppingList;

        const rollBreadItem = body.items.find((item) => item.foodId === ROLL_BREAD_FOOD_ID);
        expect(rollBreadItem).toBeDefined();
        // グラム表示フォールバック（displayUnitCode未設定食品と同じ扱い、要件14.7）。
        expect(rollBreadItem?.quantityGrams).toBe(ROLL_BREAD_QUANTITY_G);
        expect(rollBreadItem?.displayQuantity).toBe(ROLL_BREAD_QUANTITY_G);
        expect(rollBreadItem?.displayUnit).toBe("g");
      }
    );

    it(
      "GET /:weekStartDate/days/:dayIndex/meals/:mealType/eating-out-suggestion selects the " +
        "candidate with the highest alternativeMenuKcal not exceeding the meal slot's verified " +
        "energyKcal, and returns exactly the 5 fields named by Requirement 15.3 with hand-" +
        "predicted values (Req 15.1, 15.2, 15.3)",
      async () => {
        const saveResult = profileService.saveProfile(buildValidProfileInput());
        expect(saveResult.ok).toBe(true);

        const seededDays = buildSeededWeek();
        menuPlanRepository.replaceWeek(WEEK_START, seededDays);

        // 事前確認: 対象食事枠の検証済みエネルギー量が期待通り700kcalであること（選定の
        // 前提条件そのものが崩れていないことを、実際のDB読み取りで確認する）。
        const targetSlot = menuPlanRepository.findMealSlot(
          WEEK_START,
          TARGET_DAY_INDEX,
          TARGET_MEAL_TYPE
        );
        expect(targetSlot?.nutrition.energyKcal).toBe(TARGET_ENERGY_KCAL);

        const response = await app.inject({
          method: "GET",
          url:
            `/api/menu-plans/${WEEK_START}/days/${TARGET_DAY_INDEX}/meals/` +
            `${TARGET_MEAL_TYPE}/eating-out-suggestion`,
        });

        expect(response.statusCode).toBe(200);
        const body = response.json() as EatingOutSuggestionResult;
        expect(body.suggestion).not.toBeNull();

        // Requirement 15.3: EXACTLYこの5フィールド構成（typicalMenuName・typicalMenuKcal・
        // alternativeMenuName・alternativeMenuKcal・proteinDeltaG）で、かつ値そのものが
        // 手計算した期待値と一致することを確認する（フィールドの存在だけでなく値も検証）。
        expect(body.suggestion).toEqual(EXPECTED_SUGGESTION);
        expect(Object.keys(body.suggestion ?? {}).sort()).toEqual(
          [
            "typicalMenuName",
            "typicalMenuKcal",
            "alternativeMenuName",
            "alternativeMenuKcal",
            "proteinDeltaG",
          ].sort()
        );
      }
    );

    it(
      "GET /:weekStartDate/days/:dayIndex/meals/:mealType/eating-out-suggestion returns 404 " +
        "with the standard {type: 'not_found', message} shape when the target meal slot does " +
        "not exist because no active plan exists for the requested week (Req 15.6, exercised " +
        "through the REAL chain: real DB + real MenuPlanRepository + real " +
        "EatingOutSuggestionService + real HTTP -- complementing " +
        "eating-out-suggestion.service.test.ts's fake-MenuPlanRepository coverage of this branch " +
        "and meal-slot.routes.test.ts's faked-EatingOutSuggestionService coverage of the 404 " +
        "mapping, neither of which exercises the real chain together)",
      async () => {
        const saveResult = profileService.saveProfile(buildValidProfileInput());
        expect(saveResult.ok).toBe(true);

        // WEEK_START にのみプランを投入し、NO_PLAN_WEEK_START には一切投入しない
        // （shopping-listのReq 14.6テストと同一の`NO_PLAN_WEEK_START`フィクスチャを再利用する。
        // dayIndex/mealTypeの具体値は「その週にプランが存在しない」限りどの組み合わせでもよいため、
        // 他のテストと同じ TARGET_DAY_INDEX/TARGET_MEAL_TYPE を流用する）。
        const seededDays = buildSeededWeek();
        menuPlanRepository.replaceWeek(WEEK_START, seededDays);

        const response = await app.inject({
          method: "GET",
          url:
            `/api/menu-plans/${NO_PLAN_WEEK_START}/days/${TARGET_DAY_INDEX}/meals/` +
            `${TARGET_MEAL_TYPE}/eating-out-suggestion`,
        });

        expect(response.statusCode).toBe(404);

        // `eating-out-suggestion.service.ts`の`suggestForMealSlot`が実際に組み立てるメッセージ
        // テンプレートと同一（`meal-slot.routes.test.ts`の`buildNotFoundError()`が採用するのと
        // 同じ「実際のメッセージ文言をここで独立に再現する」規約に倣う）。
        const expectedMessage =
          `指定された食事枠が有効な献立プラン内に見つかりません` +
          `（weekStartDate: ${NO_PLAN_WEEK_START}, dayIndex: ${TARGET_DAY_INDEX}, ` +
          `mealType: ${TARGET_MEAL_TYPE}）`;
        expect(response.json()).toEqual({ type: "not_found", message: expectedMessage });
      }
    );
  }
);
