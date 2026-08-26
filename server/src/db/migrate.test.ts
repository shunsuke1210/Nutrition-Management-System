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

  it("creates all 6 tables defined by design.md's Physical Data Model", () => {
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
