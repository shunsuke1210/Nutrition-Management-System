import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App.js";
import * as profileClient from "./api/profileClient.js";
import * as dailyLogClient from "./api/dailyLogClient.js";

/**
 * `App` は task 6.1 で `ProfilePage`（`GET /api/profile` をマウント時に呼び出す）と
 * `DailyLogPanel`（`GET /api/daily-logs/:date` をマウント時に呼び出す）を同時に描画するため、
 * 両方のAPIクライアントをモックする（`ProfilePage.test.tsx` / `DailyLogPanel.test.tsx` と
 * 同じ規約）。モックしない場合、jsdom環境で実際の `fetch` が呼ばれ、テストが未処理の
 * ネットワークエラーで不安定になる。
 */
vi.mock("./api/profileClient.js", () => ({
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
}));

vi.mock("./api/dailyLogClient.js", () => ({
  getDailyLog: vi.fn(),
  saveDailyLog: vi.fn(),
  addExerciseEntry: vi.fn(),
  removeExerciseEntry: vi.fn(),
}));

/**
 * task 7.2（栄養ダッシュボードへの簡易ナビゲーション）: `DashboardPage` は
 * `profileClient`に加え`nutritionClient`/`menuPlanClient`/`mealSlotClient`など多数の
 * APIクライアントに依存する（`DashboardPage.tsx`参照）。これらは`DashboardPage.test.tsx`で
 * 既に個別にテスト済みであり、本ファイルの関心事は「ナビゲーション操作でプロフィール編集画面と
 * ダッシュボードが相互に表示切替できること」のみであるため、`DashboardPage`自体を軽量な
 * スタブに差し替える（module-level mock）。`ProfilePage`/`DailyLogPanel`は既存のtask 6.1の
 * テスト（このファイル冒頭の`vi.mock("./api/profileClient.js", ...)`
 * / `vi.mock("./api/dailyLogClient.js", ...)`）がそのまま実コンポーネントを描画できるように
 * 依存クライアントのみをモックする方式を採っているため、その既存方式と役割分担する形で
 * `DashboardPage`のみをスタブ化する。
 */
vi.mock("./pages/DashboardPage.js", () => ({
  DashboardPage: () => <p data-testid="dashboard-page-stub">ダッシュボードスタブ</p>,
}));

const mockedGetProfile = vi.mocked(profileClient.getProfile);
const mockedGetDailyLog = vi.mocked(dailyLogClient.getDailyLog);

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットし、モックの呼び出し履歴も破棄する。
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("App", () => {
  it("renders ProfilePage and DailyLogPanel together as the root view (task 6.1 composition)", async () => {
    mockedGetProfile.mockResolvedValue({ ok: true, value: null });
    mockedGetDailyLog.mockResolvedValue({ ok: true, value: null });

    render(<App />);

    expect(screen.getByRole("heading", { name: "プロフィール" }).textContent).toBe("プロフィール");
    expect(screen.getByRole("heading", { name: "今日の記録" }).textContent).toBe("今日の記録");

    await waitFor(() => expect(mockedGetProfile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockedGetDailyLog).toHaveBeenCalledTimes(1));
  });

  describe("簡易ナビゲーション（task 7.2）", () => {
    it("初期表示ではプロフィール編集画面（ProfilePage + DailyLogPanel）を表示する", async () => {
      mockedGetProfile.mockResolvedValue({ ok: true, value: null });
      mockedGetDailyLog.mockResolvedValue({ ok: true, value: null });

      render(<App />);

      expect(screen.getByRole("heading", { name: "プロフィール" }).textContent).toBe(
        "プロフィール",
      );
      expect(screen.getByRole("heading", { name: "今日の記録" }).textContent).toBe("今日の記録");
      expect(screen.queryByTestId("dashboard-page-stub")).toBeNull();

      await waitFor(() => expect(mockedGetProfile).toHaveBeenCalledTimes(1));
    });

    it("「栄養ダッシュボード」への切替操作で DashboardPage を表示する", async () => {
      mockedGetProfile.mockResolvedValue({ ok: true, value: null });
      mockedGetDailyLog.mockResolvedValue({ ok: true, value: null });

      render(<App />);
      await waitFor(() => expect(mockedGetProfile).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByRole("button", { name: "栄養ダッシュボード" }));

      expect(screen.getByTestId("dashboard-page-stub").textContent).toBe("ダッシュボードスタブ");
      expect(screen.queryByRole("heading", { name: "プロフィール" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "今日の記録" })).toBeNull();
    });

    it("ダッシュボード表示中に「プロフィール編集」へ切り替えると、プロフィール編集画面に戻る（往復確認）", async () => {
      mockedGetProfile.mockResolvedValue({ ok: true, value: null });
      mockedGetDailyLog.mockResolvedValue({ ok: true, value: null });

      render(<App />);
      await waitFor(() => expect(mockedGetProfile).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByRole("button", { name: "栄養ダッシュボード" }));
      expect(screen.getByTestId("dashboard-page-stub").textContent).toBe("ダッシュボードスタブ");

      fireEvent.click(screen.getByRole("button", { name: "プロフィール編集" }));

      expect(screen.getByRole("heading", { name: "プロフィール" }).textContent).toBe(
        "プロフィール",
      );
      expect(screen.getByRole("heading", { name: "今日の記録" }).textContent).toBe("今日の記録");
      expect(screen.queryByTestId("dashboard-page-stub")).toBeNull();

      await waitFor(() => expect(mockedGetProfile).toHaveBeenCalledTimes(2));
    });

    it("プロフィール編集画面・ダッシュボードのどちらの表示中でもナビゲーション操作自体は表示され続ける", async () => {
      mockedGetProfile.mockResolvedValue({ ok: true, value: null });
      mockedGetDailyLog.mockResolvedValue({ ok: true, value: null });

      render(<App />);
      await waitFor(() => expect(mockedGetProfile).toHaveBeenCalledTimes(1));

      expect(screen.getByRole("button", { name: "プロフィール編集" }).textContent).toBe(
        "プロフィール編集",
      );
      expect(screen.getByRole("button", { name: "栄養ダッシュボード" }).textContent).toBe(
        "栄養ダッシュボード",
      );

      fireEvent.click(screen.getByRole("button", { name: "栄養ダッシュボード" }));

      expect(screen.getByRole("button", { name: "プロフィール編集" }).textContent).toBe(
        "プロフィール編集",
      );
      expect(screen.getByRole("button", { name: "栄養ダッシュボード" }).textContent).toBe(
        "栄養ダッシュボード",
      );
    });
  });
});
