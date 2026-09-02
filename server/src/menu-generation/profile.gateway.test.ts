import { describe, expect, it } from "vitest";
import type { Profile } from "@nutrition/shared";
import type { ProfileService } from "../profile/profile.service.js";
import { createProfileGateway, type MenuProfileSnapshot } from "./profile.gateway.js";

/**
 * design.md #ProfileGateway (Requirements 2.1-2.6, 12.1)
 *
 * `ProfileGateway` は `user-profile` の `ProfileService.getProfile()` をプロセス内で呼び出し、
 * その結果を本specが必要とする8フィールドのみを含む `MenuProfileSnapshot` へ射影する薄いアダプタである。
 *
 * `ProfileService` 自体の正しさ（`getProfile()` の実装）は `user-profile` spec の
 * `profile.service.test.ts` で既に検証済みのため、本テストは `ProfileGateway` 自身のロジック
 * （projection と null 分岐）のみをフェイクの `ProfileService` を用いて検証する
 * （`nutrition-engine` の `profile.gateway.test.ts` と同じ方針）。
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
 * `MenuProfileSnapshot` が必要とする8フィールドに加えて、`ProfileGateway` が除外すべき
 * `user-profile` 固有の追加フィールド（`heightCm` 等）をすべて含む、完全な `Profile` を構築する。
 *
 * 本specが必要とする8フィールドには、互いに区別しやすい値を割り当てる（値の取り違え・
 * フィールド名の付け替えバグを検出するため）。
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
    cookingSkill: "advanced",
    cookingTimePreference: "under_15_minutes",
    budgetPreference: "budget_conscious",
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
    ngIngredients: ["ピーマン", "ゴーヤ"],
    preferredIngredients: ["鶏むね肉"],
    restrictionType: "low_carb",
    restrictionIntensity: "strict",
    restrictionNotes: "麺類は控えめにしてほしい（自由記述の要望）",
    dietModeEnabled: true,
    goalWeightKg: 60,
    goalPeriodWeeks: 12,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

/** design.md の `MenuProfileSnapshot` インターフェースが持つ8フィールド名（順不同で比較する）。 */
const MENU_PROFILE_SNAPSHOT_FIELDS = [
  "ngIngredients",
  "preferredIngredients",
  "restrictionType",
  "restrictionIntensity",
  "restrictionNotes",
  "cookingSkill",
  "cookingTimePreference",
  "budgetPreference",
].sort();

describe("createProfileGateway", () => {
  describe("プロフィールが未登録の場合（Requirement 12.1）", () => {
    it("getCurrentProfile() は null を返す", () => {
      const profileService = createFakeProfileService(null);
      const gateway = createProfileGateway(profileService);

      expect(gateway.getCurrentProfile()).toBeNull();
    });
  });

  describe("プロフィールが登録済みの場合（Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6）", () => {
    it("MenuProfileSnapshot の8フィールドのみを、値を変換・リネームせずに射影する", () => {
      const profile = buildFullProfile();
      const profileService = createFakeProfileService(profile);
      const gateway = createProfileGateway(profileService);

      const snapshot = gateway.getCurrentProfile();

      expect(snapshot).not.toBeNull();
      const expected: MenuProfileSnapshot = {
        ngIngredients: profile.ngIngredients,
        preferredIngredients: profile.preferredIngredients,
        restrictionType: profile.restrictionType,
        restrictionIntensity: profile.restrictionIntensity,
        restrictionNotes: profile.restrictionNotes,
        cookingSkill: profile.cookingSkill,
        cookingTimePreference: profile.cookingTimePreference,
        budgetPreference: profile.budgetPreference,
      };
      expect(snapshot).toEqual(expected);
    });

    it("MenuProfileSnapshotが持たない user-profile 固有フィールドを一切含まない（真の射影であることの証明）", () => {
      const profile = buildFullProfile();
      const profileService = createFakeProfileService(profile);
      const gateway = createProfileGateway(profileService);

      const snapshot = gateway.getCurrentProfile();

      expect(snapshot).not.toBeNull();
      expect(Object.keys(snapshot as object).sort()).toEqual(MENU_PROFILE_SNAPSHOT_FIELDS);

      expect(snapshot).not.toHaveProperty("heightCm");
      expect(snapshot).not.toHaveProperty("weightKg");
      expect(snapshot).not.toHaveProperty("age");
      expect(snapshot).not.toHaveProperty("gender");
      expect(snapshot).not.toHaveProperty("bodyFatPct");
      expect(snapshot).not.toHaveProperty("medicalNotes");
      expect(snapshot).not.toHaveProperty("pregnancyStatus");
      expect(snapshot).not.toHaveProperty("sleepHours");
      expect(snapshot).not.toHaveProperty("alcoholHabit");
      expect(snapshot).not.toHaveProperty("smokingHabit");
      expect(snapshot).not.toHaveProperty("jobActivityLevel");
      expect(snapshot).not.toHaveProperty("commuteMethod");
      expect(snapshot).not.toHaveProperty("averageDailySteps");
      expect(snapshot).not.toHaveProperty("exerciseRoutine");
      expect(snapshot).not.toHaveProperty("dietModeEnabled");
      expect(snapshot).not.toHaveProperty("goalWeightKg");
      expect(snapshot).not.toHaveProperty("goalPeriodWeeks");
      expect(snapshot).not.toHaveProperty("createdAt");
      expect(snapshot).not.toHaveProperty("updatedAt");
    });

    it("restrictionTypeが「制限なし」でrestrictionIntensityがnullの場合もnullのまま射影する（Requirement 2.5）", () => {
      const profile = buildFullProfile({
        restrictionType: "none",
        restrictionIntensity: null,
      });
      const profileService = createFakeProfileService(profile);
      const gateway = createProfileGateway(profileService);

      const snapshot = gateway.getCurrentProfile();

      expect(snapshot?.restrictionType).toBe("none");
      expect(snapshot?.restrictionIntensity).toBeNull();
    });

    it("cookingSkill/cookingTimePreference/budgetPreferenceがすべてnullの場合もそれぞれ独立にnullのまま射影する（Requirement 2.6）", () => {
      const profile = buildFullProfile({
        cookingSkill: null,
        cookingTimePreference: null,
        budgetPreference: null,
      });
      const profileService = createFakeProfileService(profile);
      const gateway = createProfileGateway(profileService);

      const snapshot = gateway.getCurrentProfile();

      expect(snapshot?.cookingSkill).toBeNull();
      expect(snapshot?.cookingTimePreference).toBeNull();
      expect(snapshot?.budgetPreference).toBeNull();
    });

    it("restrictionNotesがnullの場合もnullのまま射影する（Requirement 2.4）", () => {
      const profile = buildFullProfile({ restrictionNotes: null });
      const profileService = createFakeProfileService(profile);
      const gateway = createProfileGateway(profileService);

      const snapshot = gateway.getCurrentProfile();

      expect(snapshot?.restrictionNotes).toBeNull();
    });

    it("空のngIngredients/preferredIngredientsもそのまま射影する", () => {
      const profile = buildFullProfile({ ngIngredients: [], preferredIngredients: [] });
      const profileService = createFakeProfileService(profile);
      const gateway = createProfileGateway(profileService);

      const snapshot = gateway.getCurrentProfile();

      expect(snapshot?.ngIngredients).toEqual([]);
      expect(snapshot?.preferredIngredients).toEqual([]);
    });

    it("profileService.getProfile() を呼び出し元に依存させず、都度呼び出す（キャッシュしない）", () => {
      let current: Profile | null = buildFullProfile({ ngIngredients: ["ピーマン"] });
      const profileService: ProfileService = {
        getProfile: () => current,
        saveProfile: () => {
          throw new Error("not used");
        },
      };
      const gateway = createProfileGateway(profileService);

      expect(gateway.getCurrentProfile()?.ngIngredients).toEqual(["ピーマン"]);

      current = buildFullProfile({ ngIngredients: ["ナス", "セロリ"] });
      expect(gateway.getCurrentProfile()?.ngIngredients).toEqual(["ナス", "セロリ"]);
    });
  });
});
