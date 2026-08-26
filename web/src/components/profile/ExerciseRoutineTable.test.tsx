import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  ExerciseRoutineTable,
  validateExerciseRoutineRow,
  validateExerciseRoutineTable,
  type ExerciseRoutineRowValue,
} from "./ExerciseRoutineTable.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする。
afterEach(() => {
  cleanup();
});

const ROW_A: ExerciseRoutineRowValue = {
  scene: "commute",
  content: "徒歩",
  frequencyPerWeek: 5,
  durationMinutes: 15,
  intensity: "light",
};

const ROW_B: ExerciseRoutineRowValue = {
  scene: "after_work",
  content: "ウォーキング",
  frequencyPerWeek: 2,
  durationMinutes: 30,
  intensity: "moderate",
};

function dataRows(): HTMLElement[] {
  return screen.getAllByRole("row").slice(1); // 先頭行はヘッダー行
}

/** `noUncheckedIndexedAccess` 下でも安全にn番目のデータ行を取得する（テストの前提上、必ず存在する）。 */
function nthDataRow(index: number): HTMLElement {
  const row = dataRows()[index];
  if (!row) {
    throw new Error(`data row ${index} was not found`);
  }
  return row;
}

describe("ExerciseRoutineTable", () => {
  it("renders one row per entry with scene/content/frequency/duration/intensity fields", () => {
    render(<ExerciseRoutineTable value={[ROW_A]} onChange={vi.fn()} />);

    expect(dataRows()).toHaveLength(1);
    const row = nthDataRow(0);
    expect(within(row).getByRole("combobox", { name: "場面" })).toBeDefined();
    expect(within(row).getByRole("textbox", { name: "内容" })).toHaveProperty("value", "徒歩");
    expect(within(row).getByRole("spinbutton", { name: "頻度" })).toHaveProperty("value", "5");
    expect(within(row).getByRole("spinbutton", { name: "1回の時間" })).toHaveProperty("value", "15");
    expect(within(row).getByRole("combobox", { name: "強度" })).toBeDefined();
  });

  it("exposes exactly the five routine scene options and three intensity options (Requirement 4.6)", () => {
    render(<ExerciseRoutineTable value={[ROW_A]} onChange={vi.fn()} />);

    const row = nthDataRow(0);
    const sceneOptions = within(within(row).getByRole("combobox", { name: "場面" })).getAllByRole("option");
    expect(sceneOptions.map((option) => option.textContent)).toEqual([
      "通勤",
      "仕事中",
      "帰宅後",
      "休日",
      "その他",
    ]);

    const intensityOptions = within(within(row).getByRole("combobox", { name: "強度" })).getAllByRole("option");
    expect(intensityOptions.map((option) => option.textContent)).toEqual(["軽い", "中程度", "激しい"]);
  });

  it("renders no data rows when the routine list is empty (Requirement 4.9)", () => {
    render(<ExerciseRoutineTable value={[]} onChange={vi.fn()} />);

    expect(dataRows()).toHaveLength(0);
  });

  it("adds a new row when '行を追加' is clicked (Requirement 4.7 / completion condition)", () => {
    const onChange = vi.fn();
    render(<ExerciseRoutineTable value={[ROW_A]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "＋ 行を追加" }));

    expect(onChange).toHaveBeenCalledWith([
      ROW_A,
      { scene: "commute", content: "", frequencyPerWeek: null, durationMinutes: null, intensity: "light" },
    ]);
  });

  it("removes the targeted row when its delete button is clicked, leaving other rows intact (Requirement 4.8 / completion condition)", () => {
    const onChange = vi.fn();
    render(<ExerciseRoutineTable value={[ROW_A, ROW_B]} onChange={onChange} />);

    fireEvent.click(within(nthDataRow(0)).getByRole("button", { name: "この行を削除" }));

    expect(onChange).toHaveBeenCalledWith([ROW_B]);
  });

  it("calls onChange with an updated field value when a row's content changes", () => {
    const onChange = vi.fn();
    render(<ExerciseRoutineTable value={[ROW_A, ROW_B]} onChange={onChange} />);

    fireEvent.change(within(nthDataRow(0)).getByRole("textbox", { name: "内容" }), {
      target: { value: "ジョギング" },
    });

    expect(onChange).toHaveBeenCalledWith([{ ...ROW_A, content: "ジョギング" }, ROW_B]);
  });

  it("calls onChange with the selected scene when a row's scene changes", () => {
    const onChange = vi.fn();
    render(<ExerciseRoutineTable value={[ROW_A]} onChange={onChange} />);

    fireEvent.change(within(nthDataRow(0)).getByRole("combobox", { name: "場面" }), {
      target: { value: "holiday" },
    });

    expect(onChange).toHaveBeenCalledWith([{ ...ROW_A, scene: "holiday" }]);
  });

  it("displays a field-level error scoped to the row with an invalid frequency, leaving other rows unaffected (Requirement 4.10)", () => {
    render(
      <ExerciseRoutineTable
        value={[ROW_A, ROW_B]}
        onChange={vi.fn()}
        errors={[{ frequencyPerWeek: ["頻度には正の値を入力してください。"] }, undefined]}
      />,
    );

    expect(within(nthDataRow(0)).getByText("頻度には正の値を入力してください。")).toBeDefined();
    expect(within(nthDataRow(1)).queryByText("頻度には正の値を入力してください。")).toBeNull();

    const frequencyInput = within(nthDataRow(0)).getByRole("spinbutton", { name: "頻度" });
    expect(frequencyInput.getAttribute("aria-invalid")).toBe("true");
  });

  it("displays a field-level error scoped to the row with an invalid duration (Requirement 4.10)", () => {
    render(
      <ExerciseRoutineTable
        value={[ROW_A]}
        onChange={vi.fn()}
        errors={[{ durationMinutes: ["1回の時間には正の値を入力してください。"] }]}
      />,
    );

    expect(screen.getByText("1回の時間には正の値を入力してください。")).toBeDefined();
  });
});

describe("validateExerciseRoutineRow", () => {
  it("rejects a row with frequencyPerWeek <= 0 (Requirement 4.10)", () => {
    expect(validateExerciseRoutineRow({ ...ROW_A, frequencyPerWeek: 0 }).frequencyPerWeek).toBeDefined();
  });

  it("rejects a row with durationMinutes <= 0 (Requirement 4.10)", () => {
    expect(validateExerciseRoutineRow({ ...ROW_A, durationMinutes: -5 }).durationMinutes).toBeDefined();
  });

  it("returns no errors for a fully valid row", () => {
    expect(validateExerciseRoutineRow(ROW_A)).toEqual({});
  });
});

describe("validateExerciseRoutineTable", () => {
  it("returns an empty array for an empty routine list (Requirement 4.9)", () => {
    expect(validateExerciseRoutineTable([])).toEqual([]);
  });

  it("returns per-row errors aligned by index, leaving valid rows empty", () => {
    const result = validateExerciseRoutineTable([ROW_A, { ...ROW_B, frequencyPerWeek: -1 }]);

    expect(result[0]).toEqual({});
    expect(result[1]?.frequencyPerWeek).toBeDefined();
  });
});
