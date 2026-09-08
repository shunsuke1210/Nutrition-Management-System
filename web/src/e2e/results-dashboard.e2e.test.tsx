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
  DailyLogEntry,
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
// task 9.2で追加するシナリオ(摂取カロリー手動修正・追加運動記録の各フォーム送信)が直接
// 呼び出すクライアントを検証するために必要(task 9.1では未使用だったため、上記2つとは
// 独立に追加する)。
const mockedSaveDailyLog = vi.mocked(dailyLogClient.saveDailyLog);
const mockedAddExerciseEntry = vi.mocked(dailyLogClient.addExerciseEntry);

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

// ================================================================================================
// task 9.2 用の追加フィクスチャ・ヘルパー・シナリオ。
//
// 上記(task 9.1)のフィクスチャ・ヘルパー・テストは一切変更せず、必要なものはそのまま再利用する
// （`PROFILE`/`SHOPPING_LIST`/`EATING_OUT_RESULT`/`NUTRITION_SUMMARY`/`DIET_INSIGHTS`/
// `setupSuccessfulFetches`/`navigateToNutritionEvalScreen`）。
//
// `CalorieBalanceSection`関連のシナリオ(摂取カロリー手動修正・追加運動記録の各フォーム)のみ、
// 新たな注意点がある: `App.tsx`は`<DashboardPage />`を`today` propなしで描画するため
// （ファイル冒頭コメント参照）、`CalorieBalanceSection`の`today`/`weekStartDate`は実行時の
// 実際の`new Date()`から算出される。task 9.1の献立関連シナリオはこれを「フィクスチャ自身が
// 保持する固定値」を検証対象にすることで回避したが（ファイル冒頭コメント参照）、
// `CalorieBalanceSection`は`getLogsInRange`の応答を「実行時のtodayに一致する日付」で
// `logsByDate`に引き当てて初めて棒グラフに反映するため、同じ回避策が使えない。そのため
// 本セクションでは`DashboardPage.tsx`の`today`/`getWeekStartDate`算出と全く同一の
// アルゴリズムをこのテストファイル側で複製し（このコードベースの「日付演算の共有
// ユーティリティを持たず各ファイルが同一アルゴリズムを局所複製する」既存の確立された慣行——
// `DashboardPage.tsx`/`CalorieBalanceSection.tsx`/`DietGoalStatusSection.tsx`いずれも同型の
// 複製を持つ——にさらに倣う）、実行時の実「今日」に追随する`REAL_TODAY`/`REAL_WEEK_START_DATE`/
// `REAL_WEEK_DATES`を導出した上でフィクスチャを組み立てる。
// ================================================================================================

function addDaysIsoForToday(date: string, days: number): string {
  const parts = date.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function getWeekStartDateForToday(date: string): string {
  const parts = date.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const jsDayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun,1=Mon,...,6=Sat
  const daysSinceMonday = (jsDayOfWeek + 6) % 7; // Mon->0, Tue->1, ..., Sun->6
  return addDaysIsoForToday(date, -daysSinceMonday);
}

// `DashboardPage.tsx`の`today: IsoDate = todayProp ?? (new Date().toISOString().slice(0, 10))`と
// 全く同じ式(`today` propなしで描画されるため常にこの経路になる)。
const REAL_TODAY = new Date().toISOString().slice(0, 10);
const REAL_WEEK_START_DATE = getWeekStartDateForToday(REAL_TODAY);
const REAL_WEEK_DATES = Array.from({ length: 7 }, (_, offset) =>
  addDaysIsoForToday(REAL_WEEK_START_DATE, offset),
);

/** `NUTRITION_SUMMARY.dietMode.calorieTarget`(task 9.1のフィクスチャ、1650)。 */
const DIET_CALORIE_TARGET = NUTRITION_SUMMARY.dietMode!.calorieTarget;

/** `CalorieBalanceSection.test.tsx`の`buildEntry`と同じデフォルト値パターン。 */
function buildLogEntry(date: string, overrides: Partial<DailyLogEntry> = {}): DailyLogEntry {
  return {
    date,
    weightKg: null,
    bodyFatPct: null,
    plannedKcal: null,
    manualOverrideKcal: null,
    calorieIntakeActual: null,
    calorieIntakeSource: "unrecorded",
    exerciseEntries: [],
    ...overrides,
  };
}

/** ダイエットモードが無効なプロフィール(Requirement 16.3のシナリオ用)。`PROFILE`(task 9.1)の
 * 複製に`dietModeEnabled`/`goalWeightKg`/`goalPeriodWeeks`のみ上書きする
 * （`DashboardPage.test.tsx`の`buildProfile({ dietModeEnabled: false, goalWeightKg: null,
 * goalPeriodWeeks: null })`と同じ組み合わせ）。 */
const PROFILE_DIET_DISABLED: Profile = {
  ...PROFILE,
  dietModeEnabled: false,
  goalWeightKg: null,
  goalPeriodWeeks: null,
};

// `DIET_CALORIE_TARGET`(1650)のいずれとも一致しない6個の固定kcal値(全曜日が非ゼロの差分を
// 持つようにする。`CalorieBalanceChart`は`varianceKcal !== null`であれば0でも棒を描画するが、
// 曖昧さを避けるため意図的にすべて非ゼロにする)。
const NON_TARGET_KCAL_VALUES = [1800, 1500, 1900, 1600, 1700, 2000];

// --- 摂取カロリー手動修正フォームのシナリオ(Requirement 12.3/12.4)用フィクスチャ ---
// today自身は「行自体が存在しない」＝データなし(欠測)から開始する(`CalorieBalanceSection.
// test.tsx`のINITIAL_LOGSと同じ「欠測は0を捏造しない」規約)。today以外の6日分は実データ。
const LOGS_BEFORE_OVERRIDE: DailyLogEntry[] = REAL_WEEK_DATES.filter((date) => date !== REAL_TODAY).map(
  (date, index) =>
    buildLogEntry(date, {
      calorieIntakeActual: NON_TARGET_KCAL_VALUES[index]!,
      plannedKcal: NON_TARGET_KCAL_VALUES[index]!,
      calorieIntakeSource: "planned",
    }),
);

// 手動修正フォームの送信成功後を想定したフィクスチャ: todayにも実データが加わる(6件→7件)。
const LOGS_AFTER_OVERRIDE: DailyLogEntry[] = [
  ...LOGS_BEFORE_OVERRIDE,
  buildLogEntry(REAL_TODAY, {
    calorieIntakeActual: 1500,
    manualOverrideKcal: 1500,
    calorieIntakeSource: "manual",
  }),
];

// --- 追加運動記録フォームのシナリオ(Requirement 12.5/12.6)用フィクスチャ ---
// today とは異なる1日("marker"、todayの翌日。週をまたぐ場合も`% 7`で必ずtoday以外の日を指す)
// を欠測から開始し、フォーム送信成功後の2回目の`getLogsInRange`解決でその日にもデータが
// 加わることを、手動修正フォームと全く同じ「refetchで新しいフィクスチャが実際にDOMへ反映
// される」メカニズムの証明として使う。運動記録それ自体は摂取カロリー実績の値を意味的に
// 左右しない(`CalorieBalanceSection.tsx`のchartDataは`calorieIntakeActual`のみに依存し
// `exerciseEntries`を一切参照しない。ファイル冒頭コメント参照)ため、本シナリオは
// 「運動記録が摂取カロリー実績を変化させる」という誤った意味論を主張するものではなく、
// あくまで`ExerciseEntryForm`の`onSaved={refetch}`という配線(`ManualCalorieOverrideForm`と
// 全く同一のメカニズム)がフルの`App`ツリーの奥深くでも正しく機能することの証明である。
const EXERCISE_MARKER_DATE = REAL_WEEK_DATES[(REAL_WEEK_DATES.indexOf(REAL_TODAY) + 1) % 7]!;

const LOGS_BEFORE_EXERCISE: DailyLogEntry[] = REAL_WEEK_DATES.filter(
  (date) => date !== EXERCISE_MARKER_DATE,
).map((date, index) =>
  buildLogEntry(date, {
    calorieIntakeActual: NON_TARGET_KCAL_VALUES[index]!,
    plannedKcal: NON_TARGET_KCAL_VALUES[index]!,
    calorieIntakeSource: "planned",
  }),
);

const LOGS_AFTER_EXERCISE: DailyLogEntry[] = [
  ...LOGS_BEFORE_EXERCISE,
  buildLogEntry(EXERCISE_MARKER_DATE, {
    calorieIntakeActual: 1900,
    plannedKcal: 1900,
    calorieIntakeSource: "planned",
  }),
];

describe("results-dashboard: composed App E2E scenarios (task 9.2)", () => {
  it(
    "Requirement 16.1: profile not registered shows ONLY the registration guidance and calls no " +
      "other client, reached through the real App-nav + DashboardPage wiring — a narrower but " +
      "genuinely different proof than DashboardPage.test.tsx's own isolation-level test of the same " +
      "guard (the nav itself could theoretically break something an isolated render can't see)",
    async () => {
      mockedGetProfile.mockResolvedValue({ ok: true, value: null });
      mockedGetDailyLog.mockResolvedValue({ ok: true, value: null });

      render(<App />);
      // 既定表示はプロフィール編集画面。プロフィール未登録(=新規ユーザー)状態でも
      // クラッシュせず描画されること自体は`profile-and-daily-log.e2e.test.tsx`の関心事であり
      // 本テストでは深追いしない(Requirement 7.2、ProfilePage.tsx冒頭コメント参照)。
      await screen.findByRole("heading", { name: "プロフィール" });

      fireEvent.click(screen.getByRole("button", { name: "結果ダッシュボード" }));

      await screen.findByText(/プロフィールが登録されていません/);
      expect(screen.queryByRole("tablist", { name: "表示モード" })).toBeNull();
      expect(mockedGetSummary).not.toHaveBeenCalled();
      expect(mockedGetDietInsights).not.toHaveBeenCalled();
      expect(mockedGetWeekPlan).not.toHaveBeenCalled();
      expect(mockedGetShoppingList).not.toHaveBeenCalled();
      expect(mockedGetEatingOutSuggestion).not.toHaveBeenCalled();
      expect(mockedGetLogsInRange).not.toHaveBeenCalled();
    },
  );

  it(
    "Requirement 16.3: with a dietModeEnabled=false profile, ModeToggle's diet-status tab reached " +
      "through the real App-nav is genuinely disabled (native disabled attribute) with its guidance " +
      "note visible, and a click on it never reveals diet-only content — mirroring " +
      "DashboardPage.test.tsx's own resolution (verifying the reachable, user-facing enforcement " +
      "via ModeToggle rather than forcing the unreachable internal DashboardContent guard state)",
    async () => {
      setupSuccessfulFetches();
      mockedGetProfile.mockResolvedValue({ ok: true, value: PROFILE_DIET_DISABLED });

      await navigateToNutritionEvalScreen();

      const dietTab = screen.getByRole("tab", { name: "ダイエット状況" });
      expect(dietTab).toHaveProperty("disabled", true);
      expect(screen.getByText("ダイエットモードを有効にすると利用できます")).toBeDefined();

      fireEvent.click(dietTab);
      expect(screen.queryByText("ダイエット目標の状況")).toBeNull();
      expect(mockedGetLogsInRange).not.toHaveBeenCalled();
    },
  );

  it(
    "Requirements 8/9/13/14/15 (ShoppingListSection/EatingOutTipSection/WeightTrendSection/" +
      "PlateauAdviceCallout/ExerciseSimulationSection each display their upstream API response " +
      "content as-is, reached through the real App-nav + DashboardPage wiring) and 10.3 (DietGoalStatusSection's " +
      "available goalEta is reachable the same way) together with 12.3/12.4 (the manual " +
      "calorie-override form's submission calls saveDailyLog correctly and triggers a real refetch " +
      "that visibly updates CalorieBalanceChart, nested deep inside the full composed App tree — the " +
      "genuine integration-only value-add beyond CalorieBalanceSection.test.tsx's own identical " +
      "proof in isolation)",
    async () => {
      setupSuccessfulFetches();
      mockedGetLogsInRange.mockResolvedValueOnce({ ok: true, value: LOGS_BEFORE_OVERRIDE });
      mockedSaveDailyLog.mockResolvedValue({
        ok: true,
        value: buildLogEntry(REAL_TODAY, {
          calorieIntakeActual: 1500,
          manualOverrideKcal: 1500,
          calorieIntakeSource: "manual",
        }),
      });
      mockedGetLogsInRange.mockResolvedValueOnce({ ok: true, value: LOGS_AFTER_OVERRIDE });

      const { container } = await navigateToNutritionEvalScreen();

      // Requirement 8/9: 買い物リスト・外食時の代替提案は栄養評価画面の時点で、上流APIの
      // レスポンス内容(SHOPPING_LIST/EATING_OUT_RESULTフィクスチャ)がそのまま表示されている。
      // 各セクション自身の描画ロジック(カテゴリ別グループ化・数量表示・非表示条件等)は
      // `ShoppingListSection.test.tsx`/`EatingOutTipSection.test.tsx`が単体で既に網羅的に
      // 証明済みのため再証明しない。ここではApp全体のナビゲーション+DashboardPageの配線を
      // 実際に経由してもなおその内容がDOMへ現れることのみを確認する。
      expect(screen.getByText("白菜")).toBeDefined();
      expect(screen.getByText(/焼き魚定食/)).toBeDefined();

      fireEvent.click(screen.getByRole("tab", { name: "ダイエット状況" }));

      // Requirement 10.3: DietGoalStatusSectionのgoalETA(算出可能な場合の文言)。goalEtaの
      // 算出可能/不可能/進捗なしの3状態自体の作り分けは`DietGoalStatusSection.test.tsx`の
      // 責務であり、ここでは実際に到達可能であることのみ確認する。
      await screen.findByText("ダイエット目標の状況");
      expect(screen.getByText(/に到達見込み/)).toBeDefined();
      expect(screen.getByText("安全ペース判定：問題なし")).toBeDefined();

      // Requirement 13: 体重推移と目標達成予測グラフ。
      expect(screen.getByRole("img", { name: "体重推移と目標達成予測グラフ" })).toBeDefined();
      // Requirement 14: 停滞期アドバイス(DIET_INSIGHTS.plateau.messageがそのまま表示される)。
      expect(screen.getByText(/テスト用停滞メッセージ/)).toBeDefined();
      // Requirement 15: 運動併用シミュレーション(DIET_INSIGHTS.exerciseSimulation.scenarioLabel)。
      expect(screen.getByText("週3回・30分の運動を追加")).toBeDefined();

      // Requirement 12.3/12.4: 摂取カロリー手動修正フォーム→CalorieBalanceChartへの反映。
      await waitFor(() => expect(container.querySelectorAll("rect.bar-mark").length).toBe(6));

      fireEvent.click(screen.getByRole("button", { name: "今日の摂取カロリーを修正" }));
      fireEvent.change(screen.getByLabelText("摂取カロリー"), { target: { value: "1500" } });
      fireEvent.click(screen.getByRole("button", { name: "保存する" }));

      expect(mockedSaveDailyLog).toHaveBeenCalledWith(REAL_TODAY, { manualOverrideKcal: 1500 });
      await waitFor(() => expect(mockedGetLogsInRange).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(container.querySelectorAll("rect.bar-mark").length).toBe(7));
    },
  );

  it(
    "Requirements 12.5/12.6: the exercise-entry form's submission calls addExerciseEntry with the " +
      "correct ExerciseEntryInput shape/date and triggers the SAME real refetch mechanism as the " +
      "manual-override form above (their shared onSaved={refetch} wiring, Requirement 12.7), " +
      "visibly pulling through new CalorieBalanceChart content, nested deep inside the full composed " +
      "App tree (a separate scenario from the manual-override form, as this same proof was never " +
      "established for THIS form even by CalorieBalanceSection.test.tsx's own isolation-level tests, " +
      "which only exercised this refetch mechanism via the override form)",
    async () => {
      setupSuccessfulFetches();
      mockedGetLogsInRange.mockResolvedValueOnce({ ok: true, value: LOGS_BEFORE_EXERCISE });
      mockedAddExerciseEntry.mockResolvedValue({
        ok: true,
        value: { id: 1, activityName: "ウォーキング", durationMinutes: 30, estimatedCaloriesBurned: 120 },
      });
      mockedGetLogsInRange.mockResolvedValueOnce({ ok: true, value: LOGS_AFTER_EXERCISE });

      const { container } = await navigateToNutritionEvalScreen();
      fireEvent.click(screen.getByRole("tab", { name: "ダイエット状況" }));

      await waitFor(() => expect(container.querySelectorAll("rect.bar-mark").length).toBe(6));

      fireEvent.click(screen.getByRole("button", { name: "＋ 運動を記録" }));
      fireEvent.change(screen.getByLabelText("運動内容"), { target: { value: "ウォーキング" } });
      fireEvent.change(screen.getByLabelText("時間（分）"), { target: { value: "30" } });
      fireEvent.change(screen.getByLabelText("想定消費カロリー"), { target: { value: "120" } });
      fireEvent.click(screen.getByRole("button", { name: "保存する" }));

      expect(mockedAddExerciseEntry).toHaveBeenCalledWith(REAL_TODAY, {
        activityName: "ウォーキング",
        durationMinutes: 30,
        estimatedCaloriesBurned: 120,
      });
      await waitFor(() => expect(mockedGetLogsInRange).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(container.querySelectorAll("rect.bar-mark").length).toBe(7));
    },
  );
});
