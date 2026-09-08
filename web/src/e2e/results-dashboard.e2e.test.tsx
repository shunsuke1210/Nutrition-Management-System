/**
 * task 9.1（results-dashboard spec）用のE2Eテストスイート。
 *
 * `profile-and-daily-log.e2e.test.tsx`（task 7.5, user-profile spec）冒頭コメント参照:
 * このリポジトリにはPlaywright/Cypress等のブラウザ自動化フレームワークが導入されておらず、
 * design.mdもE2E専用ツールを指定していない。そのため本specでも同じ規約——実際に組み立てられた
 * `App`をまるごと描画し、`profileClient`/`nutritionClient`/`menuPlanClient`/`mealSlotClient`/
 * `dailyLogClient`という「境界の外側」のAPIクライアントモジュールのみをモックし、実際の
 * ユーザー操作（`fireEvent`によるクリック）を駆動する——という形でE2Eを実装する。
 *
 * `ModeToggle`/`ProfileStrip`/`RestrictionChip`/`NutritionSummarySection`/`WeeklyMenuSection`/
 * `DayColumn`/`MealCell`/`RecipeDetailModal`/`FeedbackControl`はいずれもそれぞれの
 * `.test.tsx`で内部ロジックまで既に網羅的に検証済みである（本ファイルでは再証明しない）。
 * 本ファイルの関心事は、それらが実際に組み立てられた`App`の中で正しく配線されているか
 * ——具体的には (1) `App`のナビゲーション操作(task 7.2)から`DashboardPage`(task 7.1)へ、
 * (2) `ModeToggle`の切替操作から`DashboardPage`の`mode`出し分けへ、(3) `WeeklyMenuSection`の
 * 食事セルクリックから`RecipeDetailModal`の`weekStartDate`/`dayIndex`/`mealType`propsへ、
 * (4) `RecipeDetailModal`内に埋め込まれた`FeedbackControl`のクリックから実際の
 * `mealSlotClient.submitFeedback`呼び出しへ——という、単体テストでは構造的に検出できない
 * クロスコンポーネントの配線が壊れていないことの証明である。
 *
 * このファイル名は`profile-and-daily-log.e2e.test.tsx`と並ぶ`e2e/`配下の兄弟ファイルとして、
 * まだ未着手のtask 9.2/9.3が同じファイルに`describe`/`it`を追加していくことを見越して
 * 選定されている（tasks.md参照）。本ファイルは task 9.1 自身のシナリオのみを実装する。
 *
 * `today`について: `App.tsx`は`<DashboardPage />`を`today`propなしで描画するため（App.tsx
 * 参照）、`DashboardPage`は実行時の実際の`new Date()`から`weekStartDate`/`todayDayIndex`を
 * 算出する。この日付算出ロジック自体（月曜始まりの週開始日計算）は`DashboardPage.test.tsx`の
 * 「computes the correct Monday-start weekStartDate」テストで`today`を注入して既に検証済み
 * であるため、本ファイルでは重複させない。そのため本ファイルの日付依存クライアント
 * （`getWeekPlan`/`getShoppingList`/`getEatingOutSuggestion`/`getSummary`/`getDietInsights`/
 * `getLogsInRange`）はいずれも呼び出し引数を問わず`mockResolvedValue`で解決させ、
 * `WeekMenuPlan`フィクスチャ自身が保持する`weekStartDate`（固定値）と`days[].dayIndex`
 * （0-6の固定順）のみを、`generateRecipeDetail`/`submitFeedback`の呼び出し引数の期待値として
 * 利用する（`RecipeDetailModal`の`weekStartDate` propは`WeeklyMenuSection`が
 * `data.weekStartDate`——実際のリクエストに使われた週開始日ではなく、このフィクスチャの値
 * ——からそのまま渡すため、実行時の実日付とは独立に検証できる。`WeeklyMenuSection.tsx`
 * 冒頭コメント「本コンポーネント自身は取得結果をローカルにキャッシュ・マージしない」参照）。
 *
 * Requirements: 4.1, 4.2, 4.4, 4.5, 5.1, 5.2, 5.5, 6.1, 6.2, 6.3, 7.1, 7.2
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  DayMenu,
  DietInsights,
  EatingOutSuggestionResult,
  MealSlot,
  MealType,
  NutritionSummary,
  Profile,
  RecipeDetail,
  ShoppingList,
  VerifiedNutritionValues,
  WeekMenuPlan,
} from "@nutrition/shared";
import type { ApiError, Result } from "../api/types.js";
import { App } from "../App.js";
import * as profileClient from "../api/profileClient.js";
import * as nutritionClient from "../api/nutritionClient.js";
import * as menuPlanClient from "../api/menuPlanClient.js";
import * as mealSlotClient from "../api/mealSlotClient.js";
import * as dailyLogClient from "../api/dailyLogClient.js";

/**
 * `App`が既定表示するプロフィール編集画面（`ProfilePage` + `DailyLogPanel`）は`profileClient`/
 * `dailyLogClient`のみに依存する（`App.test.tsx`参照）。ナビゲーション操作で切り替わる
 * `DashboardPage`（結果ダッシュボード）はさらに`nutritionClient`/`menuPlanClient`/
 * `mealSlotClient`にも依存する（`DashboardPage.test.tsx`参照）。本ファイルは`App`をまるごと
 * 描画するため、両画面が依存する全クライアントを合わせてモックする必要がある
 * （`dailyLogClient`は`DashboardPage.test.tsx`が挙げる`getLogsInRange`（ダイエット状況画面の
 * `CalorieBalanceSection`用）に加え、初期表示のプロフィール編集画面で`DailyLogPanel`が
 * マウント時に直接呼び出す`getDailyLog`・削除操作用の`removeExerciseEntry`も欠かせない
 * ——`App.test.tsx`の`dailyLogClient`モック参照。未モックのままだと`DailyLogPanel`マウント時に
 * `undefined`関数呼び出しで例外になる）。
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
  getDailyLog: vi.fn(),
  saveDailyLog: vi.fn(),
  addExerciseEntry: vi.fn(),
  removeExerciseEntry: vi.fn(),
  getLogsInRange: vi.fn(),
}));

const mockedGetProfile = vi.mocked(profileClient.getProfile);
const mockedGetSummary = vi.mocked(nutritionClient.getSummary);
const mockedGetDietInsights = vi.mocked(nutritionClient.getDietInsights);
const mockedGetWeekPlan = vi.mocked(menuPlanClient.getWeekPlan);
const mockedRegenerateWeek = vi.mocked(menuPlanClient.regenerateWeek);
const mockedGetShoppingList = vi.mocked(menuPlanClient.getShoppingList);
const mockedGenerateRecipeDetail = vi.mocked(mealSlotClient.generateRecipeDetail);
const mockedSubmitFeedback = vi.mocked(mealSlotClient.submitFeedback);
const mockedGetEatingOutSuggestion = vi.mocked(mealSlotClient.getEatingOutSuggestion);
const mockedGetDailyLog = vi.mocked(dailyLogClient.getDailyLog);
const mockedGetLogsInRange = vi.mocked(dailyLogClient.getLogsInRange);

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットし、モックの呼び出し履歴・実装も破棄する
// （既存の `App.test.tsx` / `DashboardPage.test.tsx` と同じ規約）。
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

// --- フィクスチャ ---
// 実行時の実日付とは独立した固定値（ファイル冒頭コメント参照）。`WeekMenuPlan.weekStartDate`
// そのものとして使い、`generateRecipeDetail`/`submitFeedback`の呼び出し引数の期待値にも使う。
const WEEK_START_DATE = "2026-08-31";
const WEEK_DATES = [
  "2026-08-31",
  "2026-09-01",
  "2026-09-02",
  "2026-09-03",
  "2026-09-04",
  "2026-09-05",
  "2026-09-06",
];

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

// 料理名は (dayIndex, mealType) の組ごとに一意にする（Requirement 6.1のシナリオで、特定の
// 食事セルを曖昧さなくクリックするため）。
const DISH_NAME_BASES: Record<MealType, string> = {
  breakfast: "鮭の塩焼き定食",
  lunch: "鶏むね肉と彩り野菜の炒め物",
  dinner: "豚肉と根菜の味噌煮込み",
  snack: "ヨーグルトとフルーツ",
};

/** 月曜(dayIndex 0)・朝食の料理名。栄養評価画面の表示確認とレシピ詳細モーダルの両方で使う。 */
const MONDAY_BREAKFAST_DISH = `${DISH_NAME_BASES.breakfast}(0)`;

function buildVerifiedNutritionValues(): VerifiedNutritionValues {
  return {
    energyKcal: 500,
    proteinG: 20,
    fatG: 15,
    carbG: 60,
    fiberG: 5,
    calciumMg: 200,
    ironMg: 3,
    vitaminAUg: 300,
    vitaminDUg: 2,
    vitaminB1Mg: 0.4,
    vitaminB2Mg: 0.4,
    vitaminCMg: 30,
    saltEquivalentG: 1.5,
  };
}

function buildMealSlot(dayIndex: number, mealType: MealType): MealSlot {
  return {
    mealType,
    dishName: `${DISH_NAME_BASES[mealType]}(${dayIndex})`,
    ingredients: [{ foodId: "11001", quantity: 100, unit: "g" }],
    nutrition: buildVerifiedNutritionValues(),
  };
}

function buildDayMenu(dayIndex: number): DayMenu {
  const dayNutrition = buildVerifiedNutritionValues();
  return {
    dayDate: WEEK_DATES[dayIndex]!,
    dayIndex,
    meals: MEAL_TYPES.map((mealType) => buildMealSlot(dayIndex, mealType)),
    dayNutrition,
    plannedKcal: dayNutrition.energyKcal,
    targetKcal: 2050,
    varianceKcal: dayNutrition.energyKcal - 2050,
  };
}

function buildWeekMenuPlan(): WeekMenuPlan {
  return {
    weekStartDate: WEEK_START_DATE,
    generatedAt: "2026-08-31T00:00:00.000Z",
    days: Array.from({ length: 7 }, (_, dayIndex) => buildDayMenu(dayIndex)),
  };
}

const WEEK_PLAN = buildWeekMenuPlan();

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

/** ダイエットモード有効時の`NutritionSummary`（Requirement 4.2の切替対象として`dietMode`を非null にする）。 */
const NUTRITION_SUMMARY: NutritionSummary = {
  computedAt: "2026-09-02T00:00:00.000Z",
  bmr: 1380,
  activityCoefficient: 1.485,
  activityLevelLabel: "ふつう",
  tdee: 2050,
  dailyExpenditure: { date: "2026-09-02", value: 2050 },
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
  dietMode: {
    calorieTarget: 1650,
    pfcRatio: { carbPct: 0.5, proteinPct: 0.25, fatPct: 0.25 },
    pfc: { carbG: 206, proteinG: 103, fatG: 46, carbKcal: 825, proteinKcal: 412, fatKcal: 412 },
    guardrails: { warnings: [] },
  },
};

const DIET_INSIGHTS: DietInsights = {
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
};

/** ダイエットモードが有効なプロフィール（`ModeToggle`のダイエット状況タブを操作可能にするため）。 */
const PROFILE: Profile = {
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
};

/** 月曜(dayIndex 0)・朝食のレシピ詳細（材料2件・手順2件・追加副菜提案1件、Requirement 6.2/6.3）。 */
const RECIPE_DETAIL: RecipeDetail = {
  mealSlotId: 501,
  servings: 2,
  cookingTimeMinutes: 15,
  steps: [
    "鮭に軽く塩を振り、10分ほど置いて出てきた水分をキッチンペーパーで拭き取る。",
    "フライパンに油をひき、皮目から中火でじっくり焼き、中まで火を通す。",
  ],
  ingredients: [
    { foodId: "10001", quantity: 80, unit: "g", name: "生鮭" },
    { foodId: "17001", quantity: 3, unit: "g", name: "塩" },
  ],
  nutrition: { energyKcal: 320, proteinG: 28, fatG: 14, carbG: 10 },
  supplementarySuggestions: [
    {
      dishName: "ほうれん草の胡麻和え",
      ingredients: [{ foodId: "06002", quantity: 60, unit: "g", name: "ほうれん草" }],
      nutritionDelta: { energyKcal: 45, proteinG: 2.1, fatG: 2.0, carbG: 4.5 },
    },
  ],
};

/** 全クライアントを成功で解決するデフォルトのセットアップ(`DashboardPage.test.tsx`と同じ方針)。 */
function setupSuccessfulFetches(): void {
  mockedGetProfile.mockResolvedValue({ ok: true, value: PROFILE });
  mockedGetDailyLog.mockResolvedValue({ ok: true, value: null });
  mockedGetSummary.mockResolvedValue({ ok: true, value: NUTRITION_SUMMARY });
  mockedGetDietInsights.mockResolvedValue({ ok: true, value: DIET_INSIGHTS });
  mockedGetWeekPlan.mockResolvedValue({ ok: true, value: WEEK_PLAN });
  mockedGetShoppingList.mockResolvedValue({ ok: true, value: SHOPPING_LIST });
  mockedGetEatingOutSuggestion.mockResolvedValue({ ok: true, value: EATING_OUT_RESULT });
  mockedGetLogsInRange.mockResolvedValue({ ok: true, value: [] });
}

/**
 * `App`を描画し、既定のプロフィール編集画面を経由して「結果ダッシュボード」ナビゲーション
 * 操作(task 7.2)で栄養評価画面へ切り替え、週間献立の内容が実際に表示されるまで待つ。
 * シナリオ1-3(タスクのプロンプト参照)に対応する共通の前段。
 */
async function navigateToNutritionEvalScreen(): Promise<{ container: HTMLElement }> {
  const { container } = render(<App />);

  // 既定表示はプロフィール編集画面(`ProfilePage`)である(深追いはしない。`App.test.tsx`/
  // `profile-and-daily-log.e2e.test.tsx`が既に検証済み)。
  await screen.findByRole("heading", { name: "プロフィール" });

  fireEvent.click(screen.getByRole("button", { name: "結果ダッシュボード" }));

  // 「1週間のおすすめ献立」見出し自体は`weekPlan`の解決を待たず即描画される
  // (`DashboardPage.tsx`のJSX参照)。`WeeklyMenuSection`は`weekPlan`(別個の非同期取得)が
  // 解決するまでは読み込み中表示のままのため、実際の料理名が表示されるまで`findByText`で
  // 待ってから見出しの存在とあわせて検証する(見出しの存在だけを待って料理名を同期チェックすると、
  // フェッチの解決タイミング次第でまだ読み込み中表示のままという競合を起こしうる)。
  await screen.findByText(MONDAY_BREAKFAST_DISH);
  expect(screen.getByRole("heading", { name: "1週間のおすすめ献立" })).toBeDefined();

  return { container };
}

interface ControlledPromise<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

/** `WeeklyMenuSection.test.tsx`の`createControlledPromise`と同じ、手動制御可能なPromiseのidiom。 */
function createControlledPromise<T>(): ControlledPromise<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("results-dashboard: composed App E2E scenarios (task 9.1)", () => {
  it(
    "Requirements 4.1/4.2/4.4: '1週間のおすすめ献立' is present only on the nutrition-eval screen, is " +
      "positioned between the nutrition-summary and shopping-list sections in document order, and is " +
      "genuinely absent (queryBy* returns null, not merely 'something else also rendered') on the " +
      "diet-status screen, reached through the real App-nav + ModeToggle interaction chain — then " +
      "reappears on switching back (round-trip)",
    async () => {
      setupSuccessfulFetches();
      await navigateToNutritionEvalScreen();

      // Requirement 4.4: 献立セクションの見出しは、推奨栄養量セクションの見出しの直後・
      // 買い物リストセクションの見出しより前という文書順に配置される(単体で`WeeklyMenuSection`
      // のみを描画する`WeeklyMenuSection.test.tsx`では、これらの兄弟セクション自体が存在しないため
      // 構造的に検証不可能。実際に組み立てられた`App`を描画する本ファイルでのみ検証できる)。
      const nutritionSummaryHeading = screen.getByRole("heading", { name: "1日の推奨栄養量" });
      const weeklyMenuHeading = screen.getByRole("heading", { name: "1週間のおすすめ献立" });
      const shoppingListHeading = screen.getByRole("heading", { name: "買い物リスト（今週分）" });
      expect(
        nutritionSummaryHeading.compareDocumentPosition(weeklyMenuHeading) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        weeklyMenuHeading.compareDocumentPosition(shoppingListHeading) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      // Requirement 4.1/4.2: ダイエット状況タブへ切り替えると、献立セクションは加算されず消える。
      fireEvent.click(screen.getByRole("tab", { name: "ダイエット状況" }));
      expect(screen.queryByRole("heading", { name: "1週間のおすすめ献立" })).toBeNull();
      expect(screen.queryByText(MONDAY_BREAKFAST_DISH)).toBeNull();

      // 往復確認: 栄養評価画面へ戻すと献立セクションが再び表示される。
      fireEvent.click(screen.getByRole("tab", { name: "栄養評価" }));
      expect(screen.getByRole("heading", { name: "1週間のおすすめ献立" })).toBeDefined();
      expect(screen.getByText(MONDAY_BREAKFAST_DISH)).toBeDefined();
    },
  );

  it(
    "Requirements 5.1/5.2/5.5: places the week-regen button inside .week-scroll-actions (mockup's " +
      "'曜日カード列の上部・右寄せ') and each day's regen button inside that day's own .day-head " +
      "('曜日名とカロリー表示の行の下'), and a re-click on the week-regen button while a regenerate is " +
      "in flight does not invoke regenerateWeek a second time, through the real composed App",
    async () => {
      setupSuccessfulFetches();
      const { container } = await navigateToNutritionEvalScreen();

      // Requirement 5.1: 週全体差し替えボタンは .week-scroll-actions 内(曜日カード列の上部・右寄せ)。
      const weekScrollActions = container.querySelector(".week-scroll-actions");
      expect(weekScrollActions).not.toBeNull();
      const weekRegenButton = weekScrollActions!.querySelector(".week-regen") as HTMLButtonElement | null;
      expect(weekRegenButton).not.toBeNull();

      // Requirement 5.2: 各曜日の差し替えボタンは、その曜日自身の .day-head 内(曜日名/カロリー行の下)。
      const dayCols = container.querySelectorAll(".day-col");
      expect(dayCols.length).toBe(7);
      dayCols.forEach((dayCol) => {
        const dayHead = dayCol.querySelector(".day-head");
        expect(dayHead).not.toBeNull();
        expect(dayHead!.querySelector(".regen-btn")).not.toBeNull();
      });

      // Requirement 5.5: 手動制御可能なPromiseで、差し替え進行中の再クリックを防止する。
      const deferred = createControlledPromise<Result<WeekMenuPlan, ApiError>>();
      mockedRegenerateWeek.mockReturnValue(deferred.promise);

      fireEvent.click(weekRegenButton!);
      expect(mockedRegenerateWeek).toHaveBeenCalledTimes(1);
      expect(weekRegenButton!.disabled).toBe(true);

      // 保留中の再クリックは受け付けない(Requirement 5.5)。
      fireEvent.click(weekRegenButton!);
      expect(mockedRegenerateWeek).toHaveBeenCalledTimes(1);

      // Promiseを解決するとロックが解除され、再びクリック可能に戻る。
      deferred.resolve({ ok: true, value: WEEK_PLAN });
      await waitFor(() => expect(weekRegenButton!.disabled).toBe(false));
    },
  );

  it(
    "Requirements 6.1/6.2/6.3/7.1/7.2: clicking a meal cell opens the recipe detail modal showing the " +
      "correct dish name/ingredients/steps/supplementary suggestions, and clicking '好き' inside the " +
      "still-open modal submits feedback with the correct weekStartDate/dayIndex/mealType/liked " +
      "arguments and shows the submitted confirmation",
    async () => {
      setupSuccessfulFetches();
      mockedGenerateRecipeDetail.mockResolvedValue({ ok: true, value: RECIPE_DETAIL });
      mockedSubmitFeedback.mockResolvedValue({ ok: true, value: undefined });

      await navigateToNutritionEvalScreen();

      // Requirement 6.1: 食事セル(月曜・朝食)クリックでレシピ詳細モーダルが開く。
      fireEvent.click(screen.getByRole("button", { name: MONDAY_BREAKFAST_DISH }));

      const dialog = await screen.findByRole("dialog", { name: "レシピ詳細" });
      expect(mockedGenerateRecipeDetail).toHaveBeenCalledWith(WEEK_START_DATE, 0, "breakfast");
      expect(within(dialog).getByRole("heading", { name: MONDAY_BREAKFAST_DISH })).toBeDefined();

      // Requirement 6.2: 材料(名称+分量)・手順。
      expect(within(dialog).getByText("生鮭")).toBeDefined();
      expect(within(dialog).getByText("80g")).toBeDefined();
      expect(within(dialog).getByText("塩")).toBeDefined();
      expect(within(dialog).getByText("3g")).toBeDefined();
      expect(within(dialog).getByText(RECIPE_DETAIL.steps[0]!)).toBeDefined();
      expect(within(dialog).getByText(RECIPE_DETAIL.steps[1]!)).toBeDefined();

      // Requirement 6.3: 追加副菜提案(料理名+栄養価増分)。
      expect(within(dialog).getByText("ほうれん草の胡麻和え")).toBeDefined();
      expect(within(dialog).getByText(/\+45kcal/)).toBeDefined();

      // Requirement 7.1/7.2: モーダル内に埋め込まれた FeedbackControl の「好き」ボタン。
      fireEvent.click(within(dialog).getByRole("button", { name: "好き" }));

      expect(mockedSubmitFeedback).toHaveBeenCalledWith(WEEK_START_DATE, 0, "breakfast", true);
      await within(dialog).findByText("「好き」を送信しました。");
    },
  );
});
