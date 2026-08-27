import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DailyLogEntry, ExerciseLogEntry } from "@nutrition/shared";
import { DailyLogPanel } from "./DailyLogPanel.js";
import * as dailyLogClient from "../../api/dailyLogClient.js";

/**
 * `dailyLogClient`（本タスクで新設）をモックし、`DailyLogPanel` が
 * `GET /api/daily-logs/:date` / `PUT /api/daily-logs/:date` /
 * `POST .../exercise-entries` / `DELETE .../exercise-entries/:id` を直接呼び出さずに
 * このモジュール経由でAPIとやり取りすることを前提にテストする
 * （design.md: Domain: UI Implementation Notes、`ProfilePage.test.tsx` と同じ規約）。
 */
vi.mock("../../api/dailyLogClient.js", () => ({
  getDailyLog: vi.fn(),
  saveDailyLog: vi.fn(),
  addExerciseEntry: vi.fn(),
  removeExerciseEntry: vi.fn(),
}));

const mockedGetDailyLog = vi.mocked(dailyLogClient.getDailyLog);
const mockedSaveDailyLog = vi.mocked(dailyLogClient.saveDailyLog);
const mockedAddExerciseEntry = vi.mocked(dailyLogClient.addExerciseEntry);
const mockedRemoveExerciseEntry = vi.mocked(dailyLogClient.removeExerciseEntry);

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットし、モックの呼び出し履歴・実装も破棄する。
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const EXISTING_ENTRY: ExerciseLogEntry = {
  id: 1,
  activityName: "ウォーキング",
  durationMinutes: 30,
  estimatedCaloriesBurned: 120,
};

const SAVED_LOG: DailyLogEntry = {
  date: "2026-08-26",
  weightKg: 68.6,
  bodyFatPct: 27.5,
  plannedKcal: 1650,
  manualOverrideKcal: null,
  calorieIntakeActual: 1650,
  calorieIntakeSource: "planned",
  exerciseEntries: [EXISTING_ENTRY],
};

const EMPTY_LOG: DailyLogEntry = {
  date: "2026-08-26",
  weightKg: null,
  bodyFatPct: null,
  plannedKcal: null,
  manualOverrideKcal: null,
  calorieIntakeActual: null,
  calorieIntakeSource: "unrecorded",
  exerciseEntries: [],
};

/** マウント後に発行される `getDailyLog` 呼び出しから、コンポーネントが計算した当日日付を取得する。 */
async function mountAndCaptureDate(): Promise<string> {
  render(<DailyLogPanel />);
  await waitFor(() => expect(mockedGetDailyLog).toHaveBeenCalledTimes(1));
  return mockedGetDailyLog.mock.calls[0]![0];
}

function weightInput(): HTMLInputElement {
  return screen.getByLabelText("体重") as HTMLInputElement;
}

function bodyFatInput(): HTMLInputElement {
  return screen.getByLabelText("体脂肪率") as HTMLInputElement;
}

describe("DailyLogPanel", () => {
  it("initializes weight/bodyFat/calorie/exercise fields from an existing DailyLogEntry on mount", async () => {
    mockedGetDailyLog.mockResolvedValue({ ok: true, value: SAVED_LOG });

    render(<DailyLogPanel />);

    await screen.findByDisplayValue("68.6");
    expect(bodyFatInput().value).toBe("27.5");
    expect(screen.getByText("1,650kcal")).toBeDefined();
    expect(screen.getByText("献立通り")).toBeDefined();
    expect(screen.getByText("ウォーキング・30分")).toBeDefined();
    expect(screen.getByText("+120kcal")).toBeDefined();
  });

  it("initializes to an empty default state without crashing when no record exists yet (null)", async () => {
    mockedGetDailyLog.mockResolvedValue({ ok: true, value: null });

    render(<DailyLogPanel />);
    await screen.findByLabelText("体重");

    expect(weightInput().value).toBe("");
    expect(bodyFatInput().value).toBe("");
    expect(screen.getByText("未記録")).toBeDefined();
    expect(screen.queryByText(/^\+\d+kcal$/)).toBeNull();
  });

  it(
    "saves weight/bodyFat via saveDailyLog with the entered values, and the saved weight re-displays " +
      "after a simulated panel reload (task completion condition, Requirement 8.3)",
    async () => {
      mockedGetDailyLog.mockResolvedValue({ ok: true, value: EMPTY_LOG });
      const today = await mountAndCaptureDate();
      await screen.findByLabelText("体重");

      fireEvent.change(weightInput(), { target: { value: "70.2" } });
      fireEvent.change(bodyFatInput(), { target: { value: "25" } });

      const savedEntry: DailyLogEntry = { ...EMPTY_LOG, weightKg: 70.2, bodyFatPct: 25 };
      mockedSaveDailyLog.mockResolvedValue({ ok: true, value: savedEntry });

      fireEvent.click(screen.getByRole("button", { name: "体重・体脂肪率を保存" }));

      await waitFor(() => expect(mockedSaveDailyLog).toHaveBeenCalledTimes(1));
      expect(mockedSaveDailyLog).toHaveBeenCalledWith(today, { weightKg: 70.2, bodyFatPct: 25 });

      // 保存後、パネルの再読み込みをシミュレートする: unmount してから、
      // `getDailyLog` が保存済みの体重を返すようモックを更新して再マウントする。
      cleanup();
      mockedGetDailyLog.mockResolvedValue({ ok: true, value: savedEntry });

      render(<DailyLogPanel />);
      await screen.findByDisplayValue("70.2");
      expect(bodyFatInput().value).toBe("25");
    },
  );

  it("does not call saveDailyLog when the entered weight is non-positive (client-side validation gate, Requirement 8.5)", async () => {
    mockedGetDailyLog.mockResolvedValue({ ok: true, value: EMPTY_LOG });
    render(<DailyLogPanel />);
    await screen.findByLabelText("体重");

    fireEvent.change(weightInput(), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "体重・体脂肪率を保存" }));

    expect(mockedSaveDailyLog).not.toHaveBeenCalled();
    expect(weightInput().getAttribute("aria-invalid")).toBe("true");
  });

  it(
    "saves a manual calorie override via saveDailyLog with only manualOverrideKcal in the payload " +
      "(does not resend plannedKcal/weight so the hybrid resolution in the service layer is unaffected, " +
      "Requirements 9.2, 9.3)",
    async () => {
      mockedGetDailyLog.mockResolvedValue({ ok: true, value: SAVED_LOG });
      const today = await mountAndCaptureDate();
      await screen.findByDisplayValue("68.6");

      fireEvent.click(screen.getByRole("button", { name: "実際と違う場合は修正" }));
      fireEvent.change(screen.getByRole("spinbutton", { name: "摂取カロリー" }), { target: { value: "1800" } });

      const savedEntry: DailyLogEntry = {
        ...SAVED_LOG,
        manualOverrideKcal: 1800,
        calorieIntakeActual: 1800,
        calorieIntakeSource: "manual",
      };
      mockedSaveDailyLog.mockResolvedValue({ ok: true, value: savedEntry });

      fireEvent.click(screen.getByRole("button", { name: "摂取カロリーを保存" }));

      await waitFor(() => expect(mockedSaveDailyLog).toHaveBeenCalledTimes(1));
      const sentPayload = mockedSaveDailyLog.mock.calls[0]![1];
      expect(mockedSaveDailyLog).toHaveBeenCalledWith(today, { manualOverrideKcal: 1800 });
      expect(sentPayload).not.toHaveProperty("plannedKcal");
      expect(sentPayload).not.toHaveProperty("weightKg");
      expect(sentPayload).not.toHaveProperty("bodyFatPct");
    },
  );

  it("adds an exercise entry via addExerciseEntry, and the server-assigned entry appears in the list (Requirement 10.3)", async () => {
    mockedGetDailyLog.mockResolvedValue({ ok: true, value: EMPTY_LOG });
    const today = await mountAndCaptureDate();
    await screen.findByLabelText("種目");

    fireEvent.change(screen.getByLabelText("種目"), { target: { value: "縄跳び" } });
    fireEvent.change(screen.getByLabelText("時間"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("想定消費カロリー"), { target: { value: "90" } });

    const newEntry: ExerciseLogEntry = { id: 5, activityName: "縄跳び", durationMinutes: 15, estimatedCaloriesBurned: 90 };
    mockedAddExerciseEntry.mockResolvedValue({ ok: true, value: newEntry });

    fireEvent.click(screen.getByRole("button", { name: "＋ 記録する" }));

    expect(mockedAddExerciseEntry).toHaveBeenCalledWith(today, {
      activityName: "縄跳び",
      durationMinutes: 15,
      estimatedCaloriesBurned: 90,
    });

    await screen.findByText("縄跳び・15分");
    expect(screen.getByText("+90kcal")).toBeDefined();
  });

  it("removes an exercise entry via removeExerciseEntry with the date and id, and it disappears from the list (Requirement 10.4)", async () => {
    mockedGetDailyLog.mockResolvedValue({ ok: true, value: SAVED_LOG });
    const today = await mountAndCaptureDate();
    await screen.findByText("ウォーキング・30分");

    mockedRemoveExerciseEntry.mockResolvedValue({ ok: true, value: undefined });

    fireEvent.click(screen.getByRole("button", { name: "ウォーキングを削除" }));

    expect(mockedRemoveExerciseEntry).toHaveBeenCalledWith(today, 1);

    await waitFor(() => expect(screen.queryByText("ウォーキング・30分")).toBeNull());
  });
});
