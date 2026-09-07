import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { GuardrailWarning } from "@nutrition/shared";
import { GuardrailWarningCallout } from "./GuardrailWarningCallout.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
afterEach(() => {
  cleanup();
});

describe("GuardrailWarningCallout", () => {
  it("renders the safe state with no fabricated percentage when warnings is empty (Requirement 11.3)", () => {
    const { container } = render(<GuardrailWarningCallout warnings={[]} />);

    const good = container.querySelector(".status-callout.good");
    expect(good).not.toBeNull();
    expect(good?.textContent).toContain("安全ペース判定：問題なし");
    // mockup.htmlが持つ具体的な数値("0.6%"、"1%/週")は実データに存在しないため表示しない。
    expect(container.textContent).not.toContain("0.6%");
    expect(container.textContent).not.toContain("1%/週");
    expect(container.querySelector(".status-callout.warning")).toBeNull();
  });

  it(
    "renders one warning block with both suggestion texts (extend_period + ease_goal_weight) using their " +
      "real numeric values (Requirement 11.1, 11.2)",
    () => {
      const warning: GuardrailWarning = {
        type: "max_weekly_loss_pace",
        message: "週あたりの減量ペースが推奨上限を超えています。",
        suggestions: [
          { kind: "extend_period", suggestedGoalPeriodWeeks: 10 },
          { kind: "ease_goal_weight", suggestedGoalWeightKg: 65 },
        ],
      };

      const { container } = render(<GuardrailWarningCallout warnings={[warning]} />);

      const warningBlocks = container.querySelectorAll(".status-callout.warning");
      expect(warningBlocks.length).toBe(1);
      expect(warningBlocks[0]!.textContent).toContain("週あたりの減量ペースが推奨上限を超えています。");

      const suggestionItems = Array.from(warningBlocks[0]!.querySelectorAll("li")).map(
        (li) => li.textContent,
      );
      expect(suggestionItems).toContain("期間延長案: 目標期間を10週間以上に延ばす");
      expect(suggestionItems).toContain("目標体重緩和案: 目標体重を65kgまで緩和する");

      expect(container.querySelector(".status-callout.good")).toBeNull();
    },
  );

  it("does NOT render the mockup's illustrative example text or its s-example-label span", () => {
    const warning: GuardrailWarning = {
      type: "max_weekly_loss_pace",
      message: "週あたりの減量ペースが推奨上限を超えています。",
      suggestions: [{ kind: "extend_period", suggestedGoalPeriodWeeks: 10 }],
    };

    const { container } = render(<GuardrailWarningCallout warnings={[warning]} />);

    expect(container.querySelector(".s-example-label")).toBeNull();
    expect(container.textContent).not.toContain("4週間で8kg減");
    expect(container.textContent).not.toContain("ガードレールの動作例");
  });

  it("renders 2 warnings as 2 separate status-callout.warning blocks (Requirement 11.1)", () => {
    const warnings: GuardrailWarning[] = [
      {
        type: "min_calorie_floor",
        message: "最低摂取カロリーを下回っています。",
        suggestions: [{ kind: "ease_goal_weight", suggestedGoalWeightKg: 60 }],
      },
      {
        type: "max_weekly_loss_pace",
        message: "週あたりの減量ペースが推奨上限を超えています。",
        suggestions: [{ kind: "extend_period", suggestedGoalPeriodWeeks: 12 }],
      },
    ];

    const { container } = render(<GuardrailWarningCallout warnings={warnings} />);

    const warningBlocks = container.querySelectorAll(".status-callout.warning");
    expect(warningBlocks.length).toBe(2);
    expect(warningBlocks[0]!.textContent).toContain("最低摂取カロリーを下回っています。");
    expect(warningBlocks[1]!.textContent).toContain("週あたりの減量ペースが推奨上限を超えています。");
  });

  it("renders a suggestion missing its optional numeric field without crashing (defensive fallback)", () => {
    const warning: GuardrailWarning = {
      type: "max_weekly_loss_pace",
      message: "週あたりの減量ペースが推奨上限を超えています。",
      suggestions: [{ kind: "extend_period" }, { kind: "ease_goal_weight" }],
    };

    const { container } = render(<GuardrailWarningCallout warnings={[warning]} />);

    const suggestionItems = Array.from(container.querySelectorAll("li")).map((li) => li.textContent);
    expect(suggestionItems.length).toBe(2);
    expect(suggestionItems.some((text) => text?.startsWith("期間延長案"))).toBe(true);
    expect(suggestionItems.some((text) => text?.startsWith("目標体重緩和案"))).toBe(true);
    // 欠落したフィールドの値を捏造しない（"undefined"文字列も出力しない）。
    expect(container.textContent).not.toContain("undefined");
  });
});
