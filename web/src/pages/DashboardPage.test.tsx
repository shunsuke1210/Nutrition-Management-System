import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  DayMenu,
  DietInsights,
  EatingOutSuggestionResult,
  MealSlot,
  MealType,
  NutritionSummary,
  Profile,
  ShoppingList,
  VerifiedNutritionValues,
  WeekMenuPlan,
} from "@nutrition/shared";
import * as profileClient from "../api/profileClient.js";
import * as nutritionClient from "../api/nutritionClient.js";
import * as menuPlanClient from "../api/menuPlanClient.js";
import * as mealSlotClient from "../api/mealSlotClient.js";
import * as dailyLogClient from "../api/dailyLogClient.js";
import { DashboardPage } from "./DashboardPage.js";

/**
 * `DashboardPage`（task 7.1）が直接呼び出す4クライアント（`profileClient` /
 * `nutritionClient` / `menuPlanClient` / `mealSlotClient`（`getEatingOutSuggestion`のみ））を
 * モックする（`RecipeDetailModal.test.tsx`/`CalorieBalanceSection.test.tsx`と同じ
 * `vi.mock` + `vi.mocked` パターン）。`dailyLogClient` は本ページが直接importしないが、
 * ダイエット状況画面に配置する`CalorieBalanceSection`がその内部で直接呼び出すため
 * （design.md参照）、実ネットワーク呼び出しを避けテスト結果を決定的にするためあわせてモックする。
 */
vi.mock("../api/profileClient.js", () => ({
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
}));
vi.mock("../api/nutritionClient.js", () => ({
  getSummary: vi.fn(),
  getDietInsights: vi.fn(),
}));
vi.mock("../api/menuPlanClient.js", () => ({
  getWeekPlan: vi.fn(),
  regenerateWeek: vi.fn(),
  regenerateDay: vi.fn(),
  getShoppingList: vi.fn(),
}));
vi.mock("../api/mealSlotClient.js", () => ({
  generateRecipeDetail: vi.fn(),
  submitFeedback: vi.fn(),
  getEatingOutSuggestion: vi.fn(),
}));
vi.mock("../api/dailyLogClient.js", () => ({
  getLogsInRange: vi.fn(),
  saveDailyLog: vi.fn(),
  addExerciseEntry: vi.fn(),
}));

const mockedGetProfile = vi.mocked(profileClient.getProfile);
const mockedGetSummary = vi.mocked(nutritionClient.getSummary);
const mockedGetDietInsights = vi.mocked(nutritionClient.getDietInsights);
const mockedGetWeekPlan = vi.mocked(menuPlanClient.getWeekPlan);
const mockedRegenerateWeek = vi.mocked(menuPlanClient.regenerateWeek);
const mockedGetShoppingList = vi.mocked(menuPlanClient.getShoppingList);
const mockedGetEatingOutSuggestion = vi.mocked(mealSlotClient.getEatingOutSuggestion);
const mockedGetLogsInRange = vi.mocked(dailyLogClient.getLogsInRange);

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

// 2026-08-31は月曜日、2026-09-02は水曜日（dayIndex 2）(node -eで実測確認済み。
// CalorieBalanceSection.test.tsxと同じ日付フィクスチャを再利用する)。
const WEEK_START_DATE = "2026-08-31";
const TODAY = "2026-09-02";
const WEEK_DATES = [
  "2026-08-31",
  "2026-09-01",
  "2026-09-02",
  "2026-09-03",
  "2026-09-04",
  "2026-09-05",
  "2026-09-06",
];

function buildProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    heightCm: 168,
    weightKg: 68.6,
    age: 34,
    gender: "female",
    bodyFatPct: null,
    medicalNotes: null,
    pregnancyStatus: "none",
    sleepHours: null,
    alcoholHabit: null,
    smokingHabit: null,
    cookingSkill: null,
    cookingTimePreference: null,
    budgetPreference: null,
    jobActivityLevel: "mixed",
    commuteMethod: "transit",
    averageDailySteps: null,
    exerciseRoutine: [],
    ngIngredients: [],
    preferredIngredients: [],
    restrictionType: "low_carb",
    restrictionIntensity: "standard",
    restrictionNotes: "揚げ物はできるだけ控えたい",
    dietModeEnabled: true,
    goalWeightKg: 63.0,
    goalPeriodWeeks: 16,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildVerifiedNutritionValues(
  overrides: Partial<VerifiedNutritionValues> = {},
): VerifiedNutritionValues {
  return {
    energyKcal: 2000,
    proteinG: 90,
    fatG: 60,
    carbG: 250,
    vitaminAUg: 697,
    vitaminDUg: 4.675,
    vitaminB1Mg: 1.064,
    vitaminB2Mg: 1.28,
    vitaminCMg: 120,
    calciumMg: 591.5,
    ironMg: 7.77,
    fiberG: 14.28,
    saltEquivalentG: 6.8,
    ...overrides,
  };
}

function buildMealSlot(mealType: MealType, dishName: string): MealSlot {
  return {
    mealType,
    dishName,
    ingredients: [{ foodId: "11001", quantity: 100, unit: "g" }],
    nutrition: buildVerifiedNutritionValues(),
  };
}

function buildDayMenu(dayIndex: number, mealNamePrefix: string): DayMenu {
  const dayNutrition = buildVerifiedNutritionValues();
  return {
    dayDate: WEEK_DATES[dayIndex]!,
    dayIndex,
    meals: [
      buildMealSlot("breakfast", `${mealNamePrefix}朝食${dayIndex}`),
      buildMealSlot("lunch", `${mealNamePrefix}昼食${dayIndex}`),
      buildMealSlot("dinner", `${mealNamePrefix}夕食${dayIndex}`),
      buildMealSlot("snack", `${mealNamePrefix}間食${dayIndex}`),
    ],
    dayNutrition,
    plannedKcal: dayNutrition.energyKcal,
    targetKcal: 2050,
    varianceKcal: dayNutrition.energyKcal - 2050,
  };
}

function buildWeekMenuPlan(mealNamePrefix: string): WeekMenuPlan {
  return {
    weekStartDate: WEEK_START_DATE,
    generatedAt: "2026-09-01T00:00:00.000Z",
    days: WEEK_DATES.map((_, index) => buildDayMenu(index, mealNamePrefix)),
  };
}

// 「旧」= 差し替え前, 「新」= regenerateWeek成功後（decision #6の検証用）。
const WEEK_PLAN = buildWeekMenuPlan("旧");
const WEEK_PLAN_V2 = buildWeekMenuPlan("新");

const SHOPPING_LIST: ShoppingList = {
  weekStartDate: WEEK_START_DATE,
  items: [
    {
      foodId: "11001",
      name: "白菜",
      category: "野菜・きのこ",
      quantityGrams: 250,
      displayQuantity: 0.5,
      displayUnit: "玉",
    },
  ],
};

const EATING_OUT_RESULT: EatingOutSuggestionResult = {
  suggestion: {
    typicalMenuName: "牛丼並盛",
    typicalMenuKcal: 780,
    alternativeMenuName: "焼き魚定食",
    alternativeMenuKcal: 620,
    proteinDeltaG: 8,
  },
};

function buildNutritionSummary(overrides: Partial<NutritionSummary> = {}): NutritionSummary {
  return {
    computedAt: "2026-09-02T00:00:00.000Z",
    bmr: 1380,
    activityCoefficient: 1.485,
    activityLevelLabel: "ふつう",
    tdee: 2050,
    dailyExpenditure: { date: TODAY, value: 2050 },
    normalMode: {
      calorieTarget: 2050,
      pfcRatio: { carbPct: 0.56, proteinPct: 0.19, fatPct: 0.25 },
      pfc: { carbG: 269, proteinG: 98, fatG: 57, carbKcal: 1076, proteinKcal: 392, fatKcal: 513 },
      micronutrients: {
        vitaminAUg: 850,
        vitaminDUg: 8.5,
        vitaminB1Mg: 1.4,
        vitaminB2Mg: 1.6,
        vitaminCMg: 100,
        calciumMg: 650,
        ironMg: 10.5,
        fiberG: 21,
        saltEquivalentUpperLimitG: 7.5,
      },
    },
    dietMode: null,
    ...overrides,
  };
}

const NUTRITION_SUMMARY_NORMAL = buildNutritionSummary();
const NUTRITION_SUMMARY_DIET = buildNutritionSummary({
  dietMode: {
    calorieTarget: 1650,
    pfcRatio: { carbPct: 0.5, proteinPct: 0.25, fatPct: 0.25 },
    pfc: { carbG: 206, proteinG: 103, fatG: 46, carbKcal: 825, proteinKcal: 412, fatKcal: 412 },
    guardrails: { warnings: [] },
  },
});

function buildDietInsights(overrides: Partial<DietInsights> = {}): DietInsights {
  return {
    weightHistory: [
      { date: "2026-07-01", weightKg: 73.4 },
      { date: "2026-08-01", weightKg: 70.0 },
      { date: "2026-09-01", weightKg: 68.6 },
    ],
    weightProjection: [{ date: "2026-09-08", projectedWeightKg: 68.0 }],
    goalEta: { available: true, weeklyProgressKg: 0.4, estimatedWeeksToGoal: 14 },
    plateau: { status: "plateaued", message: "テスト用停滞メッセージ" },
    exerciseSimulation: {
      available: true,
      scenarioLabel: "週3回・30分の運動を追加",
      dietOnlyWeeksToGoal: 14,
      dietPlusExerciseWeeksToGoal: 10,
    },
    ...overrides,
  };
}

const DIET_INSIGHTS = buildDietInsights();

/** 全クライアントを成功で解決するデフォルトのセットアップ。個々のテストで必要に応じて上書きする。 */
function setupSuccessfulFetches(profileOverrides: Partial<Profile> = {}) {
  const profile = buildProfile(profileOverrides);
  mockedGetProfile.mockResolvedValue({ ok: true, value: profile });
  mockedGetSummary.mockResolvedValue({
    ok: true,
    value: profile.dietModeEnabled ? NUTRITION_SUMMARY_DIET : NUTRITION_SUMMARY_NORMAL,
  });
  mockedGetDietInsights.mockResolvedValue({ ok: true, value: DIET_INSIGHTS });
  mockedGetWeekPlan.mockResolvedValue({ ok: true, value: WEEK_PLAN });
  mockedGetShoppingList.mockResolvedValue({ ok: true, value: SHOPPING_LIST });
  mockedGetEatingOutSuggestion.mockResolvedValue({ ok: true, value: EATING_OUT_RESULT });
  mockedGetLogsInRange.mockResolvedValue({ ok: true, value: [] });
  return profile;
}

describe("DashboardPage", () => {
  it(
    "shows ONLY the registration guidance and calls no other client when profileClient.getProfile " +
      "resolves to null (Requirement 16.1: no result display, no further fetches)",
    async () => {
      mockedGetProfile.mockResolvedValue({ ok: true, value: null });

      render(<DashboardPage today={TODAY} />);

      await screen.findByText(/プロフィールが登録されていません/);
      expect(screen.queryByRole("tablist", { name: "表示モード" })).toBeNull();
      expect(mockedGetSummary).not.toHaveBeenCalled();
      expect(mockedGetDietInsights).not.toHaveBeenCalled();
      expect(mockedGetWeekPlan).not.toHaveBeenCalled();
      expect(mockedGetShoppingList).not.toHaveBeenCalled();
      expect(mockedGetEatingOutSuggestion).not.toHaveBeenCalled();
    },
  );

  it(
    "renders normal-mode sections with real content and hides all diet-mode sections when " +
      "dietModeEnabled is false (Requirement 2.2)",
    async () => {
      setupSuccessfulFetches({ dietModeEnabled: false, goalWeightKg: null, goalPeriodWeeks: null });

      render(<DashboardPage today={TODAY} />);

      await screen.findByText("旧朝食0");
      expect(screen.getByText("推奨エネルギー量")).toBeDefined();
      expect(screen.getByText("白菜")).toBeDefined();
      expect(screen.getByText(/焼き魚定食/)).toBeDefined();

      // ダイエット専用セクション・見出しはいずれも表示されない(Requirement 2.2)。
      expect(screen.queryByText("ダイエット目標の状況")).toBeNull();
      expect(screen.queryByText("摂取・消費カロリー収支（今週）")).toBeNull();
      expect(screen.queryByText("体重推移と目標達成予測")).toBeNull();
      expect(screen.queryByText("停滞期アドバイス")).toBeNull();
      expect(screen.queryByText("運動を組み合わせた場合のシミュレーション")).toBeNull();
      expect(screen.queryByText("週3回・30分の運動を追加")).toBeNull();
      expect(screen.queryByText(/テスト用停滞メッセージ/)).toBeNull();
    },
  );

  it(
    "Requirement 16.3 defensive guard: ModeToggle's diet tab is genuinely disabled when " +
      "dietModeEnabled is false, so diet-only content can never be reached through user interaction",
    async () => {
      setupSuccessfulFetches({ dietModeEnabled: false, goalWeightKg: null, goalPeriodWeeks: null });

      render(<DashboardPage today={TODAY} />);

      const dietTab = await screen.findByRole("tab", { name: "ダイエット状況" });
      expect(dietTab).toHaveProperty("disabled", true);

      fireEvent.click(dietTab);
      expect(screen.queryByText("ダイエット目標の状況")).toBeNull();
    },
  );

  it(
    "clicking into diet mode reveals the 5 diet-only sections IN ADDITION TO the additive " +
      "normal-mode sections (NutritionSummarySection/ShoppingListSection/EatingOutTipSection, " +
      "still visible), while the ONE non-additive exception — WeeklyMenuSection and its " +
      "preceding RestrictionChip — disappears (Requirement 2.3's general 'in addition to' rule " +
      "vs. Requirement 4.2's explicit carve-out that the menu section is normal-mode-only)",
    async () => {
      setupSuccessfulFetches({ dietModeEnabled: true, goalWeightKg: 63.0, goalPeriodWeeks: 16 });

      render(<DashboardPage today={TODAY} />);

      // 通常モードでは献立セクションとその直前のRestrictionChipの両方が表示されている。
      await screen.findByText("旧朝食0");
      expect(screen.getByText(/現在の食事制限設定/)).toBeDefined();

      const dietTab = screen.getByRole("tab", { name: "ダイエット状況" });
      expect(dietTab).toHaveProperty("disabled", false);
      fireEvent.click(dietTab);

      // 加算的な通常モードのセクションは引き続き表示され続ける(Requirement 2.3)。
      expect(screen.getByText("推奨エネルギー量")).toBeDefined();
      expect(screen.getByText("白菜")).toBeDefined();
      expect(screen.getByText(/焼き魚定食/)).toBeDefined();

      // 5つのダイエット専用コンポーネントすべての識別可能な内容が同時に表示される。
      await screen.findByText("ダイエット目標の状況");
      expect(screen.getByText(/に到達見込み/)).toBeDefined();
      expect(screen.getByText("安全ペース判定：問題なし")).toBeDefined();

      await screen.findByText(/TDEE/);

      expect(screen.getByRole("img", { name: "体重推移と目標達成予測グラフ" })).toBeDefined();

      expect(screen.getByText(/テスト用停滞メッセージ/)).toBeDefined();

      expect(screen.getByText("週3回・30分の運動を追加")).toBeDefined();

      // Requirement 4.2 (design.mdで3箇所反復): 献立セクションはダイエット状況画面には
      // 配置しない。要件3.1によりその直前に配置される`RestrictionChip`も、献立セクション
      // 自体が無い以上あわせて表示されない。
      expect(screen.queryByText("旧朝食0")).toBeNull();
      expect(screen.queryByText(/現在の食事制限設定/)).toBeNull();
      expect(screen.queryByText("1週間のおすすめ献立")).toBeNull();
    },
  );

  it(
    "an independent section failure (getShoppingList rejects) shows only that section's own " +
      "fallback while other sections keep rendering their real content (Requirement 16.4/16.5)",
    async () => {
      setupSuccessfulFetches({ dietModeEnabled: false, goalWeightKg: null, goalPeriodWeeks: null });
      mockedGetShoppingList.mockResolvedValue({
        ok: false,
        error: { type: "unknown", message: "boom" },
      });

      render(<DashboardPage today={TODAY} />);

      await screen.findByText("旧朝食0");
      expect(screen.getByText("推奨エネルギー量")).toBeDefined();
      await screen.findByText(/買い物リストの取得に失敗しました/);
      expect(screen.queryByText("白菜")).toBeNull();
    },
  );

  it(
    "shows the 'week plan not generated' fallback in place of NutritionSummarySection's content " +
      "when getWeekPlan resolves to null, without crashing (decision #3 gating)",
    async () => {
      setupSuccessfulFetches({ dietModeEnabled: false, goalWeightKg: null, goalPeriodWeeks: null });
      mockedGetWeekPlan.mockResolvedValue({ ok: true, value: null });

      render(<DashboardPage today={TODAY} />);

      await screen.findByText(/週間献立が未生成のため本日の実績栄養価を表示できません/);
      expect(screen.queryByText("旧朝食0")).toBeNull();
    },
  );

  it(
    "WeeklyMenuSection's week-regenerate button, on success, triggers a real getWeekPlan refetch " +
      "reflecting the NEW fixture (decision #6: onRegenerateWeek must call weekPlan.refetch())",
    async () => {
      setupSuccessfulFetches({ dietModeEnabled: false, goalWeightKg: null, goalPeriodWeeks: null });
      mockedGetWeekPlan.mockResolvedValueOnce({ ok: true, value: WEEK_PLAN });
      mockedGetWeekPlan.mockResolvedValueOnce({ ok: true, value: WEEK_PLAN_V2 });
      mockedRegenerateWeek.mockResolvedValue({ ok: true, value: WEEK_PLAN_V2 });

      render(<DashboardPage today={TODAY} />);

      await screen.findByText("旧朝食0");

      fireEvent.click(screen.getByRole("button", { name: /週全体を差し替え/ }));

      await waitFor(() => expect(mockedGetWeekPlan).toHaveBeenCalledTimes(2));
      await screen.findByText("新朝食0");
      expect(screen.queryByText("旧朝食0")).toBeNull();
    },
  );

  it(
    "computes the correct Monday-start weekStartDate from an injected `today` prop and passes it " +
      "to getWeekPlan/getShoppingList/getEatingOutSuggestion (getWeekStartDate arithmetic)",
    async () => {
      // 2026-09-16は水曜日(dayIndex 2)、その週の月曜は2026-09-14(node -eで実測確認済み)。
      const ALT_TODAY = "2026-09-16";
      const EXPECTED_WEEK_START = "2026-09-14";

      setupSuccessfulFetches({ dietModeEnabled: false, goalWeightKg: null, goalPeriodWeeks: null });

      render(<DashboardPage today={ALT_TODAY} />);

      await waitFor(() => expect(mockedGetWeekPlan).toHaveBeenCalledWith(EXPECTED_WEEK_START));
      expect(mockedGetShoppingList).toHaveBeenCalledWith(EXPECTED_WEEK_START);
      expect(mockedGetEatingOutSuggestion).toHaveBeenCalledWith(EXPECTED_WEEK_START, 2, "lunch");
    },
  );
});
