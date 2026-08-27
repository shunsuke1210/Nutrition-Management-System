import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WeightBodyFatFields, validateWeightBodyFat, type WeightBodyFatFieldsValue } from "./WeightBodyFatFields.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする。
afterEach(() => {
  cleanup();
});

const EMPTY_VALUE: WeightBodyFatFieldsValue = {
  weightKg: null,
  bodyFatPct: null,
};

const FILLED_VALUE: WeightBodyFatFieldsValue = {
  weightKg: 68.6,
  bodyFatPct: 27.5,
};

describe("WeightBodyFatFields", () => {
  it("renders the weight and body fat percentage inputs", () => {
    render(<WeightBodyFatFields value={EMPTY_VALUE} onChange={vi.fn()} />);

    expect(screen.getByLabelText("体重")).toBeDefined();
    expect(screen.getByLabelText("体脂肪率")).toBeDefined();
  });

  it("calls onChange with the parsed weight value", () => {
    const onChange = vi.fn();
    render(<WeightBodyFatFields value={EMPTY_VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("体重"), { target: { value: "68.6" } });

    expect(onChange).toHaveBeenCalledWith("weightKg", 68.6);
  });

  it("calls onChange with null when the weight field is cleared", () => {
    const onChange = vi.fn();
    render(<WeightBodyFatFields value={FILLED_VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("体重"), { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith("weightKg", null);
  });

  it("calls onChange with the parsed body fat percentage value", () => {
    const onChange = vi.fn();
    render(<WeightBodyFatFields value={EMPTY_VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("体脂肪率"), { target: { value: "27.5" } });

    expect(onChange).toHaveBeenCalledWith("bodyFatPct", 27.5);
  });

  it("calls onChange with null when the body fat percentage field is cleared (optional field)", () => {
    const onChange = vi.fn();
    render(<WeightBodyFatFields value={FILLED_VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("体脂肪率"), { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith("bodyFatPct", null);
  });

  it("displays a field-level error next to the weight field when an errors prop is provided", () => {
    render(
      <WeightBodyFatFields
        value={EMPTY_VALUE}
        onChange={vi.fn()}
        errors={{ weightKg: ["体重は0より大きい値を入力してください。"] }}
      />,
    );

    const input = screen.getByLabelText("体重");
    const errorParagraph = screen.getByText("体重は0より大きい値を入力してください。");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(errorParagraph.id);
  });

  it("displays a field-level error next to the body fat field when an errors prop is provided", () => {
    render(
      <WeightBodyFatFields
        value={EMPTY_VALUE}
        onChange={vi.fn()}
        errors={{ bodyFatPct: ["体脂肪率は0〜100の範囲で入力してください。"] }}
      />,
    );

    const input = screen.getByLabelText("体脂肪率");
    const errorParagraph = screen.getByText("体脂肪率は0〜100の範囲で入力してください。");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(errorParagraph.id);
  });

  it("does not mark a field as invalid when it has no errors entry", () => {
    render(
      <WeightBodyFatFields
        value={EMPTY_VALUE}
        onChange={vi.fn()}
        errors={{ weightKg: ["体重は0より大きい値を入力してください。"] }}
      />,
    );

    expect(screen.getByLabelText("体脂肪率").getAttribute("aria-invalid")).toBe("false");
  });
});

describe("validateWeightBodyFat", () => {
  it("allows both fields to be left empty (weightKg is a partial-update field, not required at render time)", () => {
    expect(validateWeightBodyFat(EMPTY_VALUE)).toEqual({});
  });

  it("rejects a non-positive weight (Requirement 8.5)", () => {
    expect(validateWeightBodyFat({ weightKg: 0, bodyFatPct: null }).weightKg).toBeDefined();
    expect(validateWeightBodyFat({ weightKg: -5, bodyFatPct: null }).weightKg).toBeDefined();
  });

  it("accepts a positive weight", () => {
    expect(validateWeightBodyFat({ weightKg: 68.6, bodyFatPct: null })).toEqual({});
  });

  it("rejects a body fat percentage outside 0-100 (Requirement 8.5)", () => {
    expect(validateWeightBodyFat({ weightKg: null, bodyFatPct: -1 }).bodyFatPct).toBeDefined();
    expect(validateWeightBodyFat({ weightKg: null, bodyFatPct: 101 }).bodyFatPct).toBeDefined();
  });

  it("accepts the body fat percentage boundary values 0 and 100", () => {
    expect(validateWeightBodyFat({ weightKg: null, bodyFatPct: 0 })).toEqual({});
    expect(validateWeightBodyFat({ weightKg: null, bodyFatPct: 100 })).toEqual({});
  });

  it("allows bodyFatPct to be left empty (Requirement 8.2, optional field)", () => {
    expect(validateWeightBodyFat({ weightKg: 68.6, bodyFatPct: null })).toEqual({});
  });

  it("returns no errors for a fully valid value", () => {
    expect(validateWeightBodyFat(FILLED_VALUE)).toEqual({});
  });
});
