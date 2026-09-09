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
import { RULE_BASED_SIDE_DISHES } from "./rule-based-side-dish.data.js";

/**
 * `rule-based-side-dish.data.ts`（task 17.2）のテスト。
 *
 * `rule-based-recipe.data.test.ts` と同じ方針: 最重要の検証項目は「本ファイルの全 `foodId` が
 * 実際に `010_seed_food_items.sql` に投入される食品IDと一致すること」であり、実際の一時
 * SQLiteDBに対して機械的に検証する（モック・フェイクは使用しない）。
 *
 * それ以外は tasks.md task 17.2本文の完了条件（各mealType最低5品、quantity正数・unit"g"、
 * restrictionSuitabilityへの"none"の必須含有、dishName一意性）を満たすことを確認する。
 * `RuleBasedSideDishEntry` は `servings`/`cookingTimeMinutes`/`steps` を持たない軽量版のため、
 * これらのフィールドは検証しない（`rule-based-side-dish.data.ts` 冒頭コメント参照）。
 */

const ALL_MEAL_TYPES = MealTypeSchema.options;

describe("RULE_BASED_SIDE_DISHES", () => {
  describe("実在する食品IDのみを使用していること（実DBに対する検証、最重要）", () => {
    let tmpDir: string;
    let db: Database.Database;
    let repository: FoodCompositionRepository;

    beforeEach(() => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-rule-based-side-dish-test-"));
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
      for (const entry of RULE_BASED_SIDE_DISHES) {
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
      const names = RULE_BASED_SIDE_DISHES.map((entry) => entry.dishName);
      for (const name of names) {
        expect(name.length).toBeGreaterThan(0);
      }
      expect(new Set(names).size).toBe(names.length);
    });

    it("全エントリのmealTypeが@nutrition/sharedのMealTypeSchemaが定義する4値のいずれかである", () => {
      for (const entry of RULE_BASED_SIDE_DISHES) {
        expect(ALL_MEAL_TYPES).toContain(entry.mealType);
        expect(MealTypeSchema.safeParse(entry.mealType).success).toBe(true);
      }
    });

    it("全エントリのingredientsが1〜5件であり、各quantityが正数、各unitが'g'である（主要食材1〜3種程度を目安としつつ、調味料込みの点数はやや上振れを許容する）", () => {
      for (const entry of RULE_BASED_SIDE_DISHES) {
        expect(entry.ingredients.length).toBeGreaterThanOrEqual(1);
        expect(entry.ingredients.length).toBeLessThanOrEqual(5);
        for (const ingredient of entry.ingredients) {
          expect(ingredient.foodId.length).toBeGreaterThan(0);
          expect(ingredient.quantity).toBeGreaterThan(0);
          expect(ingredient.unit).toBe("g");
        }
      }
    });

    it("全エントリのtagsが非空配列であり、各タグが非空文字列である", () => {
      for (const entry of RULE_BASED_SIDE_DISHES) {
        expect(entry.tags.length).toBeGreaterThan(0);
        for (const tag of entry.tags) {
          expect(typeof tag).toBe("string");
          expect(tag.length).toBeGreaterThan(0);
        }
      }
    });

    it("全エントリのrestrictionSuitabilityに'none'が含まれる", () => {
      for (const entry of RULE_BASED_SIDE_DISHES) {
        expect(entry.restrictionSuitability).toContain("none");
      }
    });

    it("全エントリのrestrictionSuitabilityに'calorie_only'が含まれる（総カロリー管理のみの制限は食材構成によらず適合するため）", () => {
      for (const entry of RULE_BASED_SIDE_DISHES) {
        expect(entry.restrictionSuitability).toContain("calorie_only");
      }
    });
  });

  describe("mealType別のカバレッジ（各食事タイプ最低5品）", () => {
    function countByMealType(mealType: (typeof ALL_MEAL_TYPES)[number]): number {
      return RULE_BASED_SIDE_DISHES.filter((entry) => entry.mealType === mealType).length;
    }

    it.each(ALL_MEAL_TYPES)("mealType '%s' のエントリが少なくとも5件存在する", (mealType) => {
      expect(countByMealType(mealType)).toBeGreaterThanOrEqual(5);
    });

    it("4 mealTypeすべての合計がRULE_BASED_SIDE_DISHES全体の件数と一致する（mealTypeの値が4値以外に漏れていないことの確認）", () => {
      const total = ALL_MEAL_TYPES.reduce((sum, mealType) => sum + countByMealType(mealType), 0);
      expect(total).toBe(RULE_BASED_SIDE_DISHES.length);
    });
  });
});
