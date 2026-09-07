import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { createFoodCompositionRepository } from "./food-composition.repository.js";
import { createUnitConversionService, type UnitConversionService } from "./unit-conversion.service.js";
import {
  createRecipeDetailRepository,
  type PersistedRecipeDetail,
  type PersistedSupplementarySuggestion,
  type RecipeDetailRepository,
} from "./recipe-detail.repository.js";

/**
 * `RecipeDetailRepository`（task 8.1）のテスト。
 *
 * 実際の一時SQLiteデータベース（`createConnection` + `runMigrations`）を用いる
 * （`menu-plan.repository.test.ts` の precedent）。`recipe_details.meal_slot_id` の
 * ON DELETE CASCADE、`upsert` の「削除してから再挿入」という実際のリレーショナルな振る舞い
 * そのものが検証対象であり、DBをモックするとテストの目的が失われるため。
 *
 * `UnitConversionService` は実装（`createUnitConversionService` +
 * `createFoodCompositionRepository`）をそのまま使う。`runMigrations` が
 * `010_seed_food_items.sql` / `011_seed_unit_conversions.sql` を含めて全マイグレーションを
 * 適用するため、`supplementary_ingredients.food_id` が要求する実在の `food_items` 行と、
 * 「個」単位の食材固有換算（鶏卵1個=50g、汎用の「個」エントリは存在しない）の両方が
 * フェイクを書かずに手に入る。フェイクを別途用意するより本テストのフィクスチャ構築コストが
 * 低く、かつ「1:1でない実際の換算」を最も素直に証明できるためこちらを採用した。
 */

interface CountRow {
  count: number;
}

interface SupplementaryIngredientRawRow {
  quantity: number;
  unit_code: string;
  quantity_g: number;
}

interface DishNameRow {
  dish_name: string;
}

interface MealSlotNutritionInput {
  energyKcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
}

/** `meal_slots` に直接投入する、明確に見分けられる栄養価（0でも999でもない値）。 */
const DISTINCT_MEAL_SLOT_NUTRITION: MealSlotNutritionInput = {
  energyKcal: 456.5,
  proteinG: 34.25,
  fatG: 12.75,
  carbG: 65.5,
};

/**
 * `upsert` に渡す（実際には永続化されない）ダミーの `detail.nutrition`。
 * `DISTINCT_MEAL_SLOT_NUTRITION` とは明確に異なる値にすることで、戻り値の `nutrition` が
 * この入力をそのままコピーしたものではなく、`meal_slots` から読み直された値であることを
 * 区別して検証できる。
 */
const DUMMY_INPUT_NUTRITION: MealSlotNutritionInput = {
  energyKcal: 999,
  proteinG: 999,
  fatG: 999,
  carbG: 999,
};

/** 米（`010_seed_food_items.sql`）。`display_unit_code` はNULLで、g単位のみを使う。 */
const RICE_FOOD_ID = "01088";
/** 鶏卵（全卵・生）。`011_seed_unit_conversions.sql` に食材固有の「個」=50gエントリがある。 */
const EGG_FOOD_ID = "12004";

describe("RecipeDetailRepository", () => {
  let tmpDir: string;
  let db: Database.Database;
  let unitConversionService: UnitConversionService;
  let repository: RecipeDetailRepository;
  let weekCounter = 0;

  /** `week_menu_plans.week_start_date` は PRIMARY KEY のため、フィクスチャごとに一意な日付を払い出す。 */
  function nextWeekStartDate(): string {
    weekCounter += 1;
    const day = String(weekCounter).padStart(2, "0");
    return `2026-01-${day}`;
  }

  /**
   * `week_menu_plans` → `day_menus` → `meal_slots` の実フィクスチャチェーンを直接SQLで構築し、
   * 指定した4項目の栄養価を持つ `meal_slots` 行のIDを返す。`MenuPlanRepository` を経由しない
   * のは、`meal_ingredients` の書き込み（＝もう1つのUnitConversionService呼び出し経路）が
   * 本テストの関心事ではないため、最小限の直接INSERTでフィクスチャを組み立てる。
   */
  function insertMealSlotFixture(
    nutrition: MealSlotNutritionInput = DISTINCT_MEAL_SLOT_NUTRITION
  ): number {
    const weekStartDate = nextWeekStartDate();
    db.prepare(
      `INSERT INTO week_menu_plans (week_start_date, generated_at, generation_source)
       VALUES (?, ?, 'initial')`
    ).run(weekStartDate, new Date().toISOString());

    const dayInfo = db
      .prepare(
        `INSERT INTO day_menus (week_start_date, day_date, day_index, planned_kcal, target_kcal, variance_kcal)
         VALUES (?, ?, 0, 2000, 2000, 0)`
      )
      .run(weekStartDate, weekStartDate);
    const dayMenuId = Number(dayInfo.lastInsertRowid);

    const slotInfo = db
      .prepare(
        `INSERT INTO meal_slots (
           day_menu_id, meal_type, dish_name,
           energy_kcal, protein_g, fat_g, carb_g, fiber_g, calcium_mg, iron_mg,
           vitamin_a_ug, vitamin_d_ug, vitamin_b1_mg, vitamin_b2_mg, vitamin_c_mg,
           salt_equivalent_g, generated_at
         ) VALUES (?, 'breakfast', 'fixture-dish', ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?)`
      )
      .run(
        dayMenuId,
        nutrition.energyKcal,
        nutrition.proteinG,
        nutrition.fatG,
        nutrition.carbG,
        new Date().toISOString()
      );
    return Number(slotInfo.lastInsertRowid);
  }

  function buildSuggestion(
    overrides: Partial<PersistedSupplementarySuggestion> = {}
  ): PersistedSupplementarySuggestion {
    return {
      dishName: "ほうれん草のお浸し",
      ingredients: [{ foodId: RICE_FOOD_ID, quantity: 50, unit: "g" }],
      nutritionDelta: { energyKcal: 80.25, proteinG: 2.5, fatG: 0.25, carbG: 15.5 },
      ...overrides,
    };
  }

  function buildDetailInput(
    overrides: Partial<Omit<PersistedRecipeDetail, "mealSlotId">> = {}
  ): Omit<PersistedRecipeDetail, "mealSlotId"> {
    return {
      servings: 2,
      cookingTimeMinutes: 15,
      steps: ["材料を切る", "炒める"],
      nutrition: DUMMY_INPUT_NUTRITION,
      supplementarySuggestions: [buildSuggestion()],
      ...overrides,
    };
  }

  function countAll(table: string): number {
    return (db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as CountRow).count;
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-recipe-detail-repo-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    db = createConnection(dbPath);
    runMigrations(db);
    unitConversionService = createUnitConversionService(createFoodCompositionRepository(db));
    repository = createRecipeDetailRepository(db, unitConversionService);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("upsert() — fresh insert (no existing recipe_details row)", () => {
    it("creates a new recipe_details row with correct servings/cookingTimeMinutes/steps (multi-step case)", () => {
      const mealSlotId = insertMealSlotFixture();

      const result = repository.upsert(
        mealSlotId,
        buildDetailInput({
          servings: 3,
          cookingTimeMinutes: 25,
          steps: ["下ごしらえ", "煮る", "盛り付け"],
        })
      );

      expect(result.mealSlotId).toBe(mealSlotId);
      expect(result.servings).toBe(3);
      expect(result.cookingTimeMinutes).toBe(25);
      expect(result.steps).toEqual(["下ごしらえ", "煮る", "盛り付け"]);
      expect(countAll("recipe_details")).toBe(1);
    });

    it("round-trips an empty steps array", () => {
      const mealSlotId = insertMealSlotFixture();

      const result = repository.upsert(mealSlotId, buildDetailInput({ steps: [] }));

      expect(result.steps).toEqual([]);
      const reloaded = repository.findByMealSlotId(mealSlotId);
      expect(reloaded?.steps).toEqual([]);
    });

    it("creates exactly 1 supplementary suggestion with correct dishName/ingredients/nutritionDelta when given 1", () => {
      const mealSlotId = insertMealSlotFixture();
      const suggestion = buildSuggestion({
        dishName: "きゅうりの浅漬け",
        ingredients: [{ foodId: RICE_FOOD_ID, quantity: 30, unit: "g" }],
        nutritionDelta: { energyKcal: 20.25, proteinG: 0.5, fatG: 0.25, carbG: 4.5 },
      });

      const result = repository.upsert(
        mealSlotId,
        buildDetailInput({ supplementarySuggestions: [suggestion] })
      );

      expect(result.supplementarySuggestions).toHaveLength(1);
      expect(result.supplementarySuggestions[0]?.dishName).toBe("きゅうりの浅漬け");
      expect(result.supplementarySuggestions[0]?.nutritionDelta).toEqual({
        energyKcal: 20.25,
        proteinG: 0.5,
        fatG: 0.25,
        carbG: 4.5,
      });
      expect(result.supplementarySuggestions[0]?.ingredients).toEqual([
        { foodId: RICE_FOOD_ID, quantity: 30, unit: "g" },
      ]);
    });

    it("creates exactly 2 supplementary suggestions with correct fields when given 2", () => {
      const mealSlotId = insertMealSlotFixture();
      const suggestionA = buildSuggestion({ dishName: "副菜A" });
      const suggestionB = buildSuggestion({
        dishName: "副菜B",
        nutritionDelta: { energyKcal: 40.5, proteinG: 3.25, fatG: 1.5, carbG: 8.25 },
      });

      const result = repository.upsert(
        mealSlotId,
        buildDetailInput({ supplementarySuggestions: [suggestionA, suggestionB] })
      );

      expect(result.supplementarySuggestions).toHaveLength(2);
      expect(result.supplementarySuggestions.map((s) => s.dishName)).toEqual(["副菜A", "副菜B"]);
      expect(result.supplementarySuggestions[1]?.nutritionDelta).toEqual({
        energyKcal: 40.5,
        proteinG: 3.25,
        fatG: 1.5,
        carbG: 8.25,
      });
    });
  });

  describe("findByMealSlotId()", () => {
    it("returns null when no recipe detail exists for the given mealSlotId", () => {
      const mealSlotId = insertMealSlotFixture();

      expect(repository.findByMealSlotId(mealSlotId)).toBeNull();
    });

    it("returns the full RecipeDetail with nutrition DERIVED from the meal_slots row — not from the upsert input, not zeroed (Req 8.3)", () => {
      const mealSlotId = insertMealSlotFixture(DISTINCT_MEAL_SLOT_NUTRITION);
      repository.upsert(mealSlotId, buildDetailInput({ nutrition: DUMMY_INPUT_NUTRITION }));

      const found = repository.findByMealSlotId(mealSlotId);

      expect(found).not.toBeNull();
      expect(found?.nutrition).toEqual(DISTINCT_MEAL_SLOT_NUTRITION);
      // upsertに渡した999のダミー値が紛れ込んでいないこと。
      expect(found?.nutrition).not.toEqual(DUMMY_INPUT_NUTRITION);
    });

    it("also reflects the meal_slots-derived nutrition on the value returned directly by upsert()", () => {
      const mealSlotId = insertMealSlotFixture(DISTINCT_MEAL_SLOT_NUTRITION);

      const result = repository.upsert(mealSlotId, buildDetailInput({ nutrition: DUMMY_INPUT_NUTRITION }));

      expect(result.nutrition).toEqual(DISTINCT_MEAL_SLOT_NUTRITION);
    });
  });

  describe("upsert() — replace on the SAME mealSlotId (replace, don't append)", () => {
    it("replaces servings/steps and grows the suggestion count 1→2 — only the second call's data remains, and it round-trips via findByMealSlotId", () => {
      const mealSlotId = insertMealSlotFixture();
      repository.upsert(
        mealSlotId,
        buildDetailInput({
          servings: 1,
          steps: ["最初の手順"],
          supplementarySuggestions: [buildSuggestion({ dishName: "旧・副菜A" })],
        })
      );

      const second = repository.upsert(
        mealSlotId,
        buildDetailInput({
          servings: 4,
          steps: ["新手順1", "新手順2", "新手順3"],
          supplementarySuggestions: [
            buildSuggestion({ dishName: "新・副菜A" }),
            buildSuggestion({ dishName: "新・副菜B" }),
          ],
        })
      );

      expect(second.servings).toBe(4);
      expect(second.steps).toEqual(["新手順1", "新手順2", "新手順3"]);
      expect(second.supplementarySuggestions.map((s) => s.dishName)).toEqual([
        "新・副菜A",
        "新・副菜B",
      ]);

      const reloaded = repository.findByMealSlotId(mealSlotId);
      expect(reloaded).toEqual(second);

      // 直接クエリでも1件のみ（過去分が孤立して残っていない）。
      expect(countAll("recipe_details")).toBe(1);
      expect(countAll("supplementary_suggestions")).toBe(2);
      const dishNames = (
        db.prepare(`SELECT dish_name FROM supplementary_suggestions`).all() as DishNameRow[]
      ).map((row) => row.dish_name);
      expect(dishNames.sort()).toEqual(["新・副菜A", "新・副菜B"]);
    });

    it("shrinks the suggestion count 2→1 — the removed suggestion's ingredients are genuinely gone, not orphaned", () => {
      const mealSlotId = insertMealSlotFixture();
      repository.upsert(
        mealSlotId,
        buildDetailInput({
          supplementarySuggestions: [
            buildSuggestion({ dishName: "副菜1" }),
            buildSuggestion({
              dishName: "副菜2",
              ingredients: [
                { foodId: RICE_FOOD_ID, quantity: 10, unit: "g" },
                { foodId: EGG_FOOD_ID, quantity: 1, unit: "個" },
              ],
            }),
          ],
        })
      );
      expect(countAll("supplementary_suggestions")).toBe(2);
      expect(countAll("supplementary_ingredients")).toBe(3); // 1件 + 2件

      repository.upsert(
        mealSlotId,
        buildDetailInput({ supplementarySuggestions: [buildSuggestion({ dishName: "唯一の副菜" })] })
      );

      expect(countAll("recipe_details")).toBe(1);
      expect(countAll("supplementary_suggestions")).toBe(1);
      expect(countAll("supplementary_ingredients")).toBe(1);
      const remaining = db
        .prepare(`SELECT dish_name FROM supplementary_suggestions`)
        .get() as DishNameRow;
      expect(remaining.dish_name).toBe("唯一の副菜");
    });

    it("does not create a second recipe_details row for a second mealSlotId (isolation between meal slots)", () => {
      const mealSlotIdA = insertMealSlotFixture();
      const mealSlotIdB = insertMealSlotFixture({ ...DISTINCT_MEAL_SLOT_NUTRITION, energyKcal: 111 });

      repository.upsert(mealSlotIdA, buildDetailInput({ servings: 1 }));
      repository.upsert(mealSlotIdB, buildDetailInput({ servings: 2 }));

      expect(countAll("recipe_details")).toBe(2);
      expect(repository.findByMealSlotId(mealSlotIdA)?.servings).toBe(1);
      expect(repository.findByMealSlotId(mealSlotIdB)?.servings).toBe(2);
    });
  });

  describe("CASCADE DELETE integrity when the referenced meal_slots row is replaced (Req 8.4)", () => {
    it("deleting the referenced meal_slots row transitively deletes recipe_details/supplementary_suggestions/supplementary_ingredients (COUNT = 0 at every level)", () => {
      const mealSlotId = insertMealSlotFixture();
      repository.upsert(
        mealSlotId,
        buildDetailInput({
          supplementarySuggestions: [
            buildSuggestion({
              dishName: "副菜X",
              ingredients: [{ foodId: RICE_FOOD_ID, quantity: 10, unit: "g" }],
            }),
          ],
        })
      );

      expect(countAll("recipe_details")).toBe(1);
      expect(countAll("supplementary_suggestions")).toBe(1);
      expect(countAll("supplementary_ingredients")).toBe(1);

      // MenuPlanRepository.replaceDay/replaceWeek が再生成時に行う操作を直接シミュレートする。
      db.prepare(`DELETE FROM meal_slots WHERE id = ?`).run(mealSlotId);

      expect(countAll("recipe_details")).toBe(0);
      expect(countAll("supplementary_suggestions")).toBe(0);
      expect(countAll("supplementary_ingredients")).toBe(0);
      expect(repository.findByMealSlotId(mealSlotId)).toBeNull();
    });

    it("leaves an unrelated meal slot's recipe detail fully intact when a different meal slot is deleted", () => {
      const mealSlotIdA = insertMealSlotFixture();
      const mealSlotIdB = insertMealSlotFixture({ ...DISTINCT_MEAL_SLOT_NUTRITION, energyKcal: 222 });
      repository.upsert(mealSlotIdA, buildDetailInput({ servings: 1 }));
      repository.upsert(mealSlotIdB, buildDetailInput({ servings: 5 }));

      db.prepare(`DELETE FROM meal_slots WHERE id = ?`).run(mealSlotIdA);

      expect(repository.findByMealSlotId(mealSlotIdA)).toBeNull();
      expect(repository.findByMealSlotId(mealSlotIdB)?.servings).toBe(5);
      expect(countAll("recipe_details")).toBe(1);
    });
  });

  describe("supplementarySuggestions order preservation (sort_order)", () => {
    it("preserves the array order across an upsert + read round trip — not accidental insertion order, not sorted by name", () => {
      const mealSlotId = insertMealSlotFixture();
      const suggestions = [
        buildSuggestion({ dishName: "Z-最初に渡す副菜" }),
        buildSuggestion({ dishName: "A-次に渡す副菜" }),
      ];

      repository.upsert(mealSlotId, buildDetailInput({ supplementarySuggestions: suggestions }));
      const found = repository.findByMealSlotId(mealSlotId);

      // 名前のアルファベット順（A→Z）ではなく、渡した順（Z→A）のまま返る。
      expect(found?.supplementarySuggestions.map((s) => s.dishName)).toEqual([
        "Z-最初に渡す副菜",
        "A-次に渡す副菜",
      ]);
    });

    it("follows sort_order even when it is made to diverge from insertion order (mutation-proof: readSuggestions' ORDER BY sort_order is genuinely load-bearing)", () => {
      // 上のテストは `upsert` の書き込み経路（配列インデックス＝sort_order＝物理挿入順）を
      // 経由する限り、sort_orderと挿入順が常に一致してしまい、`ORDER BY sort_order` を
      // 取り除いても（挿入順=id順にフォールバックするだけで）検出できない、というレビュー指摘への
      // 対応。ここでは `upsert` を経由したあとに生のSQLで sort_order 列だけを直接入れ替え、
      // 行のid・物理挿入順には一切触れない状態を作ることで、読み取りが本当に sort_order を
      // 見ているのか、それとも挿入順（id順）にたまたま一致しているだけなのかを切り分ける。
      const mealSlotId = insertMealSlotFixture();
      const suggestions = [
        buildSuggestion({ dishName: "先に挿入される副菜" }),
        buildSuggestion({ dishName: "後に挿入される副菜" }),
      ];
      repository.upsert(mealSlotId, buildDetailInput({ supplementarySuggestions: suggestions }));

      interface SuggestionIdentityRow {
        id: number;
        sort_order: number;
      }
      const rows = db
        .prepare(`SELECT id, sort_order FROM supplementary_suggestions ORDER BY id ASC`)
        .all() as SuggestionIdentityRow[];
      expect(rows).toHaveLength(2);
      const [first, second] = rows as [SuggestionIdentityRow, SuggestionIdentityRow];
      // 挿入順（id昇順）で見た1件目・2件目のsort_orderをそのまま入れ替える。
      // id・物理挿入順は変更しない。
      db.prepare(`UPDATE supplementary_suggestions SET sort_order = ? WHERE id = ?`).run(
        second.sort_order,
        first.id
      );
      db.prepare(`UPDATE supplementary_suggestions SET sort_order = ? WHERE id = ?`).run(
        first.sort_order,
        second.id
      );

      const found = repository.findByMealSlotId(mealSlotId);

      // sort_orderを入れ替えたので、読み取り順は挿入順とは逆になるはず。
      // （`ORDER BY sort_order` が無ければ、id順＝元の挿入順のまま変化せず、このアサーションは失敗する。）
      expect(found?.supplementarySuggestions.map((s) => s.dishName)).toEqual([
        "後に挿入される副菜",
        "先に挿入される副菜",
      ]);
    });
  });

  describe("supplementary_ingredients.quantity_g", () => {
    it("is computed via UnitConversionService.toGrams for a non-1:1 unit (卵1個=50g) — not copied verbatim from quantity", () => {
      const mealSlotId = insertMealSlotFixture();

      repository.upsert(
        mealSlotId,
        buildDetailInput({
          supplementarySuggestions: [
            buildSuggestion({
              dishName: "卵料理",
              ingredients: [{ foodId: EGG_FOOD_ID, quantity: 2, unit: "個" }],
            }),
          ],
        })
      );

      const row = db
        .prepare(`SELECT quantity, unit_code, quantity_g FROM supplementary_ingredients`)
        .get() as SupplementaryIngredientRawRow;

      expect(row.quantity).toBe(2);
      expect(row.unit_code).toBe("個");
      // 2個 × 50g/個 = 100g。quantityをそのままコピーしていれば2になってしまう。
      expect(row.quantity_g).toBe(100);
    });

    it("throws and rolls back the entire upsert when a supplementary ingredient's unit cannot be resolved", () => {
      const mealSlotId = insertMealSlotFixture();

      expect(() =>
        repository.upsert(
          mealSlotId,
          buildDetailInput({
            supplementarySuggestions: [
              buildSuggestion({
                ingredients: [{ foodId: RICE_FOOD_ID, quantity: 1, unit: "NONEXISTENT_UNIT" }],
              }),
            ],
          })
        )
      ).toThrow();

      // トランザクション全体がロールバックされ、孤立した recipe_details 行が残らない。
      expect(countAll("recipe_details")).toBe(0);
      expect(countAll("supplementary_suggestions")).toBe(0);
      expect(countAll("supplementary_ingredients")).toBe(0);
      expect(repository.findByMealSlotId(mealSlotId)).toBeNull();
    });
  });
});
