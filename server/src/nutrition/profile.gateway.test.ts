import { describe, expect, it } from "vitest";
import type { Profile } from "@nutrition/shared";
import type { ProfileService } from "../profile/profile.service.js";
import { createProfileGateway, type ProfileSnapshot } from "./profile.gateway.js";

/**
 * design.md #ProfileGateway (Requirements 1.3, 2.4, 12.1, 12.2)
 *
 * `ProfileGateway` は `user-profile` の `ProfileService.getProfile()` をプロセス内で呼び出し、
 * その結果を本specが必要とする16フィールドのみを含む `ProfileSnapshot` へ射影する薄いアダプタである。
 *
 * `ProfileService` 自体の正しさ（`getProfile()` の実装）は `user-profile` spec の
 * `profile.service.test.ts` で既に検証済みのため、本テストは `ProfileGateway` 自身のロジック
 * （projection と null 分岐）のみをフェイクの `ProfileService` を用いて検証する。
 */

/** `ProfileGateway` の唯一の依存を差し替えるための、挙動を固定したフェイク。 */
function createFakeProfileService(profile: Profile | null): ProfileService {
  return {
    getProfile: () => profile,
    saveProfile: () => {
      throw new Error("createFakeProfileService: saveProfile is not used by ProfileGateway tests");
    },
  };
}

/**
 * `ProfileSnapshot` が必要とする16フィールドに加えて、`ProfileGateway` が除外すべき
 * `user-profile` 固有の追加フィールド（`medicalNotes` 等）をすべて含む、完全な `Profile` を構築する。
 */
function buildFullProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    heightCm: 170,
    weightKg: 65,
    age: 30,
    gender: "male",
    bodyFatPct: 18,
    medicalNotes: "既往歴なし",
    pregnancyStatus: "none",
    sleepHours: 7,
    alcoholHabit: "frequent",
    smokingHabit: "smoker",
    cookingSkill: "beginner",
    cookingTimePreference: "short",
    budgetPreference: "low",
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
    ngIngredients: ["ピーマン"],
    preferredIngredients: ["鶏むね肉"],
    restrictionType: "low_carb",
    restrictionIntensity: "standard",
    restrictionNotes: "医師の指示による",
    dietModeEnabled: true,
    goalWeightKg: 60,
    goalPeriodWeeks: 12,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

/** design.md の `ProfileSnapshot` インターフェースが持つ16フィールド名（順不同で比較する）。 */
const PROFILE_SNAPSHOT_FIELDS = [
  "heightCm",
  "weightKg",
  "age",
  "gender",
  "bodyFatPct",
  "jobActivityLevel",
  "commuteMethod",
  "averageDailySteps",
  "exerciseRoutine",
  "smokingHabit",
  "alcoholHabit",
  "restrictionType",
  "restrictionIntensity",
  "dietModeEnabled",
  "goalWeightKg",
  "goalPeriodWeeks",
].sort();

describe("createProfileGateway", () => {
  describe("プロフィールが未登録の場合（Requirement 12.1）", () => {
    it("getCurrentProfile() は null を返す", () => {
      const profileService = createFakeProfileService(null);
      const gateway = createProfileGateway(profileService);

      expect(gateway.getCurrentProfile()).toBeNull();
    });
  });

  describe("プロフィールが登録済みの場合（Requirements 1.3, 2.4, 12.2）", () => {
    it("ProfileSnapshot の16フィールドのみを、値を変換・リネームせずに射影する", () => {
      const profile = buildFullProfile();
      const profileService = createFakeProfileService(profile);
      const gateway = createProfileGateway(profileService);

      const snapshot = gateway.getCurrentProfile();

      expect(snapshot).not.toBeNull();
      const expected: ProfileSnapshot = {
        heightCm: profile.heightCm,
        weightKg: profile.weightKg,
        age: profile.age,
        gender: profile.gender,
        bodyFatPct: profile.bodyFatPct,
        jobActivityLevel: profile.jobActivityLevel,
        commuteMethod: profile.commuteMethod,
        averageDailySteps: profile.averageDailySteps,
        exerciseRoutine: profile.exerciseRoutine,
        smokingHabit: profile.smokingHabit,
        alcoholHabit: profile.alcoholHabit,
        restrictionType: profile.restrictionType,
        restrictionIntensity: profile.restrictionIntensity,
        dietModeEnabled: profile.dietModeEnabled,
        goalWeightKg: profile.goalWeightKg,
        goalPeriodWeeks: profile.goalPeriodWeeks,
      };
      expect(snapshot).toEqual(expected);
    });

    it("ProfileSnapshotが持たない user-profile 固有フィールドを一切含まない（真の射影であることの証明）", () => {
      const profile = buildFullProfile();
      const profileService = createFakeProfileService(profile);
      const gateway = createProfileGateway(profileService);

      const snapshot = gateway.getCurrentProfile();

      expect(snapshot).not.toBeNull();
      expect(Object.keys(snapshot as object).sort()).toEqual(PROFILE_SNAPSHOT_FIELDS);

      expect(snapshot).not.toHaveProperty("medicalNotes");
      expect(snapshot).not.toHaveProperty("pregnancyStatus");
      expect(snapshot).not.toHaveProperty("sleepHours");
      expect(snapshot).not.toHaveProperty("cookingSkill");
      expect(snapshot).not.toHaveProperty("cookingTimePreference");
      expect(snapshot).not.toHaveProperty("budgetPreference");
      expect(snapshot).not.toHaveProperty("ngIngredients");
      expect(snapshot).not.toHaveProperty("preferredIngredients");
      expect(snapshot).not.toHaveProperty("restrictionNotes");
      expect(snapshot).not.toHaveProperty("createdAt");
      expect(snapshot).not.toHaveProperty("updatedAt");
    });

    it("bodyFatPct/averageDailySteps/smokingHabit/alcoholHabit/restrictionIntensity/goalWeightKg/goalPeriodWeeksがnullの場合もnullのまま射影する", () => {
      const profile = buildFullProfile({
        bodyFatPct: null,
        averageDailySteps: null,
        smokingHabit: null,
        alcoholHabit: null,
        restrictionType: "none",
        restrictionIntensity: null,
        dietModeEnabled: false,
        goalWeightKg: null,
        goalPeriodWeeks: null,
      });
      const profileService = createFakeProfileService(profile);
      const gateway = createProfileGateway(profileService);

      const snapshot = gateway.getCurrentProfile();

      expect(snapshot?.bodyFatPct).toBeNull();
      expect(snapshot?.averageDailySteps).toBeNull();
      expect(snapshot?.smokingHabit).toBeNull();
      expect(snapshot?.alcoholHabit).toBeNull();
      expect(snapshot?.restrictionIntensity).toBeNull();
      expect(snapshot?.goalWeightKg).toBeNull();
      expect(snapshot?.goalPeriodWeeks).toBeNull();
      expect(snapshot?.dietModeEnabled).toBe(false);
    });

    it("空の exerciseRoutine もそのまま射影する（Requirement 1.4 が前提とする空配列の受け入れ）", () => {
      const profile = buildFullProfile({ exerciseRoutine: [] });
      const profileService = createFakeProfileService(profile);
      const gateway = createProfileGateway(profileService);

      const snapshot = gateway.getCurrentProfile();

      expect(snapshot?.exerciseRoutine).toEqual([]);
    });

    it("profileService.getProfile() を呼び出し元に依存させず、都度呼び出す（キャッシュしない）", () => {
      let current: Profile | null = buildFullProfile({ weightKg: 65 });
      const profileService: ProfileService = {
        getProfile: () => current,
        saveProfile: () => {
          throw new Error("not used");
        },
      };
      const gateway = createProfileGateway(profileService);

      expect(gateway.getCurrentProfile()?.weightKg).toBe(65);

      current = buildFullProfile({ weightKg: 72 });
      expect(gateway.getCurrentProfile()?.weightKg).toBe(72);
    });
  });
});
