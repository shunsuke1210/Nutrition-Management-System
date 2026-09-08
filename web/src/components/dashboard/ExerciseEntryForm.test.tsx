import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiError } from "../../api/types.js";
import * as dailyLogClient from "../../api/dailyLogClient.js";
import { ExerciseEntryForm } from "./ExerciseEntryForm.js";

/**
 * `dailyLogClient`（本コンポーネントが直接呼び出す唯一のクライアント）をモックする。
 * `FeedbackControl.test.tsx`の`vi.mock("../../api/mealSlotClient.js", ...)` +
 * `vi.mocked(...)`と同じパターン。
 */
vi.mock("../../api/dailyLogClient.js", () => ({ addExerciseEntry: vi.fn() }));

const mockedAddExerciseEntry = vi.mocked(dailyLogClient.addExerciseEntry);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const SOME_API_ERROR: ApiError = { type: "unknown", message: "boom" };

const SAMPLE_ENTRY = {
  id: 1,
  activityName: "ウォーキング",
  durationMinutes: 30,
  estimatedCaloriesBurned: 120,
};

describe("ExerciseEntryForm", () => {
  it("collapsed state shows only the trigger button (mockup.html行876)", () => {
    render(<ExerciseEntryForm date="2026-09-01" onSaved={vi.fn()} />);

    expect(screen.getByRole("button", { name: "＋ 運動を記録" })).toBeDefined();
    expect(screen.queryByLabelText("運動内容")).toBeNull();
  });

  it("clicking the trigger reveals all 3 input fields, initially empty", () => {
    render(<ExerciseEntryForm date="2026-09-01" onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "＋ 運動を記録" }));

    expect((screen.getByLabelText("運動内容") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("時間（分）") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("想定消費カロリー") as HTMLInputElement).value).toBe("");
  });

  it("submitting calls addExerciseEntry with the correct ExerciseEntryInput shape and date", () => {
    mockedAddExerciseEntry.mockReturnValue(new Promise(() => {}));

    render(<ExerciseEntryForm date="2026-09-05" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "＋ 運動を記録" }));
    fireEvent.change(screen.getByLabelText("運動内容"), { target: { value: "ウォーキング" } });
    fireEvent.change(screen.getByLabelText("時間（分）"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("想定消費カロリー"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));

    expect(mockedAddExerciseEntry).toHaveBeenCalledTimes(1);
    expect(mockedAddExerciseEntry).toHaveBeenCalledWith("2026-09-05", {
      activityName: "ウォーキング",
      durationMinutes: 30,
      estimatedCaloriesBurned: 120,
    });
  });

  it("on success, collapses back, clears all 3 fields, and calls onSaved (Requirement 12.6)", async () => {
    mockedAddExerciseEntry.mockResolvedValue({ ok: true, value: SAMPLE_ENTRY });
    const onSaved = vi.fn();

    render(<ExerciseEntryForm date="2026-09-05" onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "＋ 運動を記録" }));
    fireEvent.change(screen.getByLabelText("運動内容"), { target: { value: "ウォーキング" } });
    fireEvent.change(screen.getByLabelText("時間（分）"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("想定消費カロリー"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "＋ 運動を記録" })).toBeDefined());
    expect(screen.queryByLabelText("運動内容")).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);

    // 再度開いて、フィールドが実際にクリアされている（畳んだだけではない）ことを証明する。
    fireEvent.click(screen.getByRole("button", { name: "＋ 運動を記録" }));
    expect((screen.getByLabelText("運動内容") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("時間（分）") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("想定消費カロリー") as HTMLInputElement).value).toBe("");
  });

  it(
    "on failure, stays expanded with all 3 typed values still present and shows a failure message, and a " +
      "second submit attempt from that state genuinely re-submits (Requirement 12.7)",
    async () => {
      mockedAddExerciseEntry.mockResolvedValueOnce({ ok: false, error: SOME_API_ERROR });

      render(<ExerciseEntryForm date="2026-09-05" onSaved={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "＋ 運動を記録" }));
      fireEvent.change(screen.getByLabelText("運動内容"), { target: { value: "ウォーキング" } });
      fireEvent.change(screen.getByLabelText("時間（分）"), { target: { value: "30" } });
      fireEvent.change(screen.getByLabelText("想定消費カロリー"), { target: { value: "120" } });
      fireEvent.click(screen.getByRole("button", { name: "保存する" }));

      await screen.findByText(/失敗/);
      expect((screen.getByLabelText("運動内容") as HTMLInputElement).value).toBe("ウォーキング");
      expect((screen.getByLabelText("時間（分）") as HTMLInputElement).value).toBe("30");
      expect((screen.getByLabelText("想定消費カロリー") as HTMLInputElement).value).toBe("120");
      expect(screen.queryByRole("button", { name: "＋ 運動を記録" })).toBeNull();

      mockedAddExerciseEntry.mockResolvedValueOnce({ ok: true, value: SAMPLE_ENTRY });
      fireEvent.click(screen.getByRole("button", { name: "保存する" }));

      expect(mockedAddExerciseEntry).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(screen.getByRole("button", { name: "＋ 運動を記録" })).toBeDefined());
    },
  );
});
