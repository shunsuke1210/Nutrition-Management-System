import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LifestyleSection, validateLifestyle, type LifestyleSectionValue } from "./LifestyleSection.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする。
afterEach(() => {
  cleanup();
});

const EMPTY_VALUE: LifestyleSectionValue = {
  sleepHours: null,
  alcoholHabit: null,
  smokingHabit: null,
  cookingSkill: null,
  cookingTimePreference: null,
  budgetPreference: null,
};

describe("LifestyleSection", () => {
  it("renders all lifestyle fields", () => {
    render(<LifestyleSection value={EMPTY_VALUE} onChange={vi.fn()} />);

    expect(screen.getByLabelText("平均睡眠時間")).toBeDefined();
    expect(screen.getByRole("radiogroup", { name: "飲酒習慣" })).toBeDefined();
    expect(screen.getByRole("radiogroup", { name: "喫煙習慣" })).toBeDefined();
    expect(screen.getByRole("radiogroup", { name: "調理スキル" })).toBeDefined();
    expect(screen.getByLabelText("調理にかけられる時間")).toBeDefined();
    expect(screen.getByLabelText("1食あたりの予算感")).toBeDefined();
  });

  it("exposes exactly the alcohol habit options from design.md's enum (none/occasional/frequent)", () => {
    render(<LifestyleSection value={EMPTY_VALUE} onChange={vi.fn()} />);

    const group = screen.getByRole("radiogroup", { name: "飲酒習慣" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(within(group).getByRole("radio", { name: "しない" })).toBeDefined();
    expect(within(group).getByRole("radio", { name: "たまに" })).toBeDefined();
    expect(within(group).getByRole("radio", { name: "よく飲む" })).toBeDefined();
  });

  it("exposes exactly the smoking habit options from design.md's enum (non_smoker/smoker)", () => {
    render(<LifestyleSection value={EMPTY_VALUE} onChange={vi.fn()} />);

    const group = screen.getByRole("radiogroup", { name: "喫煙習慣" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(within(group).getByRole("radio", { name: "吸わない" })).toBeDefined();
    expect(within(group).getByRole("radio", { name: "吸う" })).toBeDefined();
  });

  it("calls onChange with the parsed number when sleep hours changes", () => {
    const onChange = vi.fn();
    render(<LifestyleSection value={EMPTY_VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("平均睡眠時間"), { target: { value: "6.5" } });

    expect(onChange).toHaveBeenCalledWith("sleepHours", 6.5);
  });

  it("calls onChange with the selected alcohol habit", () => {
    const onChange = vi.fn();
    render(<LifestyleSection value={EMPTY_VALUE} onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "たまに" }));

    expect(onChange).toHaveBeenCalledWith("alcoholHabit", "occasional");
  });

  it("calls onChange with the selected smoking habit", () => {
    const onChange = vi.fn();
    render(<LifestyleSection value={EMPTY_VALUE} onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "吸う" }));

    expect(onChange).toHaveBeenCalledWith("smokingHabit", "smoker");
  });

  it("calls onChange with the selected cooking skill label", () => {
    const onChange = vi.fn();
    render(<LifestyleSection value={EMPTY_VALUE} onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "得意" }));

    expect(onChange).toHaveBeenCalledWith("cookingSkill", "得意");
  });

  it("calls onChange with the selected cooking time preference", () => {
    const onChange = vi.fn();
    render(<LifestyleSection value={EMPTY_VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("調理にかけられる時間"), { target: { value: "30分以内" } });

    expect(onChange).toHaveBeenCalledWith("cookingTimePreference", "30分以内");
  });

  it("calls onChange with the selected budget preference", () => {
    const onChange = vi.fn();
    render(<LifestyleSection value={EMPTY_VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("1食あたりの予算感"), { target: { value: "500〜800円" } });

    expect(onChange).toHaveBeenCalledWith("budgetPreference", "500〜800円");
  });

  it("displays a field-level error message next to the sleep hours field when an errors prop is provided", () => {
    render(
      <LifestyleSection
        value={EMPTY_VALUE}
        onChange={vi.fn()}
        errors={{ sleepHours: ["睡眠時間には0以上の値を入力してください。"] }}
      />,
    );

    const input = screen.getByLabelText("平均睡眠時間");
    const errorParagraph = screen.getByText("睡眠時間には0以上の値を入力してください。");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(errorParagraph.id);
  });
});

describe("validateLifestyle", () => {
  it("allows all lifestyle fields to be left empty (Requirements 2.1, 2.2)", () => {
    expect(validateLifestyle(EMPTY_VALUE)).toEqual({});
  });

  it("rejects a negative sleep hours value (Requirement 2.4)", () => {
    expect(validateLifestyle({ ...EMPTY_VALUE, sleepHours: -1 }).sleepHours).toBeDefined();
  });

  it("accepts a non-negative sleep hours value", () => {
    expect(validateLifestyle({ ...EMPTY_VALUE, sleepHours: 0 })).toEqual({});
  });
});
