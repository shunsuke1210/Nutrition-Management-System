import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DietModeSection, validateDietMode, type DietModeSectionValue } from "./DietModeSection.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする。
afterEach(() => {
  cleanup();
});

const DISABLED_VALUE: DietModeSectionValue = {
  dietModeEnabled: false,
  goalWeightKg: null,
  goalPeriodWeeks: null,
};

const ENABLED_EMPTY_VALUE: DietModeSectionValue = {
  dietModeEnabled: true,
  goalWeightKg: null,
  goalPeriodWeeks: null,
};

const ENABLED_FILLED_VALUE: DietModeSectionValue = {
  dietModeEnabled: true,
  goalWeightKg: 63,
  goalPeriodWeeks: 16,
};

describe("DietModeSection", () => {
  it("renders the diet mode toggle", () => {
    render(<DietModeSection value={DISABLED_VALUE} onChange={vi.fn()} />);

    expect(screen.getByRole("checkbox", { name: "ダイエットモードを利用する" })).toBeDefined();
  });

  it("does not render the goal fields when dietModeEnabled is false (Requirement 6.1, 6.3)", () => {
    render(<DietModeSection value={DISABLED_VALUE} onChange={vi.fn()} />);

    expect(screen.queryByLabelText("目標体重")).toBeNull();
    expect(screen.queryByLabelText("目標達成期間")).toBeNull();
  });

  it("renders the goal fields when dietModeEnabled is true (Requirement 6.2)", () => {
    render(<DietModeSection value={ENABLED_EMPTY_VALUE} onChange={vi.fn()} />);

    expect(screen.getByLabelText("目標体重")).toBeDefined();
    expect(screen.getByLabelText("目標達成期間")).toBeDefined();
  });

  it(
    "shows the goal fields after toggling on and hides them after toggling off " +
      "(task completion condition, Requirement 6.1/6.2/6.3)",
    () => {
      const onChange = vi.fn();
      const { rerender } = render(<DietModeSection value={DISABLED_VALUE} onChange={onChange} />);

      expect(screen.queryByLabelText("目標体重")).toBeNull();

      fireEvent.click(screen.getByRole("checkbox", { name: "ダイエットモードを利用する" }));
      expect(onChange).toHaveBeenCalledWith("dietModeEnabled", true);

      rerender(<DietModeSection value={ENABLED_EMPTY_VALUE} onChange={onChange} />);
      expect(screen.getByLabelText("目標体重")).toBeDefined();
      expect(screen.getByLabelText("目標達成期間")).toBeDefined();

      fireEvent.click(screen.getByRole("checkbox", { name: "ダイエットモードを利用する" }));
      expect(onChange).toHaveBeenCalledWith("dietModeEnabled", false);

      rerender(<DietModeSection value={DISABLED_VALUE} onChange={onChange} />);
      expect(screen.queryByLabelText("目標体重")).toBeNull();
      expect(screen.queryByLabelText("目標達成期間")).toBeNull();
    },
  );

  it("calls onChange with the parsed goal weight", () => {
    const onChange = vi.fn();
    render(<DietModeSection value={ENABLED_EMPTY_VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("目標体重"), { target: { value: "63" } });

    expect(onChange).toHaveBeenCalledWith("goalWeightKg", 63);
  });

  it("calls onChange with the parsed goal period", () => {
    const onChange = vi.fn();
    render(<DietModeSection value={ENABLED_EMPTY_VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("目標達成期間"), { target: { value: "16" } });

    expect(onChange).toHaveBeenCalledWith("goalPeriodWeeks", 16);
  });

  it("displays a field-level error next to the goal weight field when an errors prop is provided", () => {
    render(
      <DietModeSection
        value={ENABLED_EMPTY_VALUE}
        onChange={vi.fn()}
        errors={{ goalWeightKg: ["goalWeightKg は必須です。"] }}
      />,
    );

    const input = screen.getByLabelText("目標体重");
    const errorParagraph = screen.getByText("goalWeightKg は必須です。");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(errorParagraph.id);
  });
});

describe("validateDietMode", () => {
  it("does not require goalWeightKg/goalPeriodWeeks when dietModeEnabled is false (Requirement 6.3)", () => {
    expect(validateDietMode(DISABLED_VALUE)).toEqual({});
  });

  it("requires goalWeightKg and goalPeriodWeeks when dietModeEnabled is true (Requirement 6.2)", () => {
    const errors = validateDietMode(ENABLED_EMPTY_VALUE);

    expect(errors.goalWeightKg).toBeDefined();
    expect(errors.goalPeriodWeeks).toBeDefined();
  });

  it("rejects non-positive goalWeightKg and goalPeriodWeeks when dietModeEnabled is true (Requirement 6.4)", () => {
    const errors = validateDietMode({ dietModeEnabled: true, goalWeightKg: 0, goalPeriodWeeks: -1 });

    expect(errors.goalWeightKg).toBeDefined();
    expect(errors.goalPeriodWeeks).toBeDefined();
  });

  it("returns no errors for a fully valid enabled value", () => {
    expect(validateDietMode(ENABLED_FILLED_VALUE)).toEqual({});
  });
});
