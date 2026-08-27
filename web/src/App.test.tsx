import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
});
