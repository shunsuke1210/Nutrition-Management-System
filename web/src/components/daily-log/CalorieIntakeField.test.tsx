import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CalorieIntakeField, validateCalorieIntake, type CalorieIntakeFieldValue } from "./CalorieIntakeField.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする。
afterEach(() => {
  cleanup();
});

const PLANNED_VALUE: CalorieIntakeFieldValue = {
  plannedKcal: 1650,
  manualOverrideKcal: null,
  calorieIntakeSource: "planned",
};

const UNRECORDED_VALUE: CalorieIntakeFieldValue = {
  plannedKcal: null,
  manualOverrideKcal: null,
  calorieIntakeSource: "unrecorded",
};

const MANUAL_VALUE: CalorieIntakeFieldValue = {
  plannedKcal: 1650,
  manualOverrideKcal: 1800,
  calorieIntakeSource: "manual",
};

describe("CalorieIntakeField", () => {
  it(
    "shows the planned kcal value tagged as 献立通り when no manual override is active " +
      "(task completion condition, Requirement 9.1)",
    () => {
      render(<CalorieIntakeField value={PLANNED_VALUE} onChange={vi.fn()} />);

      expect(screen.getByText("1,650kcal")).toBeDefined();
      expect(screen.getByText("献立通り")).toBeDefined();
      expect(screen.queryByRole("spinbutton")).toBeNull();
    },
  );

  it("shows an unrecorded indicator when neither planned nor manual kcal exists (Requirement 9.5)", () => {
    render(<CalorieIntakeField value={UNRECORDED_VALUE} onChange={vi.fn()} />);

    expect(screen.getByText("未記録")).toBeDefined();
    expect(screen.queryByText("献立通り")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it(
    "switches to an editable input after the override action, and the input reflects the " +
      "manually-entered value once the parent commits it (task completion condition, Requirement 9.2)",
    () => {
      const onChange = vi.fn();
      const { rerender } = render(<CalorieIntakeField value={PLANNED_VALUE} onChange={onChange} />);

      fireEvent.click(screen.getByRole("button", { name: "実際と違う場合は修正" }));

      expect(screen.queryByText("献立通り")).toBeNull();
      const input = screen.getByRole("spinbutton", { name: "摂取カロリー" });

      fireEvent.change(input, { target: { value: "1800" } });
      expect(onChange).toHaveBeenCalledWith(1800);

      // 親が確定値を反映してpropsを更新した状態を再現する。
      rerender(<CalorieIntakeField value={MANUAL_VALUE} onChange={onChange} />);

      expect(screen.getByRole("spinbutton", { name: "摂取カロリー" })).toHaveProperty("value", "1800");
      expect(screen.queryByText("献立通り")).toBeNull();
    },
  );

  it("renders directly in override mode when calorieIntakeSource is already manual", () => {
    render(<CalorieIntakeField value={MANUAL_VALUE} onChange={vi.fn()} />);

    expect(screen.getByRole("spinbutton", { name: "摂取カロリー" })).toHaveProperty("value", "1800");
    expect(screen.queryByText("献立通り")).toBeNull();
    expect(screen.queryByRole("button", { name: "実際と違う場合は修正" })).toBeNull();
  });

  it("calls onChange with null when the manual override input is cleared", () => {
    const onChange = vi.fn();
    render(<CalorieIntakeField value={MANUAL_VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByRole("spinbutton", { name: "摂取カロリー" }), { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("displays a validation error when the manual override input holds a negative value (Requirement 9.4)", () => {
    render(
      <CalorieIntakeField
        value={MANUAL_VALUE}
        onChange={vi.fn()}
        errors={{ manualOverrideKcal: ["摂取カロリーは0以上で入力してください。"] }}
      />,
    );

    const input = screen.getByRole("spinbutton", { name: "摂取カロリー" });
    const errorParagraph = screen.getByText("摂取カロリーは0以上で入力してください。");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(errorParagraph.id);
  });
});

describe("validateCalorieIntake", () => {
  it("rejects a negative manual override value (Requirement 9.4)", () => {
    expect(validateCalorieIntake(-100).manualOverrideKcal).toBeDefined();
  });

  it("accepts a non-negative manual override value", () => {
    expect(validateCalorieIntake(0)).toEqual({});
    expect(validateCalorieIntake(1800)).toEqual({});
  });

  it("accepts null (no override entered yet, or the override explicitly cleared)", () => {
    expect(validateCalorieIntake(null)).toEqual({});
  });
});
