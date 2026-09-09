import { describe, expect, it, vi } from "vitest";
import type {
  IngredientSelection,
  MealSlot,
  MealType,
  NutritionValues,
  ResolvedIngredient,
  VerifiedNutritionValues,
} from "@nutrition/shared";
import type { Result } from "../shared/result.js";
import type { ClaudeGenerationError, RecipeGenerationToolResult } from "./claude-menu.client.js";
import type { FoodCompositionRepository, FoodItemNutrition } from "./food-composition.repository.js";
import type { MenuGenerator } from "./menu-generator.js";
import type { MenuPlanRepository, OtherDayContext } from "./menu-plan.repository.js";
import type { MenuProfileSnapshot, ProfileGateway } from "./profile.gateway.js";
import type { NutritionVerificationService } from "./nutrition-verification.service.js";
import type { VerificationError } from "./unit-conversion.service.js";
import type { PersistedRecipeDetail, RecipeDetailRepository } from "./recipe-detail.repository.js";
import {
  createRecipeDetailService,
  type RecipeDetailServiceDependencies,
} from "./recipe-detail.service.js";

/**
 * RecipeDetailService（task 10.1、食材名解決部分はtask 16.1）のテスト。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #RecipeDetailService、
 * Requirements 8, 9, 4.8）に定義されたオーケストレーションの挙動を、6つの依存すべてを
 * フェイクに差し替えて検証する。`feedback.service.test.ts` / `menu-plan.service.test.ts` と
 * 同じ「フェイク依存＋設定可能な振る舞い、未使用メソッドは呼ばれたら例外を投げる」スタイルに
 * 倣う。
 *
 * task 17.1（`MenuGenerator`導入）以降、本Serviceは`ClaudeMenuClient`/`MenuPromptBuilder`に
 * 直接依存せず、`menuGenerator: MenuGenerator`（6つの依存の1つ）のみに依存する。
 * `buildRecipeDetailPrompt`の呼び出しは`MenuGenerator`実装（`ClaudeMenuGenerator`、
 * `claude-menu.generator.ts`）内部に隠蔽されるため、本テストは`findMealSlot`/`getCurrentProfile`
 * の結果が`menuGenerator.generateRecipe`へそのまま渡ることをテスト5（wiring）で検証する。
 *
 * ## `foodCompositionRepository`（task 16.1）のフェイクについて
 * `createFakeFoodCompositionRepository`の`findById`は、`foodId`ごとに明確に区別できる
 * （他のfoodIdとは異なる）名前を返す固定マップを既定とする。全foodIdに同一のプレースホルダー
 * 名を返すフェイクにすると、`RecipeDetailService`がfoodIdと解決した名前を取り違えても
 * テストが検出できなくなる（タスクブリーフの要求「name-mixup bugが検出できるように」）ため、
 * 意図的にfoodIdごとの一意な名前を用意する。
 */

// --- 固定値・フィクスチャ ---

const WEEK_START = "2026-09-07";
const DAY_INDEX = 2;
const MEAL_TYPE: MealType = "lunch";
const MEAL_SLOT_ID = 777;

/**
 * 「主菜スロット」のフィクスチャ。`dishName`・`foodId` はこのテストファイル専用の、他の
 * テストファイルの食品ID（例: "10001" 白米）とは明確に区別できる文字列にし、wiring検証で
 * ハードコードされた文言との取り違えを検出できるようにする。
 */
function buildMealSlot(overrides: Partial<MealSlot> = {}): MealSlot & { id: number } {
  return {
    id: MEAL_SLOT_ID,
    mealType: MEAL_TYPE,
    dishName: "★RecipeDetailService検証用_特製生姜焼き★",
    ingredients: [
      { foodId: "RD-MAIN-1", quantity: 150, unit: "g" },
      { foodId: "RD-MAIN-2", quantity: 1, unit: "個" },
    ],
    nutrition: {
      energyKcal: 611,
      proteinG: 32.5,
      fatG: 21.25,
      carbG: 58.75,
      fiberG: 4.4,
      calciumMg: 88,
      ironMg: 2.2,
      vitaminAUg: 133,
      vitaminDUg: 1.1,
      vitaminB1Mg: 0.33,
      vitaminB2Mg: 0.22,
      vitaminCMg: 15.5,
      saltEquivalentG: 2.75,
    },
    ...overrides,
  };
}

/** 主菜スロットの`nutrition`（13項目）を、`RecipeDetail.nutrition`が期待する4項目へ射影する。 */
function projectToNutritionValues(value: VerifiedNutritionValues): NutritionValues {
  return {
    energyKcal: value.energyKcal,
    proteinG: value.proteinG,
    fatG: value.fatG,
    carbG: value.carbG,
  };
}

/** プロフィールのNG食材に、他のテストとは明確に区別できる文字列を用いる（wiring検証用）。 */
function buildProfile(overrides: Partial<MenuProfileSnapshot> = {}): MenuProfileSnapshot {
  return {
    ngIngredients: ["★RecipeDetailService検証用NG食材_パクチー★"],
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

/** `MenuGenerator.generateRecipe`の成功結果フィクスチャ。補助副菜1〜2件を指定できる。 */
function buildClaudeRecipeResult(suggestionCount: 1 | 2): RecipeGenerationToolResult {
  const allSuggestions: RecipeGenerationToolResult["supplementarySuggestions"] = [
    { dishName: "★補助副菜A★", ingredients: [{ foodId: "RD-SUPP-A", quantity: 50, unit: "g" }] },
    { dishName: "★補助副菜B★", ingredients: [{ foodId: "RD-SUPP-B", quantity: 80, unit: "g" }] },
  ];
  return {
    servings: 2,
    cookingTimeMinutes: 15,
    steps: ["手順1: 下ごしらえをする", "手順2: 炒める"],
    supplementarySuggestions: allSuggestions.slice(0, suggestionCount),
  };
}

/**
 * `(dayIndex, mealIndex)`のようなseed値ごとに明確に区別できる13項目の`VerifiedNutritionValues`。
 * 全項目が非ゼロかつ一意な値を持つため、射影（13項目→4項目）の取り違え・微量栄養素の漏出を
 * テストで検出できる。
 */
function buildVerifiedNutrition(seed: number): VerifiedNutritionValues {
  return {
    energyKcal: 100 + seed,
    proteinG: 10 + seed * 0.1,
    fatG: 5 + seed * 0.2,
    carbG: 20 + seed * 0.3,
    fiberG: 1 + seed * 0.01,
    calciumMg: 30 + seed,
    ironMg: 1 + seed * 0.05,
    vitaminAUg: 50 + seed,
    vitaminDUg: 0.5 + seed * 0.01,
    vitaminB1Mg: 0.1 + seed * 0.001,
    vitaminB2Mg: 0.1 + seed * 0.001,
    vitaminCMg: 5 + seed * 0.1,
    saltEquivalentG: 0.5 + seed * 0.01,
  };
}

/**
 * `RecipeDetailRepository.upsert`の戻り値フィクスチャ（`PersistedRecipeDetail`、食材名は未解決）。
 * 入力の`detail`とは明確に区別できる値にする。`supplementarySuggestions[0].ingredients`は、
 * 空配列ではなく`FOOD_NAMES_BY_ID`が認識する`RD-SUPP-A`の1件にする — こうすることで
 * 「Repositoryの戻り値（`persisted`）自身に含まれる食材が正しく名前解決されるか」を、
 * `calledDetail`（Serviceがupsertへ渡した引数）ではなく`storedRecipeDetail`（Repositoryの
 * 戻り値）から検証できる。
 */
function buildStoredRecipeDetail(
  overrides: Partial<PersistedRecipeDetail> = {}
): PersistedRecipeDetail {
  return {
    mealSlotId: MEAL_SLOT_ID,
    servings: 9999,
    cookingTimeMinutes: 9999,
    steps: ["★STORED_STEP★"],
    nutrition: { energyKcal: 9999, proteinG: 9999, fatG: 9999, carbG: 9999 },
    supplementarySuggestions: [
      {
        dishName: "★STORED_SUGGESTION★",
        ingredients: [{ foodId: "RD-SUPP-A", quantity: 9999, unit: "g" }],
        nutritionDelta: { energyKcal: 8888, proteinG: 8888, fatG: 8888, carbG: 8888 },
      },
    ],
    ...overrides,
  };
}

/**
 * `FoodCompositionRepository.findById`（task 16.1、食材名解決用）が認識するfoodIdごとの
 * 名前の固定マップ。全foodIdに同一のプレースホルダー名を割り当てると、ServiceがfoodIdと
 * 名前を取り違えてもテストで検出できなくなるため、`buildMealSlot`/`buildClaudeRecipeResult`が
 * 使う4つのfoodId（`RD-MAIN-1`/`RD-MAIN-2`/`RD-SUPP-A`/`RD-SUPP-B`）それぞれに明確に区別できる
 * 名前を割り当てる。
 */
const FOOD_NAMES_BY_ID: Readonly<Record<string, string>> = {
  "RD-MAIN-1": "★食材名解決_MAIN-1（生姜）★",
  "RD-MAIN-2": "★食材名解決_MAIN-2（豚肉）★",
  "RD-SUPP-A": "★食材名解決_SUPP-A（ほうれん草）★",
  "RD-SUPP-B": "★食材名解決_SUPP-B（もやし）★",
};

/** `FoodItemNutrition`の最小フィクスチャ。`findById`の戻り値として`name`のみが検証対象。 */
function buildFoodItemNutrition(foodId: string, name: string): FoodItemNutrition {
  return {
    foodId,
    name,
    category: "test-category",
    per100g: {
      energyKcal: 0,
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
    sourceCitation: "test-fixture",
    displayUnitCode: null,
  };
}

/** foodIdから期待される`ResolvedIngredient`を組み立てる（`FOOD_NAMES_BY_ID`と対応）。 */
function resolvedIngredient(ingredient: IngredientSelection): ResolvedIngredient {
  const name = FOOD_NAMES_BY_ID[ingredient.foodId];
  if (name === undefined) {
    throw new Error(`test fixture error: unrecognized fixture foodId "${ingredient.foodId}"`);
  }
  return { ...ingredient, name };
}

// --- フェイク依存（未使用メソッドは呼ばれたら例外を投げる） ---

function createFakeMenuPlanRepository(
  overrides: { findMealSlot?: MenuPlanRepository["findMealSlot"] } = {}
): MenuPlanRepository {
  return {
    getActivePlan: () => {
      throw new Error(
        "createFakeMenuPlanRepository: getActivePlan is not used by RecipeDetailService"
      );
    },
    findOtherDays: (): OtherDayContext[] => {
      throw new Error(
        "createFakeMenuPlanRepository: findOtherDays is not used by RecipeDetailService"
      );
    },
    findMealSlot:
      overrides.findMealSlot ??
      (() => {
        throw new Error(
          "createFakeMenuPlanRepository: findMealSlot was not expected to be called in this test"
        );
      }),
    replaceWeek: () => {
      throw new Error(
        "createFakeMenuPlanRepository: replaceWeek is not used by RecipeDetailService"
      );
    },
    replaceDay: () => {
      throw new Error(
        "createFakeMenuPlanRepository: replaceDay is not used by RecipeDetailService"
      );
    },
  };
}

function createFakeProfileGateway(
  overrides: { getCurrentProfile?: ProfileGateway["getCurrentProfile"] } = {}
): ProfileGateway {
  return {
    getCurrentProfile:
      overrides.getCurrentProfile ??
      (() => {
        throw new Error(
          "createFakeProfileGateway: getCurrentProfile was not expected to be called in this test"
        );
      }),
  };
}

function createFakeMenuGenerator(
  overrides: { generateRecipe?: MenuGenerator["generateRecipe"] } = {}
): MenuGenerator {
  return {
    generateWeek: () => {
      throw new Error("createFakeMenuGenerator: generateWeek is not used by RecipeDetailService");
    },
    generateDay: () => {
      throw new Error("createFakeMenuGenerator: generateDay is not used by RecipeDetailService");
    },
    generateRecipe:
      overrides.generateRecipe ??
      (() => {
        throw new Error(
          "createFakeMenuGenerator: generateRecipe was not expected to be called in this test"
        );
      }),
  };
}

function createFakeNutritionVerificationService(
  overrides: { verifyDish?: NutritionVerificationService["verifyDish"] } = {}
): NutritionVerificationService {
  return {
    verifyDish:
      overrides.verifyDish ??
      (() => {
        throw new Error(
          "createFakeNutritionVerificationService: verifyDish was not expected to be called in this test"
        );
      }),
    verifyDay: () => {
      throw new Error(
        "createFakeNutritionVerificationService: verifyDay is not used by RecipeDetailService"
      );
    },
    computeVarianceKcal: () => {
      throw new Error(
        "createFakeNutritionVerificationService: computeVarianceKcal is not used by RecipeDetailService"
      );
    },
  };
}

function createFakeRecipeDetailRepository(
  overrides: { upsert?: RecipeDetailRepository["upsert"] } = {}
): RecipeDetailRepository {
  return {
    findByMealSlotId: () => {
      throw new Error(
        "createFakeRecipeDetailRepository: findByMealSlotId is not used by RecipeDetailService"
      );
    },
    upsert:
      overrides.upsert ??
      (() => {
        throw new Error(
          "createFakeRecipeDetailRepository: upsert was not expected to be called in this test"
        );
      }),
  };
}

/**
 * `FoodCompositionRepository`のフェイク（task 16.1）。既定の`findById`は`FOOD_NAMES_BY_ID`が
 * 認識するfoodIdについて、対応する一意な名前を持つ`FoodItemNutrition`を返す（ファイル冒頭
 * コメント参照）。他のメソッドは`RecipeDetailService`から一切呼ばれないため、呼ばれたら
 * 例外を投げる。
 */
function createFakeFoodCompositionRepository(
  overrides: { findById?: FoodCompositionRepository["findById"] } = {}
): FoodCompositionRepository {
  return {
    findById:
      overrides.findById ??
      ((foodId: string) => {
        const name = FOOD_NAMES_BY_ID[foodId];
        if (name === undefined) {
          throw new Error(
            `createFakeFoodCompositionRepository: unrecognized fixture foodId "${foodId}"`
          );
        }
        return buildFoodItemNutrition(foodId, name);
      }),
    listAllIds: () => {
      throw new Error(
        "createFakeFoodCompositionRepository: listAllIds is not used by RecipeDetailService"
      );
    },
    findUnitConversion: () => {
      throw new Error(
        "createFakeFoodCompositionRepository: findUnitConversion is not used by RecipeDetailService"
      );
    },
    findGenericUnitConversion: () => {
      throw new Error(
        "createFakeFoodCompositionRepository: findGenericUnitConversion is not used by RecipeDetailService"
      );
    },
  };
}

function createDeps(
  overrides: Partial<RecipeDetailServiceDependencies> = {}
): RecipeDetailServiceDependencies {
  return {
    menuPlanRepository: overrides.menuPlanRepository ?? createFakeMenuPlanRepository(),
    profileGateway: overrides.profileGateway ?? createFakeProfileGateway(),
    menuGenerator: overrides.menuGenerator ?? createFakeMenuGenerator(),
    nutritionVerificationService:
      overrides.nutritionVerificationService ?? createFakeNutritionVerificationService(),
    recipeDetailRepository: overrides.recipeDetailRepository ?? createFakeRecipeDetailRepository(),
    foodCompositionRepository:
      overrides.foodCompositionRepository ?? createFakeFoodCompositionRepository(),
  };
}

/**
 * ハッピーパス用の依存一式。個別の `overrides` で挙動を差し替えられるようにする。
 * `verifyDish` は既定でどの`ingredients`が渡されても最初の食材の`foodId`から
 * `RD-SUPP-A` → seed 1、`RD-SUPP-B` → seed 2 の`VerifiedNutritionValues`を返す
 * （`buildClaudeRecipeResult`のフィクスチャと対応）。
 */
function createHappyPathDeps(
  overrides: Partial<RecipeDetailServiceDependencies> = {},
  mealSlot: MealSlot & { id: number } = buildMealSlot(),
  profile: MenuProfileSnapshot = buildProfile(),
  suggestionCount: 1 | 2 = 1
): RecipeDetailServiceDependencies {
  const defaultVerifyDish = (
    ingredients: IngredientSelection[]
  ): Result<VerifiedNutritionValues, VerificationError> => {
    const first = ingredients[0];
    if (!first) {
      throw new Error("test fixture error: verifyDish called with empty ingredients");
    }
    if (first.foodId === "RD-SUPP-A") {
      return { ok: true, value: buildVerifiedNutrition(1) };
    }
    if (first.foodId === "RD-SUPP-B") {
      return { ok: true, value: buildVerifiedNutrition(2) };
    }
    throw new Error(`test fixture error: unrecognized fixture foodId "${first.foodId}"`);
  };

  return createDeps({
    menuPlanRepository: createFakeMenuPlanRepository({
      findMealSlot: () => mealSlot,
    }),
    profileGateway: createFakeProfileGateway({
      getCurrentProfile: () => profile,
    }),
    menuGenerator: createFakeMenuGenerator({
      generateRecipe: async () => ({ ok: true, value: buildClaudeRecipeResult(suggestionCount) }),
    }),
    nutritionVerificationService: createFakeNutritionVerificationService({
      verifyDish: defaultVerifyDish,
    }),
    recipeDetailRepository: createFakeRecipeDetailRepository({
      upsert: (_mealSlotId, detail) => buildStoredRecipeDetail(detail),
    }),
    ...overrides,
  });
}

// --- テスト本体 ---

describe("createRecipeDetailService", () => {
  describe("generateForMealSlot — 対象食事枠が存在しない場合（Req 8.1, design.md NotFoundError分岐）", () => {
    it("findMealSlotがnullを返す場合、NotFoundErrorを返し、他の4依存は一切呼ばれない", async () => {
      const menuPlanRepository = createFakeMenuPlanRepository({ findMealSlot: () => null });
      const deps = createDeps({ menuPlanRepository });
      const service = createRecipeDetailService(deps);

      const result = await service.generateForMealSlot(WEEK_START, DAY_INDEX, MEAL_TYPE);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected a failure result");
      }
      expect(result.error.type).toBe("not_found");
      expect(typeof result.error.message).toBe("string");
      expect(result.error.message.length).toBeGreaterThan(0);
    });
  });

  describe("generateForMealSlot — プロフィール未登録の場合（Req 12.1相当、GenerationError(profile_missing)）", () => {
    it("getCurrentProfileがnullを返す場合、GenerationError(profile_missing)を返し、menuGenerator/recipeDetailRepositoryは呼ばれない", async () => {
      const mealSlot = buildMealSlot();
      const menuPlanRepository = createFakeMenuPlanRepository({ findMealSlot: () => mealSlot });
      const profileGateway = createFakeProfileGateway({ getCurrentProfile: () => null });
      const deps = createDeps({ menuPlanRepository, profileGateway });
      const service = createRecipeDetailService(deps);

      const result = await service.generateForMealSlot(WEEK_START, DAY_INDEX, MEAL_TYPE);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected a failure result");
      }
      expect(result.error).toMatchObject({ type: "generation_failed", reason: "profile_missing" });
    });
  });

  describe.each([
    ["schema_validation_failed", "schema_validation_failed"],
    ["refusal", "claude_refusal"],
    ["request_failed", "claude_request_failed"],
  ] as const)(
    "generateForMealSlot — Claude生成エラー（Req 12.3, 12.4相当）: %s",
    (claudeType, expectedReason) => {
      it(`ClaudeGenerationError(type: "${claudeType}")の場合、GenerationError(reason: "${expectedReason}")を返し、recipeDetailRepository.upsertは呼ばれない`, async () => {
        const mealSlot = buildMealSlot();
        const profile = buildProfile();
        const menuPlanRepository = createFakeMenuPlanRepository({ findMealSlot: () => mealSlot });
        const profileGateway = createFakeProfileGateway({ getCurrentProfile: () => profile });
        const menuGenerator = createFakeMenuGenerator({
          generateRecipe: async (): Promise<
            Result<RecipeGenerationToolResult, ClaudeGenerationError>
          > => ({
            ok: false,
            error: { type: claudeType, message: `test failure: ${claudeType}` },
          }),
        });
        const deps = createDeps({ menuPlanRepository, profileGateway, menuGenerator });
        const service = createRecipeDetailService(deps);

        const result = await service.generateForMealSlot(WEEK_START, DAY_INDEX, MEAL_TYPE);

        expect(result.ok).toBe(false);
        if (result.ok) {
          throw new Error("expected a failure result");
        }
        expect(result.error).toMatchObject({ type: "generation_failed", reason: expectedReason });
      });
    }
  );

  describe("generateForMealSlot — 補助副菜の栄養検証失敗（Req 9.1〜9.3、2件中2件目が失敗するケース）", () => {
    it.each([
      ["food_id_not_found", "food_id_not_found"],
      ["unit_not_found", "unit_not_found"],
    ] as const)(
      "1件目が成功し2件目が%sで失敗する場合、GenerationError(reason: %s)を返し、upsertは一切呼ばれない（部分永続化しない）",
      async (verificationType, expectedReason) => {
        const mealSlot = buildMealSlot();
        const profile = buildProfile();
        const claudeResult = buildClaudeRecipeResult(2);
        const verifyDish = vi
          .fn<NutritionVerificationService["verifyDish"]>()
          .mockReturnValueOnce({ ok: true, value: buildVerifiedNutrition(1) })
          .mockReturnValueOnce({
            ok: false,
            error: { type: verificationType, message: `test failure: ${verificationType}` },
          });

        const deps = createDeps({
          menuPlanRepository: createFakeMenuPlanRepository({ findMealSlot: () => mealSlot }),
          profileGateway: createFakeProfileGateway({ getCurrentProfile: () => profile }),
          menuGenerator: createFakeMenuGenerator({
            generateRecipe: async () => ({ ok: true, value: claudeResult }),
          }),
          nutritionVerificationService: createFakeNutritionVerificationService({ verifyDish }),
        });
        const service = createRecipeDetailService(deps);

        const result = await service.generateForMealSlot(WEEK_START, DAY_INDEX, MEAL_TYPE);

        expect(result.ok).toBe(false);
        if (result.ok) {
          throw new Error("expected a failure result");
        }
        expect(result.error).toMatchObject({ type: "generation_failed", reason: expectedReason });
        expect(verifyDish).toHaveBeenCalledTimes(2);
      }
    );
  });

  describe("generateForMealSlot — menuGenerator.generateRecipeへのwiring検証（Req 8.1, 9.4）", () => {
    it("findMealSlotの結果とgetCurrentProfileの結果が、そのままmenuGenerator.generateRecipeの引数として渡される", async () => {
      const mealSlot = buildMealSlot();
      const profile = buildProfile();
      const generateRecipe = vi
        .fn<MenuGenerator["generateRecipe"]>()
        .mockResolvedValue({ ok: true, value: buildClaudeRecipeResult(1) });

      const deps = createHappyPathDeps(
        { menuGenerator: createFakeMenuGenerator({ generateRecipe }) },
        mealSlot,
        profile,
        1
      );
      const service = createRecipeDetailService(deps);

      await service.generateForMealSlot(WEEK_START, DAY_INDEX, MEAL_TYPE);

      expect(generateRecipe).toHaveBeenCalledTimes(1);
      const call = generateRecipe.mock.calls[0];
      if (!call) {
        throw new Error("menuGenerator.generateRecipe was not called");
      }
      const [calledMealSlot, calledProfile] = call;
      // findMealSlotの結果（mealSlot）が、そのままmenuGenerator.generateRecipeの第1引数として
      // 渡される（プロンプト構築の詳細は`ClaudeMenuGenerator`実装・`menu-prompt.builder.test.ts`
      // が別途検証済みであり、本Serviceの境界では「正しい値が正しい引数位置に渡ること」のみを
      // 検証すれば十分である）。
      expect(calledMealSlot).toBe(mealSlot);
      // getCurrentProfileの結果（profile）が、そのままmenuGenerator.generateRecipeの第2引数
      // として渡される。
      expect(calledProfile).toBe(profile);
    });
  });

  describe("generateForMealSlot — 成功パス（補助副菜1件、Req 8.1〜8.3, 9.1〜9.3）", () => {
    it("upsertがmealSlot.idと正しく組み立てたdetailで呼ばれ、Result.okがrepositoryの戻り値＋食材名解決になる", async () => {
      const mealSlot = buildMealSlot();
      const profile = buildProfile();
      const claudeResult = buildClaudeRecipeResult(1);
      // `upsert`の戻り値は、渡された`detail`から完全に独立した固定のsentinelオブジェクトにする。
      // `buildStoredRecipeDetail(detail)`のように`detail`をoverridesとして渡すと、
      // `buildStoredRecipeDetail`が`...overrides`を最後にspreadするため全sentinel値が実際の
      // 入力で上書きされてしまい、戻り値が`{mealSlotId: mealSlot.id, ...detail}`と
      // 区別不能になる（Serviceがそのようにローカル再構築しても検出できない）。
      // 引数なしで呼ぶことで、`detail`の内容に一切依存しない固定値であることを保証する。
      const storedRecipeDetail = buildStoredRecipeDetail();
      const upsert = vi
        .fn<RecipeDetailRepository["upsert"]>()
        .mockReturnValue(storedRecipeDetail);

      const deps = createHappyPathDeps(
        { recipeDetailRepository: createFakeRecipeDetailRepository({ upsert }) },
        mealSlot,
        profile,
        1
      );
      const service = createRecipeDetailService(deps);

      const result = await service.generateForMealSlot(WEEK_START, DAY_INDEX, MEAL_TYPE);

      expect(upsert).toHaveBeenCalledTimes(1);
      const [calledMealSlotId, calledDetail] = upsert.mock.calls[0] as [
        number,
        Omit<PersistedRecipeDetail, "mealSlotId">,
      ];
      expect(calledMealSlotId).toBe(mealSlot.id);
      expect(calledDetail.servings).toBe(claudeResult.servings);
      expect(calledDetail.cookingTimeMinutes).toBe(claudeResult.cookingTimeMinutes);
      expect(calledDetail.steps).toEqual(claudeResult.steps);
      // topレベルのnutritionは、主菜スロット自身のnutritionを4項目に射影したもの。
      expect(calledDetail.nutrition).toEqual(projectToNutritionValues(mealSlot.nutrition));
      expect(Object.keys(calledDetail.nutrition).sort()).toEqual(
        ["carbG", "energyKcal", "fatG", "proteinG"].sort()
      );
      // 補助副菜1件、そのnutritionDeltaはverifyDish(seed=1)の4項目射影と一致する。upsertへ渡す
      // 時点ではingredientsはまだ未解決（`PersistedSupplementarySuggestion`、food名を含まない）。
      expect(calledDetail.supplementarySuggestions).toHaveLength(1);
      const calledSuggestion = calledDetail.supplementarySuggestions[0];
      expect(calledSuggestion?.dishName).toBe("★補助副菜A★");
      expect(calledSuggestion?.ingredients).toEqual(
        claudeResult.supplementarySuggestions[0]?.ingredients
      );
      expect(calledSuggestion?.nutritionDelta).toEqual(
        projectToNutritionValues(buildVerifiedNutrition(1))
      );
      expect(Object.keys(calledSuggestion?.nutritionDelta ?? {}).sort()).toEqual(
        ["carbG", "energyKcal", "fatG", "proteinG"].sort()
      );

      // Result.okの値は、Repositoryが返した固定のsentinel値（`storedRecipeDetail`）の
      // フィールドを引き継ぎつつ、`ingredients`（新設）と`supplementarySuggestions[].ingredients`
      // を食材名解決したものになる（task 16.1、Requirement 4.8）。`calledDetail`の内容には
      // 一切依存しない（Serviceが`{mealSlotId, ...calledDetail}`をローカルに再構築して返して
      // いたら、`nutrition`などが999系の値からmealSlot由来の値に変わり、このアサーションは
      // 失敗する）。
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected a success result");
      }
      expect(result.value.mealSlotId).toBe(storedRecipeDetail.mealSlotId);
      expect(result.value.servings).toBe(storedRecipeDetail.servings);
      expect(result.value.cookingTimeMinutes).toBe(storedRecipeDetail.cookingTimeMinutes);
      expect(result.value.steps).toEqual(storedRecipeDetail.steps);
      expect(result.value.nutrition).toEqual(storedRecipeDetail.nutrition);
      // 新設の`ingredients`: 主菜スロット自身の`mealSlot.ingredients`（RD-MAIN-1/RD-MAIN-2）を
      // foodIdごとに区別できる名前で解決したもの（`calledDetail`/`claudeResult`のいずれにも
      // 存在しないフィールドであり、`mealSlot`から都度組み立てられたことの証明）。
      expect(result.value.ingredients).toEqual(mealSlot.ingredients.map(resolvedIngredient));
      // `supplementarySuggestions`は`storedRecipeDetail`（Repositoryの戻り値）由来であり、
      // `calledDetail.supplementarySuggestions`（dishName: "★補助副菜A★"）とは異なる
      // dishName（"★STORED_SUGGESTION★"）を持つことで、ローカル再構築ではなく本当に
      // Repositoryの戻り値から組み立てられたことを区別して検証する。
      expect(result.value.supplementarySuggestions).toHaveLength(1);
      const resolvedSuggestion = result.value.supplementarySuggestions[0];
      const storedSuggestion = storedRecipeDetail.supplementarySuggestions[0];
      expect(resolvedSuggestion?.dishName).toBe(storedSuggestion?.dishName);
      expect(resolvedSuggestion?.dishName).not.toBe(calledSuggestion?.dishName);
      expect(resolvedSuggestion?.nutritionDelta).toEqual(storedSuggestion?.nutritionDelta);
      expect(resolvedSuggestion?.ingredients).toEqual(
        (storedSuggestion?.ingredients ?? []).map(resolvedIngredient)
      );
    });
  });

  describe("generateForMealSlot — 成功パス（補助副菜2件、Req 8.1〜8.3, 9.1〜9.3）", () => {
    it("2件の補助副菜それぞれについて、独立に正しく射影されたnutritionDeltaを持つdetailでupsertが呼ばれる", async () => {
      const mealSlot = buildMealSlot();
      const profile = buildProfile();
      const claudeResult = buildClaudeRecipeResult(2);
      // 1件成功パスと同じ理由（上記コメント参照）で、`upsert`の戻り値を`detail`から
      // 完全に独立した固定のsentinelオブジェクトにする。
      const storedRecipeDetail = buildStoredRecipeDetail();
      const upsert = vi
        .fn<RecipeDetailRepository["upsert"]>()
        .mockReturnValue(storedRecipeDetail);

      const deps = createHappyPathDeps(
        { recipeDetailRepository: createFakeRecipeDetailRepository({ upsert }) },
        mealSlot,
        profile,
        2
      );
      const service = createRecipeDetailService(deps);

      const result = await service.generateForMealSlot(WEEK_START, DAY_INDEX, MEAL_TYPE);

      expect(upsert).toHaveBeenCalledTimes(1);
      const [, calledDetail] = upsert.mock.calls[0] as [
        number,
        Omit<PersistedRecipeDetail, "mealSlotId">,
      ];
      expect(calledDetail.supplementarySuggestions).toHaveLength(2);

      const [first, second] = calledDetail.supplementarySuggestions;
      expect(first?.dishName).toBe("★補助副菜A★");
      expect(first?.nutritionDelta).toEqual(projectToNutritionValues(buildVerifiedNutrition(1)));
      expect(second?.dishName).toBe("★補助副菜B★");
      expect(second?.nutritionDelta).toEqual(projectToNutritionValues(buildVerifiedNutrition(2)));

      // supplementarySuggestions は常に1〜2件（design.md Invariants）。
      expect(claudeResult.supplementarySuggestions).toHaveLength(2);
      // Result.okの値は、Repositoryが返した固定のsentinel値のフィールドを引き継ぎつつ、
      // 食材名解決されたものになる（1件成功パスのテストと同じ理由）。
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected a success result");
      }
      expect(result.value.nutrition).toEqual(storedRecipeDetail.nutrition);
      expect(result.value.ingredients).toEqual(mealSlot.ingredients.map(resolvedIngredient));
    });
  });

  describe("generateForMealSlot — 食材名解決（task 16.1、Requirement 4.8）", () => {
    it("主菜スロットの2食材と補助副菜2件それぞれの食材が、foodIdごとに区別できる正しいnameで解決される（取り違えがあれば検出できる）", async () => {
      const mealSlot = buildMealSlot(); // ingredients: RD-MAIN-1, RD-MAIN-2
      const profile = buildProfile();
      const claudeResult = buildClaudeRecipeResult(2); // supplementarySuggestions: RD-SUPP-A, RD-SUPP-B

      // Repositoryの戻り値（`persisted`）にも、補助副菜2件それぞれ異なるfoodId
      // （RD-SUPP-A/RD-SUPP-B）を持たせ、「どちらの補助副菜がどちらのfoodIdを解決するか」の
      // 取り違えがあれば検出できるようにする。
      const storedRecipeDetail = buildStoredRecipeDetail({
        supplementarySuggestions: [
          {
            dishName: "★STORED_SUGGESTION_A★",
            ingredients: [{ foodId: "RD-SUPP-A", quantity: 111, unit: "g" }],
            nutritionDelta: { energyKcal: 1, proteinG: 1, fatG: 1, carbG: 1 },
          },
          {
            dishName: "★STORED_SUGGESTION_B★",
            ingredients: [{ foodId: "RD-SUPP-B", quantity: 222, unit: "g" }],
            nutritionDelta: { energyKcal: 2, proteinG: 2, fatG: 2, carbG: 2 },
          },
        ],
      });
      const upsert = vi
        .fn<RecipeDetailRepository["upsert"]>()
        .mockReturnValue(storedRecipeDetail);

      const deps = createHappyPathDeps(
        { recipeDetailRepository: createFakeRecipeDetailRepository({ upsert }) },
        mealSlot,
        profile,
        2
      );
      const service = createRecipeDetailService(deps);

      const result = await service.generateForMealSlot(WEEK_START, DAY_INDEX, MEAL_TYPE);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected a success result");
      }

      // 主菜スロット自身の`ingredients`（新設）: RD-MAIN-1/RD-MAIN-2それぞれ固有の名前で解決される。
      expect(result.value.ingredients).toEqual([
        { foodId: "RD-MAIN-1", quantity: 150, unit: "g", name: FOOD_NAMES_BY_ID["RD-MAIN-1"] },
        { foodId: "RD-MAIN-2", quantity: 1, unit: "個", name: FOOD_NAMES_BY_ID["RD-MAIN-2"] },
      ]);
      // MAIN-1とMAIN-2の名前が取り違えられていない（同一名にすり替わっていない）ことの明示的確認。
      expect(result.value.ingredients[0]?.name).not.toBe(result.value.ingredients[1]?.name);

      // 補助副菜2件それぞれのingredientsが、対応するfoodId固有の名前で解決される。
      expect(result.value.supplementarySuggestions).toHaveLength(2);
      const [suggestionA, suggestionB] = result.value.supplementarySuggestions;
      expect(suggestionA?.ingredients).toEqual([
        { foodId: "RD-SUPP-A", quantity: 111, unit: "g", name: FOOD_NAMES_BY_ID["RD-SUPP-A"] },
      ]);
      expect(suggestionB?.ingredients).toEqual([
        { foodId: "RD-SUPP-B", quantity: 222, unit: "g", name: FOOD_NAMES_BY_ID["RD-SUPP-B"] },
      ]);
      // SUPP-AとSUPP-Bの名前が取り違えられていない（同一名にすり替わっていない）ことの明示的確認。
      expect(suggestionA?.ingredients[0]?.name).not.toBe(suggestionB?.ingredients[0]?.name);
    });
  });
});
