import { describe, expect, it, vi } from "vitest";
import type {
  DayMenu,
  IngredientSelection,
  MealSlot,
  MealType,
  VerifiedNutritionValues,
  WeekMenuPlan,
} from "@nutrition/shared";
import type {
  FoodCompositionRepository,
  FoodItemNutrition,
} from "./food-composition.repository.js";
import type { MenuPlanRepository, OtherDayContext } from "./menu-plan.repository.js";
import type { UnitConversionService } from "./unit-conversion.service.js";
import { createShoppingListService } from "./shopping-list.service.js";

/**
 * `ShoppingListService`（task 13.1）のテスト。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #買い物リスト生成フロー、
 * Requirements 14.1-14.7）に定義された挙動を、`MenuPlanRepository` /
 * `FoodCompositionRepository` / `UnitConversionService`（いずれも実装済み・テスト済み）を
 * 実DB越しに使わず、挙動を固定したフェイクに差し替えて検証する。
 * `recipe-detail.service.test.ts` / `nutrition-verification.service.test.ts` の
 * 「フェイク依存＋設定可能な振る舞い、未使用メソッドは呼ばれたら例外を投げる」スタイルに倣う。
 *
 * design.mdのシーケンス図は `MenuPlanRepository.getActivePlan` が「正規化済みのグラム量」を
 * 含む `WeekMenuPlan` を返すかのように読めるが、実際の `MealSlot.ingredients`
 * （`IngredientSelection[]`, `@nutrition/shared`）は `{foodId, quantity, unit}` という
 * 正規化前の選択内容のみを持つ（`quantity_g` はどこにも存在しない）。したがって
 * `ShoppingListService` 自身が28食枠すべての食材について `UnitConversionService.toGrams` を
 * 呼び、foodId単位でグラム量を合算する（task 13.1のタスク文自身の記述、および本タスクが
 * task 3.2 に依存する理由）。
 */

const WEEK_START = "2026-09-07";
const MEAL_TYPES: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack"];

const ZERO_NUTRITION: VerifiedNutritionValues = {
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

// --- フィクスチャ構築ヘルパー ---
// `ShoppingListService`は`nutrition`/`dishName`/`dayDate`等を一切参照しないため、
// これらは決定論的な埋め草値で埋める（このテストファイル内で完結する）。

function buildMealSlot(
  mealType: MealType,
  dishName: string,
  ingredients: IngredientSelection[]
): MealSlot {
  return { mealType, dishName, ingredients, nutrition: ZERO_NUTRITION };
}

function buildDayMenu(dayIndex: number, meals: MealSlot[]): DayMenu {
  return {
    dayDate: `2026-09-${String(7 + dayIndex).padStart(2, "0")}`,
    dayIndex,
    meals,
    dayNutrition: ZERO_NUTRITION,
    plannedKcal: 0,
    targetKcal: null,
    varianceKcal: null,
  };
}

function buildWeekMenuPlan(days: DayMenu[]): WeekMenuPlan {
  return { weekStartDate: WEEK_START, generatedAt: "2026-09-01T00:00:00.000Z", days };
}

function buildFoodItem(overrides: Partial<FoodItemNutrition> = {}): FoodItemNutrition {
  return {
    foodId: "FOOD-X",
    name: "★テスト食品★",
    category: "野菜類",
    per100g: {
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
    sourceCitation: "日本食品標準成分表（八訂）増補2023年から引用",
    displayUnitCode: null,
    ...overrides,
  };
}

// --- フェイク依存（未使用メソッドは呼ばれたら例外を投げる） ---

function createFakeMenuPlanRepository(
  overrides: { getActivePlan?: MenuPlanRepository["getActivePlan"] } = {}
): MenuPlanRepository {
  return {
    getActivePlan:
      overrides.getActivePlan ??
      (() => {
        throw new Error(
          "createFakeMenuPlanRepository: getActivePlan was not expected to be called in this test"
        );
      }),
    findOtherDays: (): OtherDayContext[] => {
      throw new Error("createFakeMenuPlanRepository: findOtherDays is not used by ShoppingListService");
    },
    findMealSlot: () => {
      throw new Error("createFakeMenuPlanRepository: findMealSlot is not used by ShoppingListService");
    },
    replaceWeek: () => {
      throw new Error("createFakeMenuPlanRepository: replaceWeek is not used by ShoppingListService");
    },
    replaceDay: () => {
      throw new Error("createFakeMenuPlanRepository: replaceDay is not used by ShoppingListService");
    },
  };
}

function createFakeFoodCompositionRepository(
  overrides: {
    findById?: FoodCompositionRepository["findById"];
    findUnitConversion?: FoodCompositionRepository["findUnitConversion"];
  } = {}
): FoodCompositionRepository {
  return {
    findById:
      overrides.findById ??
      (() => {
        throw new Error(
          "createFakeFoodCompositionRepository: findById was not expected to be called in this test"
        );
      }),
    listAllIds: () => {
      throw new Error("createFakeFoodCompositionRepository: listAllIds is not used by ShoppingListService");
    },
    findUnitConversion:
      overrides.findUnitConversion ??
      (() => {
        throw new Error(
          "createFakeFoodCompositionRepository: findUnitConversion was not expected to be called in this test " +
            "(pass findUnitConversion to createFakeFoodCompositionRepository if needed)"
        );
      }),
    findGenericUnitConversion: () => {
      throw new Error(
        "createFakeFoodCompositionRepository: findGenericUnitConversion is not used by ShoppingListService " +
          "(display_unit_code is always a food-specific, count-based unit per task 2.2's own finding — " +
          "no generic fallback lookup is ever performed for it)"
      );
    },
  };
}

function createFakeUnitConversionService(
  toGrams?: UnitConversionService["toGrams"]
): UnitConversionService {
  return {
    toGrams:
      toGrams ??
      (() => {
        throw new Error(
          "createFakeUnitConversionService: toGrams was not expected to be called in this test"
        );
      }),
  };
}

describe("createShoppingListService", () => {
  describe("buildForWeek — 対象週の有効なプランが存在しない場合（Req 14.6）", () => {
    it("getActivePlanがnullを返す場合、nullを返し、FoodCompositionRepository/UnitConversionServiceは一切呼ばれない", () => {
      const menuPlanRepository = createFakeMenuPlanRepository({ getActivePlan: () => null });
      const foodCompositionRepository = createFakeFoodCompositionRepository();
      const unitConversionService = createFakeUnitConversionService();
      const service = createShoppingListService(
        menuPlanRepository,
        foodCompositionRepository,
        unitConversionService
      );

      const result = service.buildForWeek(WEEK_START);

      expect(result).toBeNull();
    });
  });

  describe("buildForWeek — 同一食品IDが複数の料理・日にまたがって使用される場合の合算（Req 14.1, 14.2）", () => {
    it("g直接指定・食材固有単位「個」・汎用単位「大さじ」の3経路にまたがる同一foodIdを、正規化済みグラム量で正しく合算する", () => {
      // MULTI-001: 朝食(day0, 100g) + 昼食(day2, 2個 → 100g) + 夕食(day5, 3大さじ → 45g)
      //   合計 = 100 + 100 + 45 = 245g
      const plan = buildWeekMenuPlan([
        buildDayMenu(0, [
          buildMealSlot("breakfast", "★料理A★", [
            { foodId: "MULTI-001", quantity: 100, unit: "g" },
          ]),
        ]),
        buildDayMenu(2, [
          buildMealSlot("lunch", "★料理B★", [{ foodId: "MULTI-001", quantity: 2, unit: "個" }]),
        ]),
        buildDayMenu(5, [
          buildMealSlot("dinner", "★料理C★", [
            { foodId: "MULTI-001", quantity: 3, unit: "大さじ" },
          ]),
        ]),
      ]);
      const menuPlanRepository = createFakeMenuPlanRepository({ getActivePlan: () => plan });

      const toGrams = vi.fn((foodId: string, quantity: number, unit: string) => {
        if (foodId === "MULTI-001" && unit === "g") return { ok: true as const, value: quantity };
        if (foodId === "MULTI-001" && unit === "個")
          return { ok: true as const, value: quantity * 50 };
        if (foodId === "MULTI-001" && unit === "大さじ")
          return { ok: true as const, value: quantity * 15 };
        throw new Error(`unexpected toGrams call: ${foodId}, ${quantity}, ${unit}`);
      });
      const unitConversionService = createFakeUnitConversionService(toGrams);

      const foodItem = buildFoodItem({
        foodId: "MULTI-001",
        name: "★複数料理合算検証用食品★",
        category: "野菜類",
        displayUnitCode: null,
      });
      const foodCompositionRepository = createFakeFoodCompositionRepository({
        findById: (foodId) => (foodId === "MULTI-001" ? foodItem : null),
      });

      const service = createShoppingListService(
        menuPlanRepository,
        foodCompositionRepository,
        unitConversionService
      );

      const result = service.buildForWeek(WEEK_START);

      expect(result).not.toBeNull();
      expect(result?.items).toHaveLength(1);
      const item = result?.items[0];
      expect(item?.foodId).toBe("MULTI-001");
      expect(item?.name).toBe("★複数料理合算検証用食品★");
      expect(item?.quantityGrams).toBe(245);
      // displayUnitCodeがnullのため、displayQuantityはquantityGramsのまま。
      expect(item?.displayQuantity).toBe(245);
      expect(item?.displayUnit).toBe("g");
      expect(toGrams).toHaveBeenCalledTimes(3);
      expect(toGrams).toHaveBeenCalledWith("MULTI-001", 100, "g");
      expect(toGrams).toHaveBeenCalledWith("MULTI-001", 2, "個");
      expect(toGrams).toHaveBeenCalledWith("MULTI-001", 3, "大さじ");
    });
  });

  describe("buildForWeek — 分類先が定義されていない食品カテゴリ（Req 14.5）", () => {
    it('category-display-groups.data.tsに存在しないカテゴリ文字列を持つ食品は「調味料・その他」に分類される', () => {
      const plan = buildWeekMenuPlan([
        buildDayMenu(0, [
          buildMealSlot("breakfast", "★料理D★", [
            { foodId: "UNKNOWN-CAT-001", quantity: 100, unit: "g" },
          ]),
        ]),
      ]);
      const menuPlanRepository = createFakeMenuPlanRepository({ getActivePlan: () => plan });
      const unitConversionService = createFakeUnitConversionService(
        (_foodId, quantity, _unit) => ({ ok: true as const, value: quantity })
      );
      const foodItem = buildFoodItem({
        foodId: "UNKNOWN-CAT-001",
        category: "★未定義カテゴリ★",
        displayUnitCode: null,
      });
      const foodCompositionRepository = createFakeFoodCompositionRepository({
        findById: (foodId) => (foodId === "UNKNOWN-CAT-001" ? foodItem : null),
      });

      const service = createShoppingListService(
        menuPlanRepository,
        foodCompositionRepository,
        unitConversionService
      );

      const result = service.buildForWeek(WEEK_START);

      expect(result?.items).toHaveLength(1);
      expect(result?.items[0]?.category).toBe("調味料・その他");
    });
  });

  describe("buildForWeek — 既知（マッピング済み）カテゴリの分類（Req 14.4）", () => {
    it('category-display-groups.data.tsに実在するカテゴリ「肉類」を持つ食品は「肉・魚」に分類される', () => {
      // Req 14.5のテスト（未定義カテゴリ→フォールバック「調味料・その他」）だけでは、
      // `resolveDisplayGroup`の戻り値が実際に`item.category`へ正しく配線されていることを
      // 証明できない（フォールバック定数と実装をハードコードした定数が区別できないため）。
      // このテストは実在するマッピング済みカテゴリ「肉類」を用い、フォールバック値とは
      // 異なる「肉・魚」が返ることを検証することで、その配線を独立に証明する。
      const plan = buildWeekMenuPlan([
        buildDayMenu(0, [
          buildMealSlot("breakfast", "★料理I★", [
            { foodId: "KNOWN-CAT-001", quantity: 100, unit: "g" },
          ]),
        ]),
      ]);
      const menuPlanRepository = createFakeMenuPlanRepository({ getActivePlan: () => plan });
      const unitConversionService = createFakeUnitConversionService(
        (_foodId, quantity, _unit) => ({ ok: true as const, value: quantity })
      );
      const foodItem = buildFoodItem({
        foodId: "KNOWN-CAT-001",
        category: "肉類",
        displayUnitCode: null,
      });
      const foodCompositionRepository = createFakeFoodCompositionRepository({
        findById: (foodId) => (foodId === "KNOWN-CAT-001" ? foodItem : null),
      });

      const service = createShoppingListService(
        menuPlanRepository,
        foodCompositionRepository,
        unitConversionService
      );

      const result = service.buildForWeek(WEEK_START);

      expect(result?.items).toHaveLength(1);
      expect(result?.items[0]?.category).toBe("肉・魚");
    });
  });

  describe("buildForWeek — displayUnitCodeの有無による表示用数量の分岐（Req 14.7）", () => {
    it("displayUnitCodeが設定済みの場合、grams_per_unitで除算し0.5刻みで丸めた非自明な値をdisplayQuantityとする", () => {
      // totalGrams=182, gramsPerUnit=50 → 182/50=3.64 → 0.5刻み丸め: 3.64/0.5=7.28 → round=7 → 3.5
      const plan = buildWeekMenuPlan([
        buildDayMenu(0, [
          buildMealSlot("breakfast", "★料理E★", [
            { foodId: "DISPLAY-UNIT-A", quantity: 182, unit: "g" },
          ]),
        ]),
      ]);
      const menuPlanRepository = createFakeMenuPlanRepository({ getActivePlan: () => plan });
      const unitConversionService = createFakeUnitConversionService(
        (_foodId, quantity, _unit) => ({ ok: true as const, value: quantity })
      );
      const foodItem = buildFoodItem({
        foodId: "DISPLAY-UNIT-A",
        displayUnitCode: "個",
      });
      const findUnitConversion = vi.fn((foodId: string, unitCode: string) => {
        expect(foodId).toBe("DISPLAY-UNIT-A");
        expect(unitCode).toBe("個");
        return { foodId, unitCode, gramsPerUnit: 50 };
      });
      const foodCompositionRepository = createFakeFoodCompositionRepository({
        findById: (foodId) => (foodId === "DISPLAY-UNIT-A" ? foodItem : null),
        findUnitConversion,
      });

      const service = createShoppingListService(
        menuPlanRepository,
        foodCompositionRepository,
        unitConversionService
      );

      const result = service.buildForWeek(WEEK_START);

      expect(result?.items).toHaveLength(1);
      const item = result?.items[0];
      expect(item?.quantityGrams).toBe(182);
      expect(item?.displayQuantity).toBe(3.5);
      expect(item?.displayUnit).toBe("個");
      expect(findUnitConversion).toHaveBeenCalledWith("DISPLAY-UNIT-A", "個");
    });

    it("displayUnitCodeが設定済みでも、0.5刻み丸めの結果が0になる場合は最小表示単位0.5を下限にする（Req 14.7の0.5フロア）", () => {
      // totalGrams=5, gramsPerUnit=100 → 5/100=0.05 → 0.5刻み丸め: 0.05/0.5=0.1 → round=0 → 0 → フロアで0.5
      const plan = buildWeekMenuPlan([
        buildDayMenu(0, [
          buildMealSlot("breakfast", "★料理F★", [
            { foodId: "DISPLAY-UNIT-B", quantity: 5, unit: "g" },
          ]),
        ]),
      ]);
      const menuPlanRepository = createFakeMenuPlanRepository({ getActivePlan: () => plan });
      const unitConversionService = createFakeUnitConversionService(
        (_foodId, quantity, _unit) => ({ ok: true as const, value: quantity })
      );
      const foodItem = buildFoodItem({
        foodId: "DISPLAY-UNIT-B",
        displayUnitCode: "丁",
      });
      const foodCompositionRepository = createFakeFoodCompositionRepository({
        findById: (foodId) => (foodId === "DISPLAY-UNIT-B" ? foodItem : null),
        findUnitConversion: (foodId, unitCode) => ({ foodId, unitCode, gramsPerUnit: 100 }),
      });

      const service = createShoppingListService(
        menuPlanRepository,
        foodCompositionRepository,
        unitConversionService
      );

      const result = service.buildForWeek(WEEK_START);

      expect(result?.items).toHaveLength(1);
      const item = result?.items[0];
      expect(item?.quantityGrams).toBe(5);
      // 丸めた結果が0にならず、0.5が下限として使われることの証明。
      expect(item?.displayQuantity).toBe(0.5);
      expect(item?.displayUnit).toBe("丁");
    });

    it("displayUnitCodeがnullの場合、findUnitConversionは一切呼ばれず、displayQuantityはquantityGramsそのまま・displayUnitは'g'になる", () => {
      const plan = buildWeekMenuPlan([
        buildDayMenu(0, [
          buildMealSlot("breakfast", "★料理G★", [
            { foodId: "DISPLAY-UNIT-NONE", quantity: 123.4, unit: "g" },
          ]),
        ]),
      ]);
      const menuPlanRepository = createFakeMenuPlanRepository({ getActivePlan: () => plan });
      const unitConversionService = createFakeUnitConversionService(
        (_foodId, quantity, _unit) => ({ ok: true as const, value: quantity })
      );
      const foodItem = buildFoodItem({
        foodId: "DISPLAY-UNIT-NONE",
        displayUnitCode: null,
      });
      const foodCompositionRepository = createFakeFoodCompositionRepository({
        findById: (foodId) => (foodId === "DISPLAY-UNIT-NONE" ? foodItem : null),
        // findUnitConversionは意図的にoverrideしない → 呼ばれたら例外を投げるフェイクのまま。
      });

      const service = createShoppingListService(
        menuPlanRepository,
        foodCompositionRepository,
        unitConversionService
      );

      const result = service.buildForWeek(WEEK_START);

      expect(result?.items).toHaveLength(1);
      const item = result?.items[0];
      expect(item?.quantityGrams).toBe(123.4);
      expect(item?.displayQuantity).toBe(123.4);
      expect(item?.displayUnit).toBe("g");
    });
  });

  describe("buildForWeek — toGrams失敗は不変条件違反として例外にする（design.mdのMenuPlanRepository/RecipeDetailRepositoryと同じprecedent）", () => {
    it("UnitConversionService.toGramsがResultの失敗を返す場合、buildForWeekはResultの失敗やnullではなく例外を投げる", () => {
      const plan = buildWeekMenuPlan([
        buildDayMenu(0, [
          buildMealSlot("breakfast", "★料理H★", [
            { foodId: "BROKEN-001", quantity: 2, unit: "カップ" },
          ]),
        ]),
      ]);
      const menuPlanRepository = createFakeMenuPlanRepository({ getActivePlan: () => plan });
      const unitConversionService = createFakeUnitConversionService(() => ({
        ok: false as const,
        error: {
          type: "unit_not_found" as const,
          message: 'unit_not_found: "カップ"',
          foodId: "BROKEN-001",
          unit: "カップ",
        },
      }));
      // findById/findUnitConversionはtoGrams失敗より後には一切到達しないはずなので、
      // 呼ばれたら例外を投げるフェイクのままにしておく（呼ばれないことの検証を兼ねる）。
      const foodCompositionRepository = createFakeFoodCompositionRepository();

      const service = createShoppingListService(
        menuPlanRepository,
        foodCompositionRepository,
        unitConversionService
      );

      expect(() => service.buildForWeek(WEEK_START)).toThrow();
    });
  });

  describe("buildForWeek — 28食枠（7日×4食種）すべての反復完全性（欠落・二重計上がないこと）", () => {
    it("28食枠それぞれが異なる食品IDを1件ずつ持つ場合、結果のitemsが正確に28件の異なるfoodIdを含む", () => {
      const days: DayMenu[] = [];
      const allFoodIds: string[] = [];
      for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const meals: MealSlot[] = MEAL_TYPES.map((mealType) => {
          const foodId = `SLOT-${dayIndex}-${mealType}`;
          allFoodIds.push(foodId);
          return buildMealSlot(mealType, `★${foodId}の料理★`, [
            { foodId, quantity: 100, unit: "g" },
          ]);
        });
        days.push(buildDayMenu(dayIndex, meals));
      }
      const plan = buildWeekMenuPlan(days);
      expect(allFoodIds).toHaveLength(28);
      expect(new Set(allFoodIds).size).toBe(28); // fixture自身の前提確認

      const menuPlanRepository = createFakeMenuPlanRepository({ getActivePlan: () => plan });
      const unitConversionService = createFakeUnitConversionService(
        (_foodId, quantity, _unit) => ({ ok: true as const, value: quantity })
      );
      const foodCompositionRepository = createFakeFoodCompositionRepository({
        findById: (foodId) =>
          allFoodIds.includes(foodId)
            ? buildFoodItem({ foodId, name: `★${foodId}★`, category: "野菜類", displayUnitCode: null })
            : null,
      });

      const service = createShoppingListService(
        menuPlanRepository,
        foodCompositionRepository,
        unitConversionService
      );

      const result = service.buildForWeek(WEEK_START);

      expect(result?.items).toHaveLength(28);
      const resultFoodIds = result?.items.map((item) => item.foodId) ?? [];
      expect(new Set(resultFoodIds).size).toBe(28);
      expect(resultFoodIds.slice().sort()).toEqual(allFoodIds.slice().sort());
      for (const item of result?.items ?? []) {
        expect(item.quantityGrams).toBe(100);
      }
    });
  });
});
