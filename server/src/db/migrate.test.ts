import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection } from "./connection.js";
import { runMigrations } from "./migrate.js";

const EXPECTED_TABLES = [
  "profiles",
  "exercise_routine_entries",
  "ng_ingredients",
  "preferred_ingredients",
  "daily_logs",
  "exercise_log_entries",
  "food_items",
  "unit_conversions",
  "week_menu_plans",
  "day_menus",
  "meal_slots",
  "meal_ingredients",
  "recipe_details",
  "supplementary_suggestions",
  "supplementary_ingredients",
  "satisfaction_feedback",
] as const;

const MICRONUTRIENT_COLUMNS = [
  "fiber_g",
  "calcium_mg",
  "iron_mg",
  "vitamin_a_ug",
  "vitamin_d_ug",
  "vitamin_b1_mg",
  "vitamin_b2_mg",
  "vitamin_c_mg",
  "salt_equivalent_g",
] as const;

function tableNames(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

function insertMinimalProfile(db: Database.Database, id: number, isoNow: string): void {
  db.prepare(
    `INSERT INTO profiles (
      id, height_cm, weight_kg, age, gender, job_activity_level, commute_method, created_at, updated_at
    ) VALUES (@id, 170, 65, 30, 'male', 'mixed', 'transit', @isoNow, @isoNow)`
  ).run({ id, isoNow });
}

/**
 * スキーマ検証用のダミー食品行を投入する。
 *
 * `foodId` には必ず `99xxx` 番台を使うこと。`010_seed_food_items.sql` がMEXT
 * 「日本食品標準成分表（八訂）増補2023年」の実在の食品番号（食品群01〜18）を
 * 投入済みのため、実在しうる番号をダミーに使うとPRIMARY KEY衝突でテストが壊れる。
 * 成分表の食品群は01〜18しか存在しないので、99番台は将来カタログを拡張しても衝突しない。
 */
function insertMinimalFoodItem(db: Database.Database, foodId: string): void {
  db.prepare(
    `INSERT INTO food_items (
      food_id, name, category, energy_kcal_per100g, protein_g_per100g, fat_g_per100g, carb_g_per100g
    ) VALUES (@foodId, 'テスト食品', 'テスト分類', 100, 5, 2, 10)`
  ).run({ foodId });
}

function insertMinimalWeekMenuPlan(db: Database.Database, weekStartDate: string): void {
  db.prepare(
    `INSERT INTO week_menu_plans (week_start_date, generated_at, generation_source)
     VALUES (@weekStartDate, @generatedAt, 'initial')`
  ).run({ weekStartDate, generatedAt: new Date().toISOString() });
}

function insertMinimalDayMenu(
  db: Database.Database,
  weekStartDate: string,
  dayDate: string,
  dayIndex: number
): number {
  const result = db
    .prepare(
      `INSERT INTO day_menus (week_start_date, day_date, day_index)
       VALUES (@weekStartDate, @dayDate, @dayIndex)`
    )
    .run({ weekStartDate, dayDate, dayIndex });
  return Number(result.lastInsertRowid);
}

function insertMinimalMealSlot(db: Database.Database, dayMenuId: number, mealType: string): number {
  const result = db
    .prepare(
      `INSERT INTO meal_slots (
        day_menu_id, meal_type, dish_name, energy_kcal, protein_g, fat_g, carb_g,
        fiber_g, calcium_mg, iron_mg, vitamin_a_ug, vitamin_d_ug, vitamin_b1_mg,
        vitamin_b2_mg, vitamin_c_mg, salt_equivalent_g, generated_at
      ) VALUES (
        @dayMenuId, @mealType, 'テスト料理', 300, 10, 5, 40,
        3, 50, 1, 20, 1, 0.2,
        0.2, 10, 1.5, @generatedAt
      )`
    )
    .run({ dayMenuId, mealType, generatedAt: new Date().toISOString() });
  return Number(result.lastInsertRowid);
}

function insertMinimalRecipeDetail(db: Database.Database, mealSlotId: number): number {
  const result = db
    .prepare(
      `INSERT INTO recipe_details (meal_slot_id, cooking_time_minutes, steps_json, generated_at)
       VALUES (@mealSlotId, 15, '["下ごしらえをする", "焼く"]', @generatedAt)`
    )
    .run({ mealSlotId, generatedAt: new Date().toISOString() });
  return Number(result.lastInsertRowid);
}

function insertMinimalSupplementarySuggestion(db: Database.Database, recipeDetailId: number): number {
  const result = db
    .prepare(
      `INSERT INTO supplementary_suggestions (
        recipe_detail_id, dish_name, energy_kcal_delta, protein_g_delta, fat_g_delta, carb_g_delta
      ) VALUES (@recipeDetailId, 'テスト副菜', 80, 3, 2, 10)`
    )
    .run({ recipeDetailId });
  return Number(result.lastInsertRowid);
}

function insertMinimalSupplementaryIngredient(
  db: Database.Database,
  supplementarySuggestionId: number,
  foodId: string
): void {
  db.prepare(
    `INSERT INTO supplementary_ingredients (
      supplementary_suggestion_id, food_id, quantity, unit_code, quantity_g
    ) VALUES (@supplementarySuggestionId, @foodId, 1, '個', 50)`
  ).run({ supplementarySuggestionId, foodId });
}

function insertMinimalSatisfactionFeedback(
  db: Database.Database,
  weekStartDate: string,
  dayIndex: number,
  mealType: string,
  liked: number
): void {
  const isoNow = new Date().toISOString();
  db.prepare(
    `INSERT INTO satisfaction_feedback (
      week_start_date, day_index, meal_type, dish_name, primary_food_ids, liked, created_at, updated_at
    ) VALUES (@weekStartDate, @dayIndex, @mealType, 'テスト料理', '["99001"]', @liked, @isoNow, @isoNow)`
  ).run({ weekStartDate, dayIndex, mealType, liked, isoNow });
}

describe("db migration runner", () => {
  let tmpDir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-migrate-test-"));
    dbPath = path.join(tmpDir, "test.db");
    db = createConnection(dbPath);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // may already be closed within a test body (e.g. the reopen test)
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates all 16 tables defined by design.md's Physical Data Model", () => {
    runMigrations(db);

    const names = tableNames(db);
    for (const table of EXPECTED_TABLES) {
      expect(names).toContain(table);
    }
  });

  it("enforces profiles.id CHECK (id = 1)", () => {
    runMigrations(db);
    const now = new Date().toISOString();

    expect(() => insertMinimalProfile(db, 2, now)).toThrow();
    expect(() => insertMinimalProfile(db, 1, now)).not.toThrow();

    const upsert = db.prepare(
      `INSERT INTO profiles (
        id, height_cm, weight_kg, age, gender, job_activity_level, commute_method, created_at, updated_at
      ) VALUES (1, 180, 70, 31, 'female', 'mostly_active', 'walk_or_bike', @isoNow, @isoNow)
      ON CONFLICT(id) DO UPDATE SET
        height_cm = excluded.height_cm,
        weight_kg = excluded.weight_kg,
        updated_at = excluded.updated_at`
    );
    expect(() => upsert.run({ isoNow: new Date().toISOString() })).not.toThrow();

    const row = db.prepare("SELECT id, height_cm FROM profiles").get() as {
      id: number;
      height_cm: number;
    };
    expect(row).toEqual({ id: 1, height_cm: 180 });
  });

  it("cascades deletes from profiles to exercise_routine_entries via ON DELETE CASCADE", () => {
    runMigrations(db);
    const now = new Date().toISOString();
    insertMinimalProfile(db, 1, now);
    db.prepare(
      `INSERT INTO exercise_routine_entries (
        profile_id, scene, content, frequency_per_week, duration_minutes, intensity
      ) VALUES (1, 'commute', '自転車通勤', 5, 20, 'light')`
    ).run();

    const countBefore = (
      db.prepare("SELECT COUNT(*) as count FROM exercise_routine_entries").get() as {
        count: number;
      }
    ).count;
    expect(countBefore).toBe(1);

    db.prepare("DELETE FROM profiles WHERE id = 1").run();

    const countAfter = (
      db.prepare("SELECT COUNT(*) as count FROM exercise_routine_entries").get() as {
        count: number;
      }
    ).count;
    expect(countAfter).toBe(0);
  });

  it("is idempotent when run more than once against an already-migrated database", () => {
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();

    const names = tableNames(db);
    expect(names.filter((name) => name === "profiles")).toHaveLength(1);

    const appliedCount = (
      db.prepare("SELECT COUNT(*) as count FROM schema_migrations").get() as { count: number }
    ).count;
    expect(appliedCount).toBeGreaterThan(0);

    runMigrations(db);
    const appliedCountAfterThirdRun = (
      db.prepare("SELECT COUNT(*) as count FROM schema_migrations").get() as { count: number }
    ).count;
    expect(appliedCountAfterThirdRun).toBe(appliedCount);
  });

  it("allows inserting a food_items row with only the NOT NULL columns and leaves nullable micronutrients NULL", () => {
    runMigrations(db);

    expect(() => insertMinimalFoodItem(db, "99001")).not.toThrow();

    const row = db
      .prepare("SELECT fiber_g_per100g, calcium_mg_per100g FROM food_items WHERE food_id = '99001'")
      .get() as { fiber_g_per100g: number | null; calcium_mg_per100g: number | null };
    expect(row.fiber_g_per100g).toBeNull();
    expect(row.calcium_mg_per100g).toBeNull();
  });

  it("rejects a food_items insert that omits a NOT NULL nutrient column such as energy_kcal_per100g", () => {
    runMigrations(db);

    expect(() =>
      db
        .prepare(
          `INSERT INTO food_items (
            food_id, name, category, protein_g_per100g, fat_g_per100g, carb_g_per100g
          ) VALUES ('99002', 'テスト食品2', 'テスト分類', 5, 2, 10)`
        )
        .run()
    ).toThrow();
  });

  it("applies food_items.source_citation's DEFAULT when omitted on insert", () => {
    runMigrations(db);
    insertMinimalFoodItem(db, "99003");

    const row = db
      .prepare("SELECT source_citation FROM food_items WHERE food_id = '99003'")
      .get() as { source_citation: string };
    expect(row.source_citation).toBe("日本食品標準成分表（八訂）増補2023年から引用");
  });

  it("enforces unit_conversions' (food_id, unit_code) UNIQUE constraint", () => {
    runMigrations(db);
    insertMinimalFoodItem(db, "99004");
    db.prepare(
      `INSERT INTO unit_conversions (food_id, unit_code, grams_per_unit) VALUES ('99004', '個', 50)`
    ).run();

    expect(() =>
      db
        .prepare(
          `INSERT INTO unit_conversions (food_id, unit_code, grams_per_unit) VALUES ('99004', '個', 60)`
        )
        .run()
    ).toThrow();
  });

  it("allows unit_conversions.food_id to be NULL for generic entries, and two NULL-food_id rows with different unit_codes both succeed", () => {
    runMigrations(db);

    expect(() =>
      db
        .prepare(
          `INSERT INTO unit_conversions (food_id, unit_code, grams_per_unit) VALUES (NULL, '大さじ', 15)`
        )
        .run()
    ).not.toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO unit_conversions (food_id, unit_code, grams_per_unit) VALUES (NULL, '小さじ', 5)`
        )
        .run()
    ).not.toThrow();

    const count = (
      db.prepare("SELECT COUNT(*) as count FROM unit_conversions WHERE food_id IS NULL").get() as {
        count: number;
      }
    ).count;
    expect(count).toBe(2);
  });

  it("does not deduplicate two NULL-food_id rows that share the SAME unit_code, since SQL never treats two NULLs as equal even within a composite UNIQUE constraint", () => {
    // Unlike the previous test (different unit_codes, which trivially wouldn't collide under
    // any unique-constraint implementation), this exercises the genuinely non-obvious case:
    // UNIQUE(food_id, unit_code) provides NO deduplication for generic (food_id IS NULL) entries
    // sharing the same unit_code, because standard SQL/SQLite NULL-distinctness means
    // NULL is never considered equal to NULL for uniqueness purposes — even inside a composite
    // constraint. This is correct, expected behavior per design.md's literal schema (no bug),
    // but is directly relevant to later tasks that seed/query generic unit entries (2.2, 3.2).
    runMigrations(db);

    expect(() =>
      db
        .prepare(
          `INSERT INTO unit_conversions (food_id, unit_code, grams_per_unit) VALUES (NULL, 'カップ', 200)`
        )
        .run()
    ).not.toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO unit_conversions (food_id, unit_code, grams_per_unit) VALUES (NULL, 'カップ', 200)`
        )
        .run()
    ).not.toThrow();

    const count = (
      db
        .prepare(
          "SELECT COUNT(*) as count FROM unit_conversions WHERE food_id IS NULL AND unit_code = 'カップ'"
        )
        .get() as { count: number }
    ).count;
    expect(count).toBe(2);
  });

  it("cascades deletes from food_items to unit_conversions via ON DELETE CASCADE, leaving NULL-food_id rows unaffected", () => {
    runMigrations(db);
    insertMinimalFoodItem(db, "99005");
    db.prepare(
      `INSERT INTO unit_conversions (food_id, unit_code, grams_per_unit) VALUES ('99005', '個', 50)`
    ).run();
    db.prepare(
      `INSERT INTO unit_conversions (food_id, unit_code, grams_per_unit) VALUES (NULL, '大さじ', 15)`
    ).run();

    db.prepare("DELETE FROM food_items WHERE food_id = '99005'").run();

    const specificCount = (
      db.prepare("SELECT COUNT(*) as count FROM unit_conversions WHERE food_id = '99005'").get() as {
        count: number;
      }
    ).count;
    expect(specificCount).toBe(0);

    const genericCount = (
      db.prepare("SELECT COUNT(*) as count FROM unit_conversions WHERE food_id IS NULL").get() as {
        count: number;
      }
    ).count;
    expect(genericCount).toBe(1);
  });

  it("rejects unit_conversions.grams_per_unit values that are zero or negative", () => {
    runMigrations(db);

    expect(() =>
      db
        .prepare(
          `INSERT INTO unit_conversions (food_id, unit_code, grams_per_unit) VALUES (NULL, '個', 0)`
        )
        .run()
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO unit_conversions (food_id, unit_code, grams_per_unit) VALUES (NULL, '個', -5)`
        )
        .run()
    ).toThrow();
  });

  it("persists the created tables to the SQLite file on disk", () => {
    runMigrations(db);
    db.close();

    const reopened = createConnection(dbPath);
    try {
      const names = tableNames(reopened);
      for (const table of EXPECTED_TABLES) {
        expect(names).toContain(table);
      }
    } finally {
      reopened.close();
    }
  });

  it("enforces day_menus.day_index CHECK (0-6), rejecting -1 and 7 while accepting the 0 and 6 boundary values", () => {
    runMigrations(db);
    insertMinimalWeekMenuPlan(db, "2026-08-24");

    expect(() => insertMinimalDayMenu(db, "2026-08-24", "2026-08-23", -1)).toThrow();
    expect(() => insertMinimalDayMenu(db, "2026-08-24", "2026-08-31", 7)).toThrow();
    expect(() => insertMinimalDayMenu(db, "2026-08-24", "2026-08-24", 0)).not.toThrow();
    expect(() => insertMinimalDayMenu(db, "2026-08-24", "2026-08-30", 6)).not.toThrow();
  });

  it("enforces meal_slots.meal_type CHECK enum, rejecting an invalid value and accepting all 4 valid meal types", () => {
    runMigrations(db);
    insertMinimalWeekMenuPlan(db, "2026-08-24");
    const dayMenuId = insertMinimalDayMenu(db, "2026-08-24", "2026-08-24", 0);

    expect(() => insertMinimalMealSlot(db, dayMenuId, "brunch")).toThrow();
    for (const mealType of ["breakfast", "lunch", "dinner", "snack"]) {
      expect(() => insertMinimalMealSlot(db, dayMenuId, mealType)).not.toThrow();
    }
  });

  it("enforces day_menus' UNIQUE(week_start_date, day_index) and its separate day_date UNIQUE constraint independently", () => {
    runMigrations(db);
    insertMinimalWeekMenuPlan(db, "2026-08-24");
    insertMinimalDayMenu(db, "2026-08-24", "2026-08-24", 0);

    // Same (week_start_date, day_index) but a different day_date -> composite UNIQUE violation.
    expect(() => insertMinimalDayMenu(db, "2026-08-24", "2026-08-25", 0)).toThrow();

    // Same day_date but a different (week_start_date, day_index) -> the independent day_date
    // UNIQUE constraint rejects it even though the composite constraint would not.
    insertMinimalWeekMenuPlan(db, "2026-08-17");
    expect(() => insertMinimalDayMenu(db, "2026-08-17", "2026-08-24", 3)).toThrow();
  });

  it("enforces meal_slots' UNIQUE(day_menu_id, meal_type) constraint", () => {
    runMigrations(db);
    insertMinimalWeekMenuPlan(db, "2026-08-24");
    const dayMenuId = insertMinimalDayMenu(db, "2026-08-24", "2026-08-24", 0);
    insertMinimalMealSlot(db, dayMenuId, "breakfast");

    expect(() => insertMinimalMealSlot(db, dayMenuId, "breakfast")).toThrow();
  });

  it("cascades deletes from week_menu_plans through day_menus and meal_slots down to meal_ingredients (3-level CASCADE)", () => {
    runMigrations(db);
    insertMinimalFoodItem(db, "99006");
    insertMinimalWeekMenuPlan(db, "2026-08-24");
    const dayMenuId = insertMinimalDayMenu(db, "2026-08-24", "2026-08-24", 0);
    const mealSlotId = insertMinimalMealSlot(db, dayMenuId, "breakfast");
    db.prepare(
      `INSERT INTO meal_ingredients (meal_slot_id, food_id, quantity, unit_code, quantity_g)
       VALUES (@mealSlotId, '99006', 1, '個', 50)`
    ).run({ mealSlotId });

    const countBefore = (
      db.prepare("SELECT COUNT(*) as count FROM meal_ingredients").get() as { count: number }
    ).count;
    expect(countBefore).toBe(1);

    db.prepare("DELETE FROM week_menu_plans WHERE week_start_date = '2026-08-24'").run();

    const dayMenuCount = (
      db.prepare("SELECT COUNT(*) as count FROM day_menus").get() as { count: number }
    ).count;
    const mealSlotCount = (
      db.prepare("SELECT COUNT(*) as count FROM meal_slots").get() as { count: number }
    ).count;
    const mealIngredientCount = (
      db.prepare("SELECT COUNT(*) as count FROM meal_ingredients").get() as { count: number }
    ).count;

    expect(dayMenuCount).toBe(0);
    expect(mealSlotCount).toBe(0);
    expect(mealIngredientCount).toBe(0);
  });

  it("does NOT cascade-delete meal_ingredients when a referenced food_items row is deleted; the deletion is rejected instead (this FK deliberately has no ON DELETE CASCADE)", () => {
    runMigrations(db);
    insertMinimalFoodItem(db, "99007");
    insertMinimalWeekMenuPlan(db, "2026-08-24");
    const dayMenuId = insertMinimalDayMenu(db, "2026-08-24", "2026-08-24", 0);
    const mealSlotId = insertMinimalMealSlot(db, dayMenuId, "lunch");
    db.prepare(
      `INSERT INTO meal_ingredients (meal_slot_id, food_id, quantity, unit_code, quantity_g)
       VALUES (@mealSlotId, '99007', 1, '個', 50)`
    ).run({ mealSlotId });

    expect(() => db.prepare("DELETE FROM food_items WHERE food_id = '99007'").run()).toThrow();

    const count = (
      db
        .prepare("SELECT COUNT(*) as count FROM meal_ingredients WHERE food_id = '99007'")
        .get() as { count: number }
    ).count;
    expect(count).toBe(1);
  });

  it("has all 9 micronutrient columns on meal_slots (a full insert succeeds) and rejects a negative value in each of them individually", () => {
    runMigrations(db);
    insertMinimalWeekMenuPlan(db, "2026-08-24");
    const dayMenuId = insertMinimalDayMenu(db, "2026-08-24", "2026-08-24", 0);

    // A successful insert providing values for all 9 micronutrient columns proves they exist
    // with the expected names (insertMinimalMealSlot supplies non-null values for all 9).
    expect(() => insertMinimalMealSlot(db, dayMenuId, "breakfast")).not.toThrow();

    const baseValues = {
      dayMenuId,
      mealType: "lunch",
      fiber_g: 3,
      calcium_mg: 50,
      iron_mg: 1,
      vitamin_a_ug: 20,
      vitamin_d_ug: 1,
      vitamin_b1_mg: 0.2,
      vitamin_b2_mg: 0.2,
      vitamin_c_mg: 10,
      salt_equivalent_g: 1.5,
    };

    for (const column of MICRONUTRIENT_COLUMNS) {
      const values = { ...baseValues, [column]: -1, generatedAt: new Date().toISOString() };
      expect(() =>
        db
          .prepare(
            `INSERT INTO meal_slots (
              day_menu_id, meal_type, dish_name, energy_kcal, protein_g, fat_g, carb_g,
              fiber_g, calcium_mg, iron_mg, vitamin_a_ug, vitamin_d_ug, vitamin_b1_mg,
              vitamin_b2_mg, vitamin_c_mg, salt_equivalent_g, generated_at
            ) VALUES (
              @dayMenuId, @mealType, 'テスト料理2', 300, 10, 5, 40,
              @fiber_g, @calcium_mg, @iron_mg, @vitamin_a_ug, @vitamin_d_ug, @vitamin_b1_mg,
              @vitamin_b2_mg, @vitamin_c_mg, @salt_equivalent_g, @generatedAt
            )`
          )
          .run(values)
      ).toThrow();
    }
  });

  it("confirms day_menus has NO micronutrient columns (micronutrients aggregate at read-time from meal_slots, not stored redundantly on day_menus)", () => {
    runMigrations(db);

    const columns = (db.prepare("PRAGMA table_info(day_menus)").all() as { name: string }[]).map(
      (row) => row.name
    );

    for (const micronutrientColumn of MICRONUTRIENT_COLUMNS) {
      expect(columns).not.toContain(micronutrientColumn);
    }
  });

  it("enforces recipe_details.meal_slot_id's UNIQUE constraint", () => {
    runMigrations(db);
    insertMinimalWeekMenuPlan(db, "2026-08-24");
    const dayMenuId = insertMinimalDayMenu(db, "2026-08-24", "2026-08-24", 0);
    const mealSlotId = insertMinimalMealSlot(db, dayMenuId, "breakfast");
    insertMinimalRecipeDetail(db, mealSlotId);

    expect(() => insertMinimalRecipeDetail(db, mealSlotId)).toThrow();
  });

  it("cascades deletes from meal_slots through recipe_details and supplementary_suggestions down to supplementary_ingredients (3-level CASCADE)", () => {
    runMigrations(db);
    insertMinimalFoodItem(db, "10001");
    insertMinimalWeekMenuPlan(db, "2026-08-24");
    const dayMenuId = insertMinimalDayMenu(db, "2026-08-24", "2026-08-24", 0);
    const mealSlotId = insertMinimalMealSlot(db, dayMenuId, "dinner");
    const recipeDetailId = insertMinimalRecipeDetail(db, mealSlotId);
    const suggestionId = insertMinimalSupplementarySuggestion(db, recipeDetailId);
    insertMinimalSupplementaryIngredient(db, suggestionId, "10001");

    const ingredientCountBefore = (
      db.prepare("SELECT COUNT(*) as count FROM supplementary_ingredients").get() as {
        count: number;
      }
    ).count;
    expect(ingredientCountBefore).toBe(1);

    db.prepare("DELETE FROM meal_slots WHERE id = ?").run(mealSlotId);

    const recipeDetailCount = (
      db.prepare("SELECT COUNT(*) as count FROM recipe_details").get() as { count: number }
    ).count;
    const suggestionCount = (
      db.prepare("SELECT COUNT(*) as count FROM supplementary_suggestions").get() as {
        count: number;
      }
    ).count;
    const ingredientCount = (
      db.prepare("SELECT COUNT(*) as count FROM supplementary_ingredients").get() as {
        count: number;
      }
    ).count;

    expect(recipeDetailCount).toBe(0);
    expect(suggestionCount).toBe(0);
    expect(ingredientCount).toBe(0);
  });

  it("does NOT cascade-delete supplementary_ingredients when a referenced food_items row is deleted; the deletion is rejected instead (this FK deliberately has no ON DELETE CASCADE, mirroring meal_ingredients.food_id)", () => {
    runMigrations(db);
    insertMinimalFoodItem(db, "99008");
    insertMinimalWeekMenuPlan(db, "2026-08-24");
    const dayMenuId = insertMinimalDayMenu(db, "2026-08-24", "2026-08-24", 0);
    const mealSlotId = insertMinimalMealSlot(db, dayMenuId, "lunch");
    const recipeDetailId = insertMinimalRecipeDetail(db, mealSlotId);
    const suggestionId = insertMinimalSupplementarySuggestion(db, recipeDetailId);
    insertMinimalSupplementaryIngredient(db, suggestionId, "99008");

    expect(() => db.prepare("DELETE FROM food_items WHERE food_id = '99008'").run()).toThrow();

    const count = (
      db
        .prepare("SELECT COUNT(*) as count FROM supplementary_ingredients WHERE food_id = '99008'")
        .get() as { count: number }
    ).count;
    expect(count).toBe(1);
  });

  it("applies recipe_details.servings' DEFAULT 1 when omitted on insert", () => {
    runMigrations(db);
    insertMinimalWeekMenuPlan(db, "2026-08-24");
    const dayMenuId = insertMinimalDayMenu(db, "2026-08-24", "2026-08-24", 0);
    const mealSlotId = insertMinimalMealSlot(db, dayMenuId, "breakfast");
    const recipeDetailId = insertMinimalRecipeDetail(db, mealSlotId);

    const row = db
      .prepare("SELECT servings FROM recipe_details WHERE id = ?")
      .get(recipeDetailId) as { servings: number };
    expect(row.servings).toBe(1);
  });

  it("enforces satisfaction_feedback's UNIQUE(week_start_date, day_index, meal_type)", () => {
    runMigrations(db);
    insertMinimalSatisfactionFeedback(db, "2026-08-24", 0, "breakfast", 1);

    expect(() =>
      insertMinimalSatisfactionFeedback(db, "2026-08-24", 0, "breakfast", 0)
    ).toThrow();
  });

  it("has NO foreign key from satisfaction_feedback to meal_slots (or anywhere else): a row referencing a (week_start_date, day_index, meal_type) combination with no corresponding day_menus/meal_slots row inserts successfully", () => {
    runMigrations(db);

    // Deliberately create no week_menu_plans/day_menus/meal_slots row for this week_start_date
    // at all. If satisfaction_feedback carried a hidden FK to meal_slots (directly, or via
    // week_start_date/day_index/meal_type resolving to a real meal slot), this insert would be
    // rejected with a foreign key constraint violation. It succeeds instead, behaviorally proving
    // the deliberate decoupling required by the task text ("meal_slotsへのFKなし") and Requirement
    // 10.2's "スナップショット" framing: feedback must survive regeneration/deletion of the
    // meal_slots row it was originally about.
    expect(() =>
      insertMinimalSatisfactionFeedback(db, "2099-01-05", 3, "snack", 0)
    ).not.toThrow();

    const row = db
      .prepare(
        `SELECT dish_name FROM satisfaction_feedback
         WHERE week_start_date = '2099-01-05' AND day_index = 3 AND meal_type = 'snack'`
      )
      .get() as { dish_name: string };
    expect(row.dish_name).toBe("テスト料理");
  });

  it("enforces satisfaction_feedback.liked's CHECK (0 or 1), rejecting other integer values while accepting 0 and 1", () => {
    runMigrations(db);

    expect(() => insertMinimalSatisfactionFeedback(db, "2026-08-24", 1, "lunch", 1)).not.toThrow();
    expect(() => insertMinimalSatisfactionFeedback(db, "2026-08-24", 2, "lunch", 0)).not.toThrow();
    expect(() => insertMinimalSatisfactionFeedback(db, "2026-08-24", 3, "lunch", 2)).toThrow();
  });
});
