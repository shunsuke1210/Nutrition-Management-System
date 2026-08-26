import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BasicInfoSection, validateBasicInfo, type BasicInfoSectionValue } from "./BasicInfoSection.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする。
afterEach(() => {
  cleanup();
});

const EMPTY_VALUE: BasicInfoSectionValue = {
  heightCm: null,
  weightKg: null,
  age: null,
  gender: null,
};

const FILLED_VALUE: BasicInfoSectionValue = {
  heightCm: 168,
  weightKg: 68.6,
  age: 34,
  gender: "female",
};

describe("BasicInfoSection", () => {
  it("renders the height, weight, age, and gender fields", () => {
    render(<BasicInfoSection value={EMPTY_VALUE} onChange={vi.fn()} />);

    expect(screen.getByLabelText("身長")).toBeDefined();
    expect(screen.getByLabelText("体重")).toBeDefined();
    expect(screen.getByLabelText("年齢")).toBeDefined();
    expect(screen.getByRole("radiogroup", { name: "性別" })).toBeDefined();
  });

  it("exposes exactly the three gender options required by 1.4", () => {
    render(<BasicInfoSection value={EMPTY_VALUE} onChange={vi.fn()} />);

    const genderGroup = screen.getByRole("radiogroup", { name: "性別" });
    const radios = within(genderGroup).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(within(genderGroup).getByRole("radio", { name: "女性" })).toBeDefined();
    expect(within(genderGroup).getByRole("radio", { name: "男性" })).toBeDefined();
    expect(within(genderGroup).getByRole("radio", { name: "回答しない" })).toBeDefined();
  });

  it("calls onChange with the parsed number when the height field changes", () => {
    const onChange = vi.fn();
    render(<BasicInfoSection value={EMPTY_VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("身長"), { target: { value: "170" } });

    expect(onChange).toHaveBeenCalledWith("heightCm", 170);
  });

  it("calls onChange with null when a number field is cleared", () => {
    const onChange = vi.fn();
    render(<BasicInfoSection value={FILLED_VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("体重"), { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith("weightKg", null);
  });

  it("calls onChange with the selected gender value", () => {
    const onChange = vi.fn();
    render(<BasicInfoSection value={EMPTY_VALUE} onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "男性" }));

    expect(onChange).toHaveBeenCalledWith("gender", "male");
  });

  it("displays a field-level error message next to the height field when an errors prop is provided", () => {
    render(
      <BasicInfoSection value={EMPTY_VALUE} onChange={vi.fn()} errors={{ heightCm: ["身長は必須です。"] }} />,
    );

    const input = screen.getByLabelText("身長");
    const errorParagraph = screen.getByText("身長は必須です。");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(errorParagraph.id);
  });

  it("does not mark a field as invalid when it has no errors entry", () => {
    render(
      <BasicInfoSection value={EMPTY_VALUE} onChange={vi.fn()} errors={{ heightCm: ["身長は必須です。"] }} />,
    );

    expect(screen.getByLabelText("体重").getAttribute("aria-invalid")).toBe("false");
  });
});

describe("validateBasicInfo", () => {
  it("returns an error for every required field left empty (Requirement 1.1)", () => {
    const errors = validateBasicInfo(EMPTY_VALUE);

    expect(errors.heightCm).toBeDefined();
    expect(errors.weightKg).toBeDefined();
    expect(errors.age).toBeDefined();
    expect(errors.gender).toBeDefined();
  });

  it("rejects non-positive height, weight, and age (Requirement 1.3)", () => {
    const errors = validateBasicInfo({ heightCm: 0, weightKg: -5, age: -1, gender: "male" });

    expect(errors.heightCm).toBeDefined();
    expect(errors.weightKg).toBeDefined();
    expect(errors.age).toBeDefined();
  });

  it("returns no errors for a fully valid value", () => {
    expect(validateBasicInfo(FILLED_VALUE)).toEqual({});
  });
});
