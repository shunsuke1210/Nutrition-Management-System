import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import {
  createFoodCompositionRepository,
  type FoodCompositionRepository,
} from "./food-composition.repository.js";

/**
 * `FoodCompositionRepository`（task 3.1）のテスト。
 *
 * `010_seed_food_items.sql` / `011_seed_unit_conversions.sql` が投入する実データ（MEXT
 * 「日本食品標準成分表（八訂）増補2023」ベース）に対して、実際の一時SQLiteデータベース
 * （`createConnection` + `runMigrations`）を用いて検証する。モック・フェイクは使用しない
 * （`server/src/profile/profile.repository.test.ts` の precedent に倣う）。
 */

interface FoodIdCountRow {
  count: number;
}

describe("FoodCompositionRepository", () => {
  let tmpDir: string;
  let db: Database.Database;
  let repository: FoodCompositionRepository;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-food-composition-repo-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    db = createConnection(dbPath);
    runMigrations(db);
    repository = createFoodCompositionRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("listAllIds()", () => {
    it("returns every food_id currently seeded in food_items, matching the live row count (Req 3.1)", () => {
      // 361を決め打ちにせず、実DBの実件数と突き合わせる（シードデータが将来増減しても
      // このテスト自体は「repositoryが全件を返すこと」を検証し続けられるようにするため）。
      const expectedCount = (
        db.prepare("SELECT COUNT(*) as count FROM food_items").get() as FoodIdCountRow
      ).count;

      const ids = repository.listAllIds();

      expect(expectedCount).toBeGreaterThan(0);
      expect(ids).toHaveLength(expectedCount);
    });

    it("includes known real food_ids seeded by task 2.1 (e.g. 01088 ごはん, 12004 卵)", () => {
      const ids = repository.listAllIds();

      expect(ids).toContain("01088");
      expect(ids).toContain("12004");
    });

    it("returns each food_id exactly once (no duplicates)", () => {
      const ids = repository.listAllIds();
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("findById()", () => {
    it("returns the correct FoodItemNutrition shape for a real food_id (12004 鶏卵・全卵・生), matching 010_seed_food_items.sql exactly (Req 4.1, 4.2, 4.7)", () => {
      const result = repository.findById("12004");

      expect(result).not.toBeNull();
      expect(result).toEqual({
        foodId: "12004",
        name: "鶏卵（全卵・生）",
        category: "卵類",
        per100g: {
          energyKcal: 142,
          proteinG: 12.2,
          fatG: 10.2,
          carbG: 0.4,
          fiberG: 0,
          calciumMg: 46,
          ironMg: 1.5,
          vitaminAUg: 210,
          vitaminDUg: 3.8,
          vitaminB1Mg: 0.06,
          vitaminB2Mg: 0.37,
          vitaminCMg: 0,
          saltEquivalentG: 0.4,
        },
        sourceCitation: "日本食品標準成分表（八訂）増補2023年から引用",
        displayUnitCode: "個",
      });
    });

    it("passes NULL micronutrient fields through as null (not coerced to 0 or omitted) for a food with unmeasured values (01148 ベーグル)", () => {
      // 010_seed_food_items.sql: ('01148', 'ベーグル', ...) はvitamin_a/vitamin_d/vitamin_c が
      // 「-」（未測定）としてNULLで投入されている一方、fiber/calcium/iron/vitaminB1/vitaminB2/salt
      // は非NULLの実測値を持つ。両方が同一レコード内に混在することを確認する。
      const result = repository.findById("01148");

      expect(result).not.toBeNull();
      expect(result?.name).toBe("ベーグル");
      expect(result?.per100g).toEqual({
        energyKcal: 270,
        proteinG: 9.6,
        fatG: 2,
        carbG: 54.6,
        fiberG: 2.5,
        calciumMg: 24,
        ironMg: 1.3,
        vitaminAUg: null,
        vitaminDUg: null,
        vitaminB1Mg: 0.19,
        vitaminB2Mg: 0.08,
        vitaminCMg: null,
        saltEquivalentG: 1.2,
      });
      expect(result?.displayUnitCode).toBe("個");
    });

    it("returns null for a food_id that does not exist in food_items (Req 4.6's completion condition)", () => {
      expect(repository.findById("99999")).toBeNull();
    });

    it(
      "exposes displayUnitCode (task 13.1 extension, ShoppingListService gap) as the real seeded " +
        'value "個" for 12004 鶏卵（全卵・生）, which 010_seed_food_items.sql sets explicitly',
      () => {
        const result = repository.findById("12004");

        expect(result).not.toBeNull();
        expect(result?.displayUnitCode).toBe("個");
      }
    );

    it(
      "exposes displayUnitCode as null for a real food_id that 010_seed_food_items.sql leaves " +
        "unset (01083 精白米（うるち米）, a weight-sold staple food per the migration's own comment)",
      () => {
        const result = repository.findById("01083");

        expect(result).not.toBeNull();
        expect(result?.displayUnitCode).toBeNull();
      }
    );
  });

  describe("findUnitConversion()", () => {
    it("returns the food-specific conversion entry for a real (foodId, unitCode) pair (12004 卵 / 個, from 011_seed_unit_conversions.sql)", () => {
      const result = repository.findUnitConversion("12004", "個");

      expect(result).toEqual({
        foodId: "12004",
        unitCode: "個",
        gramsPerUnit: 50,
      });
    });

    it("returns null when no food-specific entry exists for the pair, even though a GENERIC entry exists for that unit_code (proves no fallback to generic)", () => {
      // 12004（卵）には食材固有の「大さじ」エントリは投入されていないが、汎用の「大さじ」
      // エントリ（NULL, '大さじ', 15）は存在する。findUnitConversionはfood_id=12004指定の
      // 狭いクエリのみを行うため、汎用エントリへフォールバックせずnullを返さなければならない。
      const result = repository.findUnitConversion("12004", "大さじ");

      expect(result).toBeNull();
    });

    it("returns null for a (foodId, unitCode) pair with no matching row at all", () => {
      expect(repository.findUnitConversion("99999", "個")).toBeNull();
    });
  });

  describe("findGenericUnitConversion()", () => {
    it("returns the generic (food_id IS NULL) conversion entry for a real unit_code (大さじ, from 011_seed_unit_conversions.sql)", () => {
      const result = repository.findGenericUnitConversion("大さじ");

      expect(result).toEqual({
        foodId: null,
        unitCode: "大さじ",
        gramsPerUnit: 15,
      });
    });

    it("returns null for a unit_code with no generic entry (個 — deliberately not seeded generically per 011_seed_unit_conversions.sql)", () => {
      expect(repository.findGenericUnitConversion("個")).toBeNull();
    });
  });
});
