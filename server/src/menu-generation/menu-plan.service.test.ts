import { describe, expect, it, vi } from "vitest";
import type {
  CalculationUnavailableError,
  DayMenu,
  IngredientSelection,
  IsoDate,
  MealSlot,
  MealType,
  VerifiedNutritionValues,
  WeekMenuPlan,
} from "@nutrition/shared";
import type { Result } from "../shared/result.js";
import type {
  ClaudeGenerationError,
  ClaudeMenuClient,
  ClaudePromptPayload,
  DailyGenerationToolResult,
  WeeklyGenerationToolResult,
} from "./claude-menu.client.js";
import type { FeedbackService } from "./feedback.service.js";
import type { MenuPlanRepository, OtherDayContext } from "./menu-plan.repository.js";
import {
  createMenuPlanService,
  type MenuPlanServiceDependencies,
} from "./menu-plan.service.js";
import type { DislikedItemSummary } from "./menu-prompt.builder.js";
import type { NutritionVerificationService } from "./nutrition-verification.service.js";
import type { NutritionGateway, NutritionTargetSnapshot } from "./nutrition.gateway.js";
import type {
  PlannedCalorieGateway,
  PlannedCalorieSubmissionError,
} from "./planned-calorie.gateway.js";
import type { MenuProfileSnapshot, ProfileGateway } from "./profile.gateway.js";
import type { VerificationError } from "./unit-conversion.service.js";

/**
 * `MenuPlanService`（task 9.1: `generateWeek`/`regenerateWeek`/`getActivePlan`、
 * task 9.2: `regenerateDay`）のテスト。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #MenuPlanService、
 * Requirements 1, 6, 7, 11.1, 11.2, 11.4, 12）に定義された4メソッドの挙動を、8つの依存すべて
 * （`MenuPromptBuilder` を除く。ファイル冒頭コメント「MenuPromptBuilderについて」参照）を
 * フェイクに差し替えて検証する。`feedback.service.test.ts` / `nutrition-verification.service.test.ts`
 * と同じ「フェイク依存＋設定可能な振る舞い、未使用メソッドは呼ばれたら例外を投げる」スタイルに
 * 倣う。
 *
 * `MenuPromptBuilder`（`buildWeeklyPrompt`/`buildDailyPrompt`）は外部依存を持たない純粋関数であり、
 * `menu-plan.service.ts` はこれを直接importして呼び出す（DIの対象ではない）。したがって
 * 本テストもフェイクに差し替えず実関数のまま動作させる（すでに専用テスト
 * `menu-prompt.builder.test.ts` で検証済みの決定論的な純粋関数のため、フェイク化する必要が
 * ない）。
 *
 * `regenerateDay`専用のフィクスチャ・フェイクビルダー（`TARGET_DAY_INDEX` /
 * `createDailyDeps` 等）はファイル後半の `describe("regenerateDay", ...)` の直前にまとめて
 * 定義する。
 */

// --- 固定値・フィクスチャ ---

const MEAL_TYPES: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack"];

const WEEK_START: IsoDate = "2026-09-07";

/** `menu-plan.repository.test.ts` と同じ、モジュールローカルなUTC基準の日付加算ヘルパー。 */
function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return date.toISOString().slice(0, 10);
}

/** `WEEK_START` を起点とした7日分の日付（`generateWeek`実装の`addDaysIso`とは独立に計算する）。 */
const WEEK_DATES: readonly IsoDate[] = Array.from({ length: 7 }, (_, i) => addDays(WEEK_START, i));

function weekDate(dayIndex: number): IsoDate {
  const date = WEEK_DATES[dayIndex];
  if (date === undefined) {
    throw new Error(`fixture error: dayIndex ${dayIndex} out of range`);
  }
  return date;
}

function buildDefaultProfile(): MenuProfileSnapshot {
  return {
    ngIngredients: [],
    preferredIngredients: [],
    restrictionType: "none",
    restrictionIntensity: null,
    restrictionNotes: null,
    cookingSkill: null,
    cookingTimePreference: null,
    budgetPreference: null,
  };
}

/** `dayIndex`（0-6）ごとに明確に区別できる`NutritionTargetSnapshot`。 */
function buildTarget(seed: number): NutritionTargetSnapshot {
  return {
    calorieTarget: 1800 + seed * 50,
    pfc: { proteinG: 100 + seed, fatG: 50 + seed, carbG: 200 + seed },
    activityLevelLabel: "moderate",
    guardrailWarningTypes: [],
  };
}

/**
 * `WEEK_START`基準の日付に対してのみ有効なデフォルト`getTargetsForDate`。
 * `WEEK_START`以外の週で使うテストは、専用の`nutritionGateway`オーバーライドを渡すこと
 * （このデフォルトを誤って使うと即座に例外で失敗するため、取り違えを検出できる）。
 */
function defaultGetTargetsForDate(
  date: IsoDate
): Result<NutritionTargetSnapshot, CalculationUnavailableError> {
  const dayIndex = WEEK_DATES.indexOf(date);
  if (dayIndex === -1) {
    throw new Error(
      `test fixture error: defaultGetTargetsForDate was called with an unexpected date (${date}). ` +
        "Tests using a weekStartDate other than WEEK_START must supply their own nutritionGateway override."
    );
  }
  return { ok: true, value: buildTarget(dayIndex) };
}

/** `(dayIndex, mealType)` から一意に定まる、テスト専用のダミー食品ID。 */
function fixtureIngredients(dayIndex: number, mealType: MealType): IngredientSelection[] {
  return [{ foodId: `FIX-${dayIndex}-${mealType}`, quantity: 100, unit: "g" }];
}

function parseFixtureFoodId(foodId: string): { dayIndex: number; mealType: MealType } | null {
  const match = /^FIX-(\d+)-(breakfast|lunch|dinner|snack)$/.exec(foodId);
  if (!match) {
    return null;
  }
  const dayIndexText = match[1];
  const mealTypeText = match[2];
  if (dayIndexText === undefined || mealTypeText === undefined) {
    return null;
  }
  return { dayIndex: Number(dayIndexText), mealType: mealTypeText as MealType };
}

/**
 * `(dayIndex, mealType)` ごとに明確に区別できる13項目の`VerifiedNutritionValues`。
 * 各`(dayIndex, mealIndex)`の組は一意な`n`（0〜27）に写像され、全項目が一意な値を持つため、
 * 献立プランの組み立て時に日・食枠の取り違えが起きればテストが検出できる。
 */
function fixtureNutrition(dayIndex: number, mealIndex: number): VerifiedNutritionValues {
  const n = dayIndex * 4 + mealIndex;
  return {
    energyKcal: 1000 + n * 10,
    proteinG: 50 + n,
    fatG: 20 + n * 0.5,
    carbG: 80 + n * 0.8,
    fiberG: 5 + n * 0.1,
    calciumMg: 100 + n,
    ironMg: 2 + n * 0.05,
    vitaminAUg: 200 + n * 2,
    vitaminDUg: 3 + n * 0.03,
    vitaminB1Mg: 0.5 + n * 0.01,
    vitaminB2Mg: 0.6 + n * 0.01,
    vitaminCMg: 30 + n * 0.3,
    saltEquivalentG: 1 + n * 0.01,
  };
}

function sumNutrition(values: readonly VerifiedNutritionValues[]): VerifiedNutritionValues {
  const total: VerifiedNutritionValues = {
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
  };
  for (const value of values) {
    total.energyKcal += value.energyKcal;
    total.proteinG += value.proteinG;
    total.fatG += value.fatG;
    total.carbG += value.carbG;
    total.fiberG += value.fiberG;
    total.calciumMg += value.calciumMg;
    total.ironMg += value.ironMg;
    total.vitaminAUg += value.vitaminAUg;
    total.vitaminDUg += value.vitaminDUg;
    total.vitaminB1Mg += value.vitaminB1Mg;
    total.vitaminB2Mg += value.vitaminB2Mg;
    total.vitaminCMg += value.vitaminCMg;
    total.saltEquivalentG += value.saltEquivalentG;
  }
  return total;
}

/** `NutritionVerificationService.verifyDish`のデフォルトフェイク実装。foodIdからフィクスチャを復元する。 */
function defaultVerifyDish(
  ingredients: IngredientSelection[]
): Result<VerifiedNutritionValues, VerificationError> {
  const first = ingredients[0];
  if (!first) {
    throw new Error("test fixture error: verifyDish called with empty ingredients");
  }
  const parsed = parseFixtureFoodId(first.foodId);
  if (!parsed) {
    throw new Error(`test fixture error: unrecognized fixture foodId "${first.foodId}"`);
  }
  const mealIndex = MEAL_TYPES.indexOf(parsed.mealType);
  return { ok: true, value: fixtureNutrition(parsed.dayIndex, mealIndex) };
}

/** `WeeklyGenerationToolResult`の既定の成功フィクスチャ（7日×4食枠、dayIndex 0-6を1件ずつ）。 */
function buildDefaultWeeklyResult(): WeeklyGenerationToolResult {
  return {
    days: Array.from({ length: 7 }, (_, dayIndex) => ({
      dayIndex,
      meals: MEAL_TYPES.map((mealType) => ({
        mealType,
        dishName: `Dish-D${dayIndex}-${mealType}`,
        ingredients: fixtureIngredients(dayIndex, mealType),
      })),
    })),
  };
}

function buildFixtureMealSlot(dayIndex: number, mealType: MealType): MealSlot {
  const mealIndex = MEAL_TYPES.indexOf(mealType);
  return {
    mealType,
    dishName: `Dish-D${dayIndex}-${mealType}`,
    ingredients: fixtureIngredients(dayIndex, mealType),
    nutrition: fixtureNutrition(dayIndex, mealIndex),
  };
}

function buildFixtureDayMenu(dayIndex: number): DayMenu {
  const meals = MEAL_TYPES.map((mealType) => buildFixtureMealSlot(dayIndex, mealType));
  const dayNutrition = sumNutrition(meals.map((meal) => meal.nutrition));
  const targetKcal = buildTarget(dayIndex).calorieTarget;
  return {
    dayDate: weekDate(dayIndex),
    dayIndex,
    meals,
    dayNutrition,
    plannedKcal: dayNutrition.energyKcal,
    targetKcal,
    varianceKcal: dayNutrition.energyKcal - targetKcal,
  };
}

function buildFixtureWeekMenuPlan(weekStartDate: IsoDate = WEEK_START): WeekMenuPlan {
  return {
    weekStartDate,
    generatedAt: "2026-09-07T00:00:00.000Z",
    days: Array.from({ length: 7 }, (_, dayIndex) => buildFixtureDayMenu(dayIndex)),
  };
}

/** `MenuPlanRepository.replaceWeek`の既定の成功フェイク：渡された`days`をそのまま読み戻す。 */
function defaultReplaceWeek(weekStartDate: IsoDate, days: DayMenu[]): WeekMenuPlan {
  return { weekStartDate, generatedAt: "2026-09-07T00:00:00.000Z", days };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// --- フェイク依存 ---

function createFakeProfileGateway(
  profile: MenuProfileSnapshot | null = buildDefaultProfile()
): ProfileGateway {
  return { getCurrentProfile: () => profile };
}

function createFakeNutritionGateway(
  overrides: { getTargetsForDate?: NutritionGateway["getTargetsForDate"] } = {}
): NutritionGateway {
  return {
    getTargetsForDate: overrides.getTargetsForDate ?? defaultGetTargetsForDate,
  };
}

function createFakePlannedCalorieGateway(
  overrides: { submitPlannedCalories?: PlannedCalorieGateway["submitPlannedCalories"] } = {}
): PlannedCalorieGateway {
  return {
    submitPlannedCalories: overrides.submitPlannedCalories ?? (() => ({ ok: true, value: undefined })),
  };
}

function createFakeFeedbackService(
  overrides: { getDislikedSummary?: FeedbackService["getDislikedSummary"] } = {}
): FeedbackService {
  return {
    recordFeedback: () => {
      throw new Error("createFakeFeedbackService: recordFeedback is not used by MenuPlanService");
    },
    getDislikedSummary: overrides.getDislikedSummary ?? (() => []),
  };
}

function createFakeClaudeMenuClient(
  overrides: {
    generateWeek?: ClaudeMenuClient["generateWeek"];
    generateDay?: ClaudeMenuClient["generateDay"];
  } = {}
): ClaudeMenuClient {
  return {
    generateWeek:
      overrides.generateWeek ?? (async () => ({ ok: true, value: buildDefaultWeeklyResult() })),
    generateDay:
      overrides.generateDay ??
      (() => {
        throw new Error(
          "createFakeClaudeMenuClient: generateDay was not expected to be called in this test"
        );
      }),
    generateRecipe: () => {
      throw new Error("createFakeClaudeMenuClient: generateRecipe is not used by MenuPlanService");
    },
  };
}

function createFakeNutritionVerificationService(
  overrides: { verifyDish?: NutritionVerificationService["verifyDish"] } = {}
): NutritionVerificationService {
  return {
    verifyDish: overrides.verifyDish ?? defaultVerifyDish,
    verifyDay: (values) => sumNutrition(values),
    computeVarianceKcal: (actualKcal, targetKcal) => actualKcal - targetKcal,
  };
}

function createFakeMenuPlanRepository(
  overrides: {
    getActivePlan?: MenuPlanRepository["getActivePlan"];
    findOtherDays?: MenuPlanRepository["findOtherDays"];
    replaceWeek?: MenuPlanRepository["replaceWeek"];
    replaceDay?: MenuPlanRepository["replaceDay"];
  } = {}
): MenuPlanRepository {
  return {
    getActivePlan:
      overrides.getActivePlan ??
      (() => {
        throw new Error(
          "createFakeMenuPlanRepository: getActivePlan was not expected to be called in this test"
        );
      }),
    findOtherDays:
      overrides.findOtherDays ??
      (() => {
        throw new Error(
          "createFakeMenuPlanRepository: findOtherDays was not expected to be called in this test"
        );
      }),
    findMealSlot: () => {
      throw new Error(
        "createFakeMenuPlanRepository: findMealSlot is not used by MenuPlanService"
      );
    },
    replaceWeek:
      overrides.replaceWeek ??
      (() => {
        throw new Error(
          "createFakeMenuPlanRepository: replaceWeek was not expected to be called in this test"
        );
      }),
    replaceDay:
      overrides.replaceDay ??
      (() => {
        throw new Error(
          "createFakeMenuPlanRepository: replaceDay was not expected to be called in this test"
        );
      }),
  };
}

function createDeps(overrides: Partial<MenuPlanServiceDependencies> = {}): MenuPlanServiceDependencies {
  return {
    profileGateway: overrides.profileGateway ?? createFakeProfileGateway(),
    nutritionGateway: overrides.nutritionGateway ?? createFakeNutritionGateway(),
    plannedCalorieGateway: overrides.plannedCalorieGateway ?? createFakePlannedCalorieGateway(),
    feedbackService: overrides.feedbackService ?? createFakeFeedbackService(),
    claudeMenuClient: overrides.claudeMenuClient ?? createFakeClaudeMenuClient(),
    nutritionVerificationService:
      overrides.nutritionVerificationService ?? createFakeNutritionVerificationService(),
    menuPlanRepository: overrides.menuPlanRepository ?? createFakeMenuPlanRepository(),
  };
}

// =============================================================================
// regenerateDay（task 9.2、Requirements 7, 11.1, 11.2, 12）専用のフィクスチャ・フェイク
// =============================================================================
//
// `WEEK_START` 週内の1日を対象日として固定する（weeklyテストと同じ週フィクスチャ
// `buildFixtureWeekMenuPlan`/`buildTarget`/`weekDate`を再利用するため、dayIndexの値自体が
// weeklyテストの0-6と重複していても問題にならない）。

const TARGET_DAY_INDEX = 3;
const TARGET_DAY_DATE = weekDate(TARGET_DAY_INDEX);

/** `(dayIndex, mealType)` から一意に定まる、`findOtherDays`専用のダミー`OtherDayContext`。 */
function buildFixtureOtherDayContext(dayIndex: number): OtherDayContext {
  return {
    dayIndex,
    meals: MEAL_TYPES.map((mealType) => ({
      mealType,
      dishName: `OtherDish-D${dayIndex}-${mealType}`,
      foodIds: [`OTHER-${dayIndex}-${mealType}`],
    })),
  };
}

/**
 * `MenuPlanRepository.findOtherDays`の既定の成功フェイク。`excludeDayIndex`以外の6日分の
 * `OtherDayContext`を返す（実装が`findOtherDays(weekStartDate, dayIndex)`と呼ぶことを
 * 前提に、`excludeDayIndex`のみに基づいて構築する）。
 */
function defaultFindOtherDays(_weekStartDate: IsoDate, excludeDayIndex: number): OtherDayContext[] {
  return Array.from({ length: 7 }, (_, i) => i)
    .filter((i) => i !== excludeDayIndex)
    .map(buildFixtureOtherDayContext);
}

/** `DailyGenerationToolResult`の既定の成功フィクスチャ（4食枠、対象dayIndexの料理名・食品ID）。 */
function buildDefaultDailyResult(dayIndex: number): DailyGenerationToolResult {
  return {
    meals: MEAL_TYPES.map((mealType) => ({
      mealType,
      dishName: `Dish-D${dayIndex}-${mealType}`,
      ingredients: fixtureIngredients(dayIndex, mealType),
    })),
  };
}

/**
 * `MenuPlanRepository.replaceDay`の既定の成功フェイク。実際の`runReplaceDay`
 * （`menu-plan.repository.ts`）と同じく、渡された`meals`から`dayNutrition`/`varianceKcal`を
 * 独自に導出する（`plannedKcal`引数からは導出しない）。これにより、テストが
 * `plannedKcal`に不整合な値を渡した場合、このフェイクの戻り値上でその不整合が可視化される。
 */
function defaultReplaceDay(
  _weekStartDate: IsoDate,
  dayIndex: number,
  meals: MealSlot[],
  plannedKcal: number,
  targetKcal: number | null
): DayMenu {
  const dayNutrition = sumNutrition(meals.map((meal) => meal.nutrition));
  return {
    dayDate: weekDate(dayIndex),
    dayIndex,
    meals,
    dayNutrition,
    plannedKcal,
    targetKcal,
    varianceKcal: targetKcal === null ? null : dayNutrition.energyKcal - targetKcal,
  };
}

/**
 * `regenerateDay`テスト専用の`MenuPlanRepository`フェイク。`getActivePlan`/`findOtherDays`/
 * `replaceDay`に日単位再生成向けの既定値を持つ（`replaceWeek`/`findMealSlot`は
 * `createFakeMenuPlanRepository`既定のまま：呼ばれたら例外を投げ、`regenerateDay`が
 * 誤ってそれらを呼んでいないことを検出する）。
 */
function createFakeMenuPlanRepositoryForDay(
  overrides: {
    getActivePlan?: MenuPlanRepository["getActivePlan"];
    findOtherDays?: MenuPlanRepository["findOtherDays"];
    replaceDay?: MenuPlanRepository["replaceDay"];
    replaceWeek?: MenuPlanRepository["replaceWeek"];
  } = {}
): MenuPlanRepository {
  return createFakeMenuPlanRepository({
    getActivePlan: overrides.getActivePlan ?? (() => buildFixtureWeekMenuPlan()),
    findOtherDays: overrides.findOtherDays ?? defaultFindOtherDays,
    replaceDay: overrides.replaceDay ?? defaultReplaceDay,
    replaceWeek: overrides.replaceWeek,
  });
}

/** `regenerateDay`テスト専用の`ClaudeMenuClient`フェイク。`generateDay`に日単位向けの既定値を持つ。 */
function createFakeClaudeMenuClientForDay(
  overrides: { generateDay?: ClaudeMenuClient["generateDay"] } = {}
): ClaudeMenuClient {
  return createFakeClaudeMenuClient({
    generateDay:
      overrides.generateDay ??
      (async () => ({ ok: true, value: buildDefaultDailyResult(TARGET_DAY_INDEX) })),
  });
}

/** `regenerateDay`テスト専用の`MenuPlanServiceDependencies`ビルダー。 */
function createDailyDeps(
  overrides: Partial<MenuPlanServiceDependencies> = {}
): MenuPlanServiceDependencies {
  return createDeps({
    menuPlanRepository: createFakeMenuPlanRepositoryForDay(),
    claudeMenuClient: createFakeClaudeMenuClientForDay(),
    ...overrides,
  });
}

// =============================================================================
// テスト本体
// =============================================================================

describe("createMenuPlanService", () => {
  describe("generateWeek — プロフィール未登録（Req 12.1）", () => {
    it("profileGateway.getCurrentProfileがnullを返す場合、GenerationError(profile_missing)を返し、replaceWeekは一切呼ばれない", async () => {
      const deps = createDeps({ profileGateway: createFakeProfileGateway(null) });
      const service = createMenuPlanService(deps);

      const result = await service.generateWeek(WEEK_START);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected a failure result");
      }
      expect(result.error.type).toBe("generation_failed");
      expect(result.error.reason).toBe("profile_missing");
      expect(typeof result.error.message).toBe("string");
      expect(result.error.message.length).toBeGreaterThan(0);
    });
  });

  describe("generateWeek — 栄養目標値算出不可（Req 12.2）", () => {
    it("週の非先頭日（dayIndex 3）でCalculationUnavailableErrorが返る場合、GenerationError(nutrition_unavailable)を返し、replaceWeekは一切呼ばれない（残りの日は確認しない）", async () => {
      const failingDate = weekDate(3);
      const getTargetsForDate = vi.fn(
        (date: IsoDate): Result<NutritionTargetSnapshot, CalculationUnavailableError> => {
          if (date === failingDate) {
            return {
              ok: false,
              error: {
                type: "calculation_unavailable",
                reason: "profile_missing",
                message: "テスト用の算出不可エラー",
              },
            };
          }
          return defaultGetTargetsForDate(date);
        }
      );
      const deps = createDeps({ nutritionGateway: createFakeNutritionGateway({ getTargetsForDate }) });
      const service = createMenuPlanService(deps);

      const result = await service.generateWeek(WEEK_START);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected a failure result");
      }
      expect(result.error.reason).toBe("nutrition_unavailable");
      // dayIndex 0,1,2,3 の4回で打ち切られ、4,5,6は確認しない。
      expect(getTargetsForDate).toHaveBeenCalledTimes(4);
    });
  });

  describe.each([
    ["schema_validation_failed", "schema_validation_failed"],
    ["refusal", "claude_refusal"],
    ["request_failed", "claude_request_failed"],
  ] as const)("generateWeek — Claude生成エラー（Req 1.4, 12.3, 12.4）: %s", (claudeType, expectedReason) => {
    it(`ClaudeGenerationError(type: "${claudeType}")の場合、GenerationError(reason: "${expectedReason}")を返し、replaceWeekは一切呼ばれない`, async () => {
      const claudeMenuClient = createFakeClaudeMenuClient({
        generateWeek: async (): Promise<Result<WeeklyGenerationToolResult, ClaudeGenerationError>> => ({
          ok: false,
          error: { type: claudeType, message: `test failure: ${claudeType}` },
        }),
      });
      const deps = createDeps({ claudeMenuClient });
      const service = createMenuPlanService(deps);

      const result = await service.generateWeek(WEEK_START);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected a failure result");
      }
      expect(result.error.reason).toBe(expectedReason);
    });
  });

  describe("generateWeek — dayIndexの網羅性・一意性ガード（このタスクで新規追加、Req 1.1）", () => {
    it("dayIndex=2が2件・dayIndex=5が欠落した、要素数7・形状としては有効なレスポンスの場合、GenerationError(schema_validation_failed)を返し、replaceWeekは一切呼ばれない", async () => {
      const malformedDayIndexes = [0, 1, 2, 2, 3, 4, 6];
      const malformedResult: WeeklyGenerationToolResult = {
        days: malformedDayIndexes.map((dayIndex) => ({
          dayIndex,
          meals: MEAL_TYPES.map((mealType) => ({
            mealType,
            dishName: `Dish-D${dayIndex}-${mealType}`,
            ingredients: fixtureIngredients(dayIndex, mealType),
          })),
        })),
      };
      const claudeMenuClient = createFakeClaudeMenuClient({
        generateWeek: async () => ({ ok: true, value: malformedResult }),
      });
      const deps = createDeps({ claudeMenuClient });
      const service = createMenuPlanService(deps);

      const result = await service.generateWeek(WEEK_START);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected a failure result");
      }
      expect(result.error.reason).toBe("schema_validation_failed");
      // このタスクで新規に追加した `hasCompleteDayIndexSet` ガード自身のメッセージであることを、
      // 別の（到達不能なはずの）"dayIndexに対応する結果が見つからない"フォールバック文言との
      // 混同を排除するために明示的に確認する（両者は同じreason文字列を返しうるため、
      // reasonの一致だけでは「本当にこのガードが検出したのか」を区別できない）。
      expect(result.error.message).toContain("重複・欠落なく網羅していません");
    });
  });

  describe("generateWeek — mealTypeの網羅性・一意性ガード（このタスクで新規追加のretrofit、Req 1.1と同種の防御）", () => {
    it("dayIndexは0〜6を正しく網羅しているが、ある1日（dayIndex 4）の4食枠のmealTypeに重複（breakfastが2件・dinnerが0件）がある場合、GenerationError(schema_validation_failed)を返し、replaceWeekは一切呼ばれない", async () => {
      const MALFORMED_DAY_INDEX = 4;
      const malformedResult: WeeklyGenerationToolResult = {
        days: Array.from({ length: 7 }, (_, dayIndex) => {
          if (dayIndex === MALFORMED_DAY_INDEX) {
            return {
              dayIndex,
              meals: [
                {
                  mealType: "breakfast" as const,
                  dishName: `Dish-D${dayIndex}-breakfast-1`,
                  ingredients: fixtureIngredients(dayIndex, "breakfast"),
                },
                {
                  mealType: "breakfast" as const,
                  dishName: `Dish-D${dayIndex}-breakfast-2`,
                  ingredients: fixtureIngredients(dayIndex, "lunch"),
                },
                {
                  mealType: "lunch" as const,
                  dishName: `Dish-D${dayIndex}-lunch`,
                  ingredients: fixtureIngredients(dayIndex, "dinner"),
                },
                {
                  mealType: "snack" as const,
                  dishName: `Dish-D${dayIndex}-snack`,
                  ingredients: fixtureIngredients(dayIndex, "snack"),
                },
              ],
            };
          }
          return {
            dayIndex,
            meals: MEAL_TYPES.map((mealType) => ({
              mealType,
              dishName: `Dish-D${dayIndex}-${mealType}`,
              ingredients: fixtureIngredients(dayIndex, mealType),
            })),
          };
        }),
      };
      const claudeMenuClient = createFakeClaudeMenuClient({
        generateWeek: async () => ({ ok: true, value: malformedResult }),
      });
      const replaceWeek = vi.fn(defaultReplaceWeek);
      const deps = createDeps({
        claudeMenuClient,
        menuPlanRepository: createFakeMenuPlanRepository({ replaceWeek }),
      });
      const service = createMenuPlanService(deps);

      const result = await service.generateWeek(WEEK_START);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected a failure result");
      }
      expect(result.error.reason).toBe("schema_validation_failed");
      expect(result.error.message).toContain("重複・欠落なく網羅していません");
      expect(replaceWeek).not.toHaveBeenCalled();
    });
  });

  describe.each(["food_id_not_found", "unit_not_found"] as const)(
    "generateWeek — 栄養価検証の失敗（後方の食枠で発生、Req 4.6, 5.4）: %s",
    (errorType) => {
      it(`28食枠中、後方（day5のdinner）で${errorType}が発生する場合、対応するGenerationFailureReasonを返し、replaceWeekは一切呼ばれない（前方の食枠は正常に検証されてから失敗する）`, async () => {
        const verifyDish = vi.fn(
          (ingredients: IngredientSelection[]): Result<VerifiedNutritionValues, VerificationError> => {
            const first = ingredients[0];
            if (first && first.foodId === "FIX-5-dinner") {
              return {
                ok: false,
                error: { type: errorType, message: `test failure: ${errorType}`, foodId: first.foodId },
              };
            }
            return defaultVerifyDish(ingredients);
          }
        );
        const deps = createDeps({
          nutritionVerificationService: createFakeNutritionVerificationService({ verifyDish }),
        });
        const service = createMenuPlanService(deps);

        const result = await service.generateWeek(WEEK_START);

        expect(result.ok).toBe(false);
        if (result.ok) {
          throw new Error("expected a failure result");
        }
        expect(result.error.reason).toBe(errorType);
        // day0〜day5(breakfast/lunch)まで正常に検証が進んでから失敗する（先頭で打ち切られていない）。
        expect(verifyDish.mock.calls.length).toBeGreaterThan(1);
      });
    }
  );

  describe.each(["generateWeek", "regenerateWeek"] as const)(
    "%s — 完全成功パス（Req 1.1, 1.3, 1.5, 4.3-4.5, 6.1, 11.1）",
    (methodName) => {
      it("全依存が成功する場合、7日×4食枠が正しく組み立てられreplaceWeekへ渡され、成功結果を返す", async () => {
        const replaceWeek = vi.fn(defaultReplaceWeek);
        const deps = createDeps({ menuPlanRepository: createFakeMenuPlanRepository({ replaceWeek }) });
        const service = createMenuPlanService(deps);

        const result = await service[methodName](WEEK_START);

        expect(result.ok).toBe(true);
        if (!result.ok) {
          throw new Error("expected a success result");
        }
        expect(replaceWeek).toHaveBeenCalledTimes(1);
        const call = replaceWeek.mock.calls[0];
        if (!call) {
          throw new Error("replaceWeek was not called");
        }
        const [calledWeekStartDate, calledDays] = call;
        expect(calledWeekStartDate).toBe(WEEK_START);
        expect(calledDays).toHaveLength(7);

        for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
          const day = calledDays.find((d) => d.dayIndex === dayIndex);
          if (!day) {
            throw new Error(`day ${dayIndex} missing from replaceWeek's days argument`);
          }
          expect(day.dayDate).toBe(weekDate(dayIndex));
          expect(day.meals).toHaveLength(4);

          const expectedMealNutritions = MEAL_TYPES.map((_, mealIndex) =>
            fixtureNutrition(dayIndex, mealIndex)
          );
          const expectedDayNutrition = sumNutrition(expectedMealNutritions);
          expect(day.dayNutrition).toEqual(expectedDayNutrition);
          expect(day.plannedKcal).toBe(expectedDayNutrition.energyKcal);
          const expectedTargetKcal = buildTarget(dayIndex).calorieTarget;
          expect(day.targetKcal).toBe(expectedTargetKcal);
          expect(day.varianceKcal).toBe(expectedDayNutrition.energyKcal - expectedTargetKcal);

          for (const mealType of MEAL_TYPES) {
            const meal = day.meals.find((m) => m.mealType === mealType);
            if (!meal) {
              throw new Error(`meal ${mealType} missing on day ${dayIndex}`);
            }
            const mealIndex = MEAL_TYPES.indexOf(mealType);
            expect(meal.nutrition).toEqual(fixtureNutrition(dayIndex, mealIndex));
            expect(meal.dishName).toBe(`Dish-D${dayIndex}-${mealType}`);
            expect(meal.ingredients).toEqual(fixtureIngredients(dayIndex, mealType));
          }
        }

        expect(result.value.days).toHaveLength(7);
      });
    }
  );

  describe("generateWeek と regenerateWeek の同一性（design.mdコメント: 同一フローを辿る）", () => {
    it("同一の入力・依存に対して、generateWeekとregenerateWeekは同一のresult構造・同一のreplaceWeek呼び出し引数を生成する", async () => {
      const replaceWeekForGenerate = vi.fn(defaultReplaceWeek);
      const serviceForGenerate = createMenuPlanService(
        createDeps({ menuPlanRepository: createFakeMenuPlanRepository({ replaceWeek: replaceWeekForGenerate }) })
      );
      const replaceWeekForRegenerate = vi.fn(defaultReplaceWeek);
      const serviceForRegenerate = createMenuPlanService(
        createDeps({ menuPlanRepository: createFakeMenuPlanRepository({ replaceWeek: replaceWeekForRegenerate }) })
      );

      const generateResult = await serviceForGenerate.generateWeek(WEEK_START);
      const regenerateResult = await serviceForRegenerate.regenerateWeek(WEEK_START);

      expect(generateResult).toEqual(regenerateResult);
      expect(replaceWeekForGenerate.mock.calls).toEqual(replaceWeekForRegenerate.mock.calls);
    });
  });

  describe("generateWeek — 苦手サマリの実際の伝播（Req 6.2, 10.3: FeedbackService → MenuPromptBuilder → ClaudeMenuClient）", () => {
    it("feedbackService.getDislikedSummaryが返す内容が、buildWeeklyPromptを経て実際にclaudeMenuClient.generateWeekへ渡されるペイロードに反映される", async () => {
      // 他のどのフィクスチャにも登場しない、この単体テスト専用の識別可能な料理名・食品ID。
      // 万一 dislikedSummary が捨てられて空配列のまま渡されても、他の理由でこの文字列が
      // ペイロードに紛れ込むことはない。
      const distinguishableSummary: DislikedItemSummary[] = [
        { dishName: "★苦手伝播検証用_激辛モルモット炒め★", foodIds: ["ZZ999-DISLIKED-PROPAGATION"] },
      ];
      const generateWeek = vi.fn(
        async (
          _payload: ClaudePromptPayload
        ): Promise<Result<WeeklyGenerationToolResult, ClaudeGenerationError>> => ({
          ok: true,
          value: buildDefaultWeeklyResult(),
        })
      );
      const replaceWeek = vi.fn(defaultReplaceWeek);
      const deps = createDeps({
        feedbackService: createFakeFeedbackService({
          getDislikedSummary: () => distinguishableSummary,
        }),
        claudeMenuClient: createFakeClaudeMenuClient({ generateWeek }),
        menuPlanRepository: createFakeMenuPlanRepository({ replaceWeek }),
      });
      const service = createMenuPlanService(deps);

      const result = await service.generateWeek(WEEK_START);

      expect(result.ok).toBe(true);
      expect(generateWeek).toHaveBeenCalledTimes(1);
      const call = generateWeek.mock.calls[0];
      if (!call) {
        throw new Error("claudeMenuClient.generateWeek was not called");
      }
      const [payload] = call;
      // `menu-prompt.builder.test.ts`（buildWeeklyPromptの専用テスト）が確認済みのとおり、
      // 苦手サマリの文言は `system` フィールドに配置される（`buildDislikedSummarySection`）。
      // ここではその配置場所の詳細に依存しすぎないよう、system/userMessage連結後の全文で確認する。
      const fullPromptText = `${payload.system}\n${payload.userMessage}`;
      expect(fullPromptText).toContain("★苦手伝播検証用_激辛モルモット炒め★");
      expect(fullPromptText).toContain("ZZ999-DISLIKED-PROPAGATION");
    });
  });

  describe("generateWeek — 計画摂取カロリー送信の失敗は非致命的（Req 11.2, 11.4）", () => {
    it("7日中2日でsubmitPlannedCaloriesが失敗しても、全体の生成は成功し、7日すべてに対して送信が呼ばれ、失敗分はconsole.errorに記録される", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const failingDates = new Set([weekDate(1), weekDate(4)]);
        const submitPlannedCalories = vi.fn(
          (date: IsoDate, _plannedKcal: number): Result<void, PlannedCalorieSubmissionError> => {
            if (failingDates.has(date)) {
              return {
                ok: false,
                error: { type: "planned_calorie_submission_failed", message: `test failure for ${date}` },
              };
            }
            return { ok: true, value: undefined };
          }
        );
        const replaceWeek = vi.fn(defaultReplaceWeek);
        const deps = createDeps({
          plannedCalorieGateway: createFakePlannedCalorieGateway({ submitPlannedCalories }),
          menuPlanRepository: createFakeMenuPlanRepository({ replaceWeek }),
        });
        const service = createMenuPlanService(deps);

        const result = await service.generateWeek(WEEK_START);

        expect(result.ok).toBe(true);
        expect(submitPlannedCalories).toHaveBeenCalledTimes(7);
        expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });

  describe("getActivePlan", () => {
    it("MenuPlanRepository.getActivePlanがnullを返す場合、nullをそのまま返す", () => {
      const getActivePlan = vi.fn(() => null);
      const deps = createDeps({ menuPlanRepository: createFakeMenuPlanRepository({ getActivePlan }) });
      const service = createMenuPlanService(deps);

      const result = service.getActivePlan(WEEK_START);

      expect(result).toBeNull();
      expect(getActivePlan).toHaveBeenCalledWith(WEEK_START);
      expect(getActivePlan).toHaveBeenCalledTimes(1);
    });

    it("MenuPlanRepository.getActivePlanが実際のWeekMenuPlanを返す場合、その値をそのまま返す", () => {
      const plan = buildFixtureWeekMenuPlan();
      const getActivePlan = vi.fn(() => plan);
      const deps = createDeps({ menuPlanRepository: createFakeMenuPlanRepository({ getActivePlan }) });
      const service = createMenuPlanService(deps);

      const result = service.getActivePlan(WEEK_START);

      expect(result).toBe(plan);
      expect(getActivePlan).toHaveBeenCalledWith(WEEK_START);
    });
  });

  describe("週開始日からの日付演算（addDaysIso、月・年境界、TASK_BRIEF項目2）", () => {
    it("月をまたぐ週開始日（2026-01-28、1月31日→2月1日をまたぐ）で、各日の日付が正しく計算される", async () => {
      const weekStart = "2026-01-28";
      const expectedDates = [
        "2026-01-28",
        "2026-01-29",
        "2026-01-30",
        "2026-01-31",
        "2026-02-01",
        "2026-02-02",
        "2026-02-03",
      ];
      const requestedDates: string[] = [];
      const nutritionGateway = createFakeNutritionGateway({
        getTargetsForDate: (date) => {
          requestedDates.push(date);
          return { ok: true, value: buildTarget(0) };
        },
      });
      const replaceWeek = vi.fn(defaultReplaceWeek);
      const deps = createDeps({
        nutritionGateway,
        menuPlanRepository: createFakeMenuPlanRepository({ replaceWeek }),
      });
      const service = createMenuPlanService(deps);

      const result = await service.generateWeek(weekStart);

      expect(requestedDates).toEqual(expectedDates);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected a success result");
      }
      expect(result.value.days.map((d) => d.dayDate)).toEqual(expectedDates);
    });

    it("年をまたぐ週開始日（2025-12-27、12月31日→1月1日をまたぐ）で、各日の日付が正しく計算される", async () => {
      const weekStart = "2025-12-27";
      const expectedDates = [
        "2025-12-27",
        "2025-12-28",
        "2025-12-29",
        "2025-12-30",
        "2025-12-31",
        "2026-01-01",
        "2026-01-02",
      ];
      const requestedDates: string[] = [];
      const nutritionGateway = createFakeNutritionGateway({
        getTargetsForDate: (date) => {
          requestedDates.push(date);
          return { ok: true, value: buildTarget(0) };
        },
      });
      const replaceWeek = vi.fn(defaultReplaceWeek);
      const deps = createDeps({
        nutritionGateway,
        menuPlanRepository: createFakeMenuPlanRepository({ replaceWeek }),
      });
      const service = createMenuPlanService(deps);

      const result = await service.generateWeek(weekStart);

      expect(requestedDates).toEqual(expectedDates);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected a success result");
      }
      expect(result.value.days.map((d) => d.dayDate)).toEqual(expectedDates);
    });
  });

  describe("ロック機構（Req 12.5、最も安全性に関わる性質）", () => {
    it("同一週への2つの同時generateWeek呼び出しのうち、後発側は先発側の完了を待たずに即座にgeneration_in_progressを返し、replaceWeekを呼ばない", async () => {
      const deferred = createDeferred<Result<WeeklyGenerationToolResult, ClaudeGenerationError>>();
      const replaceWeek = vi.fn(defaultReplaceWeek);
      const deps = createDeps({
        claudeMenuClient: createFakeClaudeMenuClient({ generateWeek: () => deferred.promise }),
        menuPlanRepository: createFakeMenuPlanRepository({ replaceWeek }),
      });
      const service = createMenuPlanService(deps);

      // 先発の呼び出しは、内部でClaude呼び出しにawaitするまで完全に同期的に進む。
      // したがってこの行が完了した時点で、ロックはすでに取得済みである。
      const firstCallPromise = service.generateWeek(WEEK_START);

      const secondResult = await service.generateWeek(WEEK_START);

      expect(secondResult.ok).toBe(false);
      if (secondResult.ok) {
        throw new Error("expected a failure result");
      }
      expect(secondResult.error.reason).toBe("generation_in_progress");
      expect(replaceWeek).not.toHaveBeenCalled();

      deferred.resolve({ ok: true, value: buildDefaultWeeklyResult() });
      const firstResult = await firstCallPromise;
      expect(firstResult.ok).toBe(true);
      expect(replaceWeek).toHaveBeenCalledTimes(1);
    });

    it("generateWeekとregenerateWeekは同一週に対して同一のロック名前空間を共有する（片方が処理中の間、もう片方への同一週の要求も拒否される）", async () => {
      const deferred = createDeferred<Result<WeeklyGenerationToolResult, ClaudeGenerationError>>();
      const replaceWeek = vi.fn(defaultReplaceWeek);
      const deps = createDeps({
        claudeMenuClient: createFakeClaudeMenuClient({ generateWeek: () => deferred.promise }),
        menuPlanRepository: createFakeMenuPlanRepository({ replaceWeek }),
      });
      const service = createMenuPlanService(deps);

      const firstCallPromise = service.generateWeek(WEEK_START);
      const regenerateResult = await service.regenerateWeek(WEEK_START);

      expect(regenerateResult.ok).toBe(false);
      if (regenerateResult.ok) {
        throw new Error("expected a failure result");
      }
      expect(regenerateResult.error.reason).toBe("generation_in_progress");
      expect(replaceWeek).not.toHaveBeenCalled();

      deferred.resolve({ ok: true, value: buildDefaultWeeklyResult() });
      const firstResult = await firstCallPromise;
      expect(firstResult.ok).toBe(true);
    });

    it("異なるweekStartDateへの同時呼び出しは互いにブロックせず、両方とも独立して処理が進む", async () => {
      const deferredA = createDeferred<Result<WeeklyGenerationToolResult, ClaudeGenerationError>>();
      const deferredB = createDeferred<Result<WeeklyGenerationToolResult, ClaudeGenerationError>>();
      let callCount = 0;
      const generateWeek = vi.fn((_payload: ClaudePromptPayload) => {
        callCount += 1;
        return callCount === 1 ? deferredA.promise : deferredB.promise;
      });
      const replaceWeek = vi.fn(defaultReplaceWeek);
      const genericTarget = buildTarget(0);
      const deps = createDeps({
        nutritionGateway: createFakeNutritionGateway({
          getTargetsForDate: () => ({ ok: true, value: genericTarget }),
        }),
        claudeMenuClient: createFakeClaudeMenuClient({ generateWeek }),
        menuPlanRepository: createFakeMenuPlanRepository({ replaceWeek }),
      });
      const service = createMenuPlanService(deps);

      const weekB = "2026-09-14";
      const promiseA = service.generateWeek(WEEK_START);
      const promiseB = service.generateWeek(weekB);

      deferredA.resolve({ ok: true, value: buildDefaultWeeklyResult() });
      deferredB.resolve({ ok: true, value: buildDefaultWeeklyResult() });

      const [resultA, resultB] = await Promise.all([promiseA, promiseB]);
      // どちらも「generation_in_progress」で拒否されず、両方とも成功していることが、
      // 異なる週のキーが互いをブロックしなかったことの証拠になる。
      expect(resultA.ok).toBe(true);
      expect(resultB.ok).toBe(true);
      expect(replaceWeek).toHaveBeenCalledTimes(2);
    });

    it("先発の呼び出しが成功で完了した後、同一週への後続の呼び出しは正常に処理できる（成功パスでもロックが解放される）", async () => {
      const replaceWeek = vi.fn(defaultReplaceWeek);
      const deps = createDeps({ menuPlanRepository: createFakeMenuPlanRepository({ replaceWeek }) });
      const service = createMenuPlanService(deps);

      const firstResult = await service.generateWeek(WEEK_START);
      expect(firstResult.ok).toBe(true);

      const secondResult = await service.regenerateWeek(WEEK_START);
      expect(secondResult.ok).toBe(true);
      expect(replaceWeek).toHaveBeenCalledTimes(2);
    });

    it("先発の呼び出しが失敗（profile_missing）で完了した後も、同一週への後続の呼び出しは正常に処理できる（失敗パスでもロックが解放される）", async () => {
      let profile: MenuProfileSnapshot | null = null;
      const profileGateway: ProfileGateway = { getCurrentProfile: () => profile };
      const replaceWeek = vi.fn(defaultReplaceWeek);
      const deps = createDeps({
        profileGateway,
        menuPlanRepository: createFakeMenuPlanRepository({ replaceWeek }),
      });
      const service = createMenuPlanService(deps);

      const firstResult = await service.generateWeek(WEEK_START);
      expect(firstResult.ok).toBe(false);
      if (firstResult.ok) {
        throw new Error("expected a failure result");
      }
      expect(firstResult.error.reason).toBe("profile_missing");
      expect(replaceWeek).not.toHaveBeenCalled();

      profile = buildDefaultProfile();
      const secondResult = await service.generateWeek(WEEK_START);
      expect(secondResult.ok).toBe(true);
      expect(replaceWeek).toHaveBeenCalledTimes(1);
    });

    it("先発の呼び出しがオーケストレーションの後段（Claude呼び出し起因のclaude_refusal）で失敗した後も、同一週への後続の呼び出しは正常に処理できる（早期の失敗だけでなく、後段の失敗パスでもロックが解放される）", async () => {
      let shouldRefuse = true;
      const generateWeek = vi.fn(
        async (
          payload: ClaudePromptPayload
        ): Promise<Result<WeeklyGenerationToolResult, ClaudeGenerationError>> => {
          if (shouldRefuse) {
            return { ok: false, error: { type: "refusal", message: "test refusal" } };
          }
          return { ok: true, value: buildDefaultWeeklyResult() };
        }
      );
      const replaceWeek = vi.fn(defaultReplaceWeek);
      const deps = createDeps({
        claudeMenuClient: createFakeClaudeMenuClient({ generateWeek }),
        menuPlanRepository: createFakeMenuPlanRepository({ replaceWeek }),
      });
      const service = createMenuPlanService(deps);

      const firstResult = await service.generateWeek(WEEK_START);
      expect(firstResult.ok).toBe(false);
      if (firstResult.ok) {
        throw new Error("expected a failure result");
      }
      expect(firstResult.error.reason).toBe("claude_refusal");
      expect(replaceWeek).not.toHaveBeenCalled();

      shouldRefuse = false;
      const secondResult = await service.regenerateWeek(WEEK_START);
      expect(secondResult.ok).toBe(true);
      expect(replaceWeek).toHaveBeenCalledTimes(1);
    });

    it("オーケストレーション内で予期しない例外が投げられた場合でも、例外はそのまま伝播しつつロックはfinallyで解放され、後続の呼び出しが正常に処理できる", async () => {
      let shouldThrow = true;
      const replaceWeek = vi.fn((weekStartDate: IsoDate, days: DayMenu[]): WeekMenuPlan => {
        if (shouldThrow) {
          throw new Error("unexpected repository failure (test)");
        }
        return defaultReplaceWeek(weekStartDate, days);
      });
      const deps = createDeps({ menuPlanRepository: createFakeMenuPlanRepository({ replaceWeek }) });
      const service = createMenuPlanService(deps);

      await expect(service.generateWeek(WEEK_START)).rejects.toThrow(
        "unexpected repository failure (test)"
      );
      expect(replaceWeek).toHaveBeenCalledTimes(1);

      shouldThrow = false;
      const secondResult = await service.regenerateWeek(WEEK_START);
      expect(secondResult.ok).toBe(true);
      expect(replaceWeek).toHaveBeenCalledTimes(2);
    });
  });

  describe("regenerateDay", () => {
    describe("対象週の有効なプランが存在しない（Req 7.4前提、design.md NotFoundError分岐）", () => {
      it("getActivePlanがnullを返す場合、NotFoundErrorを返し、findOtherDays/replaceDayは一切呼ばれない", async () => {
        const findOtherDays = vi.fn(defaultFindOtherDays);
        const replaceDay = vi.fn(defaultReplaceDay);
        const deps = createDailyDeps({
          menuPlanRepository: createFakeMenuPlanRepositoryForDay({
            getActivePlan: () => null,
            findOtherDays,
            replaceDay,
          }),
        });
        const service = createMenuPlanService(deps);

        const result = await service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);

        expect(result.ok).toBe(false);
        if (result.ok) {
          throw new Error("expected a failure result");
        }
        expect(result.error.type).toBe("not_found");
        expect(findOtherDays).not.toHaveBeenCalled();
        expect(replaceDay).not.toHaveBeenCalled();
      });
    });

    describe("プロフィール未登録（Req 12.1、週間生成と同一の手順）", () => {
      it("profileGateway.getCurrentProfileがnullを返す場合、GenerationError(profile_missing)を返し、replaceDayは一切呼ばれない", async () => {
        const replaceDay = vi.fn(defaultReplaceDay);
        const deps = createDailyDeps({
          profileGateway: createFakeProfileGateway(null),
          menuPlanRepository: createFakeMenuPlanRepositoryForDay({ replaceDay }),
        });
        const service = createMenuPlanService(deps);

        const result = await service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);

        expect(result.ok).toBe(false);
        if (result.ok) {
          throw new Error("expected a failure result");
        }
        expect(result.error).toMatchObject({ type: "generation_failed", reason: "profile_missing" });
        expect(replaceDay).not.toHaveBeenCalled();
      });
    });

    describe("栄養目標値算出不可（Req 12.2、週間生成と同一の手順）", () => {
      it("対象日のgetTargetsForDateが失敗する場合、GenerationError(nutrition_unavailable)を返し、replaceDayは一切呼ばれない", async () => {
        const getTargetsForDate = vi.fn(
          (date: IsoDate): Result<NutritionTargetSnapshot, CalculationUnavailableError> => {
            if (date === TARGET_DAY_DATE) {
              return {
                ok: false,
                error: {
                  type: "calculation_unavailable",
                  reason: "profile_missing",
                  message: "テスト用の算出不可エラー",
                },
              };
            }
            return defaultGetTargetsForDate(date);
          }
        );
        const replaceDay = vi.fn(defaultReplaceDay);
        const deps = createDailyDeps({
          nutritionGateway: createFakeNutritionGateway({ getTargetsForDate }),
          menuPlanRepository: createFakeMenuPlanRepositoryForDay({ replaceDay }),
        });
        const service = createMenuPlanService(deps);

        const result = await service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);

        expect(result.ok).toBe(false);
        if (result.ok) {
          throw new Error("expected a failure result");
        }
        expect(result.error).toMatchObject({ reason: "nutrition_unavailable" });
        expect(getTargetsForDate).toHaveBeenCalledWith(TARGET_DAY_DATE);
        expect(replaceDay).not.toHaveBeenCalled();
      });
    });

    describe.each([
      ["schema_validation_failed", "schema_validation_failed"],
      ["refusal", "claude_refusal"],
      ["request_failed", "claude_request_failed"],
    ] as const)("Claude生成エラー（Req 1.4, 12.3, 12.4）: %s", (claudeType, expectedReason) => {
      it(`ClaudeGenerationError(type: "${claudeType}")の場合、GenerationError(reason: "${expectedReason}")を返し、replaceDayは一切呼ばれない`, async () => {
        const replaceDay = vi.fn(defaultReplaceDay);
        const deps = createDailyDeps({
          claudeMenuClient: createFakeClaudeMenuClientForDay({
            generateDay: async (): Promise<Result<DailyGenerationToolResult, ClaudeGenerationError>> => ({
              ok: false,
              error: { type: claudeType, message: `test failure: ${claudeType}` },
            }),
          }),
          menuPlanRepository: createFakeMenuPlanRepositoryForDay({ replaceDay }),
        });
        const service = createMenuPlanService(deps);

        const result = await service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);

        expect(result.ok).toBe(false);
        if (result.ok) {
          throw new Error("expected a failure result");
        }
        expect(result.error).toMatchObject({ reason: expectedReason });
        expect(replaceDay).not.toHaveBeenCalled();
      });
    });

    describe("mealTypeの網羅性・一意性ガード（このタスクで新規追加、Req 1.1と同種の防御）", () => {
      it("4食枠のmealTypeに重複（breakfastが2件・dinnerが0件）がある場合、GenerationError(schema_validation_failed)を返し、replaceDayは一切呼ばれない", async () => {
        const malformedResult: DailyGenerationToolResult = {
          meals: [
            {
              mealType: "breakfast",
              dishName: "D1",
              ingredients: fixtureIngredients(TARGET_DAY_INDEX, "breakfast"),
            },
            {
              mealType: "breakfast",
              dishName: "D2",
              ingredients: fixtureIngredients(TARGET_DAY_INDEX, "lunch"),
            },
            {
              mealType: "lunch",
              dishName: "D3",
              ingredients: fixtureIngredients(TARGET_DAY_INDEX, "dinner"),
            },
            {
              mealType: "snack",
              dishName: "D4",
              ingredients: fixtureIngredients(TARGET_DAY_INDEX, "snack"),
            },
          ],
        };
        const replaceDay = vi.fn(defaultReplaceDay);
        const deps = createDailyDeps({
          claudeMenuClient: createFakeClaudeMenuClientForDay({
            generateDay: async () => ({ ok: true, value: malformedResult }),
          }),
          menuPlanRepository: createFakeMenuPlanRepositoryForDay({ replaceDay }),
        });
        const service = createMenuPlanService(deps);

        const result = await service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);

        expect(result.ok).toBe(false);
        if (result.ok) {
          throw new Error("expected a failure result");
        }
        expect(result.error).toMatchObject({ reason: "schema_validation_failed" });
        if (result.error.type !== "generation_failed") {
          throw new Error("expected a generation_failed error");
        }
        expect(result.error.message).toContain("重複・欠落なく網羅していません");
        expect(replaceDay).not.toHaveBeenCalled();
      });
    });

    describe.each(["food_id_not_found", "unit_not_found"] as const)(
      "栄養価検証の失敗（Req 4.6, 5.4）: %s",
      (errorType) => {
        it(`4食枠中1件でverifyDishが${errorType}を返す場合、対応するGenerationFailureReasonを返し、replaceDayは一切呼ばれない`, async () => {
          const verifyDish = vi.fn(
            (ingredients: IngredientSelection[]): Result<VerifiedNutritionValues, VerificationError> => {
              const first = ingredients[0];
              if (first && first.foodId === `FIX-${TARGET_DAY_INDEX}-dinner`) {
                return {
                  ok: false,
                  error: { type: errorType, message: `test failure: ${errorType}`, foodId: first.foodId },
                };
              }
              return defaultVerifyDish(ingredients);
            }
          );
          const replaceDay = vi.fn(defaultReplaceDay);
          const deps = createDailyDeps({
            nutritionVerificationService: createFakeNutritionVerificationService({ verifyDish }),
            menuPlanRepository: createFakeMenuPlanRepositoryForDay({ replaceDay }),
          });
          const service = createMenuPlanService(deps);

          const result = await service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);

          expect(result.ok).toBe(false);
          if (result.ok) {
            throw new Error("expected a failure result");
          }
          expect(result.error).toMatchObject({ reason: errorType });
          expect(replaceDay).not.toHaveBeenCalled();
        });
      }
    );

    describe("完全成功パス（Req 7.1, 7.4, 11.1）", () => {
      it("全依存が成功する場合、4食枠が正しく組み立てられreplaceDayへ渡され、成功結果を返す（replaceWeekは呼ばれない）", async () => {
        const replaceDay = vi.fn(defaultReplaceDay);
        const deps = createDailyDeps({
          menuPlanRepository: createFakeMenuPlanRepositoryForDay({ replaceDay }),
        });
        const service = createMenuPlanService(deps);

        const result = await service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);

        expect(result.ok).toBe(true);
        if (!result.ok) {
          throw new Error("expected a success result");
        }
        expect(replaceDay).toHaveBeenCalledTimes(1);
        const call = replaceDay.mock.calls[0];
        if (!call) {
          throw new Error("replaceDay was not called");
        }
        const [calledWeekStartDate, calledDayIndex, calledMeals, calledPlannedKcal, calledTargetKcal] = call;
        // Req 7.1/7.4: replaceDay（日単位）が呼ばれ、対象dayIndexのみが渡される
        // （replaceWeekは既定でthrowするフェイクのままであり、誤って呼ばれれば即座に検出される）。
        expect(calledWeekStartDate).toBe(WEEK_START);
        expect(calledDayIndex).toBe(TARGET_DAY_INDEX);
        expect(calledMeals).toHaveLength(4);

        const expectedMealNutritions = MEAL_TYPES.map((_, mealIndex) =>
          fixtureNutrition(TARGET_DAY_INDEX, mealIndex)
        );
        // Req 11.1: plannedKcalは4食枠の検証済みエネルギー量の「真の合計」でなければならない
        // （プレースホルダや別の値であってはならない、TASK_BRIEFのCRITICAL事項）。
        const expectedPlannedKcal = expectedMealNutritions.reduce((sum, n) => sum + n.energyKcal, 0);
        expect(calledPlannedKcal).toBe(expectedPlannedKcal);
        const expectedTargetKcal = buildTarget(TARGET_DAY_INDEX).calorieTarget;
        expect(calledTargetKcal).toBe(expectedTargetKcal);

        for (const mealType of MEAL_TYPES) {
          const meal = calledMeals.find((m) => m.mealType === mealType);
          if (!meal) {
            throw new Error(`meal ${mealType} missing`);
          }
          const mealIndex = MEAL_TYPES.indexOf(mealType);
          expect(meal.nutrition).toEqual(fixtureNutrition(TARGET_DAY_INDEX, mealIndex));
          expect(meal.dishName).toBe(`Dish-D${TARGET_DAY_INDEX}-${mealType}`);
          expect(meal.ingredients).toEqual(fixtureIngredients(TARGET_DAY_INDEX, mealType));
        }

        expect(result.value.dayIndex).toBe(TARGET_DAY_INDEX);
        expect(result.value.dayDate).toBe(TARGET_DAY_DATE);
      });
    });

    describe("findOtherDaysの配線（Req 7.2, 7.3）", () => {
      it("findOtherDaysに正しいweekStartDate・除外対象dayIndexが渡され、その結果が実際にgenerateDayへ渡されるペイロードに反映される", async () => {
        const distinguishableOtherDays: OtherDayContext[] = [
          {
            dayIndex: 0,
            meals: [
              {
                mealType: "breakfast",
                dishName: "★他日配線検証用_特製カレー★",
                foodIds: ["ZZ888-OTHERDAY-PROPAGATION"],
              },
            ],
          },
        ];
        const findOtherDays = vi.fn((_w: IsoDate, _e: number) => distinguishableOtherDays);
        const generateDay = vi.fn(
          async (
            _payload: ClaudePromptPayload
          ): Promise<Result<DailyGenerationToolResult, ClaudeGenerationError>> => ({
            ok: true,
            value: buildDefaultDailyResult(TARGET_DAY_INDEX),
          })
        );
        const deps = createDailyDeps({
          menuPlanRepository: createFakeMenuPlanRepositoryForDay({ findOtherDays }),
          claudeMenuClient: createFakeClaudeMenuClientForDay({ generateDay }),
        });
        const service = createMenuPlanService(deps);

        const result = await service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);

        expect(result.ok).toBe(true);
        expect(findOtherDays).toHaveBeenCalledWith(WEEK_START, TARGET_DAY_INDEX);
        expect(generateDay).toHaveBeenCalledTimes(1);
        const call = generateDay.mock.calls[0];
        if (!call) {
          throw new Error("claudeMenuClient.generateDay was not called");
        }
        const [payload] = call;
        const fullPromptText = `${payload.system}\n${payload.userMessage}`;
        expect(fullPromptText).toContain("★他日配線検証用_特製カレー★");
        expect(fullPromptText).toContain("ZZ888-OTHERDAY-PROPAGATION");
      });
    });

    describe("苦手サマリの配線（Req 7.5, 10.3）", () => {
      it("getDislikedSummaryが返す内容が、buildDailyPromptを経て実際にgenerateDayへ渡されるペイロードに反映される", async () => {
        const distinguishableSummary: DislikedItemSummary[] = [
          {
            dishName: "★日単位苦手伝播検証用_激辛モルモット炒め★",
            foodIds: ["ZZ999-DAILY-DISLIKED-PROPAGATION"],
          },
        ];
        const generateDay = vi.fn(
          async (
            _payload: ClaudePromptPayload
          ): Promise<Result<DailyGenerationToolResult, ClaudeGenerationError>> => ({
            ok: true,
            value: buildDefaultDailyResult(TARGET_DAY_INDEX),
          })
        );
        const deps = createDailyDeps({
          feedbackService: createFakeFeedbackService({
            getDislikedSummary: () => distinguishableSummary,
          }),
          claudeMenuClient: createFakeClaudeMenuClientForDay({ generateDay }),
        });
        const service = createMenuPlanService(deps);

        const result = await service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);

        expect(result.ok).toBe(true);
        const call = generateDay.mock.calls[0];
        if (!call) {
          throw new Error("claudeMenuClient.generateDay was not called");
        }
        const [payload] = call;
        const fullPromptText = `${payload.system}\n${payload.userMessage}`;
        expect(fullPromptText).toContain("★日単位苦手伝播検証用_激辛モルモット炒め★");
        expect(fullPromptText).toContain("ZZ999-DAILY-DISLIKED-PROPAGATION");
      });
    });

    describe("計画摂取カロリー送信の失敗は非致命的（Req 11.2, 11.4）", () => {
      it("submitPlannedCaloriesが失敗しても、regenerateDay全体は成功し、対象日1件分のみ呼ばれ、失敗はconsole.errorに記録される", async () => {
        const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
          const submitPlannedCalories = vi.fn(
            (_date: IsoDate, _plannedKcal: number): Result<void, PlannedCalorieSubmissionError> => ({
              ok: false,
              error: { type: "planned_calorie_submission_failed", message: "test failure" },
            })
          );
          const deps = createDailyDeps({
            plannedCalorieGateway: createFakePlannedCalorieGateway({ submitPlannedCalories }),
          });
          const service = createMenuPlanService(deps);

          const result = await service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);

          expect(result.ok).toBe(true);
          expect(submitPlannedCalories).toHaveBeenCalledTimes(1);
          expect(submitPlannedCalories).toHaveBeenCalledWith(TARGET_DAY_DATE, expect.any(Number));
          expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        } finally {
          consoleErrorSpy.mockRestore();
        }
      });
    });

    describe("日単位ロック機構（Req 12.5）", () => {
      it("同一週・同一dayIndexへの2つの同時regenerateDay呼び出しのうち、後発側は先発側の完了を待たずに即座にgeneration_in_progressを返し、replaceDayを呼ばない", async () => {
        const deferred = createDeferred<Result<DailyGenerationToolResult, ClaudeGenerationError>>();
        const replaceDay = vi.fn(defaultReplaceDay);
        const deps = createDailyDeps({
          claudeMenuClient: createFakeClaudeMenuClientForDay({ generateDay: () => deferred.promise }),
          menuPlanRepository: createFakeMenuPlanRepositoryForDay({ replaceDay }),
        });
        const service = createMenuPlanService(deps);

        const firstCallPromise = service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);
        const secondResult = await service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);

        expect(secondResult.ok).toBe(false);
        if (secondResult.ok) {
          throw new Error("expected a failure result");
        }
        expect(secondResult.error).toMatchObject({ reason: "generation_in_progress" });
        expect(replaceDay).not.toHaveBeenCalled();

        deferred.resolve({ ok: true, value: buildDefaultDailyResult(TARGET_DAY_INDEX) });
        const firstResult = await firstCallPromise;
        expect(firstResult.ok).toBe(true);
        expect(replaceDay).toHaveBeenCalledTimes(1);
      });

      it("同一週内の異なるdayIndexへの同時regenerateDay呼び出しは互いにブロックせず、両方とも独立して処理が進む", async () => {
        const deferredA = createDeferred<Result<DailyGenerationToolResult, ClaudeGenerationError>>();
        const deferredB = createDeferred<Result<DailyGenerationToolResult, ClaudeGenerationError>>();
        const otherDayIndex = 5;
        let callCount = 0;
        const generateDay = vi.fn((_payload: ClaudePromptPayload) => {
          callCount += 1;
          return callCount === 1 ? deferredA.promise : deferredB.promise;
        });
        const deps = createDailyDeps({
          claudeMenuClient: createFakeClaudeMenuClientForDay({ generateDay }),
        });
        const service = createMenuPlanService(deps);

        const promiseA = service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);
        const promiseB = service.regenerateDay(WEEK_START, otherDayIndex);

        deferredA.resolve({ ok: true, value: buildDefaultDailyResult(TARGET_DAY_INDEX) });
        deferredB.resolve({ ok: true, value: buildDefaultDailyResult(otherDayIndex) });

        const [resultA, resultB] = await Promise.all([promiseA, promiseB]);
        expect(resultA.ok).toBe(true);
        expect(resultB.ok).toBe(true);
      });

      it("同一dayIndexだが異なる週への同時regenerateDay呼び出しは互いにブロックせず、両方とも独立して処理が進む", async () => {
        const deferredA = createDeferred<Result<DailyGenerationToolResult, ClaudeGenerationError>>();
        const deferredB = createDeferred<Result<DailyGenerationToolResult, ClaudeGenerationError>>();
        const otherWeekStart = "2026-09-14";
        let callCount = 0;
        const generateDay = vi.fn((_payload: ClaudePromptPayload) => {
          callCount += 1;
          return callCount === 1 ? deferredA.promise : deferredB.promise;
        });
        const genericTarget = buildTarget(0);
        const deps = createDailyDeps({
          nutritionGateway: createFakeNutritionGateway({
            getTargetsForDate: () => ({ ok: true, value: genericTarget }),
          }),
          claudeMenuClient: createFakeClaudeMenuClientForDay({ generateDay }),
        });
        const service = createMenuPlanService(deps);

        const promiseA = service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);
        const promiseB = service.regenerateDay(otherWeekStart, TARGET_DAY_INDEX);

        deferredA.resolve({ ok: true, value: buildDefaultDailyResult(TARGET_DAY_INDEX) });
        deferredB.resolve({ ok: true, value: buildDefaultDailyResult(TARGET_DAY_INDEX) });

        const [resultA, resultB] = await Promise.all([promiseA, promiseB]);
        expect(resultA.ok).toBe(true);
        expect(resultB.ok).toBe(true);
      });

      it("regenerateDayは同一週へのgenerateWeek呼び出しと衝突しない（ロックキーが異なるため独立に処理される。design.mdは同一対象への重複要求防止のみを求め、週単位・日単位操作間の相互排他は求めていないための意図的な挙動）", async () => {
        const weekDeferred = createDeferred<Result<WeeklyGenerationToolResult, ClaudeGenerationError>>();
        const dayDeferred = createDeferred<Result<DailyGenerationToolResult, ClaudeGenerationError>>();
        const deps = createDailyDeps({
          claudeMenuClient: {
            generateWeek: () => weekDeferred.promise,
            generateDay: () => dayDeferred.promise,
            generateRecipe: () => {
              throw new Error("createFakeClaudeMenuClientForDay: generateRecipe is not used by MenuPlanService");
            },
          },
          menuPlanRepository: createFakeMenuPlanRepositoryForDay({
            replaceWeek: vi.fn(defaultReplaceWeek),
          }),
        });
        const service = createMenuPlanService(deps);

        const weekPromise = service.generateWeek(WEEK_START);
        const dayPromise = service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);

        weekDeferred.resolve({ ok: true, value: buildDefaultWeeklyResult() });
        dayDeferred.resolve({ ok: true, value: buildDefaultDailyResult(TARGET_DAY_INDEX) });

        const [weekResult, dayResult] = await Promise.all([weekPromise, dayPromise]);
        expect(weekResult.ok).toBe(true);
        expect(dayResult.ok).toBe(true);
      });

      it("先発の呼び出しが成功で完了した後、同一週・同一dayIndexへの後続の呼び出しは正常に処理できる（成功パスでもロックが解放される）", async () => {
        const replaceDay = vi.fn(defaultReplaceDay);
        const deps = createDailyDeps({
          menuPlanRepository: createFakeMenuPlanRepositoryForDay({ replaceDay }),
        });
        const service = createMenuPlanService(deps);

        const firstResult = await service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);
        expect(firstResult.ok).toBe(true);

        const secondResult = await service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);
        expect(secondResult.ok).toBe(true);
        expect(replaceDay).toHaveBeenCalledTimes(2);
      });

      it("先発の呼び出しが失敗（NotFoundError）で完了した後も、同一週・同一dayIndexへの後続の呼び出しは正常に処理できる（早期の失敗パスでもロックが解放される）", async () => {
        let activePlan: WeekMenuPlan | null = null;
        const replaceDay = vi.fn(defaultReplaceDay);
        const deps = createDailyDeps({
          menuPlanRepository: createFakeMenuPlanRepositoryForDay({
            getActivePlan: () => activePlan,
            replaceDay,
          }),
        });
        const service = createMenuPlanService(deps);

        const firstResult = await service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);
        expect(firstResult.ok).toBe(false);
        if (firstResult.ok) {
          throw new Error("expected a failure result");
        }
        expect(firstResult.error.type).toBe("not_found");
        expect(replaceDay).not.toHaveBeenCalled();

        activePlan = buildFixtureWeekMenuPlan();
        const secondResult = await service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);
        expect(secondResult.ok).toBe(true);
        expect(replaceDay).toHaveBeenCalledTimes(1);
      });

      it("先発の呼び出しがオーケストレーションの後段（Claude呼び出し起因のclaude_refusal）で失敗した後も、同一週・同一dayIndexへの後続の呼び出しは正常に処理できる（後段の失敗パスでもロックが解放される）", async () => {
        let shouldRefuse = true;
        const generateDay = vi.fn(
          async (
            _payload: ClaudePromptPayload
          ): Promise<Result<DailyGenerationToolResult, ClaudeGenerationError>> => {
            if (shouldRefuse) {
              return { ok: false, error: { type: "refusal", message: "test refusal" } };
            }
            return { ok: true, value: buildDefaultDailyResult(TARGET_DAY_INDEX) };
          }
        );
        const replaceDay = vi.fn(defaultReplaceDay);
        const deps = createDailyDeps({
          claudeMenuClient: createFakeClaudeMenuClientForDay({ generateDay }),
          menuPlanRepository: createFakeMenuPlanRepositoryForDay({ replaceDay }),
        });
        const service = createMenuPlanService(deps);

        const firstResult = await service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);
        expect(firstResult.ok).toBe(false);
        if (firstResult.ok) {
          throw new Error("expected a failure result");
        }
        expect(firstResult.error).toMatchObject({ reason: "claude_refusal" });
        expect(replaceDay).not.toHaveBeenCalled();

        shouldRefuse = false;
        const secondResult = await service.regenerateDay(WEEK_START, TARGET_DAY_INDEX);
        expect(secondResult.ok).toBe(true);
        expect(replaceDay).toHaveBeenCalledTimes(1);
      });
    });
  });
});
