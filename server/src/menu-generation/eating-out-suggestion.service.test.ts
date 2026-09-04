import { describe, expect, it } from "vitest";
import type { MealType } from "@nutrition/shared";
import type { OtherDayContext, MenuPlanRepository } from "./menu-plan.repository.js";
import type { MenuProfileSnapshot, ProfileGateway } from "./profile.gateway.js";
import { createEatingOutSuggestionService } from "./eating-out-suggestion.service.js";

/**
 * EatingOutSuggestionService（task 13.5）のテスト。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #外食代替提案生成フロー、
 * Requirements 15.1-15.7）には他のDomain Serviceと異なり独立したResponsibilities/Service
 * Interfaceの記述がなく（Componentsテーブルの1行サマリとシーケンス図のみ）、本テストは
 * `eating-out-suggestion.service.ts`のファイル冒頭コメントが推論した挙動仕様
 * （findMealSlot→null-profile graceful degradation→mealType一致→NG食材除外→
 * カロリー以下で最も近いものを選定）をそのまま検証する。
 *
 * `MenuPlanRepository`/`ProfileGateway`はいずれも`recipe-detail.service.test.ts`と同じ
 * 「フェイク依存＋設定可能な振る舞い、未使用メソッドは呼ばれたら例外を投げる」スタイルの
 * フェイクに差し替える。`EATING_OUT_REFERENCE_DATA`（task 13.4、既に実装・コミット済みの
 * 静的参照データ）は一切フェイクにせず実データをそのまま使い、テストフィクスチャ
 * （`mealSlot.nutrition.energyKcal`・`profile.ngIngredients`・対象`mealType`）を実データの
 * 実在エントリと整合するように手計算で構築する。
 */

const WEEK_START = "2026-09-07";
const DAY_INDEX = 3;

function buildMealSlotNutrition(energyKcal: number) {
  return {
    energyKcal,
    proteinG: 20,
    fatG: 10,
    carbG: 30,
    fiberG: 2,
    calciumMg: 50,
    ironMg: 1,
    vitaminAUg: 60,
    vitaminDUg: 1,
    vitaminB1Mg: 0.2,
    vitaminB2Mg: 0.2,
    vitaminCMg: 10,
    saltEquivalentG: 2,
  };
}

/** 対象食事枠のフィクスチャ。`energyKcal`のみをテストごとに差し替える。 */
function buildMealSlot(mealType: MealType, energyKcal: number) {
  return {
    id: 555,
    mealType,
    dishName: "★EatingOutSuggestionService検証用食事枠★",
    ingredients: [],
    nutrition: buildMealSlotNutrition(energyKcal),
  };
}

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

// --- フェイク依存（未使用メソッドは呼ばれたら例外を投げる） ---

function createFakeMenuPlanRepository(
  overrides: { findMealSlot?: MenuPlanRepository["findMealSlot"] } = {}
): MenuPlanRepository {
  return {
    getActivePlan: () => {
      throw new Error(
        "createFakeMenuPlanRepository: getActivePlan is not used by EatingOutSuggestionService"
      );
    },
    findOtherDays: (): OtherDayContext[] => {
      throw new Error(
        "createFakeMenuPlanRepository: findOtherDays is not used by EatingOutSuggestionService"
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
        "createFakeMenuPlanRepository: replaceWeek is not used by EatingOutSuggestionService"
      );
    },
    replaceDay: () => {
      throw new Error(
        "createFakeMenuPlanRepository: replaceDay is not used by EatingOutSuggestionService"
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

describe("createEatingOutSuggestionService", () => {
  describe("suggestForMealSlot — 対象食事枠が存在しない場合（Req 15.6）", () => {
    it("findMealSlotがnullを返す場合、NotFoundErrorを返し、profileGatewayは一切呼ばれない", () => {
      const menuPlanRepository = createFakeMenuPlanRepository({ findMealSlot: () => null });
      // getCurrentProfileが呼ばれたら例外を投げるフェイク（呼ばれないことの証明）。
      const profileGateway = createFakeProfileGateway();
      const service = createEatingOutSuggestionService(menuPlanRepository, profileGateway);

      const result = service.suggestForMealSlot(WEEK_START, DAY_INDEX, "lunch");

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected a failure result");
      }
      expect(result.error.type).toBe("not_found");
      expect(typeof result.error.message).toBe("string");
      expect(result.error.message.length).toBeGreaterThan(0);
    });
  });

  describe("suggestForMealSlot — プロフィール未登録の場合（null-profile graceful degradation）", () => {
    it("getCurrentProfileがnullを返す場合でもエラーにならず、フルの候補集合から選定した提案を返す（lunch, energyKcal=500 → とんこつラーメン→醤油ラーメン(500)が一意の最大値）", () => {
      const mealSlot = buildMealSlot("lunch", 500);
      const menuPlanRepository = createFakeMenuPlanRepository({ findMealSlot: () => mealSlot });
      const profileGateway = createFakeProfileGateway({ getCurrentProfile: () => null });
      const service = createEatingOutSuggestionService(menuPlanRepository, profileGateway);

      const result = service.suggestForMealSlot(WEEK_START, DAY_INDEX, "lunch");

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected a success result");
      }
      expect(result.value.suggestion).not.toBeNull();
      expect(result.value.suggestion).toEqual({
        typicalMenuName: "とんこつラーメン",
        typicalMenuKcal: 750,
        alternativeMenuName: "醤油ラーメン（中華そば）",
        alternativeMenuKcal: 500,
        proteinDeltaG: 22.0 - 28.0,
      });
    });
  });

  describe("suggestForMealSlot — NG食材による候補除外（Req 15.4）", () => {
    it('ngIngredientsに候補のingredientTagsと重複する食材（"麺"）が含まれる場合、その候補は除外され、別の候補が選定される（lunch, energyKcal=500: とんこつラーメン(tags: 豚肉,麺)が除外され、次点タイの先頭要素である牛丼（並盛）→銀鮭の塩焼定食(499)が選定される）', () => {
      const mealSlot = buildMealSlot("lunch", 500);
      const profile = buildProfile({ ngIngredients: ["麺"] });
      const menuPlanRepository = createFakeMenuPlanRepository({ findMealSlot: () => mealSlot });
      const profileGateway = createFakeProfileGateway({ getCurrentProfile: () => profile });
      const service = createEatingOutSuggestionService(menuPlanRepository, profileGateway);

      const result = service.suggestForMealSlot(WEEK_START, DAY_INDEX, "lunch");

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected a success result");
      }
      // NG食材除外がなければ選定されるはずだった「とんこつラーメン→醤油ラーメン」ではない。
      expect(result.value.suggestion?.typicalMenuName).not.toBe("とんこつラーメン");
      expect(result.value.suggestion).toEqual({
        typicalMenuName: "牛丼（並盛）",
        typicalMenuKcal: 633,
        alternativeMenuName: "銀鮭の塩焼定食",
        alternativeMenuKcal: 499,
        proteinDeltaG: 30.0 - 19.6,
      });
    });
  });

  describe("suggestForMealSlot — 候補が0件になる場合（Req 15.5、生成失敗ではない）", () => {
    it("対象energyKcalが該当mealTypeの全候補のalternativeMenuKcalを下回る場合（breakfast, energyKcal=5: 最小の代替候補は10kcal）、エラーではなくsuggestion: nullを返す", () => {
      const mealSlot = buildMealSlot("breakfast", 5);
      const menuPlanRepository = createFakeMenuPlanRepository({ findMealSlot: () => mealSlot });
      const profileGateway = createFakeProfileGateway({ getCurrentProfile: () => null });
      const service = createEatingOutSuggestionService(menuPlanRepository, profileGateway);

      const result = service.suggestForMealSlot(WEEK_START, DAY_INDEX, "breakfast");

      expect(result).toEqual({ ok: true, value: { suggestion: null } });
    });
  });

  describe("suggestForMealSlot — mealTypeによる候補の絞り込み（Req 15.5）", () => {
    it("対象mealTypeがsnackの場合、他mealType（lunch/dinner等）のより高カロリーな候補は選定されず、snack内の最大値（素焼きミックスナッツ150kcal）のみが選定される（energyKcal=700: mealType絞り込みが機能していなければdinnerの550kcal等が誤って選ばれてしまう）", () => {
      const mealSlot = buildMealSlot("snack", 700);
      const menuPlanRepository = createFakeMenuPlanRepository({ findMealSlot: () => mealSlot });
      const profileGateway = createFakeProfileGateway({ getCurrentProfile: () => null });
      const service = createEatingOutSuggestionService(menuPlanRepository, profileGateway);

      const result = service.suggestForMealSlot(WEEK_START, DAY_INDEX, "snack");

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected a success result");
      }
      expect(result.value.suggestion).toEqual({
        typicalMenuName: "ポテトチップス（1袋）",
        typicalMenuKcal: 330,
        alternativeMenuName: "素焼きミックスナッツ（小袋）",
        alternativeMenuKcal: 150,
        proteinDeltaG: 5.0 - 3.0,
      });
    });
  });

  describe("suggestForMealSlot — カロリー以下で最も近い候補の選定（Req 15.2）", () => {
    it("複数の適格候補（altKcal: 259, 299, 381, 499×3, 500）が存在する場合、energyKcal(500)を超えない中で最大の500（味噌ラーメン→醤油ラーメン）が選定され、550（カルボナーラ→和風きのこパスタ、energyKcalを超過）は選定されない（dinner, energyKcal=500）", () => {
      const mealSlot = buildMealSlot("dinner", 500);
      const menuPlanRepository = createFakeMenuPlanRepository({ findMealSlot: () => mealSlot });
      const profileGateway = createFakeProfileGateway({ getCurrentProfile: () => null });
      const service = createEatingOutSuggestionService(menuPlanRepository, profileGateway);

      const result = service.suggestForMealSlot(WEEK_START, DAY_INDEX, "dinner");

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected a success result");
      }
      expect(result.value.suggestion?.alternativeMenuKcal).toBe(500);
      expect(result.value.suggestion).toEqual({
        typicalMenuName: "味噌ラーメン",
        typicalMenuKcal: 700,
        alternativeMenuName: "醤油ラーメン（中華そば）",
        alternativeMenuKcal: 500,
        proteinDeltaG: 22.0 - 26.0,
      });
    });
  });

  describe("suggestForMealSlot — proteinDeltaGが負になる場合（Req 15.3）", () => {
    it("代替メニューのたんぱく質量が typicalMenu より少ない実在エントリ（親子丼→かけうどん: 9.5 - 28.0 = -18.5）で、proteinDeltaGが手計算どおりの負値になる（dinner, energyKcal=299）", () => {
      const mealSlot = buildMealSlot("dinner", 299);
      const menuPlanRepository = createFakeMenuPlanRepository({ findMealSlot: () => mealSlot });
      const profileGateway = createFakeProfileGateway({ getCurrentProfile: () => null });
      const service = createEatingOutSuggestionService(menuPlanRepository, profileGateway);

      const result = service.suggestForMealSlot(WEEK_START, DAY_INDEX, "dinner");

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected a success result");
      }
      expect(result.value.suggestion?.proteinDeltaG).toBe(-18.5);
      expect(result.value.suggestion).toEqual({
        typicalMenuName: "親子丼（並盛）",
        typicalMenuKcal: 650,
        alternativeMenuName: "かけうどん（並）",
        alternativeMenuKcal: 299,
        proteinDeltaG: -18.5,
      });
    });
  });

  describe("suggestForMealSlot — フィールドの正しい射影（フィールド入れ替えがないこと）", () => {
    it("選定されたエントリのtypicalMenuName/typicalMenuKcal/alternativeMenuName/alternativeMenuKcalが、参照データの対応するフィールドと一切入れ替わっていない（lunch, energyKcal=218 → マックチキン→オリジナルチキンが一意の適格候補）", () => {
      const mealSlot = buildMealSlot("lunch", 218);
      const menuPlanRepository = createFakeMenuPlanRepository({ findMealSlot: () => mealSlot });
      const profileGateway = createFakeProfileGateway({ getCurrentProfile: () => null });
      const service = createEatingOutSuggestionService(menuPlanRepository, profileGateway);

      const result = service.suggestForMealSlot(WEEK_START, DAY_INDEX, "lunch");

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected a success result");
      }
      const suggestion = result.value.suggestion;
      expect(suggestion).not.toBeNull();
      expect(suggestion?.typicalMenuName).toBe("マックチキン");
      expect(suggestion?.typicalMenuKcal).toBe(386);
      expect(suggestion?.alternativeMenuName).toBe("オリジナルチキン（1ピース）");
      expect(suggestion?.alternativeMenuKcal).toBe(218);
      expect(suggestion?.proteinDeltaG).toBe(16.5 - 13.5);
    });
  });
});
