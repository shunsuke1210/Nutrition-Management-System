import { describe, expect, it } from "vitest";
import {
  ProfileInputSchema,
  DailyLogInputSchema,
  ExerciseEntryInputSchema,
  SHARED_PACKAGE_NAME,
  ping,
} from "./index.js";

describe("@nutrition/shared entry point", () => {
  it("exports the package name constant (relied on by web/src/App.tsx)", () => {
    expect(SHARED_PACKAGE_NAME).toBe("@nutrition/shared");
  });

  it("ping() resolves to the expected health-check value (relied on by server/web smoke tests)", () => {
    expect(ping()).toBe("shared:ok");
  });

  it("re-exports ProfileInputSchema from the package barrel", () => {
    expect(ProfileInputSchema).toBeDefined();
  });

  it("re-exports DailyLogInputSchema and ExerciseEntryInputSchema from the package barrel", () => {
    expect(DailyLogInputSchema).toBeDefined();
    expect(ExerciseEntryInputSchema).toBeDefined();
  });

  it("allows importing @nutrition/shared and parsing a sample ProfileInput end-to-end", () => {
    const sample = {
      heightCm: 170,
      weightKg: 65,
      age: 30,
      gender: "female",
      bodyFatPct: null,
      medicalNotes: null,
      pregnancyStatus: "none",
      sleepHours: null,
      alcoholHabit: null,
      smokingHabit: null,
      cookingSkill: null,
      cookingTimePreference: null,
      budgetPreference: null,
      jobActivityLevel: "mixed",
      commuteMethod: "transit",
      averageDailySteps: null,
      exerciseRoutine: [],
      ngIngredients: [],
      preferredIngredients: [],
      restrictionType: "none",
      restrictionIntensity: null,
      restrictionNotes: null,
      dietModeEnabled: false,
      goalWeightKg: null,
      goalPeriodWeeks: null,
    };
    expect(() => ProfileInputSchema.parse(sample)).not.toThrow();
  });
});
