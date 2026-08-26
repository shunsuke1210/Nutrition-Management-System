import { describe, expect, it } from "vitest";
import type { Profile, ProfileInput } from "@nutrition/shared";
import type { ProfileRepository } from "./profile.repository.js";
import { createProfileService } from "./profile.service.js";

/**
 * `ProfileService` の単体テスト（design.md: Testing Strategy > Unit Tests）。
 *
 * `ProfileRepository` はフェイク（インメモリ）で代替し、Service層の検証・業務ルール
 * （必須項目欠落・レンジ逸脱・条件付き必須違反）のみを対象とする真の単体テストとする。
 * SQLiteを用いた統合的な確認は task 7.3 の責務であり、本テストの対象外。
 */

function buildValidInput(overrides: Partial<ProfileInput> = {}): ProfileInput {
  return {
    heightCm: 170,
    weightKg: 65,
    age: 30,
    gender: "male",
    bodyFatPct: 18,
    medicalNotes: null,
    pregnancyStatus: "none",
    sleepHours: 7,
    alcoholHabit: "occasional",
    smokingHabit: "non_smoker",
    cookingSkill: null,
    cookingTimePreference: null,
    budgetPreference: null,
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
    ],
    ngIngredients: [],
    preferredIngredients: [],
    restrictionType: "none",
    restrictionIntensity: null,
    restrictionNotes: null,
    dietModeEnabled: false,
    goalWeightKg: null,
    goalPeriodWeeks: null,
    ...overrides,
  };
}

/** 実行時にキーそのものが欠落した入力（未入力送信）を模倣するためのヘルパー。 */
function omit(input: ProfileInput, key: keyof ProfileInput): ProfileInput {
  const clone: Record<string, unknown> = { ...input };
  delete clone[key];
  return clone as ProfileInput;
}

interface FakeRepository {
  repository: ProfileRepository;
  upsertCalls: ProfileInput[];
  getCurrent: () => Profile | null;
}

function createFakeProfileRepository(initial: Profile | null = null): FakeRepository {
  let current = initial;
  const upsertCalls: ProfileInput[] = [];

  const repository: ProfileRepository = {
    findCurrent: () => current,
    upsert: (input: ProfileInput) => {
      upsertCalls.push(input);
      const now = new Date().toISOString();
      const profile: Profile = {
        ...input,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      };
      current = profile;
      return profile;
    },
  };

  return { repository, upsertCalls, getCurrent: () => current };
}

describe("ProfileService", () => {
  describe("getProfile", () => {
    it("returns null when the repository has no current profile (Req 7.2)", () => {
      const { repository } = createFakeProfileRepository(null);
      const service = createProfileService(repository);

      expect(service.getProfile()).toBeNull();
    });

    it("delegates to profileRepository.findCurrent() and returns its value unchanged (Req 7.1)", () => {
      const existing: Profile = {
        ...buildValidInput(),
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      const { repository } = createFakeProfileRepository(existing);
      const service = createProfileService(repository);

      expect(service.getProfile()).toEqual(existing);
    });
  });

  describe("saveProfile - required fields (Req 1.2, 1.3, 4.3)", () => {
    const requiredFields: Array<keyof ProfileInput> = [
      "heightCm",
      "weightKg",
      "age",
      "gender",
      "jobActivityLevel",
      "commuteMethod",
    ];

    it.each(requiredFields)("rejects saveProfile when %s is missing", (field) => {
      const { repository, upsertCalls } = createFakeProfileRepository();
      const service = createProfileService(repository);
      const input = omit(buildValidInput(), field);

      const result = service.saveProfile(input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("validation");
        expect(result.error.fieldErrors[field]).toBeDefined();
        expect(result.error.fieldErrors[field]?.length).toBeGreaterThan(0);
      }
      expect(upsertCalls).toHaveLength(0);
    });
  });

  describe("saveProfile - required field range validation (Req 1.3)", () => {
    it("rejects heightCm <= 0", () => {
      const { repository, upsertCalls } = createFakeProfileRepository();
      const service = createProfileService(repository);

      const result = service.saveProfile(buildValidInput({ heightCm: 0 }));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors.heightCm?.length).toBeGreaterThan(0);
      }
      expect(upsertCalls).toHaveLength(0);
    });

    it("rejects a negative weightKg", () => {
      const { repository } = createFakeProfileRepository();
      const service = createProfileService(repository);

      const result = service.saveProfile(buildValidInput({ weightKg: -5 }));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors.weightKg?.length).toBeGreaterThan(0);
      }
    });

    it("rejects age <= 0", () => {
      const { repository } = createFakeProfileRepository();
      const service = createProfileService(repository);

      const result = service.saveProfile(buildValidInput({ age: 0 }));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors.age?.length).toBeGreaterThan(0);
      }
    });
  });

  describe("saveProfile - extended field range validation (Req 2.3, 2.4, 4.5)", () => {
    it("rejects bodyFatPct below 0", () => {
      const { repository, upsertCalls } = createFakeProfileRepository();
      const service = createProfileService(repository);

      const result = service.saveProfile(buildValidInput({ bodyFatPct: -1 }));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors.bodyFatPct?.length).toBeGreaterThan(0);
      }
      expect(upsertCalls).toHaveLength(0);
    });

    it("rejects bodyFatPct above 100", () => {
      const { repository } = createFakeProfileRepository();
      const service = createProfileService(repository);

      const result = service.saveProfile(buildValidInput({ bodyFatPct: 100.5 }));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors.bodyFatPct?.length).toBeGreaterThan(0);
      }
    });

    it("rejects negative sleepHours", () => {
      const { repository } = createFakeProfileRepository();
      const service = createProfileService(repository);

      const result = service.saveProfile(buildValidInput({ sleepHours: -0.5 }));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors.sleepHours?.length).toBeGreaterThan(0);
      }
    });

    it("rejects negative averageDailySteps", () => {
      const { repository } = createFakeProfileRepository();
      const service = createProfileService(repository);

      const result = service.saveProfile(buildValidInput({ averageDailySteps: -100 }));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors.averageDailySteps?.length).toBeGreaterThan(0);
      }
    });
  });

  describe("saveProfile - exerciseRoutine row constraints (Req 4.10)", () => {
    it("rejects a row with frequencyPerWeek <= 0 and reports a row-specific field key", () => {
      const { repository } = createFakeProfileRepository();
      const service = createProfileService(repository);

      const result = service.saveProfile(
        buildValidInput({
          exerciseRoutine: [
            {
              scene: "commute",
              content: "自転車通勤",
              frequencyPerWeek: 0,
              durationMinutes: 20,
              intensity: "light",
            },
          ],
        })
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors["exerciseRoutine.0.frequencyPerWeek"]?.length).toBeGreaterThan(
          0
        );
      }
    });

    it("rejects a row with durationMinutes <= 0, keyed by that row's index (not the first row)", () => {
      const { repository } = createFakeProfileRepository();
      const service = createProfileService(repository);

      const result = service.saveProfile(
        buildValidInput({
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
              durationMinutes: -10,
              intensity: "moderate",
            },
          ],
        })
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors["exerciseRoutine.1.durationMinutes"]?.length).toBeGreaterThan(
          0
        );
        expect(result.error.fieldErrors["exerciseRoutine.0.durationMinutes"]).toBeUndefined();
      }
    });

    it("allows an empty exerciseRoutine list (Req 4.9)", () => {
      const { repository } = createFakeProfileRepository();
      const service = createProfileService(repository);

      const result = service.saveProfile(buildValidInput({ exerciseRoutine: [] }));

      expect(result.ok).toBe(true);
    });
  });

  describe("saveProfile - conditional restrictionIntensity (Req 5.3, 5.4)", () => {
    it("rejects when restrictionType is not 'none' and restrictionIntensity is missing", () => {
      const { repository } = createFakeProfileRepository();
      const service = createProfileService(repository);

      const result = service.saveProfile(
        buildValidInput({ restrictionType: "low_carb", restrictionIntensity: null })
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors.restrictionIntensity?.length).toBeGreaterThan(0);
      }
    });

    it("allows restrictionIntensity to be missing when restrictionType is 'none'", () => {
      const { repository } = createFakeProfileRepository();
      const service = createProfileService(repository);

      const result = service.saveProfile(
        buildValidInput({ restrictionType: "none", restrictionIntensity: null })
      );

      expect(result.ok).toBe(true);
    });
  });

  describe("saveProfile - conditional diet mode goals (Req 6.2, 6.3, 6.4)", () => {
    it("rejects when dietModeEnabled is true and goalWeightKg is missing", () => {
      const { repository } = createFakeProfileRepository();
      const service = createProfileService(repository);

      const result = service.saveProfile(
        buildValidInput({ dietModeEnabled: true, goalWeightKg: null, goalPeriodWeeks: 12 })
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors.goalWeightKg?.length).toBeGreaterThan(0);
      }
    });

    it("rejects when dietModeEnabled is true and goalPeriodWeeks is missing", () => {
      const { repository } = createFakeProfileRepository();
      const service = createProfileService(repository);

      const result = service.saveProfile(
        buildValidInput({ dietModeEnabled: true, goalWeightKg: 60, goalPeriodWeeks: null })
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors.goalPeriodWeeks?.length).toBeGreaterThan(0);
      }
    });

    it("rejects when dietModeEnabled is true and goalWeightKg is <= 0", () => {
      const { repository } = createFakeProfileRepository();
      const service = createProfileService(repository);

      const result = service.saveProfile(
        buildValidInput({ dietModeEnabled: true, goalWeightKg: 0, goalPeriodWeeks: 12 })
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors.goalWeightKg?.length).toBeGreaterThan(0);
      }
    });

    it("rejects when dietModeEnabled is true and goalPeriodWeeks is <= 0", () => {
      const { repository } = createFakeProfileRepository();
      const service = createProfileService(repository);

      const result = service.saveProfile(
        buildValidInput({ dietModeEnabled: true, goalWeightKg: 60, goalPeriodWeeks: -1 })
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors.goalPeriodWeeks?.length).toBeGreaterThan(0);
      }
    });

    it("allows dietModeEnabled false with goalWeightKg and goalPeriodWeeks both null", () => {
      const { repository } = createFakeProfileRepository();
      const service = createProfileService(repository);

      const result = service.saveProfile(
        buildValidInput({ dietModeEnabled: false, goalWeightKg: null, goalPeriodWeeks: null })
      );

      expect(result.ok).toBe(true);
    });
  });

  describe("saveProfile - success path", () => {
    it("returns ok:true with the persisted Profile and calls profileRepository.upsert with the validated input", () => {
      const { repository, upsertCalls } = createFakeProfileRepository();
      const service = createProfileService(repository);
      const input = buildValidInput();

      const result = service.saveProfile(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.heightCm).toBe(input.heightCm);
        expect(result.value.weightKg).toBe(input.weightKg);
        expect(result.value.gender).toBe(input.gender);
        expect(typeof result.value.createdAt).toBe("string");
        expect(typeof result.value.updatedAt).toBe("string");
      }

      expect(upsertCalls).toHaveLength(1);
      expect(upsertCalls[0]).toMatchObject(input);
    });

    it("makes the saved profile visible via a subsequent getProfile() call", () => {
      const { repository } = createFakeProfileRepository();
      const service = createProfileService(repository);
      const input = buildValidInput({ heightCm: 180 });

      service.saveProfile(input);

      expect(service.getProfile()?.heightCm).toBe(180);
    });
  });
});
