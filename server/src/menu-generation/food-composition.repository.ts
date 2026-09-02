/**
 * FoodCompositionRepository — `food_items`（食品成分参照データ）と `unit_conversions`
 * （分量単位正規化テーブル）への読み取り専用アクセスを提供するリポジトリ。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #FoodCompositionRepository、
 * Requirements 3.1, 4.1, 4.2, 4.6）に定義されたService Interfaceをそのまま実装する。
 *
 * `FoodItemNutrition` / `UnitConversionEntry` は、design.mdの本コンポーネントのContracts行
 * （`Service [x] / API [ ] / ... / State [x]`）がAPI境界を持たないことに対応し、HTTP境界を
 * 越えない内部契約としてローカルなTypeScriptインターフェースで定義する（`shared/src/menu.schema.ts`
 * のZodスキーマには追加しない）。`NutritionValues`（基本4項目）のみ、design.mdの型が交差型
 * （`NutritionValues & {...}`）で示す通り `@nutrition/shared` から再利用する。
 *
 * `findById` / `findUnitConversion` / `findGenericUnitConversion` はいずれも、該当行が
 * 存在しない場合に `null` を返す（例外を投げない）。本リポジトリは読み取り専用・副作用なしで
 * あり、データの不在は例外的事象ではなく通常の結果である、という
 * `ProfileRepository.findCurrent()`（`server/src/profile/profile.repository.ts`）等
 * このコードベースの既存リポジトリと同じ規約に倣う。
 *
 * `findUnitConversion(foodId, unitCode)` は `(food_id = foodId, unit_code = unitCode)` に
 * 一致する食材固有のエントリのみを検索する（`food_id IS NULL` の汎用行には決してマッチしない）。
 * `findGenericUnitConversion(unitCode)` は逆に `(food_id IS NULL, unit_code = unitCode)` の
 * 汎用エントリのみを検索する。両者は意図的に独立した狭いクエリであり、一方が見つからない
 * 場合にもう一方へフォールバックする優先度解決ロジックは持たない
 * （そのフォールバック処理はdesign.mdの `UnitConversionService`、task 3.2の責務である）。
 */
import type Database from "better-sqlite3";
import type { NutritionValues } from "@nutrition/shared";

/** design.md #FoodCompositionRepository Service Interface。 */
export interface FoodItemNutrition {
  foodId: string;
  name: string;
  category: string;
  per100g: NutritionValues & {
    fiberG: number | null;
    calciumMg: number | null;
    ironMg: number | null;
    vitaminAUg: number | null;
    vitaminDUg: number | null;
    vitaminB1Mg: number | null;
    vitaminB2Mg: number | null;
    vitaminCMg: number | null;
    saltEquivalentG: number | null;
  };
  sourceCitation: string;
}

/** design.md #FoodCompositionRepository Service Interface。 */
export interface UnitConversionEntry {
  foodId: string | null; // null = 汎用エントリ
  unitCode: string;
  gramsPerUnit: number;
}

/** design.md #FoodCompositionRepository Service Interface。 */
export interface FoodCompositionRepository {
  findById(foodId: string): FoodItemNutrition | null;
  listAllIds(): string[];
  findUnitConversion(foodId: string, unitCode: string): UnitConversionEntry | null;
  findGenericUnitConversion(unitCode: string): UnitConversionEntry | null;
}

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
}

interface FoodIdRow {
  food_id: string;
}

interface UnitConversionRow {
  food_id: string | null;
  unit_code: string;
  grams_per_unit: number;
}

function mapRowToFoodItemNutrition(row: FoodItemRow): FoodItemNutrition {
  return {
    foodId: row.food_id,
    name: row.name,
    category: row.category,
    per100g: {
      energyKcal: row.energy_kcal_per100g,
      proteinG: row.protein_g_per100g,
      fatG: row.fat_g_per100g,
      carbG: row.carb_g_per100g,
      fiberG: row.fiber_g_per100g,
      calciumMg: row.calcium_mg_per100g,
      ironMg: row.iron_mg_per100g,
      vitaminAUg: row.vitamin_a_ug_per100g,
      vitaminDUg: row.vitamin_d_ug_per100g,
      vitaminB1Mg: row.vitamin_b1_mg_per100g,
      vitaminB2Mg: row.vitamin_b2_mg_per100g,
      vitaminCMg: row.vitamin_c_mg_per100g,
      saltEquivalentG: row.salt_equivalent_g_per100g,
    },
    sourceCitation: row.source_citation,
  };
}

function mapRowToUnitConversionEntry(row: UnitConversionRow): UnitConversionEntry {
  return {
    foodId: row.food_id,
    unitCode: row.unit_code,
    gramsPerUnit: row.grams_per_unit,
  };
}

/**
 * `db`（マイグレーション適用済みの better-sqlite3 コネクション）に対する
 * `FoodCompositionRepository` を生成する。`ProfileRepository`（`profile.repository.ts`）と
 * 同じファクトリ関数パターンに揃えている。本リポジトリは既存コネクションを受け取るのみで、
 * 自らDBコネクションを構築しない。
 */
export function createFoodCompositionRepository(
  db: Database.Database
): FoodCompositionRepository {
  function findById(foodId: string): FoodItemNutrition | null {
    const row = db
      .prepare(
        `SELECT food_id, name, category, energy_kcal_per100g, protein_g_per100g,
                fat_g_per100g, carb_g_per100g, fiber_g_per100g, calcium_mg_per100g,
                iron_mg_per100g, vitamin_a_ug_per100g, vitamin_d_ug_per100g,
                vitamin_b1_mg_per100g, vitamin_b2_mg_per100g, vitamin_c_mg_per100g,
                salt_equivalent_g_per100g, source_citation
         FROM food_items
         WHERE food_id = ?`
      )
      .get(foodId) as FoodItemRow | undefined;

    if (!row) {
      return null;
    }
    return mapRowToFoodItemNutrition(row);
  }

  function listAllIds(): string[] {
    // 昇順ソートは構造上必須ではない（design.mdはtool schemaのenum構築用途のみを述べ、
    // 順序を規定しない）が、決定論的なテスト・デバッグのしやすさのために採用する
    // （foodIdはTEXT PRIMARY KEYであり、`ORDER BY food_id ASC` は他クエリの性能に影響しない）。
    const rows = db
      .prepare(`SELECT food_id FROM food_items ORDER BY food_id ASC`)
      .all() as FoodIdRow[];
    return rows.map((row) => row.food_id);
  }

  function findUnitConversion(foodId: string, unitCode: string): UnitConversionEntry | null {
    const row = db
      .prepare(
        `SELECT food_id, unit_code, grams_per_unit
         FROM unit_conversions
         WHERE food_id = ? AND unit_code = ?`
      )
      .get(foodId, unitCode) as UnitConversionRow | undefined;

    if (!row) {
      return null;
    }
    return mapRowToUnitConversionEntry(row);
  }

  function findGenericUnitConversion(unitCode: string): UnitConversionEntry | null {
    const row = db
      .prepare(
        `SELECT food_id, unit_code, grams_per_unit
         FROM unit_conversions
         WHERE food_id IS NULL AND unit_code = ?`
      )
      .get(unitCode) as UnitConversionRow | undefined;

    if (!row) {
      return null;
    }
    return mapRowToUnitConversionEntry(row);
  }

  return { findById, listAllIds, findUnitConversion, findGenericUnitConversion };
}
