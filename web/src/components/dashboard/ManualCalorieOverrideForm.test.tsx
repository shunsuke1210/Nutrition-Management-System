import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiError } from "../../api/types.js";
import * as dailyLogClient from "../../api/dailyLogClient.js";
import { ManualCalorieOverrideForm } from "./ManualCalorieOverrideForm.js";

/**
 * `dailyLogClient`（本コンポーネントが直接呼び出す唯一のクライアント）をモックする。
 * `FeedbackControl.test.tsx`の`vi.mock("../../api/mealSlotClient.js", ...)` +
 * `vi.mocked(...)`と同じパターン。
 */
vi.mock("../../api/dailyLogClient.js", () => ({ saveDailyLog: vi.fn() }));

const mockedSaveDailyLog = vi.mocked(dailyLogClient.saveDailyLog);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const SOME_API_ERROR: ApiError = { type: "unknown", message: "boom" };

function buildSavedEntry(manualOverrideKcal: number) {
  return {
    date: "2026-09-03",
    weightKg: null,
    bodyFatPct: null,
    plannedKcal: null,
    manualOverrideKcal,
    calorieIntakeActual: manualOverrideKcal,
    calorieIntakeSource: "manual" as const,
    exerciseEntries: [],
  };
}

describe("ManualCalorieOverrideForm", () => {
  it("collapsed state shows only the trigger button (mockup.html行875)", () => {
    render(<ManualCalorieOverrideForm date="2026-09-01" currentOverrideKcal={null} onSaved={vi.fn()} />);

    expect(screen.getByRole("button", { name: "今日の摂取カロリーを修正" })).toBeDefined();
    expect(screen.queryByLabelText("摂取カロリー")).toBeNull();
  });

  it("clicking the trigger reveals the input, pre-filled with currentOverrideKcal when provided", () => {
    render(<ManualCalorieOverrideForm date="2026-09-01" currentOverrideKcal={1500} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "今日の摂取カロリーを修正" }));

    expect((screen.getByLabelText("摂取カロリー") as HTMLInputElement).value).toBe("1500");
  });

  it("clicking the trigger reveals an empty input when currentOverrideKcal is null", () => {
    render(<ManualCalorieOverrideForm date="2026-09-01" currentOverrideKcal={null} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "今日の摂取カロリーを修正" }));

    expect((screen.getByLabelText("摂取カロリー") as HTMLInputElement).value).toBe("");
  });

  it("submitting calls saveDailyLog with EXACTLY { manualOverrideKcal } (no other fields) and the correct date", () => {
    mockedSaveDailyLog.mockReturnValue(new Promise(() => {}));

    render(<ManualCalorieOverrideForm date="2026-09-03" currentOverrideKcal={null} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "今日の摂取カロリーを修正" }));
    fireEvent.change(screen.getByLabelText("摂取カロリー"), { target: { value: "1400" } });
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));

    expect(mockedSaveDailyLog).toHaveBeenCalledTimes(1);
    expect(mockedSaveDailyLog).toHaveBeenCalledWith("2026-09-03", { manualOverrideKcal: 1400 });
  });

  it("on success, collapses back to the trigger button and calls onSaved (Requirement 12.4)", async () => {
    mockedSaveDailyLog.mockResolvedValue({ ok: true, value: buildSavedEntry(1400) });
    const onSaved = vi.fn();

    render(<ManualCalorieOverrideForm date="2026-09-03" currentOverrideKcal={null} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "今日の摂取カロリーを修正" }));
    fireEvent.change(screen.getByLabelText("摂取カロリー"), { target: { value: "1400" } });
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "今日の摂取カロリーを修正" })).toBeDefined(),
    );
    expect(screen.queryByLabelText("摂取カロリー")).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it(
    "on failure, stays expanded with the typed value still present and shows a failure message, and a " +
      "second submit attempt from that state genuinely re-submits (Requirement 12.7)",
    async () => {
      mockedSaveDailyLog.mockResolvedValueOnce({ ok: false, error: SOME_API_ERROR });

      render(<ManualCalorieOverrideForm date="2026-09-03" currentOverrideKcal={null} onSaved={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "今日の摂取カロリーを修正" }));
      fireEvent.change(screen.getByLabelText("摂取カロリー"), { target: { value: "1400" } });
      fireEvent.click(screen.getByRole("button", { name: "保存する" }));

      await screen.findByText(/失敗/);
      expect((screen.getByLabelText("摂取カロリー") as HTMLInputElement).value).toBe("1400");
      expect(screen.queryByRole("button", { name: "今日の摂取カロリーを修正" })).toBeNull();

      mockedSaveDailyLog.mockResolvedValueOnce({ ok: true, value: buildSavedEntry(1400) });
      fireEvent.click(screen.getByRole("button", { name: "保存する" }));

      expect(mockedSaveDailyLog).toHaveBeenCalledTimes(2);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "今日の摂取カロリーを修正" })).toBeDefined(),
      );
    },
  );
});
