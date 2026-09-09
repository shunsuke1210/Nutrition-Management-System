import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { MealTypeSchema } from "@nutrition/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import {
  createFoodCompositionRepository,
  type FoodCompositionRepository,
} from "./food-composition.repository.js";
import { RULE_BASED_RECIPES } from "./rule-based-recipe.data.js";

/**
 * `rule-based-recipe.data.ts`（task 17.2）のテスト。
 *
 * 最重要の検証項目は「本ファイルの全 `foodId` が実際に `010_seed_food_items.sql` に投入される
 * 食品IDと一致すること」である。存在しない食品IDを1件でも含めると、`RuleBasedMenuGenerator`
 * （task 17.3以降）が生成する献立が `NutritionVerificationService.verifyDish` で
 * `food_id_not_found` エラーとなり、後続タスクが根本的に動作しなくなるため、目視確認だけに
 * 頼らず実際の一時SQLiteDBに対して機械的に検証する（`food-composition.repository.test.ts` の
 * precedentに倣う。モック・フェイクは使用しない）。
 *
 * それ以外の検証は tasks.md task 17.2本文の完了条件（各mealType最低10品・計40品以上、
 * quantity正数・unit"g"、restrictionSuitabilityへの"none"の必須含有、dishName一意性）を
 * 満たすことを機械的に確認する。
 */

const ALL_MEAL_TYPES = MealTypeSchema.options;

describe("RULE_BASED_RECIPES", () => {
  describe("実在する食品IDのみを使用していること（実DBに対する検証、最重要）", () => {
    let tmpDir: string;
    let db: Database.Database;
    let repository: FoodCompositionRepository;

    beforeEach(() => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-rule-based-recipe-test-"));
      const dbPath = path.join(tmpDir, "test.db");
      db = createConnection(dbPath);
      runMigrations(db);
      repository = createFoodCompositionRepository(db);
    });

    afterEach(() => {
      db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("全エントリの全ingredients[].foodIdが010_seed_food_items.sqlに実在する食品IDである", () => {
      const validFoodIds = new Set(repository.listAllIds());
      expect(validFoodIds.size).toBeGreaterThan(0);

      const unknownFoodIds: string[] = [];
      for (const entry of RULE_BASED_RECIPES) {
        for (const ingredient of entry.ingredients) {
          if (!validFoodIds.has(ingredient.foodId)) {
            unknownFoodIds.push(`${entry.dishName}: ${ingredient.foodId}`);
          }
        }
      }

      expect(unknownFoodIds).toEqual([]);
    });
  });

  describe("データ整合性（基本的な構造検証）", () => {
    it("dishNameが非空文字列であり、全エントリでユニークである", () => {
      const names = RULE_BASED_RECIPES.map((entry) => entry.dishName);
      for (const name of names) {
        expect(name.length).toBeGreaterThan(0);
      }
      expect(new Set(names).size).toBe(names.length);
    });

    it("全エントリのmealTypeが@nutrition/sharedのMealTypeSchemaが定義する4値のいずれかである", () => {
      for (const entry of RULE_BASED_RECIPES) {
        expect(ALL_MEAL_TYPES).toContain(entry.mealType);
        expect(MealTypeSchema.safeParse(entry.mealType).success).toBe(true);
      }
    });

    it("全エントリのingredientsが1〜8件であり、各quantityが正数、各unitが'g'である（単一食材のシンプルな間食から調味料込みの手の込んだ主菜まで幅を許容する）", () => {
      for (const entry of RULE_BASED_RECIPES) {
        expect(entry.ingredients.length).toBeGreaterThanOrEqual(1);
        expect(entry.ingredients.length).toBeLessThanOrEqual(8);
        for (const ingredient of entry.ingredients) {
          expect(ingredient.foodId.length).toBeGreaterThan(0);
          expect(ingredient.quantity).toBeGreaterThan(0);
          expect(ingredient.unit).toBe("g");
        }
      }
    });

    it("全エントリのtagsが非空配列であり、各タグが非空文字列である", () => {
      for (const entry of RULE_BASED_RECIPES) {
        expect(entry.tags.length).toBeGreaterThan(0);
        for (const tag of entry.tags) {
          expect(typeof tag).toBe("string");
          expect(tag.length).toBeGreaterThan(0);
        }
      }
    });

    it("foodId '01088'（ごはん）を含むエントリは、必ずtagsに'米'を含む（レビュー指摘の回帰防止: 米をNG食材登録したユーザーに米入り料理が誤って提示されることを防ぐ）", () => {
      const entriesUsingRice = RULE_BASED_RECIPES.filter((entry) =>
        entry.ingredients.some((ingredient) => ingredient.foodId === "01088")
      );
      // 本ファイルは実際に01088を使うエントリを複数含む（このフィルタ自体が空にならないことも
      // 確認し、テストが「何もチェックしていない」状態に陥っていないことを保証する）。
      expect(entriesUsingRice.length).toBeGreaterThan(0);

      for (const entry of entriesUsingRice) {
        expect(entry.tags, `dishName: ${entry.dishName}`).toContain("米");
      }
    });

    it(
      "mealType 'dinner' に'米'タグを持たないエントリが少なくとも1件存在する（task 17.6" +
        "レビュー指摘の回帰防止: 当初は夕食12件全てが'米'タグを持ち、ユーザーが'米'をNG食材" +
        "登録した瞬間に夕食枠の必須フィルタが0件まで枯渇し、週間献立生成機能全体が決定論的かつ" +
        "恒久的に使用不能になっていた）",
      () => {
        const dinnerEntriesWithoutRice = RULE_BASED_RECIPES.filter(
          (entry) => entry.mealType === "dinner" && !entry.tags.includes("米")
        );
        expect(dinnerEntriesWithoutRice.length).toBeGreaterThanOrEqual(1);
      }
    );

    it(
      "mealType 'dinner' にrestrictionSuitabilityへ'low_carb'を含むエントリが少なくとも1件" +
        "存在する（task 17.6レビュー指摘の回帰防止: 当初は夕食にlow_carb適合のエントリが0件で、" +
        "restrictionType: 'low_carb'を選んだユーザーは夕食について常にfilterByRestrictionの" +
        "フォールバック（制限を無視した全候補からの選定）をサイレントに受け取っていた）",
      () => {
        const dinnerEntriesLowCarb = RULE_BASED_RECIPES.filter(
          (entry) => entry.mealType === "dinner" && entry.restrictionSuitability.includes("low_carb")
        );
        expect(dinnerEntriesLowCarb.length).toBeGreaterThanOrEqual(1);
      }
    );

    it("全エントリのrestrictionSuitabilityに'none'が含まれる", () => {
      for (const entry of RULE_BASED_RECIPES) {
        expect(entry.restrictionSuitability).toContain("none");
      }
    });

    it("全エントリのrestrictionSuitabilityに'calorie_only'が含まれる（総カロリー管理のみの制限は食材構成によらず適合するため）", () => {
      for (const entry of RULE_BASED_RECIPES) {
        expect(entry.restrictionSuitability).toContain("calorie_only");
      }
    });

    it("全エントリのservingsが1以上の整数、cookingTimeMinutesが1以上の整数である", () => {
      for (const entry of RULE_BASED_RECIPES) {
        expect(Number.isInteger(entry.servings)).toBe(true);
        expect(entry.servings).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(entry.cookingTimeMinutes)).toBe(true);
        expect(entry.cookingTimeMinutes).toBeGreaterThanOrEqual(1);
      }
    });

    it("全エントリのstepsが非空配列であり、各手順が非空文字列である", () => {
      for (const entry of RULE_BASED_RECIPES) {
        expect(entry.steps.length).toBeGreaterThan(0);
        for (const step of entry.steps) {
          expect(typeof step).toBe("string");
          expect(step.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("mealType別のカバレッジ（各食事タイプ最低10品、計40品以上）", () => {
    function countByMealType(mealType: (typeof ALL_MEAL_TYPES)[number]): number {
      return RULE_BASED_RECIPES.filter((entry) => entry.mealType === mealType).length;
    }

    it.each(ALL_MEAL_TYPES)("mealType '%s' のエントリが少なくとも10件存在する", (mealType) => {
      expect(countByMealType(mealType)).toBeGreaterThanOrEqual(10);
    });

    it("合計40件以上のエントリが存在する", () => {
      expect(RULE_BASED_RECIPES.length).toBeGreaterThanOrEqual(40);
    });

    it("4 mealTypeすべての合計がRULE_BASED_RECIPES全体の件数と一致する（mealTypeの値が4値以外に漏れていないことの確認）", () => {
      const total = ALL_MEAL_TYPES.reduce((sum, mealType) => sum + countByMealType(mealType), 0);
      expect(total).toBe(RULE_BASED_RECIPES.length);
    });
  });
});
