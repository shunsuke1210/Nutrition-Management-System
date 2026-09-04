import { MealTypeSchema } from "@nutrition/shared";
import { describe, expect, it } from "vitest";
import {
  EATING_OUT_REFERENCE_DATA,
  type EatingOutCategory,
  type EatingOutReferenceEntry,
} from "./eating-out-reference.data.js";

/**
 * `eating-out-reference.data.ts`（task 13.4）のテスト。
 *
 * このファイル自身の完了条件（tasks.md task 13.4本文）である「各エントリについて
 * 代替案のカロリーが基準メニューのカロリー以下であることを確認する」を全件について
 * 検証することが中心の目的であり、加えて要件15.1/15.2/15.7が前提とする参照データの
 * 構造的な整合性（非空文字列・正の数値・有効なmealType・非空のingredientTags）と、
 * tasks.mdが要求する「数十件規模」「丼もの・定食・麺類・ファストフード等の代表的な
 * 外食シーンを横断」「4 mealType全てをカバーする」という定量的なカバレッジ条件を検証する。
 *
 * `EatingOutSuggestionService`（task 13.5、未着手）が実際に行う「NG食材による除外」
 * 「energy_kcal以下で最も近い候補の選定」というロジック自体はこのファイルの責務ではない
 * （Boundary: eating-out-reference.data）ため、ここではテストしない。
 */

const ALL_MEAL_TYPES = MealTypeSchema.options;

const ALL_CATEGORIES: readonly EatingOutCategory[] = [
  "丼もの",
  "定食",
  "麺類",
  "ファストフード",
  "カレー",
  "その他",
];

describe("EATING_OUT_REFERENCE_DATA", () => {
  it("少なくとも30件のエントリを持つ（tasks.mdの「数十件規模」という規模要求）", () => {
    expect(EATING_OUT_REFERENCE_DATA.length).toBeGreaterThanOrEqual(30);
  });

  it("全エントリについて、代替案のカロリーが基準メニューのカロリー以下である（task 13.4本文自身の完了条件、要件15.2）", () => {
    for (const entry of EATING_OUT_REFERENCE_DATA) {
      expect(entry.alternativeMenuKcal).toBeLessThanOrEqual(entry.typicalMenuKcal);
    }
  });

  describe("データ整合性（基本的な構造検証）", () => {
    it("全エントリのtypicalMenuName/alternativeMenuNameが非空文字列である", () => {
      for (const entry of EATING_OUT_REFERENCE_DATA) {
        expect(entry.typicalMenuName.length).toBeGreaterThan(0);
        expect(entry.alternativeMenuName.length).toBeGreaterThan(0);
      }
    });

    it("全エントリのtypicalMenuKcal/alternativeMenuKcalが正の数値である", () => {
      for (const entry of EATING_OUT_REFERENCE_DATA) {
        expect(entry.typicalMenuKcal).toBeGreaterThan(0);
        expect(entry.alternativeMenuKcal).toBeGreaterThan(0);
      }
    });

    it("全エントリのtypicalMenuProteinG/alternativeMenuProteinGが正の数値である", () => {
      for (const entry of EATING_OUT_REFERENCE_DATA) {
        expect(entry.typicalMenuProteinG).toBeGreaterThan(0);
        expect(entry.alternativeMenuProteinG).toBeGreaterThan(0);
      }
    });

    it("全エントリのmealTypeが、@nutrition/sharedのMealTypeSchemaが定義する4値のいずれかである", () => {
      for (const entry of EATING_OUT_REFERENCE_DATA) {
        expect(ALL_MEAL_TYPES).toContain(entry.mealType);
        expect(MealTypeSchema.safeParse(entry.mealType).success).toBe(true);
      }
    });

    it("全エントリのingredientTagsが非空配列であり、各タグが非空文字列である", () => {
      for (const entry of EATING_OUT_REFERENCE_DATA) {
        expect(entry.ingredientTags.length).toBeGreaterThan(0);
        for (const tag of entry.ingredientTags) {
          expect(typeof tag).toBe("string");
          expect(tag.length).toBeGreaterThan(0);
        }
      }
    });

    it("全エントリのcategoryが、本ファイルが定義する固定6分類のいずれかである", () => {
      for (const entry of EATING_OUT_REFERENCE_DATA) {
        expect(ALL_CATEGORIES).toContain(entry.category);
      }
    });
  });

  describe("mealType別のカバレッジ（要件が朝食・間食の候補も要求するため、lunch/dinnerに偏らせない）", () => {
    function countByMealType(mealType: EatingOutReferenceEntry["mealType"]): number {
      return EATING_OUT_REFERENCE_DATA.filter((entry) => entry.mealType === mealType).length;
    }

    it.each(ALL_MEAL_TYPES)("mealType '%s' のエントリが少なくとも5件存在する", (mealType) => {
      expect(countByMealType(mealType)).toBeGreaterThanOrEqual(5);
    });

    it("4 mealTypeすべての合計がEATING_OUT_REFERENCE_DATA全体の件数と一致する（mealTypeの値が4値以外に漏れていないことの確認）", () => {
      const total = ALL_MEAL_TYPES.reduce((sum, mealType) => sum + countByMealType(mealType), 0);
      expect(total).toBe(EATING_OUT_REFERENCE_DATA.length);
    });
  });

  describe("category別のカバレッジ（丼もの・定食・麺類・ファストフード等の代表的な外食シーンを横断すること）", () => {
    function countByCategory(category: EatingOutCategory): number {
      return EATING_OUT_REFERENCE_DATA.filter((entry) => entry.category === category).length;
    }

    it("丼もの・定食・麺類・ファストフードのそれぞれについて、少なくとも1件以上のエントリが存在する（tasks.mdが明示する4シーン横断の要求）", () => {
      expect(countByCategory("丼もの")).toBeGreaterThan(0);
      expect(countByCategory("定食")).toBeGreaterThan(0);
      expect(countByCategory("麺類")).toBeGreaterThan(0);
      expect(countByCategory("ファストフード")).toBeGreaterThan(0);
    });
  });
});
