import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ExerciseLogList, validateExerciseEntry, type ExerciseEntryDraftValue } from "./ExerciseLogList.js";
import type { ExerciseLogEntry } from "@nutrition/shared";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする。
afterEach(() => {
  cleanup();
});

const ENTRY_A: ExerciseLogEntry = {
  id: 1,
  activityName: "ウォーキング",
  durationMinutes: 30,
  estimatedCaloriesBurned: 120,
};

const ENTRY_B: ExerciseLogEntry = {
  id: 2,
  activityName: "ジョギング",
  durationMinutes: 20,
  estimatedCaloriesBurned: 180,
};

const VALID_DRAFT: ExerciseEntryDraftValue = {
  activityName: "縄跳び",
  durationMinutes: 15,
  estimatedCaloriesBurned: 90,
};

function fillDraft(draft: ExerciseEntryDraftValue): void {
  fireEvent.change(screen.getByLabelText("種目"), { target: { value: draft.activityName } });
  fireEvent.change(screen.getByLabelText("時間"), {
    target: { value: draft.durationMinutes === null ? "" : String(draft.durationMinutes) },
  });
  fireEvent.change(screen.getByLabelText("想定消費カロリー"), {
    target: { value: draft.estimatedCaloriesBurned === null ? "" : String(draft.estimatedCaloriesBurned) },
  });
}

function submitAddForm(): void {
  fireEvent.click(screen.getByRole("button", { name: "＋ 記録する" }));
}

describe("ExerciseLogList", () => {
  it("renders the add-form fields and the existing entries list", () => {
    render(<ExerciseLogList entries={[ENTRY_A, ENTRY_B]} onAdd={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.getByLabelText("種目")).toBeDefined();
    expect(screen.getByLabelText("時間")).toBeDefined();
    expect(screen.getByLabelText("想定消費カロリー")).toBeDefined();
    expect(screen.getByRole("button", { name: "＋ 記録する" })).toBeDefined();

    expect(screen.getByText("ウォーキング・30分")).toBeDefined();
    expect(screen.getByText("+120kcal")).toBeDefined();
    expect(screen.getByText("ジョギング・20分")).toBeDefined();
    expect(screen.getByText("+180kcal")).toBeDefined();
  });

  it("renders no entries when the list is empty (Requirement 10.1)", () => {
    render(<ExerciseLogList entries={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);

    // 一覧項目のメタ表示（「+120kcal」のような形式）のみが対象で、追加フォームの
    // 単位ラベル（「kcal」）とは区別する。
    expect(screen.queryByText(/^\+\d+kcal$/)).toBeNull();
  });

  it(
    "calls onAdd with the entered activity/duration/calories when the add-form is submitted with valid " +
      "values, and a re-render with the new entry shows it in the list (task completion condition, Requirement 10.3)",
    () => {
      const onAdd = vi.fn();
      const { rerender } = render(<ExerciseLogList entries={[ENTRY_A]} onAdd={onAdd} onRemove={vi.fn()} />);

      fillDraft(VALID_DRAFT);
      submitAddForm();

      expect(onAdd).toHaveBeenCalledWith({
        activityName: "縄跳び",
        durationMinutes: 15,
        estimatedCaloriesBurned: 90,
      });

      // 親が確定値を反映してpropsを更新した状態を再現する。
      const NEW_ENTRY: ExerciseLogEntry = { id: 3, ...VALID_DRAFT } as ExerciseLogEntry;
      rerender(<ExerciseLogList entries={[ENTRY_A, NEW_ENTRY]} onAdd={onAdd} onRemove={vi.fn()} />);

      expect(screen.getByText("縄跳び・15分")).toBeDefined();
      expect(screen.getByText("+90kcal")).toBeDefined();
      expect(screen.getByText("ウォーキング・30分")).toBeDefined();
    },
  );

  it("clears the add-form's own draft fields after a successful add", () => {
    render(<ExerciseLogList entries={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);

    fillDraft(VALID_DRAFT);
    submitAddForm();

    expect(screen.getByLabelText("種目")).toHaveProperty("value", "");
    expect(screen.getByLabelText("時間")).toHaveProperty("value", "");
    expect(screen.getByLabelText("想定消費カロリー")).toHaveProperty("value", "");
  });

  it(
    "calls onRemove with the targeted entry's id when its remove control is clicked, and a re-render " +
      "without that entry shows it gone from the list while other entries remain (task completion condition, Requirement 10.4)",
    () => {
      const onRemove = vi.fn();
      const { rerender } = render(<ExerciseLogList entries={[ENTRY_A, ENTRY_B]} onAdd={vi.fn()} onRemove={onRemove} />);

      fireEvent.click(screen.getByRole("button", { name: "ウォーキングを削除" }));

      expect(onRemove).toHaveBeenCalledWith(1);

      // 親が確定値を反映してpropsを更新した状態を再現する。
      rerender(<ExerciseLogList entries={[ENTRY_B]} onAdd={vi.fn()} onRemove={onRemove} />);

      expect(screen.queryByText("ウォーキング・30分")).toBeNull();
      expect(screen.getByText("ジョギング・20分")).toBeDefined();
    },
  );

  it("does not call onAdd when durationMinutes is 0 or negative, and shows a field error (Requirement 10.5 boundary)", () => {
    const onAdd = vi.fn();
    render(<ExerciseLogList entries={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    fillDraft({ ...VALID_DRAFT, durationMinutes: 0 });
    submitAddForm();
    expect(onAdd).not.toHaveBeenCalled();
    const durationInput = screen.getByLabelText("時間");
    expect(durationInput.getAttribute("aria-invalid")).toBe("true");

    fillDraft({ ...VALID_DRAFT, durationMinutes: -5 });
    submitAddForm();
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByLabelText("時間").getAttribute("aria-invalid")).toBe("true");
  });

  it("calls onAdd when durationMinutes is a valid positive value (no duration error)", () => {
    const onAdd = vi.fn();
    render(<ExerciseLogList entries={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    fillDraft(VALID_DRAFT);
    submitAddForm();

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("時間").getAttribute("aria-invalid")).toBe("false");
  });

  it("does not call onAdd when estimatedCaloriesBurned is 0 or negative, and shows a field error (Requirement 10.5 boundary)", () => {
    const onAdd = vi.fn();
    render(<ExerciseLogList entries={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    fillDraft({ ...VALID_DRAFT, estimatedCaloriesBurned: 0 });
    submitAddForm();
    expect(onAdd).not.toHaveBeenCalled();
    const caloriesInput = screen.getByLabelText("想定消費カロリー");
    expect(caloriesInput.getAttribute("aria-invalid")).toBe("true");

    fillDraft({ ...VALID_DRAFT, estimatedCaloriesBurned: -10 });
    submitAddForm();
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByLabelText("想定消費カロリー").getAttribute("aria-invalid")).toBe("true");
  });

  it("calls onAdd when estimatedCaloriesBurned is a valid positive value (no calories error)", () => {
    const onAdd = vi.fn();
    render(<ExerciseLogList entries={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    fillDraft(VALID_DRAFT);
    submitAddForm();

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("想定消費カロリー").getAttribute("aria-invalid")).toBe("false");
  });

  it("does not call onAdd at all when the submission is invalid (validation gate genuinely blocks the callback)", () => {
    const onAdd = vi.fn();
    render(<ExerciseLogList entries={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    fillDraft({ activityName: "縄跳び", durationMinutes: 0, estimatedCaloriesBurned: 0 });
    submitAddForm();

    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe("validateExerciseEntry", () => {
  it("rejects durationMinutes <= 0 (Requirement 10.5)", () => {
    expect(validateExerciseEntry({ ...VALID_DRAFT, durationMinutes: 0 }).durationMinutes).toBeDefined();
    expect(validateExerciseEntry({ ...VALID_DRAFT, durationMinutes: -1 }).durationMinutes).toBeDefined();
  });

  it("accepts a positive durationMinutes", () => {
    expect(validateExerciseEntry(VALID_DRAFT).durationMinutes).toBeUndefined();
  });

  it("rejects estimatedCaloriesBurned <= 0 (Requirement 10.5)", () => {
    expect(validateExerciseEntry({ ...VALID_DRAFT, estimatedCaloriesBurned: 0 }).estimatedCaloriesBurned).toBeDefined();
    expect(validateExerciseEntry({ ...VALID_DRAFT, estimatedCaloriesBurned: -1 }).estimatedCaloriesBurned).toBeDefined();
  });

  it("accepts a positive estimatedCaloriesBurned", () => {
    expect(validateExerciseEntry(VALID_DRAFT).estimatedCaloriesBurned).toBeUndefined();
  });

  it("returns no errors for a fully valid draft", () => {
    expect(validateExerciseEntry(VALID_DRAFT)).toEqual({});
  });
});
