import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DietInsights, Profile } from "@nutrition/shared";
import { WeightTrendSection } from "./WeightTrendSection.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする（DietGoalStatusSection.test.tsx等と同じ方針）。
afterEach(() => {
  cleanup();
});

function buildDietInsights(overrides: Partial<DietInsights> = {}): DietInsights {
  return {
    weightHistory: [
      { date: "2026-07-01", weightKg: 73.4 },
      { date: "2026-08-01", weightKg: 70.0 },
      { date: "2026-09-01", weightKg: 68.6 },
    ],
    weightProjection: [
      { date: "2026-09-08", projectedWeightKg: 68.0 },
      { date: "2026-09-15", projectedWeightKg: 67.3 },
    ],
    goalEta: { available: true, weeklyProgressKg: 0.4, estimatedWeeksToGoal: 14 },
    plateau: { status: "not_applicable" },
    exerciseSimulation: { available: false },
    ...overrides,
  };
}

function buildProfile(overrides: Partial<Profile> = {}): Profile {
  return {
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
    dietModeEnabled: true,
    goalWeightKg: 63.0,
    goalPeriodWeeks: 16,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("WeightTrendSection", () => {
  it("renders WeightTrendChart with weightHistory/weightProjection/goalWeightKg derived from the dietInsights/profile props (Requirement 13.1, 13.2, 13.3)", () => {
    const { container } = render(
      <WeightTrendSection dietInsights={buildDietInsights()} profile={buildProfile({ goalWeightKg: 63.0 })} />,
    );

    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toContain("目標 63kg");
    expect(container.textContent).toContain("68.6kg（現在）");
    expect(container.textContent).toContain("67.3kg想定");
  });

  it("renders the fallback message instead of the chart when weightHistory is empty (no meaningful trend to show)", () => {
    const { container } = render(
      <WeightTrendSection dietInsights={buildDietInsights({ weightHistory: [] })} profile={buildProfile()} />,
    );

    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).toBe("体重記録がありません。");
  });

  it("renders the .chart-sub caption text describing the solid/dashed/dotted line legend", () => {
    const { container } = render(
      <WeightTrendSection dietInsights={buildDietInsights()} profile={buildProfile()} />,
    );

    expect(container.querySelector(".chart-sub")?.textContent).toBe(
      "実線＝記録済みの実測値／破線＝現在のペースを継続した場合の予測、点線＝目標体重",
    );
  });

  it("an empty weightProjection (Requirement 13.4, the normal 'cannot project' case) still renders the chart via WeightTrendChart, not the empty-history fallback", () => {
    const { container } = render(
      <WeightTrendSection
        dietInsights={buildDietInsights({ weightProjection: [] })}
        profile={buildProfile()}
      />,
    );

    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).not.toBe("体重記録がありません。");
    expect(container.textContent).not.toContain("想定");
  });
});
