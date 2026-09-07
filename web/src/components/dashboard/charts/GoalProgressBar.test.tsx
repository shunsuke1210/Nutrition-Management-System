import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { GoalProgressBar } from "./GoalProgressBar.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする（PfcBarChart.test.tsx等と同じ方針）。
afterEach(() => {
  cleanup();
});

describe("GoalProgressBar", () => {
  it("renders the goal weight and current weight kg labels from props (mockup.html行845)", () => {
    const { container } = render(
      <GoalProgressBar currentWeightKg={68.6} goalWeightKg={63.5} fillPercent={43} />,
    );

    const scale = container.querySelector(".goal-scale");
    expect(scale).not.toBeNull();
    const spans = scale!.querySelectorAll("span");
    expect(spans.length).toBe(2);
    expect(spans[0]!.textContent).toBe("63.5kg（目標）");
    expect(spans[1]!.textContent).toBe("68.6kg（現在）");
  });

  it("renders the fill bar's width style matching the given fillPercent prop exactly (dumb prop-driven component)", () => {
    const { container } = render(
      <GoalProgressBar currentWeightKg={68.6} goalWeightKg={63.5} fillPercent={37} />,
    );

    const fill = container.querySelector(".goal-track .fill") as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe("37%");
  });

  it("renders a different fillPercent value exactly, proving the width is not hardcoded", () => {
    const { container } = render(
      <GoalProgressBar currentWeightKg={68.6} goalWeightKg={63.5} fillPercent={0} />,
    );

    const fill = container.querySelector(".goal-track .fill") as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });

  it("renders fillPercent=100 exactly (upper clamp boundary, clamping itself is the caller's responsibility)", () => {
    const { container } = render(
      <GoalProgressBar currentWeightKg={63.5} goalWeightKg={63.5} fillPercent={100} />,
    );

    const fill = container.querySelector(".goal-track .fill") as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });
});
