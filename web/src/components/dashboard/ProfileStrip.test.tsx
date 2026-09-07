import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GenderSchema, type Gender, type Profile } from "@nutrition/shared";
import { ProfileStrip } from "./ProfileStrip.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする。
afterEach(() => {
  cleanup();
});

const BASE_PROFILE: Profile = {
  heightCm: 168,
  weightKg: 68.6,
  age: 34,
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const DIET_MODE_PROFILE: Profile = {
  ...BASE_PROFILE,
  dietModeEnabled: true,
  goalWeightKg: 63.5,
  goalPeriodWeeks: 16,
};

// テスト独自の期待値マップ（実装の内部マップとは独立に維持する。BasicInfoSection.tsx の
// GENDER_LABELS と同じ日本語表記）。
const EXPECTED_GENDER_LABELS: Record<Gender, string> = {
  female: "女性",
  male: "男性",
  undisclosed: "回答しない",
};

describe("ProfileStrip", () => {
  it("renders height/weight/age/gender/activity-level chips regardless of dietModeEnabled (Requirement 2.4)", () => {
    const { container } = render(<ProfileStrip profile={BASE_PROFILE} activityLevelLabel="ふつう" />);

    expect(container.textContent).toContain("身長");
    expect(container.textContent).toContain("体重");
    expect(container.textContent).toContain("年齢");
    expect(container.textContent).toContain("性別");
    expect(container.textContent).toContain("活動レベル（推定）");

    expect(screen.getByText("168cm")).toBeDefined();
    expect(screen.getByText("68.6kg")).toBeDefined();
    expect(screen.getByText("34歳")).toBeDefined();
    expect(screen.getByText("女性")).toBeDefined();
    expect(screen.getByText("ふつう")).toBeDefined();
  });

  it.each(GenderSchema.options)(
    "renders the correct Japanese label for gender=%s (Requirement 2.4)",
    (gender) => {
      render(<ProfileStrip profile={{ ...BASE_PROFILE, gender }} activityLevelLabel="ふつう" />);

      expect(screen.getByText(EXPECTED_GENDER_LABELS[gender])).toBeDefined();
    },
  );

  it("shows the combined goal-weight/goal-period chip when dietModeEnabled is true (Requirement 2.5)", () => {
    const { container } = render(<ProfileStrip profile={DIET_MODE_PROFILE} activityLevelLabel="ふつう" />);

    const goalChip = container.querySelector(".chip.goal");
    expect(goalChip).not.toBeNull();
    expect(goalChip?.textContent).toContain("目標体重");
    expect(goalChip?.textContent).toContain("63.5kg");
    expect(goalChip?.textContent).toContain("目標期間");
    expect(goalChip?.textContent).toContain("16週");
  });

  it("does not show the goal-weight/goal-period chip when dietModeEnabled is false (Requirement 2.6)", () => {
    const { container } = render(<ProfileStrip profile={BASE_PROFILE} activityLevelLabel="ふつう" />);

    expect(container.querySelector(".chip.goal")).toBeNull();
    expect(container.textContent).not.toContain("目標体重");
    expect(container.textContent).not.toContain("目標期間");
  });
});
