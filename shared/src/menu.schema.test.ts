import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  DayMenuSchema,
  EatingOutSuggestionResultSchema,
  EatingOutSuggestionSchema,
  FeedbackInputSchema,
  IngredientSelectionSchema,
  MealSlotSchema,
  MealTypeSchema,
  NutritionValuesSchema,
  RecipeDetailSchema,
  ShoppingListCategorySchema,
  ShoppingListItemSchema,
  ShoppingListSchema,
  SupplementarySuggestionSchema,
  VerifiedNutritionValuesSchema,
  WeekMenuPlanSchema,
} from "./menu.schema.js";
import type {
  DayMenu,
  EatingOutSuggestion,
  EatingOutSuggestionResult,
  FeedbackInput,
  IngredientSelection,
  MealSlot,
  NutritionValues,
  RecipeDetail,
  ShoppingList,
  ShoppingListItem,
  SupplementarySuggestion,
  VerifiedNutritionValues,
  WeekMenuPlan,
} from "./menu.schema.js";

function validIngredientSelection(
  overrides: Partial<IngredientSelection> = {},
): IngredientSelection {
  return {
    foodId: "11001",
    quantity: 100,
    unit: "g",
    ...overrides,
  };
}

function validNutritionValues(overrides: Partial<NutritionValues> = {}): NutritionValues {
  return {
    energyKcal: 250,
    proteinG: 12,
    fatG: 8,
    carbG: 30,
    ...overrides,
  };
}

function validVerifiedNutritionValues(
  overrides: Partial<VerifiedNutritionValues> = {},
): VerifiedNutritionValues {
  return {
    energyKcal: 250,
    proteinG: 12,
    fatG: 8,
    carbG: 30,
    fiberG: 3,
    calciumMg: 50,
    ironMg: 1.2,
    vitaminAUg: 80,
    vitaminDUg: 1,
    vitaminB1Mg: 0.2,
    vitaminB2Mg: 0.2,
    vitaminCMg: 15,
    saltEquivalentG: 1.1,
    ...overrides,
  };
}

function validMealSlot(overrides: Partial<MealSlot> = {}): MealSlot {
  return {
    mealType: "breakfast",
    dishName: "鮭の塩焼き定食",
    ingredients: [validIngredientSelection()],
    nutrition: validVerifiedNutritionValues(),
    ...overrides,
  };
}

function validDayMenu(overrides: Partial<DayMenu> = {}): DayMenu {
  return {
    dayDate: "2026-09-07",
    dayIndex: 0,
    meals: [
      validMealSlot({ mealType: "breakfast" }),
      validMealSlot({ mealType: "lunch" }),
      validMealSlot({ mealType: "dinner" }),
      validMealSlot({ mealType: "snack" }),
    ],
    dayNutrition: validVerifiedNutritionValues({
      energyKcal: 1000,
      proteinG: 48,
      fatG: 32,
      carbG: 120,
      fiberG: 12,
      calciumMg: 200,
      ironMg: 4.8,
      vitaminAUg: 320,
      vitaminDUg: 4,
      vitaminB1Mg: 0.8,
      vitaminB2Mg: 0.8,
      vitaminCMg: 60,
      saltEquivalentG: 4.4,
    }),
    plannedKcal: 1000,
    targetKcal: 1050,
    varianceKcal: -50,
    ...overrides,
  };
}

function validWeekMenuPlan(overrides: Partial<WeekMenuPlan> = {}): WeekMenuPlan {
  const days: DayMenu[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(2026, 8, 7 + i); // 2026-09-07 (月) 起点
    const iso = date.toISOString().slice(0, 10);
    days.push(validDayMenu({ dayDate: iso, dayIndex: i }));
  }
  return {
    weekStartDate: "2026-09-07",
    generatedAt: "2026-09-01T00:00:00.000Z",
    days,
    ...overrides,
  };
}

function validSupplementarySuggestion(
  overrides: Partial<SupplementarySuggestion> = {},
): SupplementarySuggestion {
  return {
    dishName: "ほうれん草のおひたし",
    ingredients: [validIngredientSelection({ foodId: "06267", quantity: 80, unit: "g" })],
    nutritionDelta: validNutritionValues({ energyKcal: 20, proteinG: 2, fatG: 0, carbG: 3 }),
    ...overrides,
  };
}

function validRecipeDetail(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
  return {
    mealSlotId: 1,
    servings: 1,
    cookingTimeMinutes: 15,
    steps: ["鮭に軽く塩を振る。", "魚焼きグリルで両面を焼く。"],
    nutrition: validNutritionValues(),
    supplementarySuggestions: [validSupplementarySuggestion()],
    ...overrides,
  };
}

function validShoppingListItem(overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    foodId: "12004",
    name: "鶏卵（全卵・生）",
    category: "乳製品・卵・豆",
    quantityGrams: 300,
    displayQuantity: 6,
    displayUnit: "個",
    ...overrides,
  };
}

function validShoppingList(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    weekStartDate: "2026-09-07",
    items: [validShoppingListItem()],
    ...overrides,
  };
}

function validEatingOutSuggestion(
  overrides: Partial<EatingOutSuggestion> = {},
): EatingOutSuggestion {
  return {
    typicalMenuName: "牛丼（並盛）",
    typicalMenuKcal: 633,
    alternativeMenuName: "銀鮭の塩焼定食",
    alternativeMenuKcal: 499,
    proteinDeltaG: 10.4,
    ...overrides,
  };
}

function validEatingOutSuggestionResult(
  overrides: Partial<EatingOutSuggestionResult> = {},
): EatingOutSuggestionResult {
  return {
    suggestion: validEatingOutSuggestion(),
    ...overrides,
  };
}

describe("MealTypeSchema", () => {
  it.each(["breakfast", "lunch", "dinner", "snack"] as const)(
    "mealType=%sを受理する",
    (mealType) => {
      expect(() => MealTypeSchema.parse(mealType)).not.toThrow();
    },
  );

  it("未定義の食事種別を拒否する", () => {
    expect(() => MealTypeSchema.parse("brunch")).toThrow(ZodError);
  });
});

describe("IngredientSelectionSchema", () => {
  it("有効な食材選択をparseできる (Requirement 4.3)", () => {
    const input = validIngredientSelection();
    expect(IngredientSelectionSchema.parse(input)).toEqual(input);
  });

  it("quantityが0以下なら拒否する (design.md: > 0)", () => {
    expect(() => IngredientSelectionSchema.parse(validIngredientSelection({ quantity: 0 }))).toThrow(
      ZodError,
    );
    expect(() =>
      IngredientSelectionSchema.parse(validIngredientSelection({ quantity: -10 })),
    ).toThrow(ZodError);
  });

  it("foodIdが空文字なら拒否する", () => {
    expect(() => IngredientSelectionSchema.parse(validIngredientSelection({ foodId: "" }))).toThrow(
      ZodError,
    );
  });

  it("unitが欠落していれば拒否する", () => {
    const invalid: Record<string, unknown> = { ...validIngredientSelection() };
    delete invalid.unit;
    expect(() => IngredientSelectionSchema.parse(invalid)).toThrow(ZodError);
  });
});

describe("NutritionValuesSchema", () => {
  it("有効な栄養価をparseできる (Requirement 4.3)", () => {
    const input = validNutritionValues();
    expect(NutritionValuesSchema.parse(input)).toEqual(input);
  });

  it("負のenergyKcalも受理する（SupplementarySuggestion.nutritionDeltaは負の増分を取り得るため値域を制約しない）", () => {
    const input = validNutritionValues({ energyKcal: -50, proteinG: -2, fatG: -1, carbG: -5 });
    expect(() => NutritionValuesSchema.parse(input)).not.toThrow();
  });

  it("必須フィールドが欠落していれば拒否する", () => {
    const invalid = { ...validNutritionValues(), carbG: undefined };
    expect(() => NutritionValuesSchema.parse(invalid)).toThrow(ZodError);
  });

  it("数値以外の型を拒否する", () => {
    const invalid = { ...validNutritionValues(), proteinG: "12" };
    expect(() => NutritionValuesSchema.parse(invalid)).toThrow(ZodError);
  });
});

describe("VerifiedNutritionValuesSchema", () => {
  it("9項目の微量栄養素を含む有効な検証済み栄養価をparseできる (Requirement 4.7)", () => {
    const input = validVerifiedNutritionValues();
    expect(VerifiedNutritionValuesSchema.parse(input)).toEqual(input);
  });

  it("基本4項目のいずれかが負なら拒否する（NutritionValuesとは異なり非負制約を持つ）", () => {
    expect(() =>
      VerifiedNutritionValuesSchema.parse(validVerifiedNutritionValues({ energyKcal: -1 })),
    ).toThrow(ZodError);
  });

  it("微量栄養素のいずれかが負なら拒否する", () => {
    expect(() =>
      VerifiedNutritionValuesSchema.parse(validVerifiedNutritionValues({ vitaminCMg: -0.1 })),
    ).toThrow(ZodError);
    expect(() =>
      VerifiedNutritionValuesSchema.parse(validVerifiedNutritionValues({ saltEquivalentG: -0.1 })),
    ).toThrow(ZodError);
  });

  it("0は受理する（非負境界値）", () => {
    expect(() =>
      VerifiedNutritionValuesSchema.parse(validVerifiedNutritionValues({ fiberG: 0 })),
    ).not.toThrow();
  });

  it("必須フィールドが欠落していれば拒否する", () => {
    const invalid = { ...validVerifiedNutritionValues(), ironMg: undefined };
    expect(() => VerifiedNutritionValuesSchema.parse(invalid)).toThrow(ZodError);
  });
});

describe("MealSlotSchema", () => {
  it("有効な食事枠をparseできる (Requirement 4.3, 4.7)", () => {
    const input = validMealSlot();
    expect(MealSlotSchema.parse(input)).toEqual(input);
  });

  it("dishNameが空文字なら拒否する", () => {
    expect(() => MealSlotSchema.parse(validMealSlot({ dishName: "" }))).toThrow(ZodError);
  });

  it("未定義のmealTypeを拒否する", () => {
    const invalid = { ...validMealSlot(), mealType: "brunch" };
    expect(() => MealSlotSchema.parse(invalid)).toThrow(ZodError);
  });

  it("ingredientsが配列でなければ拒否する", () => {
    const invalid = { ...validMealSlot(), ingredients: "none" };
    expect(() => MealSlotSchema.parse(invalid)).toThrow(ZodError);
  });
});

describe("DayMenuSchema", () => {
  it("有効な1日分の献立をparseできる (Requirement 1.1)", () => {
    const input = validDayMenu();
    expect(DayMenuSchema.parse(input)).toEqual(input);
  });

  it("dayIndexが0-6の範囲外なら拒否する", () => {
    expect(() => DayMenuSchema.parse(validDayMenu({ dayIndex: -1 }))).toThrow(ZodError);
    expect(() => DayMenuSchema.parse(validDayMenu({ dayIndex: 7 }))).toThrow(ZodError);
  });

  it("dayIndexが整数でなければ拒否する", () => {
    expect(() => DayMenuSchema.parse(validDayMenu({ dayIndex: 2.5 }))).toThrow(ZodError);
  });

  it("mealsが4件でなければ拒否する（design.md: 4件固定, Requirement 1.1の28食枠）", () => {
    const input = validDayMenu();
    expect(() =>
      DayMenuSchema.parse({ ...input, meals: input.meals.slice(0, 3) }),
    ).toThrow(ZodError);
    expect(() =>
      DayMenuSchema.parse({ ...input, meals: [...input.meals, validMealSlot()] }),
    ).toThrow(ZodError);
  });

  it("targetKcal/varianceKcalがnullでもparseできる", () => {
    const input = validDayMenu({ targetKcal: null, varianceKcal: null });
    expect(() => DayMenuSchema.parse(input)).not.toThrow();
  });
});

describe("WeekMenuPlanSchema", () => {
  it("有効な週間献立プランをparseできる (Requirement 1.1: 7日間×4食種の合計28食枠)", () => {
    const input = validWeekMenuPlan();
    expect(WeekMenuPlanSchema.parse(input)).toEqual(input);
  });

  it("daysが7件でなければ拒否する", () => {
    const input = validWeekMenuPlan();
    expect(() =>
      WeekMenuPlanSchema.parse({ ...input, days: input.days.slice(0, 6) }),
    ).toThrow(ZodError);
    expect(() =>
      WeekMenuPlanSchema.parse({ ...input, days: [...input.days, validDayMenu({ dayIndex: 6 })] }),
    ).toThrow(ZodError);
  });

  it("generatedAtは単純な文字列として受理する（nutrition.schema.tsのNutritionSummary.computedAtと同様、厳密なISO8601フォーマット検証は行わない）", () => {
    expect(() =>
      WeekMenuPlanSchema.parse(validWeekMenuPlan({ generatedAt: "not-a-real-timestamp" })),
    ).not.toThrow();
  });
});

describe("SupplementarySuggestionSchema", () => {
  it("有効な補助的な副菜提案をparseできる (Requirement 9.1, 9.3)", () => {
    const input = validSupplementarySuggestion();
    expect(SupplementarySuggestionSchema.parse(input)).toEqual(input);
  });

  it("nutritionDeltaに負の値を含んでも受理する（栄養価の増分は負にもなり得る）", () => {
    const input = validSupplementarySuggestion({
      nutritionDelta: validNutritionValues({ carbG: -5 }),
    });
    expect(() => SupplementarySuggestionSchema.parse(input)).not.toThrow();
  });

  it("dishNameが欠落していれば拒否する", () => {
    const invalid: Record<string, unknown> = { ...validSupplementarySuggestion() };
    delete invalid.dishName;
    expect(() => SupplementarySuggestionSchema.parse(invalid)).toThrow(ZodError);
  });
});

describe("RecipeDetailSchema", () => {
  it("有効なレシピ詳細をparseできる (Requirement 8.1, 8.2, 9.1)", () => {
    const input = validRecipeDetail();
    expect(RecipeDetailSchema.parse(input)).toEqual(input);
  });

  it("servingsが0以下なら拒否する (design.md: > 0)", () => {
    expect(() => RecipeDetailSchema.parse(validRecipeDetail({ servings: 0 }))).toThrow(ZodError);
  });

  it("cookingTimeMinutesが0以下なら拒否する (design.md: > 0)", () => {
    expect(() =>
      RecipeDetailSchema.parse(validRecipeDetail({ cookingTimeMinutes: 0 })),
    ).toThrow(ZodError);
  });

  it("servings/cookingTimeMinutesが整数でなければ拒否する", () => {
    expect(() => RecipeDetailSchema.parse(validRecipeDetail({ servings: 1.5 }))).toThrow(
      ZodError,
    );
    expect(() =>
      RecipeDetailSchema.parse(validRecipeDetail({ cookingTimeMinutes: 12.3 })),
    ).toThrow(ZodError);
  });

  it("supplementarySuggestionsが0件なら拒否する（design.md: 1〜2件）", () => {
    expect(() =>
      RecipeDetailSchema.parse(validRecipeDetail({ supplementarySuggestions: [] })),
    ).toThrow(ZodError);
  });

  it("supplementarySuggestionsが3件以上なら拒否する（design.md: 1〜2件）", () => {
    const three = [
      validSupplementarySuggestion(),
      validSupplementarySuggestion({ dishName: "副菜2" }),
      validSupplementarySuggestion({ dishName: "副菜3" }),
    ];
    expect(() =>
      RecipeDetailSchema.parse(validRecipeDetail({ supplementarySuggestions: three })),
    ).toThrow(ZodError);
  });

  it("supplementarySuggestionsが2件ならparseできる", () => {
    const two = [validSupplementarySuggestion(), validSupplementarySuggestion({ dishName: "副菜2" })];
    expect(() =>
      RecipeDetailSchema.parse(validRecipeDetail({ supplementarySuggestions: two })),
    ).not.toThrow();
  });

  it("stepsが文字列配列でなければ拒否する", () => {
    const invalid = { ...validRecipeDetail(), steps: [1, 2, 3] };
    expect(() => RecipeDetailSchema.parse(invalid)).toThrow(ZodError);
  });
});

describe("FeedbackInputSchema", () => {
  it("liked: trueをparseできる (Requirement 10.1)", () => {
    const input: FeedbackInput = { liked: true };
    expect(FeedbackInputSchema.parse(input)).toEqual(input);
  });

  it("liked: falseをparseできる (Requirement 10.1)", () => {
    const input: FeedbackInput = { liked: false };
    expect(FeedbackInputSchema.parse(input)).toEqual(input);
  });

  it("likedが真偽値でなければ拒否する", () => {
    expect(() => FeedbackInputSchema.parse({ liked: "true" })).toThrow(ZodError);
  });

  it("likedが欠落していれば拒否する", () => {
    expect(() => FeedbackInputSchema.parse({})).toThrow(ZodError);
  });
});

describe("ShoppingListCategorySchema", () => {
  it.each(["野菜・きのこ", "肉・魚", "乳製品・卵・豆", "調味料・その他"] as const)(
    "category=%sを受理する (Requirement 14.4)",
    (category) => {
      expect(() => ShoppingListCategorySchema.parse(category)).not.toThrow();
    },
  );

  it("4値のいずれでもない文字列を拒否する（要件14.5のフォールバックはServiceの責務であり、スキーマ自体は未知のカテゴリ文字列を受理しない）", () => {
    expect(() => ShoppingListCategorySchema.parse("主食")).toThrow(ZodError);
  });
});

describe("ShoppingListItemSchema", () => {
  it("有効な買い物リスト品目をparseできる (Requirement 14.3, 14.4, 14.7)", () => {
    const input = validShoppingListItem();
    expect(ShoppingListItemSchema.parse(input)).toEqual(input);
  });

  it("display_unit_code未設定の品目（displayUnit: 'g'）もparseできる (Requirement 14.7)", () => {
    const input = validShoppingListItem({
      quantityGrams: 245,
      displayQuantity: 245,
      displayUnit: "g",
    });
    expect(() => ShoppingListItemSchema.parse(input)).not.toThrow();
  });

  it("quantityGramsが0以下なら拒否する（対象週で実際に使用された食品IDのみがitemsに現れるため常に正）", () => {
    expect(() =>
      ShoppingListItemSchema.parse(validShoppingListItem({ quantityGrams: 0 })),
    ).toThrow(ZodError);
    expect(() =>
      ShoppingListItemSchema.parse(validShoppingListItem({ quantityGrams: -10 })),
    ).toThrow(ZodError);
  });

  it("displayQuantityが0以下なら拒否する（要件14.7の0.5フロアにより常に正）", () => {
    expect(() =>
      ShoppingListItemSchema.parse(validShoppingListItem({ displayQuantity: 0 })),
    ).toThrow(ZodError);
  });

  it("foodId/name/displayUnitが空文字なら拒否する", () => {
    expect(() => ShoppingListItemSchema.parse(validShoppingListItem({ foodId: "" }))).toThrow(
      ZodError,
    );
    expect(() => ShoppingListItemSchema.parse(validShoppingListItem({ name: "" }))).toThrow(
      ZodError,
    );
    expect(() => ShoppingListItemSchema.parse(validShoppingListItem({ displayUnit: "" }))).toThrow(
      ZodError,
    );
  });

  it("未定義のcategoryを拒否する（4値の固定カテゴリ以外はスキーマレベルで拒否、Requirement 14.4）", () => {
    const invalid = { ...validShoppingListItem(), category: "主食" };
    expect(() => ShoppingListItemSchema.parse(invalid)).toThrow(ZodError);
  });
});

describe("ShoppingListSchema", () => {
  it("有効な週間買い物リストをparseできる (Requirement 14.1-14.7)", () => {
    const input = validShoppingList();
    expect(ShoppingListSchema.parse(input)).toEqual(input);
  });

  it("複数品目を含むitemsをparseできる", () => {
    const input = validShoppingList({
      items: [
        validShoppingListItem({ foodId: "12004", category: "乳製品・卵・豆" }),
        validShoppingListItem({ foodId: "06267", name: "ほうれん草", category: "野菜・きのこ" }),
      ],
    });
    expect(() => ShoppingListSchema.parse(input)).not.toThrow();
  });

  it("itemsが配列でなければ拒否する", () => {
    const invalid = { ...validShoppingList(), items: "none" };
    expect(() => ShoppingListSchema.parse(invalid)).toThrow(ZodError);
  });

  it("weekStartDateが欠落していれば拒否する", () => {
    const invalid: Record<string, unknown> = { ...validShoppingList() };
    delete invalid.weekStartDate;
    expect(() => ShoppingListSchema.parse(invalid)).toThrow(ZodError);
  });
});

describe("EatingOutSuggestionSchema", () => {
  it("有効な外食代替提案をparseできる (Requirement 15.1-15.6)", () => {
    const input = validEatingOutSuggestion();
    expect(EatingOutSuggestionSchema.parse(input)).toEqual(input);
  });

  it("proteinDeltaGが負の値でも受理する（代替メニューの方が低たんぱくな実例が存在するため値域を制約しない、Requirement 15.3）", () => {
    const input = validEatingOutSuggestion({ proteinDeltaG: -18.5 });
    expect(() => EatingOutSuggestionSchema.parse(input)).not.toThrow();
  });

  it("typicalMenuKcal/alternativeMenuKcalが0以下なら拒否する（常に正の実在メニューのカロリー）", () => {
    expect(() =>
      EatingOutSuggestionSchema.parse(validEatingOutSuggestion({ typicalMenuKcal: 0 })),
    ).toThrow(ZodError);
    expect(() =>
      EatingOutSuggestionSchema.parse(validEatingOutSuggestion({ alternativeMenuKcal: -10 })),
    ).toThrow(ZodError);
  });

  it("typicalMenuName/alternativeMenuNameが空文字なら拒否する", () => {
    expect(() =>
      EatingOutSuggestionSchema.parse(validEatingOutSuggestion({ typicalMenuName: "" })),
    ).toThrow(ZodError);
    expect(() =>
      EatingOutSuggestionSchema.parse(validEatingOutSuggestion({ alternativeMenuName: "" })),
    ).toThrow(ZodError);
  });

  it("proteinDeltaGが欠落していれば拒否する", () => {
    const invalid: Record<string, unknown> = { ...validEatingOutSuggestion() };
    delete invalid.proteinDeltaG;
    expect(() => EatingOutSuggestionSchema.parse(invalid)).toThrow(ZodError);
  });
});

describe("EatingOutSuggestionResultSchema", () => {
  it("有効な外食代替提案結果（suggestionあり）をparseできる (Requirement 15.1-15.6)", () => {
    const input = validEatingOutSuggestionResult();
    expect(EatingOutSuggestionResultSchema.parse(input)).toEqual(input);
  });

  it("suggestion: nullを受理する（NG食材の除外により候補が残らない場合、Requirement 15.5）", () => {
    const input = validEatingOutSuggestionResult({ suggestion: null });
    expect(() => EatingOutSuggestionResultSchema.parse(input)).not.toThrow();
  });

  it("suggestionが欠落していれば拒否する", () => {
    const invalid: Record<string, unknown> = { ...validEatingOutSuggestionResult() };
    delete invalid.suggestion;
    expect(() => EatingOutSuggestionResultSchema.parse(invalid)).toThrow(ZodError);
  });

  it("suggestionが不正な形状（必須フィールド欠落）なら拒否する", () => {
    const invalidSuggestion: Record<string, unknown> = { ...validEatingOutSuggestion() };
    delete invalidSuggestion.alternativeMenuKcal;
    const invalid = { suggestion: invalidSuggestion };
    expect(() => EatingOutSuggestionResultSchema.parse(invalid)).toThrow(ZodError);
  });
});
