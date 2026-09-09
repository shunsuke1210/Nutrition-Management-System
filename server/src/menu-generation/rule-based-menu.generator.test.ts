import { describe, expect, it } from "vitest";
import { MealTypeSchema, type IsoDate, type MealType } from "@nutrition/shared";
import type {
  FoodCompositionRepository,
  FoodItemNutrition,
} from "./food-composition.repository.js";
import type { MenuGenerator } from "./menu-generator.js";
import type { OtherDayContext } from "./menu-plan.repository.js";
import type { DislikedItemSummary } from "./menu-prompt.builder.js";
import type { NutritionTargetSnapshot } from "./nutrition.gateway.js";
import type { MenuProfileSnapshot } from "./profile.gateway.js";
import { RULE_BASED_RECIPES } from "./rule-based-recipe.data.js";
import { createRuleBasedMenuGenerator } from "./rule-based-menu.generator.js";

/**
 * `RuleBasedMenuGenerator`（task 17.3）のテスト。
 *
 * `RULE_BASED_RECIPES`（task 17.2、実データ）そのものを候補プールとして使い、モック化しない
 * （`rule-based-recipe.data.test.ts`が既にfoodId実在性・データ整合性を検証済みのため、本テストは
 * 「そのデータからの選定ロジック・分量スケーリング」のみに専念する）。`FoodCompositionRepository`
 * は`nutrition-verification.service.test.ts`の`createFakeFoodCompositionRepository`と同じ
 * スタイルの、`findById`のみを実装するフェイクを用いる（`listAllIds`/`findUnitConversion`/
 * `findGenericUnitConversion`はRuleBasedMenuGeneratorが使わないため未使用扱いで呼ばれたら例外）。
 */

// --- フィクスチャ ---

function buildProfile(overrides: Partial<MenuProfileSnapshot> = {}): MenuProfileSnapshot {
  return {
    ngIngredients: [],
    preferredIngredients: [],
    restrictionType: "none",
    restrictionIntensity: null,
    restrictionNotes: null,
    cookingSkill: null,
    cookingTimePreference: null,
    budgetPreference: null,
    ...overrides,
  };
}

function buildTarget(overrides: Partial<NutritionTargetSnapshot> = {}): NutritionTargetSnapshot {
  return {
    calorieTarget: 2000,
    pfc: { proteinG: 120, fatG: 55, carbG: 250 },
    activityLevelLabel: "普通",
    guardrailWarningTypes: [],
    ...overrides,
  };
}

const WEEK_DATES: IsoDate[] = [
  "2025-01-06",
  "2025-01-07",
  "2025-01-08",
  "2025-01-09",
  "2025-01-10",
  "2025-01-11",
  "2025-01-12",
];

function buildTargetsRecord(calorieTarget = 2000): Record<IsoDate, NutritionTargetSnapshot> {
  const record: Record<IsoDate, NutritionTargetSnapshot> = {};
  for (const date of WEEK_DATES) {
    record[date] = buildTarget({ calorieTarget });
  }
  return record;
}

/**
 * `RuleBasedMenuGenerator`が呼び出す唯一のメソッドは`findById`のみ。
 * `energyKcal`は`kcalByFoodId`で個別指定するか、指定がなければ`defaultKcalPer100g`を返す。
 */
function createFakeFoodCompositionRepository(
  options: { kcalByFoodId?: Record<string, number>; defaultKcalPer100g?: number } = {}
): FoodCompositionRepository {
  const { kcalByFoodId = {}, defaultKcalPer100g = 150 } = options;
  return {
    findById: (foodId: string): FoodItemNutrition => ({
      foodId,
      name: `dummy-${foodId}`,
      category: "dummy",
      per100g: {
        energyKcal: kcalByFoodId[foodId] ?? defaultKcalPer100g,
        proteinG: 0,
        fatG: 0,
        carbG: 0,
        fiberG: null,
        calciumMg: null,
        ironMg: null,
        vitaminAUg: null,
        vitaminDUg: null,
        vitaminB1Mg: null,
        vitaminB2Mg: null,
        vitaminCMg: null,
        saltEquivalentG: null,
      },
      sourceCitation: "dummy",
      displayUnitCode: null,
    }),
    listAllIds: () => {
      throw new Error(
        "createFakeFoodCompositionRepository: listAllIds is not used by RuleBasedMenuGenerator"
      );
    },
    findUnitConversion: () => {
      throw new Error(
        "createFakeFoodCompositionRepository: findUnitConversion is not used by RuleBasedMenuGenerator"
      );
    },
    findGenericUnitConversion: () => {
      throw new Error(
        "createFakeFoodCompositionRepository: findGenericUnitConversion is not used by RuleBasedMenuGenerator"
      );
    },
  };
}

/** シード可能な単純なLCG擬似乱数（決定論的再現性のテスト専用、暗号強度は不要）。 */
function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const BREAKFAST_RECIPES = RULE_BASED_RECIPES.filter((entry) => entry.mealType === "breakfast");
const ALL_BREAKFAST_DISH_NAMES = BREAKFAST_RECIPES.map((entry) => entry.dishName);
const ALL_BREAKFAST_TAGS = Array.from(new Set(BREAKFAST_RECIPES.flatMap((entry) => entry.tags)));

function findBreakfastRecipe(dishName: string) {
  const entry = BREAKFAST_RECIPES.find((candidate) => candidate.dishName === dishName);
  if (!entry) {
    throw new Error(`test fixture error: unknown breakfast dishName ${dishName}`);
  }
  return entry;
}

/**
 * `mealType`枠について、`sampleCount`件の異なる`random()`値（`[0,1)`を均等割りした値）で
 * `generateDay`を独立に呼び出し、選定された`dishName`の集合を返す。候補全体を統計的・決定論的に
 * 走査するための共通ヘルパー（NG食材フィルタ・苦手料理除外・食事制限フィルタの「機能している
 * こと」の検証に使う）。
 */
async function collectDishNamesAcrossRandomRange(
  generatorFactory: (random: () => number) => MenuGenerator,
  profile: MenuProfileSnapshot,
  target: NutritionTargetSnapshot,
  otherDays: OtherDayContext[],
  dislikedSummary: DislikedItemSummary[],
  mealType: MealType,
  sampleCount: number
): Promise<Set<string>> {
  const dishNames = new Set<string>();
  for (let i = 0; i < sampleCount; i++) {
    const r = (i + 0.5) / sampleCount;
    const generator = generatorFactory(() => r);
    const result = await generator.generateDay(profile, target, otherDays, dislikedSummary);
    if (!result.ok) {
      throw new Error(`unexpected generateDay failure at r=${r}: ${result.error.message}`);
    }
    const meal = result.value.meals.find((m) => m.mealType === mealType);
    if (!meal) {
      throw new Error(`meal for mealType ${mealType} not found in generateDay result`);
    }
    dishNames.add(meal.dishName);
  }
  return dishNames;
}

// --- テスト本体 ---

describe("createRuleBasedMenuGenerator", () => {
  describe("決定論性（固定シードの乱数関数を注入した場合、同一入力に対して常に同一の結果を返す）", () => {
    it("同じシードで構築した2つの独立したgeneratorインスタンスがgenerateWeekで完全に同一の結果を返す", async () => {
      const foodCompositionRepository = createFakeFoodCompositionRepository();
      const profile = buildProfile({ ngIngredients: ["ピーマン"] });
      const targets = buildTargetsRecord();
      const dislikedSummary: DislikedItemSummary[] = [];

      const generatorA = createRuleBasedMenuGenerator({
        foodCompositionRepository,
        random: createSeededRandom(42),
      });
      const generatorB = createRuleBasedMenuGenerator({
        foodCompositionRepository,
        random: createSeededRandom(42),
      });

      const resultA = await generatorA.generateWeek(profile, targets, dislikedSummary);
      const resultB = await generatorB.generateWeek(profile, targets, dislikedSummary);

      expect(resultA.ok).toBe(true);
      expect(resultB.ok).toBe(true);
      expect(resultA).toEqual(resultB);
    });

    it("異なるシードでは（少なくともどこかのスロットで）異なる結果になり得る（決定論性が本当にシード依存であることの裏付け）", async () => {
      const foodCompositionRepository = createFakeFoodCompositionRepository();
      const profile = buildProfile();
      const targets = buildTargetsRecord();

      const generatorA = createRuleBasedMenuGenerator({
        foodCompositionRepository,
        random: createSeededRandom(1),
      });
      const generatorB = createRuleBasedMenuGenerator({
        foodCompositionRepository,
        random: createSeededRandom(999999),
      });

      const resultA = await generatorA.generateWeek(profile, targets, []);
      const resultB = await generatorB.generateWeek(profile, targets, []);
      expect(resultA.ok).toBe(true);
      expect(resultB.ok).toBe(true);
      // 完全一致しないことをもって「シードが結果に影響する」ことを確認する
      // （両者が偶然同じ献立になる確率は極めて低いが、万一一致してもテスト自体の意義
      // ＝上の「同一シードなら同一結果」テストが決定論性の主たる証明であるため許容する）。
      expect(resultA).not.toEqual(resultB);
    });
  });

  describe("WeeklyGenerationToolResult / DailyGenerationToolResultの型契約", () => {
    it("generateWeekはdayIndex 0-6を重複なく網羅し、各日がmealTypeを4種重複なく網羅する", async () => {
      const foodCompositionRepository = createFakeFoodCompositionRepository();
      const generator = createRuleBasedMenuGenerator({
        foodCompositionRepository,
        random: createSeededRandom(7),
      });

      const result = await generator.generateWeek(buildProfile(), buildTargetsRecord(), []);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const dayIndexes = result.value.days.map((day) => day.dayIndex);
      expect(new Set(dayIndexes).size).toBe(7);
      expect([...dayIndexes].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);

      for (const day of result.value.days) {
        const mealTypes = day.meals.map((meal) => meal.mealType);
        expect(new Set(mealTypes).size).toBe(4);
        expect([...mealTypes].sort()).toEqual(["breakfast", "dinner", "lunch", "snack"].sort());
      }
    });

    it("generateDayはちょうど4件のmealTypeを重複なく網羅するmealsを返す", async () => {
      const foodCompositionRepository = createFakeFoodCompositionRepository();
      const generator = createRuleBasedMenuGenerator({
        foodCompositionRepository,
        random: createSeededRandom(7),
      });

      const result = await generator.generateDay(buildProfile(), buildTarget(), [], []);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const mealTypes = result.value.meals.map((meal) => meal.mealType);
      expect(mealTypes).toHaveLength(4);
      expect(new Set(mealTypes).size).toBe(4);
      expect([...mealTypes].sort()).toEqual(["breakfast", "dinner", "lunch", "snack"].sort());
    });
  });

  describe("NG食材フィルタ", () => {
    it("ngIngredientsにマッチする候補（タグ'卵'を含む朝食4品）が、候補が十分残っている状況で一度も選ばれない", async () => {
      const foodCompositionRepository = createFakeFoodCompositionRepository();
      const profile = buildProfile({ ngIngredients: ["卵"] });
      const excludedDishNames = BREAKFAST_RECIPES.filter((entry) => entry.tags.includes("卵")).map(
        (entry) => entry.dishName
      );
      expect(excludedDishNames.length).toBeGreaterThan(0);

      const selected = await collectDishNamesAcrossRandomRange(
        (random) => createRuleBasedMenuGenerator({ foodCompositionRepository, random }),
        profile,
        buildTarget(),
        [],
        [],
        "breakfast",
        40
      );

      for (const dishName of selected) {
        expect(excludedDishNames).not.toContain(dishName);
        expect(findBreakfastRecipe(dishName).tags).not.toContain("卵");
      }
      // フィルタが機能しつつ候補が複数残っていること自体も確認する（0件へのフォールバックが
      // 発生していない通常経路であることの裏付け）。
      expect(selected.size).toBeGreaterThan(1);
    });
  });

  describe("苦手料理（dislikedSummary）の除外", () => {
    it("dislikedSummaryのdishNameと一致する候補が一度も選ばれない", async () => {
      const foodCompositionRepository = createFakeFoodCompositionRepository();
      const profile = buildProfile();
      const dislikedSummary: DislikedItemSummary[] = [{ dishName: "納豆ごはん", foodIds: ["01088"] }];

      const selected = await collectDishNamesAcrossRandomRange(
        (random) => createRuleBasedMenuGenerator({ foodCompositionRepository, random }),
        profile,
        buildTarget(),
        [],
        dislikedSummary,
        "breakfast",
        40
      );

      expect(selected.has("納豆ごはん")).toBe(false);
      expect(selected.size).toBeGreaterThan(1);
    });
  });

  describe("restrictionTypeフィルタ（ソフト、フォールバックあり）", () => {
    it("候補が残る通常ケースでは、restrictionSuitabilityにrestrictionTypeを含む候補のみが選ばれる", async () => {
      const foodCompositionRepository = createFakeFoodCompositionRepository();
      // 朝食でlow_carbに適合するのは「ハムエッグ」「スクランブルエッグとソーセージ」
      // 「鶏むね肉のサラダ朝食プレート」の3件のみ（rule-based-recipe.data.tsの実データ）。
      const lowCarbBreakfastDishNames = BREAKFAST_RECIPES.filter((entry) =>
        entry.restrictionSuitability.includes("low_carb")
      ).map((entry) => entry.dishName);
      expect(lowCarbBreakfastDishNames.length).toBeGreaterThan(0);
      expect(lowCarbBreakfastDishNames.length).toBeLessThan(BREAKFAST_RECIPES.length);

      const profile = buildProfile({ restrictionType: "low_carb" });
      const selected = await collectDishNamesAcrossRandomRange(
        (random) => createRuleBasedMenuGenerator({ foodCompositionRepository, random }),
        profile,
        buildTarget(),
        [],
        [],
        "breakfast",
        40
      );

      for (const dishName of selected) {
        expect(lowCarbBreakfastDishNames).toContain(dishName);
      }
    });

    it("restrictionTypeフィルタの結果が0件になる極端なケースでは、restrictionフィルタのみが緩和され（NG食材フィルタは維持され）、選定が成功する", async () => {
      const foodCompositionRepository = createFakeFoodCompositionRepository();
      // 朝食でlow_carbに適合する3件（ハムエッグ・スクランブルエッグとソーセージ・
      // 鶏むね肉のサラダ朝食プレート）はいずれもタグ「卵」または「鶏肉」を含む。
      // ngIngredients=["卵","鶏肉"]を指定すると、NG食材フィルタ（必須・維持される）だけで
      // この3件が全て除外され、結果としてlow_carb適合候補は0件になる
      // （残る7件はいずれもlow_carb非適合）。この場合restrictionフィルタのみが緩和され、
      // 残る7件（いずれもNG食材フィルタは通過済み）から選定されるべきである。
      const lowCarbBreakfastDishNames = BREAKFAST_RECIPES.filter((entry) =>
        entry.restrictionSuitability.includes("low_carb")
      ).map((entry) => entry.dishName);
      const ngIngredients = ["卵", "鶏肉"];
      const survivingAfterNgFilter = BREAKFAST_RECIPES.filter(
        (entry) => !entry.tags.some((tag) => ngIngredients.includes(tag))
      );
      // 前提の検証: low_carb適合候補が本当に0件になり、かつNG食材フィルタ後に候補が残ること。
      expect(
        survivingAfterNgFilter.filter((entry) => entry.restrictionSuitability.includes("low_carb"))
      ).toHaveLength(0);
      expect(survivingAfterNgFilter.length).toBeGreaterThan(0);

      const profile = buildProfile({ restrictionType: "low_carb", ngIngredients });
      const selected = await collectDishNamesAcrossRandomRange(
        (random) => createRuleBasedMenuGenerator({ foodCompositionRepository, random }),
        profile,
        buildTarget(),
        [],
        [],
        "breakfast",
        40
      );

      expect(selected.size).toBeGreaterThan(0);
      for (const dishName of selected) {
        // NG食材フィルタ（必須）は維持されている: low_carb適合候補（すべて卵or鶏肉を含む）は
        // 選ばれない。
        expect(lowCarbBreakfastDishNames).not.toContain(dishName);
        // 選ばれた候補はNG食材フィルタ後に残った7件のいずれかである
        // （restrictionフィルタが緩和され、フィルタなしの状態と同じ候補群から選ばれている）。
        expect(survivingAfterNgFilter.map((entry) => entry.dishName)).toContain(dishName);
      }
    });
  });

  describe("generateWeekのdayIndex→targetの対応（日付昇順マッピングの回帰テスト）", () => {
    /**
     * 目的: `buildDayIndexToTargetMap`が「`targets`のキーを日付昇順に並べ、その並び順の位置を
     * そのまま`dayIndex`とする」という実装であることを、実際に7日分すべてに明確に異なる
     * `calorieTarget`を与えて検証する。
     *
     * 上の「WeeklyGenerationToolResult…の型契約」テストは`dayIndex`の**集合**が
     * `{0,...,6}`であることしか見ておらず、各`dayIndex`が正しい日付の`target`と対応している
     * かどうかまでは検証しない。かつ`buildTargetsRecord`（本ファイル共通フィクスチャ）は
     * 7日全てに同一の`calorieTarget`を使うため、日付↔dayIndexの対応が入れ替わっても
     * 分量スケーリング結果が変化せず、レビューが指摘した通り`.sort()`を`.sort().reverse()`に
     * 変えるmutationを検知できない。本テストは7日それぞれに異なる`calorieTarget`
     * （1400〜2000kcal、日付昇順に対応）を設定し、各`dayIndex`の実際の分量スケーリング結果
     * （4食枠合計kcal）が、日付昇順で対応する「正しい」`calorieTarget`を反映していることを
     * 検証する。
     *
     * mealType別の候補を1件（他の47件を`dislikedSummary`で除外）に固定することで、週内の
     * バラエティ回避（既に選んだdishNameを避ける仕組み）が日によって異なる料理を選んでしまう
     * 影響を排除し、「同じ料理が7日間ずっと選ばれ続け、分量だけがcalorieTargetに応じて変化する」
     * という単純な状況を作る（NG食材タグと異なり`dishName`は全エントリで一意なため、この
     * 除外方法はmealType間の意図しない巻き添えを起こさない）。
     */

    const PINNED_DISH_NAMES: Record<MealType, string> = {
      breakfast: "目玉焼きトースト",
      lunch: "鶏むね肉の照り焼き定食",
      dinner: "鮭の塩焼き定食",
      snack: "ヨーグルト",
    };

    function findPinnedRecipe(mealType: MealType) {
      const dishName = PINNED_DISH_NAMES[mealType];
      const entry = RULE_BASED_RECIPES.find(
        (candidate) => candidate.mealType === mealType && candidate.dishName === dishName
      );
      if (!entry) {
        throw new Error(`test fixture error: ${mealType}/${dishName} not found in RULE_BASED_RECIPES`);
      }
      return entry;
    }

    const pinnedDishNameValues = Object.values(PINNED_DISH_NAMES);
    // 上記4件以外の全44件を苦手料理として除外し、mealTypeごとに候補を1件に固定する。
    const dislikedSummary: DislikedItemSummary[] = RULE_BASED_RECIPES.filter(
      (entry) => !pinnedDishNameValues.includes(entry.dishName)
    ).map((entry) => ({ dishName: entry.dishName, foodIds: [] }));

    // per100gのenergyKcalを一律225とする。固定した4件の料理（素の合計quantity: 目玉焼きトースト
    // 115g・鶏むね肉の照り焼き定食363g・鮭の塩焼き定食301g・ヨーグルト108g）と、下記の
    // calorieTarget範囲（1400〜2000kcal）の組み合わせでは、rule-based-menu.generator.tsの
    // MEAL_CALORIE_RATIOS（朝食25%/昼食30%/夕食35%/間食10%、下記でテスト内に複製）との
    // 掛け合わせで、4食枠すべてでスケール係数が[0.5, 2.0]のクランプ範囲内に収まる
    // （このit内の冒頭で実際に計算し直して裏付ける）。これにより「4食枠合計kcal ==
    // その日のcalorieTarget（丸め誤差数kcal程度を除く）」という単純な関係が成立する
    // （4つの比率の合計は1.0であり、いずれもクランプされない限り、配分kcalの合計は
    // 個々の比率の値によらず必ずcalorieTargetそのものになるため）。
    const KCAL_PER_100G = 225;
    const foodCompositionRepository = createFakeFoodCompositionRepository({
      defaultKcalPer100g: KCAL_PER_100G,
    });

    // rule-based-menu.generator.ts本体のMEAL_CALORIE_RATIOS（非export）を、クランプ回避の
    // 事前チェック計算のためだけにこのテストファイル内で複製する（本体の値と一致していることが
    // 前提。値が乖離した場合は下記の事前チェック自体がテスト内で失敗し、乖離に気付ける）。
    const MEAL_CALORIE_RATIOS_MIRROR: Record<MealType, number> = {
      breakfast: 0.25,
      lunch: 0.3,
      dinner: 0.35,
      snack: 0.1,
    };

    // 7日分、日付昇順（WEEK_DATES）に対応させて明確に異なるcalorieTargetを設定する。
    const CALORIE_TARGETS_ASCENDING = [1400, 1500, 1600, 1700, 1800, 1900, 2000];

    function buildDistinctTargetsRecord(): Record<IsoDate, NutritionTargetSnapshot> {
      const record: Record<IsoDate, NutritionTargetSnapshot> = {};
      WEEK_DATES.forEach((date, index) => {
        record[date] = buildTarget({ calorieTarget: CALORIE_TARGETS_ASCENDING[index] as number });
      });
      return record;
    }

    function totalKcalForDay(meals: { ingredients: { quantity: number }[] }[]): number {
      return meals.reduce((sum, meal) => {
        const mealQuantitySum = meal.ingredients.reduce((s, ingredient) => s + ingredient.quantity, 0);
        return sum + (mealQuantitySum / 100) * KCAL_PER_100G;
      }, 0);
    }

    it("各dayIndexの4食枠合計kcalが、日付昇順で対応する正しいcalorieTargetを反映する（dayIndex 0は最も早い日付=1400kcal、dayIndex 6は最も遅い日付=2000kcalとして明確に区別できる）", async () => {
      // 事前チェック: 固定した4件の料理それぞれについて、想定するスケール係数が
      // 実際に[0.5, 2.0]の範囲内（クランプなし）に収まることを、計算目標カロリー全件で確認する
      // （このチェック自体が失敗する場合、以降の本題の検証が成立しないため先に潰しておく）。
      for (const mealType of MealTypeSchema.options) {
        const entry = findPinnedRecipe(mealType);
        const rawTotalQuantity = entry.ingredients.reduce((sum, i) => sum + i.quantity, 0);
        const rawKcal = (rawTotalQuantity / 100) * KCAL_PER_100G;
        const ratio = MEAL_CALORIE_RATIOS_MIRROR[mealType];
        for (const calorieTarget of CALORIE_TARGETS_ASCENDING) {
          const scaleFactor = (calorieTarget * ratio) / rawKcal;
          expect(scaleFactor).toBeGreaterThan(0.5);
          expect(scaleFactor).toBeLessThan(2.0);
        }
      }

      const generator = createRuleBasedMenuGenerator({
        foodCompositionRepository,
        random: createSeededRandom(123),
      });
      const result = await generator.generateWeek(
        buildProfile(),
        buildDistinctTargetsRecord(),
        dislikedSummary
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      for (const day of result.value.days) {
        // 固定した4件の料理が実際に選ばれていること（バラエティ回避の影響を受けていないこと）
        // の確認。
        for (const mealType of MealTypeSchema.options) {
          const meal = day.meals.find((m) => m.mealType === mealType);
          expect(meal?.dishName).toBe(PINNED_DISH_NAMES[mealType]);
        }

        // dayIndexに対応する「正しい」calorieTarget = 日付昇順（WEEK_DATES）のdayIndex番目の値。
        const expectedCalorieTarget = CALORIE_TARGETS_ASCENDING[day.dayIndex];
        expect(expectedCalorieTarget).toBeDefined();
        const totalKcal = totalKcalForDay(day.meals);
        expect(Math.abs(totalKcal - (expectedCalorieTarget as number))).toBeLessThan(3);
      }

      // dayIndex 0とdayIndex 6を明確に区別できることの直接的な確認（両者の合計kcalが明確に
      // 異なり、それぞれ最小・最大のcalorieTargetに対応すること）。`.sort()`を
      // `.sort().reverse()`に変えるmutationが混入した場合、dayIndex 0は本来最も早い日付
      // （1400kcal）ではなく最も遅い日付（2000kcal）のtargetを使ってしまい、この2つの
      // assertionが失敗する。
      const day0 = result.value.days.find((d) => d.dayIndex === 0);
      const day6 = result.value.days.find((d) => d.dayIndex === 6);
      expect(day0).toBeDefined();
      expect(day6).toBeDefined();
      if (!day0 || !day6) return;

      const day0Kcal = totalKcalForDay(day0.meals);
      const day6Kcal = totalKcalForDay(day6.meals);
      expect(day0Kcal).toBeLessThan(day6Kcal);
      expect(Math.abs(day0Kcal - 1400)).toBeLessThan(3);
      expect(Math.abs(day6Kcal - 2000)).toBeLessThan(3);
    });
  });

  describe("候補が完全に尽きた場合のエラー", () => {
    it("mealType一致かつNG食材フィルタを満たす候補が1件も存在しない場合、schema_validation_failedエラーを、対象dayIndex/mealTypeが分かるメッセージ付きで返す", async () => {
      const foodCompositionRepository = createFakeFoodCompositionRepository();
      // 朝食12件が使う全タグをngIngredientsに指定することで、朝食の必須フィルタ
      // （mealType一致＋NG食材非重複）を満たす候補を意図的に0件にする。
      const profile = buildProfile({ ngIngredients: ALL_BREAKFAST_TAGS });
      const generator = createRuleBasedMenuGenerator({
        foodCompositionRepository,
        random: createSeededRandom(1),
      });

      const weekResult = await generator.generateWeek(profile, buildTargetsRecord(), []);
      expect(weekResult.ok).toBe(false);
      if (weekResult.ok) return;
      expect(weekResult.error.type).toBe("schema_validation_failed");
      expect(weekResult.error.message).toContain("dayIndex 0");
      expect(weekResult.error.message).toContain("breakfast");

      const dayResult = await generator.generateDay(profile, buildTarget(), [], []);
      expect(dayResult.ok).toBe(false);
      if (dayResult.ok) return;
      expect(dayResult.error.type).toBe("schema_validation_failed");
      expect(dayResult.error.message).toContain("breakfast");
    });
  });

  describe("generateDayのotherDaysによるバラエティ回避", () => {
    it("otherDaysの同じmealTypeで既に使われていない唯一の候補が残る場合、常にその候補が選ばれる", async () => {
      const foodCompositionRepository = createFakeFoodCompositionRepository();
      const [remainingDishName, ...alreadyUsedDishNames] = ALL_BREAKFAST_DISH_NAMES;
      expect(remainingDishName).toBeDefined();
      expect(alreadyUsedDishNames.length).toBe(ALL_BREAKFAST_DISH_NAMES.length - 1);

      const otherDays: OtherDayContext[] = [
        {
          dayIndex: 1,
          meals: alreadyUsedDishNames.map((dishName) => ({
            mealType: "breakfast" as const,
            dishName,
            foodIds: [],
          })),
        },
      ];

      const selected = await collectDishNamesAcrossRandomRange(
        (random) => createRuleBasedMenuGenerator({ foodCompositionRepository, random }),
        buildProfile(),
        buildTarget(),
        otherDays,
        [],
        "breakfast",
        40
      );

      expect(selected.size).toBe(1);
      expect(selected.has(remainingDishName as string)).toBe(true);
    });

    it("otherDaysが朝食候補を全件使い切っている場合、バラエティ制約が緩和され選定が成功する", async () => {
      const foodCompositionRepository = createFakeFoodCompositionRepository();
      const otherDays: OtherDayContext[] = [
        {
          dayIndex: 1,
          meals: ALL_BREAKFAST_DISH_NAMES.map((dishName) => ({
            mealType: "breakfast" as const,
            dishName,
            foodIds: [],
          })),
        },
      ];

      const generator = createRuleBasedMenuGenerator({
        foodCompositionRepository,
        random: createSeededRandom(5),
      });
      const result = await generator.generateDay(buildProfile(), buildTarget(), otherDays, []);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const breakfastMeal = result.value.meals.find((meal) => meal.mealType === "breakfast");
      expect(breakfastMeal).toBeDefined();
      expect(ALL_BREAKFAST_DISH_NAMES).toContain(breakfastMeal?.dishName);
    });
  });

  describe("カロリースケーリング", () => {
    // per100gのenergyKcalを一律100とすることで、素の合計kcal = quantity(g)の合計と数値的に
    // 一致させ、期待値の手計算を単純にする（(quantity/100) * 100 = quantity）。
    const foodCompositionRepository = createFakeFoodCompositionRepository({ defaultKcalPer100g: 100 });
    // random=()=>0 は各mealTypeの候補配列の先頭（index 0）を常に選ぶ。NG食材・食事制限・
    // 苦手料理いずれも指定しない場合、朝食候補の先頭はRULE_BASED_RECIPES内の最初の朝食エントリ
    // 「目玉焼きトースト」（食パン60g・卵50g・バター5g、素の合計kcal=115）である。
    const TARGET_DISH = findBreakfastRecipe("目玉焼きトースト");
    const RAW_TOTAL_KCAL = TARGET_DISH.ingredients.reduce((sum, i) => sum + i.quantity, 0); // 115

    async function generateBreakfastIngredients(calorieTarget: number) {
      const generator = createRuleBasedMenuGenerator({
        foodCompositionRepository,
        random: () => 0,
      });
      const result = await generator.generateDay(
        buildProfile(),
        buildTarget({ calorieTarget }),
        [],
        []
      );
      if (!result.ok) {
        throw new Error(`unexpected failure: ${result.error.message}`);
      }
      const breakfastMeal = result.value.meals.find((meal) => meal.mealType === "breakfast");
      if (!breakfastMeal) {
        throw new Error("breakfast meal not found");
      }
      expect(breakfastMeal.dishName).toBe("目玉焼きトースト");
      return breakfastMeal.ingredients;
    }

    it("目標カロリーに応じて分量が実際にスケールする（クランプ範囲内の通常ケース、スケール係数1.5）", async () => {
      // 朝食への配分比率25%。配分kcal = RAW_TOTAL_KCAL(115) * 1.5 = 172.5 となるcalorieTargetを
      // 逆算する: calorieTarget = 172.5 / 0.25 = 690。
      const calorieTarget = (RAW_TOTAL_KCAL * 1.5) / 0.25;
      const ingredients = await generateBreakfastIngredients(calorieTarget);

      expect(ingredients).toEqual([
        { foodId: "01026", quantity: 90, unit: "g" },
        { foodId: "12004", quantity: 75, unit: "g" },
        { foodId: "14017", quantity: 7.5, unit: "g" },
      ]);
    });

    it("極端に高い目標カロリーでもスケール係数が2.0にクランプされ、異常な分量にならない", async () => {
      const calorieTarget = 10_000_000; // 配分kcalが素の合計kcalの何万倍にもなる極端な値
      const ingredients = await generateBreakfastIngredients(calorieTarget);

      // クランプ上限2.0倍: 60→120, 50→100, 5→10
      expect(ingredients).toEqual([
        { foodId: "01026", quantity: 120, unit: "g" },
        { foodId: "12004", quantity: 100, unit: "g" },
        { foodId: "14017", quantity: 10, unit: "g" },
      ]);
    });

    it("極端に低い目標カロリーでもスケール係数が0.5にクランプされ、異常な分量（ほぼ0）にならない", async () => {
      const calorieTarget = 1; // 配分kcal=0.25、素の合計kcal(115)よりはるかに小さい極端な値
      const ingredients = await generateBreakfastIngredients(calorieTarget);

      // クランプ下限0.5倍: 60→30, 50→25, 5→2.5
      expect(ingredients).toEqual([
        { foodId: "01026", quantity: 30, unit: "g" },
        { foodId: "12004", quantity: 25, unit: "g" },
        { foodId: "14017", quantity: 2.5, unit: "g" },
      ]);
    });
  });

  describe("generateRecipe（task 17.4の範囲外、プレースホルダ）", () => {
    it("呼び出すと例外を投げる", async () => {
      const foodCompositionRepository = createFakeFoodCompositionRepository();
      const generator = createRuleBasedMenuGenerator({ foodCompositionRepository });

      await expect(
        generator.generateRecipe(
          {
            id: 1,
            mealType: "breakfast",
            dishName: "テスト料理",
            ingredients: [],
            nutrition: {
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
            },
          },
          buildProfile()
        )
      ).rejects.toThrow();
    });
  });
});
