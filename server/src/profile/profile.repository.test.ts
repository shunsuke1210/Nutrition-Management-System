import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProfileInput } from "@nutrition/shared";
import { createConnection } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { createProfileRepository, type ProfileRepository } from "./profile.repository.js";

function buildProfileInput(overrides: Partial<ProfileInput> = {}): ProfileInput {
  return {
    heightCm: 170,
    weightKg: 65,
    age: 30,
    gender: "male",
    bodyFatPct: 18,
    medicalNotes: "花粉症",
    pregnancyStatus: "none",
    sleepHours: 7,
    alcoholHabit: "occasional",
    smokingHabit: "non_smoker",
    cookingSkill: "普通",
    cookingTimePreference: "30分以内",
    budgetPreference: "500円前後",
    jobActivityLevel: "mixed",
    commuteMethod: "transit",
    averageDailySteps: 6000,
    exerciseRoutine: [
      {
        scene: "commute",
        content: "自転車通勤",
        frequencyPerWeek: 5,
        durationMinutes: 20,
        intensity: "light",
      },
      {
        scene: "holiday",
        content: "ジョギング",
        frequencyPerWeek: 1,
        durationMinutes: 40,
        intensity: "moderate",
      },
    ],
    ngIngredients: ["パクチー", "レバー"],
    preferredIngredients: ["鶏むね肉", "ブロッコリー"],
    restrictionType: "low_carb",
    restrictionIntensity: "standard",
    restrictionNotes: "16時以降の糖質を控えたい",
    dietModeEnabled: true,
    goalWeightKg: 60,
    goalPeriodWeeks: 12,
    ...overrides,
  };
}

function buildSecondProfileInput(): ProfileInput {
  return buildProfileInput({
    heightCm: 172,
    weightKg: 63,
    age: 31,
    gender: "female",
    bodyFatPct: 22,
    medicalNotes: null,
    pregnancyStatus: "lactating",
    sleepHours: 6.5,
    alcoholHabit: "none",
    smokingHabit: "smoker",
    cookingSkill: "上級者",
    cookingTimePreference: "1時間以上",
    budgetPreference: "1000円前後",
    jobActivityLevel: "mostly_active",
    commuteMethod: "walk_or_bike",
    averageDailySteps: 9000,
    exerciseRoutine: [
      {
        scene: "work",
        content: "階段昇降",
        frequencyPerWeek: 3,
        durationMinutes: 15,
        intensity: "vigorous",
      },
    ],
    ngIngredients: ["納豆"],
    preferredIngredients: ["鮭", "卵", "ほうれん草"],
    restrictionType: "none",
    restrictionIntensity: null,
    restrictionNotes: null,
    dietModeEnabled: false,
    goalWeightKg: null,
    goalPeriodWeeks: null,
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ProfileRepository", () => {
  let tmpDir: string;
  let db: Database.Database;
  let repository: ProfileRepository;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-profile-repo-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    db = createConnection(dbPath);
    runMigrations(db);
    repository = createProfileRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null from findCurrent() before any upsert has occurred (Req 7.2)", () => {
    expect(repository.findCurrent()).toBeNull();
  });

  it("persists a full ProfileInput via upsert() and returns it from findCurrent() with all fields matching, including ordered child arrays (Req 1.5, 3.3, 4.7, 7.1)", () => {
    const input = buildProfileInput();

    const saved = repository.upsert(input);
    const found = repository.findCurrent();

    expect(found).not.toBeNull();
    for (const result of [saved, found as NonNullable<typeof found>]) {
      expect(result.heightCm).toBe(input.heightCm);
      expect(result.weightKg).toBe(input.weightKg);
      expect(result.age).toBe(input.age);
      expect(result.gender).toBe(input.gender);
      expect(result.bodyFatPct).toBe(input.bodyFatPct);
      expect(result.medicalNotes).toBe(input.medicalNotes);
      expect(result.pregnancyStatus).toBe(input.pregnancyStatus);
      expect(result.sleepHours).toBe(input.sleepHours);
      expect(result.alcoholHabit).toBe(input.alcoholHabit);
      expect(result.smokingHabit).toBe(input.smokingHabit);
      expect(result.cookingSkill).toBe(input.cookingSkill);
      expect(result.cookingTimePreference).toBe(input.cookingTimePreference);
      expect(result.budgetPreference).toBe(input.budgetPreference);
      expect(result.jobActivityLevel).toBe(input.jobActivityLevel);
      expect(result.commuteMethod).toBe(input.commuteMethod);
      expect(result.averageDailySteps).toBe(input.averageDailySteps);
      expect(result.exerciseRoutine).toEqual(input.exerciseRoutine);
      expect(result.ngIngredients).toEqual(input.ngIngredients);
      expect(result.preferredIngredients).toEqual(input.preferredIngredients);
      expect(result.restrictionType).toBe(input.restrictionType);
      expect(result.restrictionIntensity).toBe(input.restrictionIntensity);
      expect(result.restrictionNotes).toBe(input.restrictionNotes);
      expect(result.dietModeEnabled).toBe(input.dietModeEnabled);
      expect(result.goalWeightKg).toBe(input.goalWeightKg);
      expect(result.goalPeriodWeeks).toBe(input.goalPeriodWeeks);
      expect(typeof result.createdAt).toBe("string");
      expect(typeof result.updatedAt).toBe("string");
    }
  });

  it("keeps exactly one row in profiles after two consecutive upserts, reflecting only the second call's data (Req 7.3, 7.4)", () => {
    repository.upsert(buildProfileInput());
    repository.upsert(buildSecondProfileInput());

    const profileCount = db.prepare("SELECT COUNT(*) as count FROM profiles").get() as {
      count: number;
    };
    expect(profileCount.count).toBe(1);

    const second = buildSecondProfileInput();
    const found = repository.findCurrent();
    expect(found).not.toBeNull();
    expect(found?.heightCm).toBe(second.heightCm);
    expect(found?.gender).toBe(second.gender);
    expect(found?.restrictionType).toBe(second.restrictionType);
    expect(found?.dietModeEnabled).toBe(second.dietModeEnabled);
    expect(found?.exerciseRoutine).toEqual(second.exerciseRoutine);
    expect(found?.ngIngredients).toEqual(second.ngIngredients);
    expect(found?.preferredIngredients).toEqual(second.preferredIngredients);

    const exerciseCount = db
      .prepare("SELECT COUNT(*) as count FROM exercise_routine_entries")
      .get() as { count: number };
    expect(exerciseCount.count).toBe(second.exerciseRoutine.length);

    const ngCount = db.prepare("SELECT COUNT(*) as count FROM ng_ingredients").get() as {
      count: number;
    };
    expect(ngCount.count).toBe(second.ngIngredients.length);

    const preferredCount = db
      .prepare("SELECT COUNT(*) as count FROM preferred_ingredients")
      .get() as { count: number };
    expect(preferredCount.count).toBe(second.preferredIngredients.length);
  });

  it("preserves created_at while advancing updated_at across a second upsert() call (Req 7.3)", async () => {
    const first = repository.upsert(buildProfileInput());

    await wait(20);

    const second = repository.upsert(buildSecondProfileInput());

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).not.toBe(first.updatedAt);

    const found = repository.findCurrent();
    expect(found?.createdAt).toBe(first.createdAt);
    expect(found?.updatedAt).toBe(second.updatedAt);
  });

  it("replaces exercise_routine_entries via delete-then-reinsert rather than appending (Req 4.7, 4.8)", () => {
    repository.upsert(
      buildProfileInput({
        exerciseRoutine: [
          {
            scene: "commute",
            content: "自転車通勤",
            frequencyPerWeek: 5,
            durationMinutes: 20,
            intensity: "light",
          },
          {
            scene: "holiday",
            content: "ジョギング",
            frequencyPerWeek: 1,
            durationMinutes: 40,
            intensity: "moderate",
          },
        ],
      })
    );

    const secondRoutine = [
      {
        scene: "work" as const,
        content: "階段昇降",
        frequencyPerWeek: 3,
        durationMinutes: 15,
        intensity: "vigorous" as const,
      },
    ];
    repository.upsert(buildProfileInput({ exerciseRoutine: secondRoutine }));

    const rowCount = db
      .prepare("SELECT COUNT(*) as count FROM exercise_routine_entries")
      .get() as { count: number };
    expect(rowCount.count).toBe(1);

    const found = repository.findCurrent();
    expect(found?.exerciseRoutine).toEqual(secondRoutine);
  });
});
