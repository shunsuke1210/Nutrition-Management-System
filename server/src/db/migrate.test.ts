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

function insertMinimalFoodItem(db: Database.Database, foodId: string): void {
  db.prepare(
    `INSERT INTO food_items (
      food_id, name, category, energy_kcal_per100g, protein_g_per100g, fat_g_per100g, carb_g_per100g
    ) VALUES (@foodId, 'テスト食品', 'テスト分類', 100, 5, 2, 10)`
  ).run({ foodId });
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

  it("creates all 8 tables defined by design.md's Physical Data Model", () => {
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

    expect(() => insertMinimalFoodItem(db, "01001")).not.toThrow();

    const row = db
      .prepare("SELECT fiber_g_per100g, calcium_mg_per100g FROM food_items WHERE food_id = '01001'")
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
          ) VALUES ('01002', 'テスト食品2', 'テスト分類', 5, 2, 10)`
        )
        .run()
    ).toThrow();
  });

  it("applies food_items.source_citation's DEFAULT when omitted on insert", () => {
    runMigrations(db);
    insertMinimalFoodItem(db, "01003");

    const row = db
      .prepare("SELECT source_citation FROM food_items WHERE food_id = '01003'")
      .get() as { source_citation: string };
    expect(row.source_citation).toBe("日本食品標準成分表（八訂）増補2023年から引用");
  });

  it("enforces unit_conversions' (food_id, unit_code) UNIQUE constraint", () => {
    runMigrations(db);
    insertMinimalFoodItem(db, "01004");
    db.prepare(
      `INSERT INTO unit_conversions (food_id, unit_code, grams_per_unit) VALUES ('01004', '個', 50)`
    ).run();

    expect(() =>
      db
        .prepare(
          `INSERT INTO unit_conversions (food_id, unit_code, grams_per_unit) VALUES ('01004', '個', 60)`
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
    insertMinimalFoodItem(db, "01005");
    db.prepare(
      `INSERT INTO unit_conversions (food_id, unit_code, grams_per_unit) VALUES ('01005', '個', 50)`
    ).run();
    db.prepare(
      `INSERT INTO unit_conversions (food_id, unit_code, grams_per_unit) VALUES (NULL, '大さじ', 15)`
    ).run();

    db.prepare("DELETE FROM food_items WHERE food_id = '01005'").run();

    const specificCount = (
      db.prepare("SELECT COUNT(*) as count FROM unit_conversions WHERE food_id = '01005'").get() as {
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
});
