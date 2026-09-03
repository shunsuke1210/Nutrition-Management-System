import { describe, expect, it, vi } from "vitest";
import type { MealSlot, MealType } from "@nutrition/shared";
import type { FeedbackRepository, SatisfactionFeedbackEntry } from "./feedback.repository.js";
import type { MenuPlanRepository, OtherDayContext } from "./menu-plan.repository.js";
import type { DislikedItemSummary } from "./menu-prompt.builder.js";
import { createFeedbackService } from "./feedback.service.js";

/**
 * FeedbackService（task 7.2）のテスト。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #FeedbackService、
 * Requirements 10.1, 10.3, 10.4）に定義された挙動を、`FeedbackRepository` /
 * `MenuPlanRepository`（いずれも実装済み・テスト済み）を実DB越しに使わず、挙動を固定した
 * フェイクに差し替えて検証する。`nutrition-verification.service.test.ts` の
 * `createFakeFoodCompositionRepository`（フェイク依存＋設定可能な振る舞い、未使用メソッドは
 * 呼ばれたら例外を投げる）と同じスタイルに倣う。
 *
 * `FeedbackRepository` / `MenuPlanRepository` 自体の正しさはそれぞれの専用テストで
 * 既に検証済みのため、本テストは `FeedbackService` 自身のオーケストレーションロジック
 * （存在確認 → スナップショット組み立て → upsert呼び出し、苦手サマリのマッピング）のみを
 * 検証する。
 */

/** `FeedbackService` が呼び出す唯一のメソッドは `upsert` のみ（`recordFeedback`）。 */
function createFakeFeedbackRepository(
  overrides: {
    upsert?: FeedbackRepository["upsert"];
    findRecentDisliked?: FeedbackRepository["findRecentDisliked"];
  } = {}
): FeedbackRepository {
  return {
    upsert:
      overrides.upsert ??
      (() => {
        throw new Error(
          "createFakeFeedbackRepository: upsert was not expected to be called in this test"
        );
      }),
    findRecentDisliked:
      overrides.findRecentDisliked ??
      (() => {
        throw new Error(
          "createFakeFeedbackRepository: findRecentDisliked was not expected to be called in this test"
        );
      }),
  };
}

/** `FeedbackService` が呼び出す唯一のメソッドは `findMealSlot` のみ（`recordFeedback`）。 */
function createFakeMenuPlanRepository(
  overrides: {
    findMealSlot?: MenuPlanRepository["findMealSlot"];
  } = {}
): MenuPlanRepository {
  return {
    getActivePlan: () => {
      throw new Error(
        "createFakeMenuPlanRepository: getActivePlan is not used by FeedbackService"
      );
    },
    findOtherDays: (): OtherDayContext[] => {
      throw new Error(
        "createFakeMenuPlanRepository: findOtherDays is not used by FeedbackService"
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
      throw new Error("createFakeMenuPlanRepository: replaceWeek is not used by FeedbackService");
    },
    replaceDay: () => {
      throw new Error("createFakeMenuPlanRepository: replaceDay is not used by FeedbackService");
    },
  };
}

/**
 * ダミーの `SatisfactionFeedbackEntry`（`upsert` フェイクの戻り値組み立て用）。
 * `recordFeedback` はこの戻り値を呼び出し元へ返さない（design.md Service Interface:
 * `Result<void, ...>`）ため、内容自体はテストの主眼ではない。
 */
function buildStoredEntry(
  overrides: Partial<SatisfactionFeedbackEntry> = {}
): SatisfactionFeedbackEntry {
  return {
    weekStartDate: "2026-09-07",
    dayIndex: 0,
    mealType: "breakfast",
    dishName: "ダミー",
    primaryFoodIds: [],
    liked: true,
    updatedAt: "2026-09-07T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * 他のテストで通常使われる食品ID（例: "10001" 白米, "11001" 鶏むね肉）とは明確に区別できる、
 * このテストファイル専用の食品ID・料理名を用いる `MealSlot`。スナップショットが本当に
 * meal slot から読み取られていること（ハードコードされた値ではないこと）を証明するため。
 */
function buildMealSlot(overrides: Partial<MealSlot> = {}): MealSlot & { id: number } {
  return {
    id: 4242,
    mealType: "lunch",
    dishName: "★スナップショット検証用_特製唐揚げ弁当★",
    ingredients: [
      { foodId: "77701", quantity: 120, unit: "g" },
      { foodId: "77702", quantity: 2, unit: "個" },
      { foodId: "77703", quantity: 5, unit: "g" },
    ],
    nutrition: {
      energyKcal: 650,
      proteinG: 30,
      fatG: 25,
      carbG: 70,
      fiberG: 3,
      calciumMg: 40,
      ironMg: 1.5,
      vitaminAUg: 20,
      vitaminDUg: 0.5,
      vitaminB1Mg: 0.2,
      vitaminB2Mg: 0.2,
      vitaminCMg: 10,
      saltEquivalentG: 2,
    },
    ...overrides,
  };
}

describe("createFeedbackService", () => {
  describe("recordFeedback — 存在する食事枠へのフィードバック記録（Req 10.1, 10.2）", () => {
    it("meal slotが存在する場合、その料理名・食材の食品ID全件をスナップショットとしてupsertへ渡し、Result.ok(undefined)を返す", () => {
      const mealSlot = buildMealSlot();
      const menuPlanRepository = createFakeMenuPlanRepository({
        findMealSlot: (weekStartDate, dayIndex, mealType) => {
          expect(weekStartDate).toBe("2026-09-07");
          expect(dayIndex).toBe(2);
          expect(mealType).toBe("lunch");
          return mealSlot;
        },
      });
      const upsert = vi.fn((entry) => buildStoredEntry(entry));
      const feedbackRepository = createFakeFeedbackRepository({ upsert });
      const service = createFeedbackService(feedbackRepository, menuPlanRepository);

      const result = service.recordFeedback("2026-09-07", 2, "lunch", { liked: false });

      expect(result).toEqual({ ok: true, value: undefined });
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenCalledWith({
        weekStartDate: "2026-09-07",
        dayIndex: 2,
        mealType: "lunch",
        dishName: "★スナップショット検証用_特製唐揚げ弁当★",
        primaryFoodIds: ["77701", "77702", "77703"],
        liked: false,
      });
    });

    it("liked:trueの入力の場合、upsertへ渡すliked値もtrueになる（入力のlikedをそのまま伝播する）", () => {
      const mealSlot = buildMealSlot();
      const menuPlanRepository = createFakeMenuPlanRepository({
        findMealSlot: () => mealSlot,
      });
      const upsert = vi.fn((entry) => buildStoredEntry(entry));
      const feedbackRepository = createFakeFeedbackRepository({ upsert });
      const service = createFeedbackService(feedbackRepository, menuPlanRepository);

      const result = service.recordFeedback("2026-09-07", 2, "lunch", { liked: true });

      expect(result).toEqual({ ok: true, value: undefined });
      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ liked: true }));
    });
  });

  describe("recordFeedback — 存在しない食事枠（Req: NotFoundError, design.md Responsibilities）", () => {
    it("findMealSlotがnullを返す場合、NotFoundErrorのResultを返し、upsertは一切呼ばれない", () => {
      const menuPlanRepository = createFakeMenuPlanRepository({
        findMealSlot: () => null,
      });
      // upsertを一切設定しない上記のフェイク既定動作（呼ばれたら例外を投げる）で、
      // 呼び出しがあれば本テスト自体が例外により失敗する。
      const feedbackRepository = createFakeFeedbackRepository();
      const service = createFeedbackService(feedbackRepository, menuPlanRepository);

      const result = service.recordFeedback("2099-01-05", 6, "snack", { liked: true });

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected a failure result");
      }
      expect(result.error.type).toBe("not_found");
      expect(typeof result.error.message).toBe("string");
      expect(result.error.message.length).toBeGreaterThan(0);
    });
  });

  describe("recordFeedback — 食事枠ごとの独立性（Req 10.4）", () => {
    it("同一のweekStartDate/dayIndexでもmealTypeが異なる2回の呼び出しは、それぞれ独立に成功し、異なるmealTypeを持つ別々のupsert呼び出しを生成する", () => {
      const breakfastSlot = buildMealSlot({
        mealType: "breakfast",
        dishName: "朝食スロット",
        ingredients: [{ foodId: "88801", quantity: 1, unit: "個" }],
      });
      const dinnerSlot = buildMealSlot({
        mealType: "dinner",
        dishName: "夕食スロット",
        ingredients: [{ foodId: "88802", quantity: 1, unit: "個" }],
      });

      const findMealSlot = vi.fn((_weekStartDate: string, _dayIndex: number, mealType: MealType) => {
        if (mealType === "breakfast") return breakfastSlot;
        if (mealType === "dinner") return dinnerSlot;
        throw new Error(`unexpected mealType in test: ${mealType}`);
      });
      const menuPlanRepository = createFakeMenuPlanRepository({ findMealSlot });
      const upsert = vi.fn((entry) => buildStoredEntry(entry));
      const feedbackRepository = createFakeFeedbackRepository({ upsert });
      const service = createFeedbackService(feedbackRepository, menuPlanRepository);

      const breakfastResult = service.recordFeedback("2026-09-07", 3, "breakfast", {
        liked: true,
      });
      const dinnerResult = service.recordFeedback("2026-09-07", 3, "dinner", { liked: false });

      expect(breakfastResult).toEqual({ ok: true, value: undefined });
      expect(dinnerResult).toEqual({ ok: true, value: undefined });
      expect(upsert).toHaveBeenCalledTimes(2);
      expect(upsert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          mealType: "breakfast",
          dishName: "朝食スロット",
          primaryFoodIds: ["88801"],
          liked: true,
        })
      );
      expect(upsert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          mealType: "dinner",
          dishName: "夕食スロット",
          primaryFoodIds: ["88802"],
          liked: false,
        })
      );
    });
  });

  describe("getDislikedSummary — デフォルトの上限件数", () => {
    it("limit引数を省略した場合、選んだデフォルト上限（10）でfindRecentDislikedを呼び出す", () => {
      const findRecentDisliked = vi.fn((limit: number) =>
        Array.from({ length: Math.min(limit, 15) }, (_, i) =>
          buildStoredEntry({ dishName: `苦手${i}`, primaryFoodIds: [`9${i}`] })
        )
      );
      const feedbackRepository = createFakeFeedbackRepository({ findRecentDisliked });
      const menuPlanRepository = createFakeMenuPlanRepository();
      const service = createFeedbackService(feedbackRepository, menuPlanRepository);

      const summary = service.getDislikedSummary();

      expect(findRecentDisliked).toHaveBeenCalledTimes(1);
      expect(findRecentDisliked).toHaveBeenCalledWith(10);
      expect(summary).toHaveLength(10);
    });
  });

  describe("getDislikedSummary — 明示的なlimit指定", () => {
    it("limit引数を明示的に渡した場合、その値をそのままfindRecentDislikedへ渡す", () => {
      const findRecentDisliked = vi.fn((limit: number) =>
        Array.from({ length: limit }, (_, i) => buildStoredEntry({ dishName: `苦手${i}` }))
      );
      const feedbackRepository = createFakeFeedbackRepository({ findRecentDisliked });
      const menuPlanRepository = createFakeMenuPlanRepository();
      const service = createFeedbackService(feedbackRepository, menuPlanRepository);

      const summary = service.getDislikedSummary(3);

      expect(findRecentDisliked).toHaveBeenCalledTimes(1);
      expect(findRecentDisliked).toHaveBeenCalledWith(3);
      expect(summary).toHaveLength(3);
    });
  });

  describe("getDislikedSummary — SatisfactionFeedbackEntry → DislikedItemSummaryのマッピング", () => {
    it("dishNameを保持し、primaryFoodIdsをfoodIdsへマッピングする（フィールド入れ替わりを検出できるよう明確に区別可能な値を使用）", () => {
      const entry = buildStoredEntry({
        dishName: "苦手認定_激辛麻婆豆腐",
        primaryFoodIds: ["55501", "55502"],
        liked: false,
      });
      const feedbackRepository = createFakeFeedbackRepository({
        findRecentDisliked: () => [entry],
      });
      const menuPlanRepository = createFakeMenuPlanRepository();
      const service = createFeedbackService(feedbackRepository, menuPlanRepository);

      const summary = service.getDislikedSummary(1);

      const expected: DislikedItemSummary = {
        dishName: "苦手認定_激辛麻婆豆腐",
        foodIds: ["55501", "55502"],
      };
      expect(summary).toEqual([expected]);
    });
  });

  describe("getDislikedSummary — MenuPlanRepositoryへの非依存", () => {
    it("MenuPlanRepositoryの全メソッドが呼ばれたら例外を投げるフェイクでも、getDislikedSummaryは問題なく完了する", () => {
      const feedbackRepository = createFakeFeedbackRepository({
        findRecentDisliked: () => [buildStoredEntry()],
      });
      // オーバーライドなし: 全メソッドが「呼ばれたら例外」のフェイク。
      const menuPlanRepository = createFakeMenuPlanRepository();
      const service = createFeedbackService(feedbackRepository, menuPlanRepository);

      expect(() => service.getDislikedSummary()).not.toThrow();
    });
  });
});
