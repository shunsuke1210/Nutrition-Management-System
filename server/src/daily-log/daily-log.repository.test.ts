import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExerciseEntryInput } from "@nutrition/shared";
import { createConnection } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { createDailyLogRepository, type DailyLogRepository } from "./daily-log.repository.js";

function buildExerciseEntryInput(
  overrides: Partial<ExerciseEntryInput> = {}
): ExerciseEntryInput {
  return {
    activityName: "ジョギング",
    durationMinutes: 30,
    estimatedCaloriesBurned: 250,
    ...overrides,
  };
}

describe("DailyLogRepository", () => {
  let tmpDir: string;
  let db: Database.Database;
  let repository: DailyLogRepository;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-daily-log-repo-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    db = createConnection(dbPath);
    runMigrations(db);
    repository = createDailyLogRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null from findByDate() for a date with no record (Req 11.2)", () => {
    expect(repository.findByDate("2026-08-01")).toBeNull();
  });

  it("upsertCore creates a new row when none exists, and updates in place (not duplicating) on a second call for the same date (Req 8.1, 8.4)", () => {
    const created = repository.upsertCore("2026-08-01", { weightKg: 65 });
    expect(created.date).toBe("2026-08-01");
    expect(created.weightKg).toBe(65);

    const updated = repository.upsertCore("2026-08-01", { weightKg: 64.5 });
    expect(updated.weightKg).toBe(64.5);

    const rowCount = db
      .prepare("SELECT COUNT(*) as count FROM daily_logs WHERE log_date = ?")
      .get("2026-08-01") as { count: number };
    expect(rowCount.count).toBe(1);

    const found = repository.findByDate("2026-08-01");
    expect(found?.weightKg).toBe(64.5);
  });

  it("upsertCore only touches fields present in the input, leaving other previously-set fields unchanged", () => {
    repository.upsertCore("2026-08-01", { weightKg: 65, bodyFatPct: 20 });

    const afterPartialUpdate = repository.upsertCore("2026-08-01", { weightKg: 66 });

    expect(afterPartialUpdate.weightKg).toBe(66);
    expect(afterPartialUpdate.bodyFatPct).toBe(20);
  });

  it("upsertCore with manualOverrideKcal set derives calorieIntakeActual/calorieIntakeSource as manual (Req 9.2)", () => {
    const result = repository.upsertCore("2026-08-01", { manualOverrideKcal: 1800 });

    expect(result.manualOverrideKcal).toBe(1800);
    expect(result.calorieIntakeActual).toBe(1800);
    expect(result.calorieIntakeSource).toBe("manual");
  });

  it("upsertCore with manualOverrideKcal: null clears a previously-set override and falls back to plannedKcal (Req 9.3, 9.5)", () => {
    repository.upsertPlannedKcal("2026-08-01", 2000);
    repository.upsertCore("2026-08-01", { manualOverrideKcal: 1800 });

    const cleared = repository.upsertCore("2026-08-01", { manualOverrideKcal: null });

    expect(cleared.manualOverrideKcal).toBeNull();
    expect(cleared.calorieIntakeActual).toBe(2000);
    expect(cleared.calorieIntakeSource).toBe("planned");
  });

  it("upsertCore with manualOverrideKcal: null and no plannedKcal falls back to unrecorded", () => {
    repository.upsertCore("2026-08-01", { manualOverrideKcal: 1800 });

    const cleared = repository.upsertCore("2026-08-01", { manualOverrideKcal: null });

    expect(cleared.manualOverrideKcal).toBeNull();
    expect(cleared.plannedKcal).toBeNull();
    expect(cleared.calorieIntakeActual).toBeNull();
    expect(cleared.calorieIntakeSource).toBe("unrecorded");
  });

  it("upsertPlannedKcal creates a new row when none exists and sets plannedKcal (Req 9.1)", () => {
    const result = repository.upsertPlannedKcal("2026-08-02", 1900);

    expect(result.plannedKcal).toBe(1900);
    expect(result.calorieIntakeActual).toBe(1900);
    expect(result.calorieIntakeSource).toBe("planned");
  });

  it("upsertPlannedKcal does not clear an existing manualOverrideKcal (Req 9.3)", () => {
    repository.upsertCore("2026-08-01", { manualOverrideKcal: 1800 });

    const afterPlanUpdate = repository.upsertPlannedKcal("2026-08-01", 2200);

    expect(afterPlanUpdate.manualOverrideKcal).toBe(1800);
    expect(afterPlanUpdate.plannedKcal).toBe(2200);
    expect(afterPlanUpdate.calorieIntakeActual).toBe(1800);
    expect(afterPlanUpdate.calorieIntakeSource).toBe("manual");
  });

  it("addExerciseEntry on a date with NO prior daily_logs row auto-creates the row, and a subsequent findByDate returns it with the entry (task 3.1 completion condition, Req 10.1)", () => {
    const entryInput = buildExerciseEntryInput();

    const added = repository.addExerciseEntry("2026-08-05", entryInput);

    expect(added.id).toBeTypeOf("number");
    expect(added.activityName).toBe(entryInput.activityName);
    expect(added.durationMinutes).toBe(entryInput.durationMinutes);
    expect(added.estimatedCaloriesBurned).toBe(entryInput.estimatedCaloriesBurned);

    const found = repository.findByDate("2026-08-05");
    expect(found).not.toBeNull();
    expect(found?.exerciseEntries).toHaveLength(1);
    expect(found?.exerciseEntries[0]).toEqual(added);
  });

  it("addExerciseEntry supports multiple entries per date (Req 10.1)", () => {
    repository.addExerciseEntry("2026-08-05", buildExerciseEntryInput({ activityName: "ジョギング" }));
    repository.addExerciseEntry(
      "2026-08-05",
      buildExerciseEntryInput({ activityName: "筋トレ", estimatedCaloriesBurned: 150 })
    );

    const found = repository.findByDate("2026-08-05");
    expect(found?.exerciseEntries).toHaveLength(2);
    expect(found?.exerciseEntries.map((entry) => entry.activityName)).toEqual([
      "ジョギング",
      "筋トレ",
    ]);
  });

  it("removeExerciseEntry removes an entry and returns true; a second removal of the same id returns false (no-op)", () => {
    const added = repository.addExerciseEntry("2026-08-05", buildExerciseEntryInput());

    const firstRemoval = repository.removeExerciseEntry("2026-08-05", added.id);
    expect(firstRemoval).toBe(true);

    const found = repository.findByDate("2026-08-05");
    expect(found?.exerciseEntries).toHaveLength(0);

    const secondRemoval = repository.removeExerciseEntry("2026-08-05", added.id);
    expect(secondRemoval).toBe(false);
  });

  it("removeExerciseEntry returns false for a non-existent entryId", () => {
    expect(repository.removeExerciseEntry("2026-08-05", 9999)).toBe(false);
  });

  it("findInRange returns records in ascending date order, and a date with no row in the middle of the range is simply absent (not a null placeholder), while surrounding dates are unaffected (Req 11.2, 11.4)", () => {
    repository.upsertCore("2026-08-03", { weightKg: 63 });
    repository.upsertCore("2026-08-01", { weightKg: 65 });
    // 2026-08-02 intentionally has no record — a gap in the middle of the range.

    const results = repository.findInRange("2026-08-01", "2026-08-03");

    expect(results).toHaveLength(2);
    expect(results.map((entry) => entry.date)).toEqual(["2026-08-01", "2026-08-03"]);
    expect(results[0].weightKg).toBe(65);
    expect(results[1].weightKg).toBe(63);
  });

  it("findInRange excludes records outside the [from, to] boundaries and includes records exactly on the boundaries", () => {
    repository.upsertCore("2026-07-31", { weightKg: 70 });
    repository.upsertCore("2026-08-01", { weightKg: 65 });
    repository.upsertCore("2026-08-03", { weightKg: 63 });
    repository.upsertCore("2026-08-04", { weightKg: 62 });

    const results = repository.findInRange("2026-08-01", "2026-08-03");

    expect(results.map((entry) => entry.date)).toEqual(["2026-08-01", "2026-08-03"]);
  });

  it("findInRange returns an empty array when no records exist in range", () => {
    expect(repository.findInRange("2026-08-01", "2026-08-31")).toEqual([]);
  });
});
