import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ExerciseSimulationResult } from "@nutrition/shared";
import { ExerciseSimulationSection } from "./ExerciseSimulationSection.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする（DietGoalStatusSection.test.tsx等と同じ方針）。
afterEach(() => {
  cleanup();
});

describe("ExerciseSimulationSection", () => {
  it("exerciseSimulation.available===false renders nothing (Requirement 15.3)", () => {
    const exerciseSimulation: ExerciseSimulationResult = { available: false };

    const { container } = render(
      <ExerciseSimulationSection exerciseSimulation={exerciseSimulation} />,
    );

    expect(container.innerHTML).toBe("");
  });

  it(
    "exerciseSimulation.available===true renders CompareBars with the correct props passed through " +
      "(Requirement 15.1, 15.2)",
    () => {
      const exerciseSimulation: ExerciseSimulationResult = {
        available: true,
        scenarioLabel: "週3回・30分の運動を追加",
        dietOnlyWeeksToGoal: 14,
        dietPlusExerciseWeeksToGoal: 10,
      };

      const { container } = render(
        <ExerciseSimulationSection exerciseSimulation={exerciseSimulation} />,
      );

      expect(container.querySelector(".card")).not.toBeNull();
      expect(screen.getByText("週3回・30分の運動を追加")).toBeDefined();
      expect(screen.getByText("目標まで 約14週")).toBeDefined();
      expect(screen.getByText("目標まで 約10週")).toBeDefined();
      expect(screen.getByText("運動なし（食事管理のみ）")).toBeDefined();
    },
  );
});
