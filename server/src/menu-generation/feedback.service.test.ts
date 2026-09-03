import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MealSlot, MealType } from "@nutrition/shared";
import { createConnection } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import {
  createFeedbackRepository,
  type FeedbackRepository,
  type SatisfactionFeedbackEntry,
} from "./feedback.repository.js";
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

/**
 * task 11.3: FeedbackService の実DB統合テスト（Req 10.3, 10.5）。
 *
 * 上の `describe("createFeedbackService", ...)` ブロックは `FeedbackRepository` /
 * `MenuPlanRepository` の両方をフェイクに差し替え、`FeedbackService` 自身の
 * オーケストレーションロジック（存在確認 → スナップショット組み立て → upsert呼び出しの
 * 引数、苦手サマリのマッピング）のみを検証していた。`FeedbackRepository` 自体の正しさは
 * `feedback.repository.test.ts`（実DB越し、task 7.1）で既に検証済みだが、その2つを
 * 合成した「`FeedbackService.recordFeedback` を実際の `FeedbackRepository`（実DB）に対して
 * 複数回呼び出した結果、本当に最新値のみが残るか」（Req 10.5）や「liked:trueのフィードバックが
 * `getDislikedSummary` に現れないことを、あらかじめ苦手のみにフィルタ済みのフェイクではなく
 * 実Repositoryの `WHERE liked = 0` フィルタリングを通して証明できるか」（Req 10.3）は、
 * 上記いずれのテストでも直接には検証されない（フェイクの `findRecentDisliked` はテストが
 * 用意した戻り値をそのまま返すだけで、実際のSQLフィルタリングを経由しない）。
 *
 * ここでは `feedback.repository.test.ts` と同じ `createConnection` + `runMigrations` の
 * 実一時SQLiteデータベースセットアップを再利用し、`createFeedbackRepository`
 * （フェイクではなく実実装）を `createFeedbackService` に注入する。`MenuPlanRepository` 側は
 * `FeedbackService.recordFeedback` が `findMealSlot` の戻り値（`MealSlot`）以外に一切依存
 * しないため（`feedback.service.ts` 冒頭コメント参照）、上のdescribeブロックで既に定義済みの
 * `createFakeMenuPlanRepository`/`buildMealSlot` ヘルパーをそのまま再利用する
 * （本ブロックの検証対象はあくまで `FeedbackRepository` 側の実際の永続化・クエリ挙動であり、
 * `MenuPlanRepository` 側まで実DB化する必要はない）。
 */
describe("createFeedbackService — 実DB統合テスト（FeedbackRepositoryを実DB越しに使用、Req 10.3, 10.5）", () => {
  let tmpDir: string;
  let db: Database.Database;
  let feedbackRepository: FeedbackRepository;

  beforeEach(() => {
    tmpDir = mkdtempSync(
      path.join(os.tmpdir(), "nutrition-feedback-service-integration-test-")
    );
    const dbPath = path.join(tmpDir, "test.db");
    db = createConnection(dbPath);
    runMigrations(db);
    feedbackRepository = createFeedbackRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("recordFeedback — 同一食事枠インスタンスへの複数回フィードバックで最新値のみが残る（Req 10.5）", () => {
    it("同一(weekStartDate, dayIndex, mealType)への2回目のrecordFeedback（異なるスナップショット・同じliked:false）は、実DB上で1回目の値を完全に置き換える（重複行も残存も起きない）", () => {
      let currentSlot: MealSlot & { id: number };
      const menuPlanRepository = createFakeMenuPlanRepository({
        findMealSlot: () => currentSlot,
      });
      const service = createFeedbackService(feedbackRepository, menuPlanRepository);

      // 1回目: liked:false、旧スナップショット
      currentSlot = buildMealSlot({
        mealType: "dinner",
        dishName: "★10.5検証_旧スナップショット_豚の生姜焼き★",
        ingredients: [{ foodId: "91001", quantity: 100, unit: "g" }],
      });
      const firstResult = service.recordFeedback("2026-09-14", 5, "dinner", { liked: false });
      expect(firstResult).toEqual({ ok: true, value: undefined });

      // 1回目の時点では苦手サマリに「旧スナップショット」が現れることを確認しておく
      // （2回目の後で本当に置き換わったことと対比するための事前確認）
      expect(service.getDislikedSummary()).toEqual([
        { dishName: "★10.5検証_旧スナップショット_豚の生姜焼き★", foodIds: ["91001"] },
      ]);

      // 2回目: 同一の(weekStartDate=2026-09-14, dayIndex=5, mealType=dinner)に対し、
      // 異なるdishName/ingredients（日単位/週単位再生成で料理が置き換わった想定）・
      // 同じliked:falseで記録する
      currentSlot = buildMealSlot({
        mealType: "dinner",
        dishName: "★10.5検証_新スナップショット_鮭の塩焼き★",
        ingredients: [
          { foodId: "92001", quantity: 80, unit: "g" },
          { foodId: "92002", quantity: 1, unit: "個" },
        ],
      });
      const secondResult = service.recordFeedback("2026-09-14", 5, "dinner", { liked: false });
      expect(secondResult).toEqual({ ok: true, value: undefined });

      // 実DBの生の行を直接確認: 同一トリプルに対する行が1件のみ存在し（重複行が作られていない）、
      // その内容が2回目の値で完全に置き換わっている（1回目の値が残っていない）
      const rawRows = db
        .prepare(
          `SELECT dish_name, primary_food_ids, liked
             FROM satisfaction_feedback
            WHERE week_start_date = ? AND day_index = ? AND meal_type = ?`
        )
        .all("2026-09-14", 5, "dinner") as {
        dish_name: string;
        primary_food_ids: string;
        liked: number;
      }[];
      expect(rawRows).toHaveLength(1);
      expect(rawRows[0]?.dish_name).toBe("★10.5検証_新スナップショット_鮭の塩焼き★");
      expect(JSON.parse(rawRows[0]?.primary_food_ids ?? "null")).toEqual(["92001", "92002"]);
      expect(rawRows[0]?.liked).toBe(0);

      // getDislikedSummary経由（Service→実Repository）でも同じことを確認する:
      // 新スナップショットのみが1件返り、旧スナップショットは影も形もない
      // （重複でも古い値でもない）
      const summaryAfterSecond = service.getDislikedSummary();
      expect(summaryAfterSecond).toEqual([
        { dishName: "★10.5検証_新スナップショット_鮭の塩焼き★", foodIds: ["92001", "92002"] },
      ]);
      expect(
        summaryAfterSecond.some(
          (item) => item.dishName === "★10.5検証_旧スナップショット_豚の生姜焼き★"
        )
      ).toBe(false);
    });

    it("同一食事枠インスタンスへの2回目のフィードバックでliked値がfalse→trueに変わった場合、実DB上でも行は1件のみに更新され、getDislikedSummaryから完全に除外される", () => {
      let currentSlot: MealSlot & { id: number };
      const menuPlanRepository = createFakeMenuPlanRepository({
        findMealSlot: () => currentSlot,
      });
      const service = createFeedbackService(feedbackRepository, menuPlanRepository);

      currentSlot = buildMealSlot({
        mealType: "lunch",
        dishName: "★10.5境界検証_最初は苦手★",
        ingredients: [{ foodId: "93001", quantity: 50, unit: "g" }],
      });
      service.recordFeedback("2026-09-14", 6, "lunch", { liked: false });
      expect(service.getDislikedSummary().map((entry) => entry.dishName)).toEqual([
        "★10.5境界検証_最初は苦手★",
      ]);

      currentSlot = buildMealSlot({
        mealType: "lunch",
        dishName: "★10.5境界検証_更新後は好き★",
        ingredients: [{ foodId: "93002", quantity: 50, unit: "g" }],
      });
      const result = service.recordFeedback("2026-09-14", 6, "lunch", { liked: true });
      expect(result).toEqual({ ok: true, value: undefined });

      // 実DB: 同一トリプルの行数は依然として1件のみ（liked更新でも重複行が作られない）
      const countRow = db
        .prepare(
          `SELECT COUNT(*) as count FROM satisfaction_feedback
            WHERE week_start_date = ? AND day_index = ? AND meal_type = ?`
        )
        .get("2026-09-14", 6, "lunch") as { count: number };
      expect(countRow.count).toBe(1);

      const raw = db
        .prepare(
          `SELECT dish_name, liked FROM satisfaction_feedback
            WHERE week_start_date = ? AND day_index = ? AND meal_type = ?`
        )
        .get("2026-09-14", 6, "lunch") as { dish_name: string; liked: number };
      expect(raw.dish_name).toBe("★10.5境界検証_更新後は好き★");
      expect(raw.liked).toBe(1);

      // liked:trueに更新された後は、getDislikedSummaryから完全に除外される
      // （古いliked:falseの値も、新しいdishNameも、どちらも現れない）
      const summary = service.getDislikedSummary();
      expect(summary.some((entry) => entry.dishName === "★10.5境界検証_最初は苦手★")).toBe(
        false
      );
      expect(
        summary.some((entry) => entry.dishName === "★10.5境界検証_更新後は好き★")
      ).toBe(false);
    });
  });

  describe("getDislikedSummary — liked:trueのフィードバックが苦手サマリに含まれない（Req 10.3、複数インスタンス混在）", () => {
    it("複数の異なる食事枠インスタンスに対しliked:true/falseを混在させてrecordFeedbackした場合、実DBを経由したgetDislikedSummaryにはliked:falseのインスタンスのみが現れ、liked:trueのインスタンスは一切現れない", () => {
      const instances: {
        dayIndex: number;
        mealType: MealType;
        dishName: string;
        foodId: string;
        liked: boolean;
      }[] = [
        {
          dayIndex: 0,
          mealType: "breakfast",
          dishName: "★10.3検証_好きA_トースト★",
          foodId: "81001",
          liked: true,
        },
        {
          dayIndex: 0,
          mealType: "lunch",
          dishName: "★10.3検証_苦手A_納豆★",
          foodId: "81002",
          liked: false,
        },
        {
          dayIndex: 1,
          mealType: "dinner",
          dishName: "★10.3検証_好きB_カレー★",
          foodId: "81003",
          liked: true,
        },
        {
          dayIndex: 1,
          mealType: "snack",
          dishName: "★10.3検証_苦手B_レバー★",
          foodId: "81004",
          liked: false,
        },
        {
          dayIndex: 2,
          mealType: "breakfast",
          dishName: "★10.3検証_苦手C_ゴーヤ★",
          foodId: "81005",
          liked: false,
        },
      ];

      for (const instance of instances) {
        const slot = buildMealSlot({
          mealType: instance.mealType,
          dishName: instance.dishName,
          ingredients: [{ foodId: instance.foodId, quantity: 100, unit: "g" }],
        });
        const menuPlanRepository = createFakeMenuPlanRepository({ findMealSlot: () => slot });
        const service = createFeedbackService(feedbackRepository, menuPlanRepository);
        const result = service.recordFeedback(
          "2026-09-21",
          instance.dayIndex,
          instance.mealType,
          { liked: instance.liked }
        );
        expect(result).toEqual({ ok: true, value: undefined });
      }

      const service = createFeedbackService(feedbackRepository, createFakeMenuPlanRepository());
      const summary = service.getDislikedSummary(10);

      // liked:falseの3件のみが現れる（水増しも欠落もない）
      expect(summary).toHaveLength(3);
      const dislikedNames = summary.map((entry) => entry.dishName).sort();
      expect(dislikedNames).toEqual(
        ["★10.3検証_苦手A_納豆★", "★10.3検証_苦手B_レバー★", "★10.3検証_苦手C_ゴーヤ★"].sort()
      );

      // liked:trueの2件は「未検証」ではなく積極的に「含まれていない」ことを確認する
      expect(dislikedNames).not.toContain("★10.3検証_好きA_トースト★");
      expect(dislikedNames).not.toContain("★10.3検証_好きB_カレー★");
      expect(summary.some((entry) => entry.foodIds.includes("81001"))).toBe(false);
      expect(summary.some((entry) => entry.foodIds.includes("81003"))).toBe(false);
    });
  });
});
