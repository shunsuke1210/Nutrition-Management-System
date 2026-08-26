import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  ExerciseHabitSection,
  validateExerciseHabit,
  type ExerciseHabitSectionValue,
} from "./ExerciseHabitSection.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする。
afterEach(() => {
  cleanup();
});

const EMPTY_VALUE: ExerciseHabitSectionValue = {
  jobActivityLevel: null,
  commuteMethod: null,
  averageDailySteps: null,
};

const FILLED_VALUE: ExerciseHabitSectionValue = {
  jobActivityLevel: "mostly_sedentary",
  commuteMethod: "walk_or_bike",
  averageDailySteps: 6000,
};

describe("ExerciseHabitSection", () => {
  it("renders the job activity level, commute method, and average daily steps fields", () => {
    render(<ExerciseHabitSection value={EMPTY_VALUE} onChange={vi.fn()} />);

    expect(screen.getByRole("radiogroup", { name: "お仕事中の活動度" })).toBeDefined();
    expect(screen.getByRole("radiogroup", { name: "通勤手段" })).toBeDefined();
    expect(screen.getByLabelText("1日の平均歩数（分かれば）")).toBeDefined();
  });

  it("exposes exactly the three job activity level options required by 4.1", () => {
    render(<ExerciseHabitSection value={EMPTY_VALUE} onChange={vi.fn()} />);

    const group = screen.getByRole("radiogroup", { name: "お仕事中の活動度" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(within(group).getByRole("radio", { name: "主に座って過ごす" })).toBeDefined();
    expect(within(group).getByRole("radio", { name: "座り・立ち半々" })).toBeDefined();
    expect(within(group).getByRole("radio", { name: "主に立つ・体を動かす仕事" })).toBeDefined();
  });

  it("exposes exactly the three commute method options required by 4.2", () => {
    render(<ExerciseHabitSection value={EMPTY_VALUE} onChange={vi.fn()} />);

    const group = screen.getByRole("radiogroup", { name: "通勤手段" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(within(group).getByRole("radio", { name: "徒歩・自転車が中心" })).toBeDefined();
    expect(within(group).getByRole("radio", { name: "電車・バスなど" })).toBeDefined();
    expect(within(group).getByRole("radio", { name: "車・ほぼ歩かない" })).toBeDefined();
  });

  it("calls onChange with the selected job activity level", () => {
    const onChange = vi.fn();
    render(<ExerciseHabitSection value={EMPTY_VALUE} onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "座り・立ち半々" }));

    expect(onChange).toHaveBeenCalledWith("jobActivityLevel", "mixed");
  });

  it("calls onChange with the selected commute method", () => {
    const onChange = vi.fn();
    render(<ExerciseHabitSection value={EMPTY_VALUE} onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "車・ほぼ歩かない" }));

    expect(onChange).toHaveBeenCalledWith("commuteMethod", "car");
  });

  it("calls onChange with the parsed number when average daily steps changes", () => {
    const onChange = vi.fn();
    render(<ExerciseHabitSection value={EMPTY_VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("1日の平均歩数（分かれば）"), { target: { value: "6000" } });

    expect(onChange).toHaveBeenCalledWith("averageDailySteps", 6000);
  });

  it("calls onChange with null when average daily steps is cleared", () => {
    const onChange = vi.fn();
    render(<ExerciseHabitSection value={FILLED_VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("1日の平均歩数（分かれば）"), { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith("averageDailySteps", null);
  });

  it("displays a field-level error message when jobActivityLevel is missing (Requirement 4.3)", () => {
    render(
      <ExerciseHabitSection
        value={EMPTY_VALUE}
        onChange={vi.fn()}
        errors={{ jobActivityLevel: ["お仕事中の活動度は必須です。"] }}
      />,
    );

    expect(screen.getByText("お仕事中の活動度は必須です。")).toBeDefined();
  });

  it("displays a field-level error message when commuteMethod is missing (Requirement 4.3)", () => {
    render(
      <ExerciseHabitSection
        value={EMPTY_VALUE}
        onChange={vi.fn()}
        errors={{ commuteMethod: ["通勤手段は必須です。"] }}
      />,
    );

    expect(screen.getByText("通勤手段は必須です。")).toBeDefined();
  });

  it("marks the average daily steps field invalid when it has an errors entry", () => {
    render(
      <ExerciseHabitSection
        value={EMPTY_VALUE}
        onChange={vi.fn()}
        errors={{ averageDailySteps: ["1日の平均歩数には0以上の値を入力してください。"] }}
      />,
    );

    const input = screen.getByLabelText("1日の平均歩数（分かれば）");
    const errorParagraph = screen.getByText("1日の平均歩数には0以上の値を入力してください。");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(errorParagraph.id);
  });
});

describe("validateExerciseHabit", () => {
  it("rejects an unselected jobActivityLevel and commuteMethod (Requirement 4.3)", () => {
    const errors = validateExerciseHabit(EMPTY_VALUE);

    expect(errors.jobActivityLevel).toBeDefined();
    expect(errors.commuteMethod).toBeDefined();
  });

  it("allows averageDailySteps to be left empty (Requirement 4.4)", () => {
    expect(validateExerciseHabit(FILLED_VALUE)).toEqual({});
  });

  it("rejects a negative averageDailySteps value (Requirement 4.5)", () => {
    expect(validateExerciseHabit({ ...FILLED_VALUE, averageDailySteps: -1 }).averageDailySteps).toBeDefined();
  });

  it("accepts a non-negative averageDailySteps value", () => {
    expect(validateExerciseHabit({ ...FILLED_VALUE, averageDailySteps: 0 })).toEqual({});
  });

  it("returns no errors for a fully valid value", () => {
    expect(validateExerciseHabit(FILLED_VALUE)).toEqual({});
  });
});
