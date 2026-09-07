import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { DietInsights, NutritionSummary, Profile } from "@nutrition/shared";
import * as nutritionClient from "../../api/nutritionClient.js";
import { DietGoalStatusSection } from "./DietGoalStatusSection.js";

/**
 * `nutritionClient`（本コンポーネントが「今週の平均」表示時のみ直接呼び出す唯一のクライアント。
 * design.md:375参照）をモックする。`RecipeDetailModal.test.tsx`の
 * `vi.mock("../../api/mealSlotClient.js", ...)` + `vi.mocked(...)`と同じパターン。
 */
vi.mock("../../api/nutritionClient.js", () => ({
  getSummary: vi.fn(),
  getDietInsights: vi.fn(),
}));

const mockedGetSummary = vi.mocked(nutritionClient.getSummary);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function buildNutritionSummary(overrides: Partial<NutritionSummary> = {}): NutritionSummary {
  return {
    computedAt: "2026-09-01T00:00:00.000Z",
    bmr: 1380,
    activityCoefficient: 1.485,
    activityLevelLabel: "ふつう",
    tdee: 2050,
    dailyExpenditure: { date: "2026-09-01", value: 2050 },
    normalMode: {
      calorieTarget: 2050,
      pfcRatio: { carbPct: 0.56, proteinPct: 0.19, fatPct: 0.25 },
      pfc: { carbG: 269, proteinG: 98, fatG: 57, carbKcal: 1076, proteinKcal: 392, fatKcal: 513 },
      micronutrients: {
        vitaminAUg: 850,
        vitaminDUg: 8.5,
        vitaminB1Mg: 1.4,
        vitaminB2Mg: 1.6,
        vitaminCMg: 100,
        calciumMg: 650,
        ironMg: 10.5,
        fiberG: 21,
        saltEquivalentUpperLimitG: 7.5,
      },
    },
    dietMode: {
      calorieTarget: 1650,
      pfcRatio: { carbPct: 0.5, proteinPct: 0.25, fatPct: 0.25 },
      pfc: { carbG: 206, proteinG: 103, fatG: 46, carbKcal: 825, proteinKcal: 412, fatKcal: 413 },
      guardrails: { warnings: [] },
    },
    ...overrides,
  };
}

function buildDietInsights(overrides: Partial<DietInsights> = {}): DietInsights {
  return {
    weightHistory: [
      { date: "2026-07-01", weightKg: 73.4 },
      { date: "2026-08-01", weightKg: 70.0 },
      { date: "2026-09-01", weightKg: 68.6 },
    ],
    weightProjection: [],
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

const WEEK_START_DATE = "2026-08-29"; // Aug29,30,31,Sep01,02,03,04 — crosses a month boundary.
const EXPECTED_WEEK_DATES = [
  "2026-08-29",
  "2026-08-30",
  "2026-08-31",
  "2026-09-01",
  "2026-09-02",
  "2026-09-03",
  "2026-09-04",
];
// 意図的に切りの悪い7件の異なる値。合計11400 -> 平均1628.5714... -> 四捨五入で1,629。
// 全て同一の値にすると平均バグを検出できないため7件とも異なる値にする。
const WEEK_CALORIE_TARGETS = [1580, 1610, 1655, 1620, 1690, 1600, 1645];

function buildDietModeSummaryForDate(calorieTarget: number): NutritionSummary {
  return buildNutritionSummary({
    dietMode: {
      calorieTarget,
      pfcRatio: { carbPct: 0.5, proteinPct: 0.25, fatPct: 0.25 },
      pfc: { carbG: 200, proteinG: 100, fatG: 45, carbKcal: 800, proteinKcal: 400, fatKcal: 405 },
      guardrails: { warnings: [] },
    },
  });
}

describe("DietGoalStatusSection", () => {
  it("period=\"today\" renders dietMode.calorieTarget and the correctly signed delta vs tdee (Requirement 10.1, 18.5)", () => {
    render(
      <DietGoalStatusSection
        nutritionSummary={buildNutritionSummary()}
        dietInsights={buildDietInsights()}
        profile={buildProfile()}
        weekStartDate={WEEK_START_DATE}
        period="today"
        onPeriodChange={vi.fn()}
      />,
    );

    expect(screen.getByText("目標エネルギー量")).toBeDefined();
    expect(screen.getAllByText(/1,650/).length).toBeGreaterThan(0);
    // dietMode.calorieTarget(1650) - tdee(2050) = -400
    expect(screen.getAllByText(/-400kcal／日/).length).toBeGreaterThan(0);
    expect(mockedGetSummary).not.toHaveBeenCalled();
  });

  it("period=\"today\" with a positive delta renders an explicit + sign (proves genuine signed formatting)", () => {
    render(
      <DietGoalStatusSection
        nutritionSummary={buildNutritionSummary({
          tdee: 1500,
          dietMode: {
            calorieTarget: 1650,
            pfcRatio: { carbPct: 0.5, proteinPct: 0.25, fatPct: 0.25 },
            pfc: { carbG: 206, proteinG: 103, fatG: 46, carbKcal: 825, proteinKcal: 412, fatKcal: 413 },
            guardrails: { warnings: [] },
          },
        })}
        dietInsights={buildDietInsights()}
        profile={buildProfile()}
        weekStartDate={WEEK_START_DATE}
        period="today"
        onPeriodChange={vi.fn()}
      />,
    );

    // 1650 - 1500 = +150
    expect(screen.getAllByText(/\+150kcal／日/).length).toBeGreaterThan(0);
  });

  it(
    "period=\"week\" calls getSummary exactly 7 times with the 7 correct consecutive dates starting at " +
      "weekStartDate, and displays the genuine average of their dietMode.calorieTarget (not a hardcoded value)",
    async () => {
      mockedGetSummary.mockImplementation((date) => {
        const index = EXPECTED_WEEK_DATES.indexOf(date);
        const calorieTarget = WEEK_CALORIE_TARGETS[index] ?? -1;
        return Promise.resolve({ ok: true, value: buildDietModeSummaryForDate(calorieTarget) });
      });

      render(
        <DietGoalStatusSection
          nutritionSummary={buildNutritionSummary()}
          dietInsights={buildDietInsights()}
          profile={buildProfile()}
          weekStartDate={WEEK_START_DATE}
          period="week"
          onPeriodChange={vi.fn()}
        />,
      );

      await waitFor(() => expect(mockedGetSummary).toHaveBeenCalledTimes(7));
      for (const date of EXPECTED_WEEK_DATES) {
        expect(mockedGetSummary).toHaveBeenCalledWith(date);
      }

      // 11400 / 7 = 1628.5714... -> 四捨五入で1,629。
      await screen.findByText(/1,629/);
      expect(screen.getByText(/今週7日間の平均目標/)).toBeDefined();
      // 「今日」モード固有の維持カロリー差分表示は出さない。
      expect(screen.queryByText(/維持カロリーより/)).toBeNull();
    },
  );

  it("period=\"week\" shows a failure message (not a partial/wrong average) when any of the 7 calls fails", async () => {
    mockedGetSummary.mockImplementation((date) => {
      if (date === "2026-09-04") {
        return Promise.resolve({
          ok: false,
          error: { type: "calculation_unavailable", reason: "profile_missing", message: "boom" },
        });
      }
      return Promise.resolve({ ok: true, value: buildDietModeSummaryForDate(1600) });
    });

    const { container } = render(
      <DietGoalStatusSection
        nutritionSummary={buildNutritionSummary()}
        dietInsights={buildDietInsights()}
        profile={buildProfile()}
        weekStartDate={WEEK_START_DATE}
        period="week"
        onPeriodChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(mockedGetSummary).toHaveBeenCalledTimes(7));

    await screen.findByText("今週の平均を算出できませんでした。");
    // 平均が算出できた場合の"1,600"（成功していれば出るはずの値）は表示しない。
    expect(container.querySelector(".hero-num")).toBeNull();
  });

  it("goalEta.available === false shows the unavailable fallback and no ETA pace/number text (Requirement 10.5)", () => {
    render(
      <DietGoalStatusSection
        nutritionSummary={buildNutritionSummary()}
        dietInsights={buildDietInsights({ goalEta: { available: false } })}
        profile={buildProfile()}
        weekStartDate={WEEK_START_DATE}
        period="today"
        onPeriodChange={vi.fn()}
      />,
    );

    expect(screen.getByText("見込み期間を算出できません。")).toBeDefined();
    expect(screen.queryByText(/週間後に到達見込み/)).toBeNull();
    expect(screen.queryByText("現在のペースでは目標体重への到達を見込めません。")).toBeNull();
  });

  it(
    "goalEta.available === true && estimatedWeeksToGoal !== null renders the correct ETA text " +
      "(Requirement 10.3)",
    () => {
      render(
        <DietGoalStatusSection
          nutritionSummary={buildNutritionSummary()}
          dietInsights={buildDietInsights({
            goalEta: { available: true, weeklyProgressKg: 0.4, estimatedWeeksToGoal: 14 },
          })}
          profile={buildProfile({ weightKg: 68.6, goalWeightKg: 63.0 })}
          weekStartDate={WEEK_START_DATE}
          period="today"
          onPeriodChange={vi.fn()}
        />,
      );

      // remainingKg = |68.6 - 63.0| = 5.6
      expect(
        screen.getByText("あと 5.6kg ・ 週0.4kgペースで 約14週間後に到達見込み"),
      ).toBeDefined();
    },
  );

  it(
    "goalEta.available === true && estimatedWeeksToGoal === null renders the distinct " +
      "\"見込めません\" fallback (not the same text as available:false, not a crash, no 0-week text)",
    () => {
      render(
        <DietGoalStatusSection
          nutritionSummary={buildNutritionSummary()}
          dietInsights={buildDietInsights({
            goalEta: { available: true, weeklyProgressKg: -0.2, estimatedWeeksToGoal: null },
          })}
          profile={buildProfile()}
          weekStartDate={WEEK_START_DATE}
          period="today"
          onPeriodChange={vi.fn()}
        />,
      );

      expect(screen.getByText("現在のペースでは目標体重への到達を見込めません。")).toBeDefined();
      expect(screen.queryByText("見込み期間を算出できません。")).toBeNull();
      expect(screen.queryByText(/週間後に到達見込み/)).toBeNull();
    },
  );

  it(
    "computes GoalProgressBar's fillPercent correctly from a realistic weightHistory fixture, matching a " +
      "hand-calculation of the documented formula (non-trivial, non-round-number case)",
    () => {
      // startWeightKg (weightHistory[0]) = 73.4, goalWeightKg = 63.0, currentWeightKg (profile.weightKg) = 68.6.
      // totalJourneyKg = 73.4 - 63.0 = 10.4. progressedKg = 73.4 - 68.6 = 4.8.
      // rawPercent = 4.8 / 10.4 * 100 = 46.153846...
      const { container } = render(
        <DietGoalStatusSection
          nutritionSummary={buildNutritionSummary()}
          dietInsights={buildDietInsights()}
          profile={buildProfile({ weightKg: 68.6, goalWeightKg: 63.0 })}
          weekStartDate={WEEK_START_DATE}
          period="today"
          onPeriodChange={vi.fn()}
        />,
      );

      const fill = container.querySelector(".goal-track .fill") as HTMLElement;
      expect(fill).not.toBeNull();
      const widthPercent = parseFloat(fill.style.width);
      expect(widthPercent).toBeCloseTo(46.1538, 3);
    },
  );

  it("an empty weightHistory yields fillPercent 0 (no crash, no NaN)", () => {
    const { container } = render(
      <DietGoalStatusSection
        nutritionSummary={buildNutritionSummary()}
        dietInsights={buildDietInsights({ weightHistory: [] })}
        profile={buildProfile({ weightKg: 68.6, goalWeightKg: 63.0 })}
        weekStartDate={WEEK_START_DATE}
        period="today"
        onPeriodChange={vi.fn()}
      />,
    );

    const fill = container.querySelector(".goal-track .fill") as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe("0%");
    expect(container.textContent).not.toContain("NaN");
  });

  it(
    "clamps fillPercent to 100 when the user has already overshot past the goal weight further than the " +
      "recorded starting point implied (raw percent > 100%, proves the upper clamp is not a no-op)",
    () => {
      // startWeightKg (weightHistory[0]) = 70, goalWeightKg = 60, currentWeightKg (profile.weightKg) = 55
      // (already below goal). totalJourneyKg = 70-60 = 10. progressedKg = 70-55 = 15.
      // rawPercent = 15/10*100 = 150% -> without the clamp this would render "150%", not "100%".
      const { container } = render(
        <DietGoalStatusSection
          nutritionSummary={buildNutritionSummary()}
          dietInsights={buildDietInsights({ weightHistory: [{ date: "2026-07-01", weightKg: 70 }] })}
          profile={buildProfile({ weightKg: 55, goalWeightKg: 60 })}
          weekStartDate={WEEK_START_DATE}
          period="today"
          onPeriodChange={vi.fn()}
        />,
      );

      const fill = container.querySelector(".goal-track .fill") as HTMLElement;
      expect(fill).not.toBeNull();
      expect(fill.style.width).toBe("100%");
    },
  );

  it(
    "clamps fillPercent to 0 when the user is moving in the WRONG direction relative to their goal (raw " +
      "percent < 0%, proves the lower clamp is not a no-op)",
    () => {
      // startWeightKg (weightHistory[0]) = 70, goalWeightKg = 60 (needs to lose weight), but
      // currentWeightKg (profile.weightKg) = 72 (gained weight since the start record).
      // totalJourneyKg = 70-60 = 10. progressedKg = 70-72 = -2. rawPercent = -2/10*100 = -20%
      // -> without the clamp this would render "-20%", not "0%".
      const { container } = render(
        <DietGoalStatusSection
          nutritionSummary={buildNutritionSummary()}
          dietInsights={buildDietInsights({ weightHistory: [{ date: "2026-07-01", weightKg: 70 }] })}
          profile={buildProfile({ weightKg: 72, goalWeightKg: 60 })}
          weekStartDate={WEEK_START_DATE}
          period="today"
          onPeriodChange={vi.fn()}
        />,
      );

      const fill = container.querySelector(".goal-track .fill") as HTMLElement;
      expect(fill).not.toBeNull();
      expect(fill.style.width).toBe("0%");
    },
  );

  it("passes nutritionSummary.dietMode.guardrails.warnings through to GuardrailWarningCallout (safe state)", () => {
    const { container } = render(
      <DietGoalStatusSection
        nutritionSummary={buildNutritionSummary()}
        dietInsights={buildDietInsights()}
        profile={buildProfile()}
        weekStartDate={WEEK_START_DATE}
        period="today"
        onPeriodChange={vi.fn()}
      />,
    );

    expect(container.querySelector(".status-callout.good")).not.toBeNull();
    expect(container.querySelector(".status-callout.warning")).toBeNull();
  });

  it("passes nutritionSummary.dietMode.guardrails.warnings through to GuardrailWarningCallout (warning state, with real message)", () => {
    const { container } = render(
      <DietGoalStatusSection
        nutritionSummary={buildNutritionSummary({
          dietMode: {
            calorieTarget: 1200,
            pfcRatio: { carbPct: 0.5, proteinPct: 0.25, fatPct: 0.25 },
            pfc: { carbG: 150, proteinG: 75, fatG: 33, carbKcal: 600, proteinKcal: 300, fatKcal: 300 },
            guardrails: {
              warnings: [
                {
                  type: "min_calorie_floor",
                  message: "最低摂取カロリーを下回っています。",
                  suggestions: [{ kind: "ease_goal_weight", suggestedGoalWeightKg: 60 }],
                },
              ],
            },
          },
        })}
        dietInsights={buildDietInsights()}
        profile={buildProfile()}
        weekStartDate={WEEK_START_DATE}
        period="today"
        onPeriodChange={vi.fn()}
      />,
    );

    expect(container.querySelector(".status-callout.good")).toBeNull();
    const warningBlock = container.querySelector(".status-callout.warning");
    expect(warningBlock).not.toBeNull();
    expect(warningBlock?.textContent).toContain("最低摂取カロリーを下回っています。");
  });

  it("renders nothing when nutritionSummary.dietMode is unexpectedly null (defensive-only branch)", () => {
    const { container } = render(
      <DietGoalStatusSection
        nutritionSummary={buildNutritionSummary({ dietMode: null })}
        dietInsights={buildDietInsights()}
        profile={buildProfile()}
        weekStartDate={WEEK_START_DATE}
        period="today"
        onPeriodChange={vi.fn()}
      />,
    );

    expect(container.textContent).toBe("");
  });

  it("renders the PeriodToggle with weekAvailable always true (this card has no menu-plan dependency, Requirement 18.5)", () => {
    const { container } = render(
      <DietGoalStatusSection
        nutritionSummary={buildNutritionSummary()}
        dietInsights={buildDietInsights()}
        profile={buildProfile()}
        weekStartDate={WEEK_START_DATE}
        period="today"
        onPeriodChange={vi.fn()}
      />,
    );

    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(2);
    const weekTab = Array.from(tabs).find((tab) => tab.textContent === "今週の計画平均");
    expect(weekTab?.hasAttribute("disabled")).toBe(false);
  });
});
