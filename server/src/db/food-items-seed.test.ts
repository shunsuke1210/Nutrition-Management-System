import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection } from "./connection.js";
import { runMigrations } from "./migrate.js";

/**
 * `010_seed_food_items.sql`（MEXT「日本食品標準成分表（八訂）増補2023年」ベースの
 * 厳選食品カタログ）の投入結果を、`FoodCompositionRepository` 相当の直接クエリで検証する。
 *
 * `FoodCompositionRepository` の実装は後続タスク（3.1）のため、ここでは
 * better-sqlite3 の生SQLで同等の参照を行う。
 */

/** `010_seed_food_items.sql` で使用しているカテゴリラベル（タスク2.1が挙げる10分類）。 */
const EXPECTED_CATEGORIES = [
  "主食",
  "肉類",
  "魚介類",
  "卵類",
  "乳類",
  "豆類",
  "野菜類",
  "果実類",
  "調味料類",
  "菓子類",
] as const;

/** 買い物リスト表示用の計数単位として許容するコード（要件14.7）。 */
const ALLOWED_DISPLAY_UNITS = ["個", "本", "枚", "玉", "丁", "束", "パック", "缶"] as const;

const SOURCE_CITATION = "日本食品標準成分表（八訂）増補2023年から引用";

interface FoodItemRow {
  food_id: string;
  name: string;
  category: string;
  energy_kcal_per100g: number;
  protein_g_per100g: number;
  fat_g_per100g: number;
  carb_g_per100g: number;
  fiber_g_per100g: number | null;
  calcium_mg_per100g: number | null;
  iron_mg_per100g: number | null;
  vitamin_a_ug_per100g: number | null;
  vitamin_d_ug_per100g: number | null;
  vitamin_b1_mg_per100g: number | null;
  vitamin_b2_mg_per100g: number | null;
  vitamin_c_mg_per100g: number | null;
  salt_equivalent_g_per100g: number | null;
  source_citation: string;
  display_unit_code: string | null;
}

function findByName(db: Database.Database, name: string): FoodItemRow | undefined {
  return db.prepare("SELECT * FROM food_items WHERE name = ?").get(name) as
    | FoodItemRow
    | undefined;
}

function findById(db: Database.Database, foodId: string): FoodItemRow | undefined {
  return db.prepare("SELECT * FROM food_items WHERE food_id = ?").get(foodId) as
    | FoodItemRow
    | undefined;
}

function countOf(db: Database.Database, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { count: number }).count;
}

describe("010_seed_food_items.sql (MEXT八訂増補2023 食品カタログ)", () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-food-seed-test-"));
    db = createConnection(path.join(tmpDir, "test.db"));
    runMigrations(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // already closed within a test body
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- 代表的な食品IDが正しい栄養価で取得できること（タスク2.1の完了条件） ---
  //
  // 期待値はいずれも文部科学省 食品成分データベース（https://fooddb.mext.go.jp/）の
  // 「日本食品標準成分表（八訂）増補2023年」の収載値と一致する。

  it("resolves 米 (ごはん・精白米 = MEXT食品番号 01088) with the exact 八訂増補2023 composition", () => {
    const row = findByName(db, "ごはん（精白米・うるち米）");

    expect(row).toBeDefined();
    expect(row?.food_id).toBe("01088");
    expect(row?.category).toBe("主食");
    expect(row?.energy_kcal_per100g).toBe(156);
    expect(row?.protein_g_per100g).toBe(2.5);
    expect(row?.fat_g_per100g).toBe(0.3);
    expect(row?.carb_g_per100g).toBe(37.1);
    expect(row?.fiber_g_per100g).toBe(1.5);
    expect(row?.calcium_mg_per100g).toBe(3);
    expect(row?.iron_mg_per100g).toBe(0.1);
    expect(row?.vitamin_b1_mg_per100g).toBe(0.02);
    expect(row?.vitamin_b2_mg_per100g).toBe(0.01);
    expect(row?.salt_equivalent_g_per100g).toBe(0);
    // 重量売り食品なので計数単位は持たない
    expect(row?.display_unit_code).toBeNull();
  });

  it("resolves 米 (精白米・生 = MEXT食品番号 01083) with the exact 八訂増補2023 composition", () => {
    const row = findByName(db, "精白米（うるち米）");

    expect(row).toBeDefined();
    expect(row?.food_id).toBe("01083");
    expect(row?.energy_kcal_per100g).toBe(342);
    expect(row?.protein_g_per100g).toBe(6.1);
    expect(row?.fat_g_per100g).toBe(0.9);
    expect(row?.carb_g_per100g).toBe(77.6);
    expect(row?.display_unit_code).toBeNull();
  });

  it("resolves 鶏むね肉 (皮なし・生 = MEXT食品番号 11220) with the exact 八訂増補2023 composition", () => {
    const row = findByName(db, "鶏むね肉（皮なし・生）");

    expect(row).toBeDefined();
    expect(row?.food_id).toBe("11220");
    expect(row?.category).toBe("肉類");
    // 八訂でエネルギー算出方法が変わったため七訂の116 kcalではなく105 kcalが正しい
    expect(row?.energy_kcal_per100g).toBe(105);
    expect(row?.protein_g_per100g).toBe(23.3);
    expect(row?.fat_g_per100g).toBe(1.9);
    expect(row?.carb_g_per100g).toBe(0.1);
    expect(row?.calcium_mg_per100g).toBe(4);
    expect(row?.iron_mg_per100g).toBe(0.3);
    expect(row?.vitamin_a_ug_per100g).toBe(9);
    expect(row?.vitamin_d_ug_per100g).toBe(0.1);
    expect(row?.vitamin_b1_mg_per100g).toBe(0.1);
    expect(row?.vitamin_b2_mg_per100g).toBe(0.11);
    expect(row?.vitamin_c_mg_per100g).toBe(3);
    expect(row?.salt_equivalent_g_per100g).toBe(0.1);
    expect(row?.display_unit_code).toBeNull();
  });

  it("resolves 卵 (鶏卵・全卵・生 = MEXT食品番号 12004) with the exact 八訂増補2023 composition", () => {
    const row = findByName(db, "鶏卵（全卵・生）");

    expect(row).toBeDefined();
    expect(row?.food_id).toBe("12004");
    expect(row?.category).toBe("卵類");
    expect(row?.energy_kcal_per100g).toBe(142);
    expect(row?.protein_g_per100g).toBe(12.2);
    expect(row?.fat_g_per100g).toBe(10.2);
    expect(row?.carb_g_per100g).toBe(0.4);
    expect(row?.calcium_mg_per100g).toBe(46);
    expect(row?.iron_mg_per100g).toBe(1.5);
    expect(row?.vitamin_a_ug_per100g).toBe(210);
    expect(row?.vitamin_d_ug_per100g).toBe(3.8);
    expect(row?.vitamin_b1_mg_per100g).toBe(0.06);
    expect(row?.vitamin_b2_mg_per100g).toBe(0.37);
    expect(row?.salt_equivalent_g_per100g).toBe(0.4);
    // 個数で数える食品なので計数単位を持つ
    expect(row?.display_unit_code).toBe("個");
  });

  it("resolves キャベツ (結球葉・生 = MEXT食品番号 06061) with the exact 八訂増補2023 composition", () => {
    const row = findByName(db, "キャベツ（生）");

    expect(row).toBeDefined();
    expect(row?.food_id).toBe("06061");
    expect(row?.category).toBe("野菜類");
    expect(row?.energy_kcal_per100g).toBe(23);
    expect(row?.protein_g_per100g).toBe(1.2);
    expect(row?.fat_g_per100g).toBe(0.1);
    expect(row?.carb_g_per100g).toBe(5.2);
    expect(row?.fiber_g_per100g).toBe(1.8);
    expect(row?.calcium_mg_per100g).toBe(42);
    expect(row?.iron_mg_per100g).toBe(0.3);
    expect(row?.vitamin_b1_mg_per100g).toBe(0.04);
    expect(row?.vitamin_b2_mg_per100g).toBe(0.03);
    expect(row?.vitamin_c_mg_per100g).toBe(38);
    expect(row?.salt_equivalent_g_per100g).toBe(0);
    // 玉で数える食品なので計数単位を持つ
    expect(row?.display_unit_code).toBe("玉");
  });

  // --- カタログ全体の性質 ---

  it("seeds a 数百件規模 catalog (hundreds of items)", () => {
    const total = countOf(db, "SELECT COUNT(*) as count FROM food_items");

    expect(total).toBe(361);
    expect(total).toBeGreaterThanOrEqual(100);
    expect(total).toBeLessThan(1000);
  });

  it("covers all 10 categories named by the task, each with at least one item", () => {
    const rows = db
      .prepare("SELECT category, COUNT(*) as count FROM food_items GROUP BY category")
      .all() as { category: string; count: number }[];
    const byCategory = new Map(rows.map((r) => [r.category, r.count]));

    for (const category of EXPECTED_CATEGORIES) {
      expect(byCategory.get(category), `category ${category} must have items`).toBeGreaterThan(0);
    }
    // カテゴリラベルは列挙可能な小さい集合に閉じている（後続タスク13.2のマッピング前提）
    expect([...byCategory.keys()].sort()).toEqual([...EXPECTED_CATEGORIES].sort());
  });

  it("uses a real 5-digit MEXT 食品番号 as food_id for every row", () => {
    const rows = db.prepare("SELECT food_id FROM food_items").all() as { food_id: string }[];

    expect(rows).toHaveLength(361);
    for (const { food_id } of rows) {
      expect(food_id).toMatch(/^\d{5}$/);
    }
    // 食品群番号（先頭2桁）も成分表の18群の範囲に収まっている
    const groups = new Set(rows.map((r) => r.food_id.slice(0, 2)));
    for (const group of groups) {
      const n = Number(group);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(18);
    }
  });

  it("sets the required 出典表示 on every row via the column DEFAULT", () => {
    const mismatched = countOf(
      db,
      "SELECT COUNT(*) as count FROM food_items WHERE source_citation <> ?",
      SOURCE_CITATION
    );

    expect(mismatched).toBe(0);
    // DEFAULTに委ねているのでINSERT文にsource_citationは現れないが、全行に設定されている
    expect(
      countOf(db, "SELECT COUNT(*) as count FROM food_items WHERE source_citation = ?", SOURCE_CITATION)
    ).toBe(361);
  });

  it("has a real, non-negative value for all four NOT NULL macronutrient columns on every row", () => {
    const invalid = countOf(
      db,
      `SELECT COUNT(*) as count FROM food_items
       WHERE energy_kcal_per100g IS NULL OR energy_kcal_per100g < 0
          OR protein_g_per100g IS NULL OR protein_g_per100g < 0
          OR fat_g_per100g IS NULL OR fat_g_per100g < 0
          OR carb_g_per100g IS NULL OR carb_g_per100g < 0`
    );

    expect(invalid).toBe(0);
  });

  // --- display_unit_code の付与ルール（タスク2.1 / 要件14.7） ---

  it("sets display_unit_code only to units from the allowed countable set", () => {
    const units = db
      .prepare(
        "SELECT DISTINCT display_unit_code as unit FROM food_items WHERE display_unit_code IS NOT NULL"
      )
      .all() as { unit: string }[];

    expect(units.length).toBeGreaterThan(0);
    for (const { unit } of units) {
      expect(ALLOWED_DISPLAY_UNITS).toContain(unit as (typeof ALLOWED_DISPLAY_UNITS)[number]);
    }
  });

  it("sets a countable display_unit_code on foods households count by piece/block/bunch/head/pack", () => {
    const expectations: [string, string][] = [
      ["12004", "個"], // 鶏卵（全卵・生）
      ["12002", "個"], // うずら卵
      ["04033", "丁"], // 絹ごし豆腐
      ["04032", "丁"], // 木綿豆腐
      ["01026", "枚"], // 角形食パン
      ["04040", "枚"], // 油揚げ
      ["06267", "束"], // ほうれんそう
      ["06086", "束"], // こまつな
      ["06061", "玉"], // キャベツ
      ["06233", "玉"], // はくさい
      ["06312", "玉"], // レタス
      ["06291", "パック"], // りょくとうもやし
      ["04046", "パック"], // 糸引き納豆
      ["06153", "個"], // たまねぎ
      ["07107", "本"], // バナナ
    ];

    for (const [foodId, unit] of expectations) {
      const row = findById(db, foodId);
      expect(row, `food_id ${foodId} must be seeded`).toBeDefined();
      expect(row?.display_unit_code, `food_id ${foodId} (${row?.name})`).toBe(unit);
    }
  });

  it("leaves display_unit_code NULL for weight-sold foods (肉・魚・米・調味料)", () => {
    const weightSold = [
      "01083", // 精白米
      "01088", // ごはん
      "11220", // 鶏むね肉（皮なし・生）
      "11219", // 鶏むね肉（皮つき・生）
      "11221", // 鶏もも肉（皮つき・生）
      "11163", // 豚ひき肉
      "11089", // 牛ひき肉
      "10154", // まさば
      "10134", // しろさけ
      "10003", // まあじ
      "17007", // こいくちしょうゆ
      "17045", // 米みそ（淡色辛みそ）
      "17012", // 食塩
      "14002", // ごま油
      "03003", // 上白糖
    ];

    for (const foodId of weightSold) {
      const row = findById(db, foodId);
      expect(row, `food_id ${foodId} must be seeded`).toBeDefined();
      expect(row?.display_unit_code, `food_id ${foodId} (${row?.name})`).toBeNull();
    }
  });

  it("leaves display_unit_code NULL for the majority of the catalog (weight-based fallback)", () => {
    const withUnit = countOf(
      db,
      "SELECT COUNT(*) as count FROM food_items WHERE display_unit_code IS NOT NULL"
    );
    const withoutUnit = countOf(
      db,
      "SELECT COUNT(*) as count FROM food_items WHERE display_unit_code IS NULL"
    );

    expect(withUnit + withoutUnit).toBe(361);
    expect(withUnit).toBeGreaterThan(0);
    expect(withoutUnit).toBeGreaterThan(withUnit);
  });

  // --- マイグレーションとしての振る舞い ---

  it("is applied exactly once and is idempotent across repeated runMigrations() calls", () => {
    const applied = countOf(
      db,
      "SELECT COUNT(*) as count FROM schema_migrations WHERE name = '010_seed_food_items.sql'"
    );
    expect(applied).toBe(1);

    runMigrations(db);
    runMigrations(db);

    expect(countOf(db, "SELECT COUNT(*) as count FROM food_items")).toBe(361);
    expect(
      countOf(
        db,
        "SELECT COUNT(*) as count FROM schema_migrations WHERE name = '010_seed_food_items.sql'"
      )
    ).toBe(1);
  });

  it("provides a food catalog usable as the tool-schema food_id enum (要件3.1)", () => {
    // FoodCompositionRepository.listAllIds() 相当
    const ids = (db.prepare("SELECT food_id FROM food_items ORDER BY food_id").all() as {
      food_id: string;
    }[]).map((r) => r.food_id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("01088");
    expect(ids).toContain("11220");
    expect(ids).toContain("12004");
    expect(ids).toContain("06061");
  });
});
