import { describe, expect, it, vi } from "vitest";
import type {
  IngredientSelection,
  MealSlot,
  MealType,
  NutritionValues,
  RecipeDetail,
  VerifiedNutritionValues,
} from "@nutrition/shared";
import type { Result } from "../shared/result.js";
import type {
  ClaudeGenerationError,
  ClaudeMenuClient,
  ClaudePromptPayload,
  RecipeGenerationToolResult,
} from "./claude-menu.client.js";
import type { MenuPlanRepository, OtherDayContext } from "./menu-plan.repository.js";
import type { MenuProfileSnapshot, ProfileGateway } from "./profile.gateway.js";
import type { NutritionVerificationService } from "./nutrition-verification.service.js";
import type { VerificationError } from "./unit-conversion.service.js";
import type { RecipeDetailRepository } from "./recipe-detail.repository.js";
import {
  createRecipeDetailService,
  type RecipeDetailServiceDependencies,
} from "./recipe-detail.service.js";

/**
 * RecipeDetailService（task 10.1）のテスト。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #RecipeDetailService、
 * Requirements 8, 9）に定義されたオーケストレーションの挙動を、5つの依存すべてを
 * フェイクに差し替えて検証する。`feedback.service.test.ts` / `menu-plan.service.test.ts` と
 * 同じ「フェイク依存＋設定可能な振る舞い、未使用メソッドは呼ばれたら例外を投げる」スタイルに
 * 倣う。
 *
 * `MenuPromptBuilder.buildRecipeDetailPrompt` は外部依存を持たない純粋関数であり、
 * `menu-plan.service.ts` が確立した precedent（`buildWeeklyPrompt`/`buildDailyPrompt` を
 * DIの対象にせず直接importする）に倣って、本Serviceも直接importして呼び出す想定であるため、
 * 依存一覧・フェイクの対象にはしない。実関数のまま動作させ、その結果が
 * `ClaudeMenuClient.generateRecipe` へ渡る payload に反映されることをテスト5（wiring）で検証する。
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

/** `ClaudeMenuClient.generateRecipe`の成功結果フィクスチャ。補助副菜1〜2件を指定できる。 */
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

/** `RecipeDetailRepository.upsert`の戻り値フィクスチャ。入力の`detail`とは明確に区別できる値にする。 */
function buildStoredRecipeDetail(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
  return {
    mealSlotId: MEAL_SLOT_ID,
    servings: 9999,
    cookingTimeMinutes: 9999,
    steps: ["★STORED_STEP★"],
    nutrition: { energyKcal: 9999, proteinG: 9999, fatG: 9999, carbG: 9999 },
    supplementarySuggestions: [
      {
        dishName: "★STORED_SUGGESTION★",
        ingredients: [],
        nutritionDelta: { energyKcal: 8888, proteinG: 8888, fatG: 8888, carbG: 8888 },
      },
    ],
    ...overrides,
  };
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

function createFakeClaudeMenuClient(
  overrides: { generateRecipe?: ClaudeMenuClient["generateRecipe"] } = {}
): ClaudeMenuClient {
  return {
    generateWeek: () => {
      throw new Error("createFakeClaudeMenuClient: generateWeek is not used by RecipeDetailService");
    },
    generateDay: () => {
      throw new Error("createFakeClaudeMenuClient: generateDay is not used by RecipeDetailService");
    },
    generateRecipe:
      overrides.generateRecipe ??
      (() => {
        throw new Error(
          "createFakeClaudeMenuClient: generateRecipe was not expected to be called in this test"
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

function createDeps(
  overrides: Partial<RecipeDetailServiceDependencies> = {}
): RecipeDetailServiceDependencies {
  return {
    menuPlanRepository: overrides.menuPlanRepository ?? createFakeMenuPlanRepository(),
    profileGateway: overrides.profileGateway ?? createFakeProfileGateway(),
    claudeMenuClient: overrides.claudeMenuClient ?? createFakeClaudeMenuClient(),
    nutritionVerificationService:
      overrides.nutritionVerificationService ?? createFakeNutritionVerificationService(),
    recipeDetailRepository: overrides.recipeDetailRepository ?? createFakeRecipeDetailRepository(),
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
    claudeMenuClient: createFakeClaudeMenuClient({
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
    it("getCurrentProfileがnullを返す場合、GenerationError(profile_missing)を返し、claudeMenuClient/recipeDetailRepositoryは呼ばれない", async () => {
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
        const claudeMenuClient = createFakeClaudeMenuClient({
          generateRecipe: async (): Promise<
            Result<RecipeGenerationToolResult, ClaudeGenerationError>
          > => ({
            ok: false,
            error: { type: claudeType, message: `test failure: ${claudeType}` },
          }),
        });
        const deps = createDeps({ menuPlanRepository, profileGateway, claudeMenuClient });
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
          claudeMenuClient: createFakeClaudeMenuClient({
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

  describe("generateForMealSlot — buildRecipeDetailPromptのwiring検証（Req 8.1, 9.4）", () => {
    it("findMealSlotの結果とgetCurrentProfileの結果が、buildRecipeDetailPrompt経由でgenerateRecipeへ渡るpayloadに反映される", async () => {
      const mealSlot = buildMealSlot();
      const profile = buildProfile();
      const generateRecipe = vi
        .fn<ClaudeMenuClient["generateRecipe"]>()
        .mockResolvedValue({ ok: true, value: buildClaudeRecipeResult(1) });

      const deps = createHappyPathDeps(
        { claudeMenuClient: createFakeClaudeMenuClient({ generateRecipe }) },
        mealSlot,
        profile,
        1
      );
      const service = createRecipeDetailService(deps);

      await service.generateForMealSlot(WEEK_START, DAY_INDEX, MEAL_TYPE);

      expect(generateRecipe).toHaveBeenCalledTimes(1);
      const payload = generateRecipe.mock.calls[0]?.[0] as ClaudePromptPayload;
      expect(payload).toBeDefined();
      // mealSlotの内容（料理名）がuserMessageに反映されている。
      expect(payload.userMessage).toContain(mealSlot.dishName);
      // profileの内容（NG食材）がsystemに反映されている。
      expect(payload.system).toContain(profile.ngIngredients[0]);
    });
  });

  describe("generateForMealSlot — 成功パス（補助副菜1件、Req 8.1〜8.3, 9.1〜9.3）", () => {
    it("upsertがmealSlot.idと正しく組み立てたdetailで呼ばれ、Result.okがrepositoryの戻り値そのものになる", async () => {
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
        Omit<RecipeDetail, "mealSlotId">,
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
      // 補助副菜1件、そのnutritionDeltaはverifyDish(seed=1)の4項目射影と一致する。
      expect(calledDetail.supplementarySuggestions).toHaveLength(1);
      const suggestion = calledDetail.supplementarySuggestions[0];
      expect(suggestion?.dishName).toBe("★補助副菜A★");
      expect(suggestion?.ingredients).toEqual(claudeResult.supplementarySuggestions[0]?.ingredients);
      expect(suggestion?.nutritionDelta).toEqual(projectToNutritionValues(buildVerifiedNutrition(1)));
      expect(Object.keys(suggestion?.nutritionDelta ?? {}).sort()).toEqual(
        ["carbG", "energyKcal", "fatG", "proteinG"].sort()
      );

      // Result.okの値は、Repositoryが返した固定のsentinel値そのもの（`detail`から再構築した
      // ものではない）。この比較が`calledDetail`の内容に一切依存しないことが核心である
      // （もしServiceが`{mealSlotId, ...detail}`をローカルに再構築して返していたら、この
      // アサーションは失敗する）。
      expect(result).toEqual({ ok: true, value: storedRecipeDetail });
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
      const [, calledDetail] = upsert.mock.calls[0] as [number, Omit<RecipeDetail, "mealSlotId">];
      expect(calledDetail.supplementarySuggestions).toHaveLength(2);

      const [first, second] = calledDetail.supplementarySuggestions;
      expect(first?.dishName).toBe("★補助副菜A★");
      expect(first?.nutritionDelta).toEqual(projectToNutritionValues(buildVerifiedNutrition(1)));
      expect(second?.dishName).toBe("★補助副菜B★");
      expect(second?.nutritionDelta).toEqual(projectToNutritionValues(buildVerifiedNutrition(2)));

      // supplementarySuggestions は常に1〜2件（design.md Invariants）。
      expect(claudeResult.supplementarySuggestions).toHaveLength(2);
      // Result.okの値は、Repositoryが返した固定のsentinel値そのもの（`detail`から再構築した
      // ものではない）。
      expect(result).toEqual({ ok: true, value: storedRecipeDetail });
    });
  });
});
