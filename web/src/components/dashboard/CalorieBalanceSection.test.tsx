import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DailyLogEntry, IsoDate } from "@nutrition/shared";
import * as dailyLogClient from "../../api/dailyLogClient.js";
import { CalorieBalanceSection } from "./CalorieBalanceSection.js";

/**
 * `dailyLogClient`（本コンポーネント自身、および内部で描画する2フォームがそれぞれ直接
 * 呼び出すクライアント）をまとめてモックする。`DietGoalStatusSection.test.tsx`の
 * `vi.mock("../../api/nutritionClient.js", ...)` + `vi.mocked(...)`と同じパターン。
 */
vi.mock("../../api/dailyLogClient.js", () => ({
  getLogsInRange: vi.fn(),
  saveDailyLog: vi.fn(),
  addExerciseEntry: vi.fn(),
}));

const mockedGetLogsInRange = vi.mocked(dailyLogClient.getLogsInRange);
const mockedSaveDailyLog = vi.mocked(dailyLogClient.saveDailyLog);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

// 2026-08-31は月曜日（node -e で実測確認済み）。dayIndex 0-6 = 月/火/水/木/金/土/日。
const WEEK_START_DATE: IsoDate = "2026-08-31";
const TODAY: IsoDate = "2026-09-02"; // 水曜日、dayIndex 2。
const CALORIE_TARGET = 1650;

function buildEntry(overrides: Partial<DailyLogEntry> & { date: IsoDate }): DailyLogEntry {
  return {
    weightKg: null,
    bodyFatPct: null,
    plannedKcal: null,
    manualOverrideKcal: null,
    calorieIntakeActual: null,
    calorieIntakeSource: "unrecorded",
    exerciseEntries: [],
    ...overrides,
  };
}

// 2026-09-01(火曜日, dayIndex1)は意図的に配列から欠落させる(=その日のログが未作成)。
// 2026-09-02(水曜日, today, dayIndex2)は行自体は存在するが calorieIntakeActual が null
// (plannedKcalも手動上書きも無い状態)。両方とも「データなし」として同様に扱われるべき
// ケースを1つのフィクスチャに含める(いずれも0を補完してはならない)。
const INITIAL_LOGS: DailyLogEntry[] = [
  buildEntry({ date: "2026-08-31", calorieIntakeActual: 1800, plannedKcal: 1800, calorieIntakeSource: "planned" }),
  buildEntry({ date: "2026-09-02", calorieIntakeActual: null }),
  buildEntry({ date: "2026-09-03", calorieIntakeActual: 1500, plannedKcal: 1500, calorieIntakeSource: "planned" }),
  buildEntry({ date: "2026-09-04", calorieIntakeActual: 1900, plannedKcal: 1900, calorieIntakeSource: "planned" }),
  buildEntry({ date: "2026-09-05", calorieIntakeActual: 1600, plannedKcal: 1600, calorieIntakeSource: "planned" }),
  buildEntry({ date: "2026-09-06", calorieIntakeActual: 1700, plannedKcal: 1700, calorieIntakeSource: "planned" }),
];

// 手動修正の再取得後を想定したフィクスチャ: 以前nullだった today(09-02) にも実データが加わる。
const REFRESHED_LOGS: DailyLogEntry[] = [
  buildEntry({ date: "2026-08-31", calorieIntakeActual: 1800, plannedKcal: 1800, calorieIntakeSource: "planned" }),
  buildEntry({
    date: "2026-09-02",
    calorieIntakeActual: 1550,
    manualOverrideKcal: 1550,
    calorieIntakeSource: "manual",
  }),
  buildEntry({ date: "2026-09-03", calorieIntakeActual: 1500, plannedKcal: 1500, calorieIntakeSource: "planned" }),
  buildEntry({ date: "2026-09-04", calorieIntakeActual: 1900, plannedKcal: 1900, calorieIntakeSource: "planned" }),
  buildEntry({ date: "2026-09-05", calorieIntakeActual: 1600, plannedKcal: 1600, calorieIntakeSource: "planned" }),
  buildEntry({ date: "2026-09-06", calorieIntakeActual: 1700, plannedKcal: 1700, calorieIntakeSource: "planned" }),
];

describe("CalorieBalanceSection", () => {
  it("shows a loading indicator while the initial fetch is pending, without rendering the chart/forms/advice", () => {
    mockedGetLogsInRange.mockReturnValue(new Promise(() => {}));

    const { container } = render(
      <CalorieBalanceSection weekStartDate={WEEK_START_DATE} today={TODAY} calorieTarget={CALORIE_TARGET} />,
    );

    expect(container.querySelector(".calorie-balance-loading")).not.toBeNull();
    expect(container.querySelectorAll("svg").length).toBe(0);
    expect(screen.queryByRole("button", { name: "今日の摂取カロリーを修正" })).toBeNull();
  });

  it("shows a fetch-error indicator when getLogsInRange fails, without rendering the chart/forms/advice", async () => {
    mockedGetLogsInRange.mockResolvedValue({ ok: false, error: { type: "unknown", message: "boom" } });

    const { container } = render(
      <CalorieBalanceSection weekStartDate={WEEK_START_DATE} today={TODAY} calorieTarget={CALORIE_TARGET} />,
    );

    await waitFor(() => expect(container.querySelector(".calorie-balance-fetch-error")).not.toBeNull());
    expect(container.querySelectorAll("svg").length).toBe(0);
    expect(screen.queryByRole("button", { name: "今日の摂取カロリーを修正" })).toBeNull();
  });

  it(
    "fetches the correct 7-day range (weekStartDate to weekStartDate+6) and builds the variance array " +
      "treating an absent day and a present-but-null day both as 'no data' (not a fabricated 0)",
    async () => {
      mockedGetLogsInRange.mockResolvedValue({ ok: true, value: INITIAL_LOGS });

      const { container } = render(
        <CalorieBalanceSection weekStartDate={WEEK_START_DATE} today={TODAY} calorieTarget={CALORIE_TARGET} />,
      );

      await waitFor(() => expect(mockedGetLogsInRange).toHaveBeenCalledTimes(1));
      expect(mockedGetLogsInRange).toHaveBeenCalledWith("2026-08-31", "2026-09-06");

      // 5件の実データ(08-31,09-03,09-04,09-05,09-06)のみ棒が描画される。09-01(欠落)と
      // 09-02(present-but-null)は棒を描画しない。
      await waitFor(() => expect(container.querySelectorAll("rect.bar-mark").length).toBe(5));

      // AdviceCalloutは今週最大の超過日(09-04, 金曜日, actual1900-target1650=+250kcal)を
      // 要約表示する。
      await screen.findByText(/金曜日/);
      expect(container.textContent).toContain("+250kcal");
    },
  );

  it("renders the static section caption (Requirement 12.2) and both action forms' trigger buttons", async () => {
    mockedGetLogsInRange.mockResolvedValue({ ok: true, value: INITIAL_LOGS });

    render(
      <CalorieBalanceSection weekStartDate={WEEK_START_DATE} today={TODAY} calorieTarget={CALORIE_TARGET} />,
    );

    await screen.findByRole("button", { name: "今日の摂取カロリーを修正" });
    expect(screen.getByRole("button", { name: "＋ 運動を記録" })).toBeDefined();
    expect(screen.getByText(/TDEE/)).toBeDefined();
  });

  it("a successful manual-override submission triggers a real refetch that updates the chart (Requirement 12.7)", async () => {
    mockedGetLogsInRange.mockResolvedValueOnce({ ok: true, value: INITIAL_LOGS });
    mockedSaveDailyLog.mockResolvedValue({
      ok: true,
      value: buildEntry({
        date: TODAY,
        calorieIntakeActual: 1550,
        manualOverrideKcal: 1550,
        calorieIntakeSource: "manual",
      }),
    });
    mockedGetLogsInRange.mockResolvedValueOnce({ ok: true, value: REFRESHED_LOGS });

    const { container } = render(
      <CalorieBalanceSection weekStartDate={WEEK_START_DATE} today={TODAY} calorieTarget={CALORIE_TARGET} />,
    );

    await waitFor(() => expect(container.querySelectorAll("rect.bar-mark").length).toBe(5));

    fireEvent.click(screen.getByRole("button", { name: "今日の摂取カロリーを修正" }));
    fireEvent.change(screen.getByLabelText("摂取カロリー"), { target: { value: "1550" } });
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));

    await waitFor(() => expect(mockedGetLogsInRange).toHaveBeenCalledTimes(2));
    // 更新後のフィクスチャでは以前nullだった today(09-02) にも実データが加わり6件になる
    // (mockResolvedValueOnceの2件チェーンにより、これが本当に2回目の取得結果を反映している
    // ことを証明する)。
    await waitFor(() => expect(container.querySelectorAll("rect.bar-mark").length).toBe(6));
  });

  it(
    "AdviceCallout's dailyVariances only includes days with real data (the absent day and the " +
      "present-but-null day never appear in the advice text)",
    async () => {
      mockedGetLogsInRange.mockResolvedValue({ ok: true, value: INITIAL_LOGS });

      render(
        <CalorieBalanceSection weekStartDate={WEEK_START_DATE} today={TODAY} calorieTarget={CALORIE_TARGET} />,
      );

      await screen.findByText(/金曜日/);
      expect(screen.queryByText(/火曜日/)).toBeNull();
      expect(screen.queryByText(/水曜日/)).toBeNull();
    },
  );
});
