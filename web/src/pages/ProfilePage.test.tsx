import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Profile } from "@nutrition/shared";
import { ProfilePage } from "./ProfilePage.js";
import * as profileClient from "../api/profileClient.js";

/**
 * `profileClient`（task 1.5）をモックし、`ProfilePage` が `GET /api/profile` /
 * `PUT /api/profile` を直接呼び出さずにこのモジュール経由でAPIとやり取りすることを
 * 前提にテストする（design.md: Domain: UI Implementation Notes）。
 */
vi.mock("../api/profileClient.js", () => ({
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
}));

const mockedGetProfile = vi.mocked(profileClient.getProfile);
const mockedSaveProfile = vi.mocked(profileClient.saveProfile);

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットし、モックの呼び出し履歴・実装も破棄する。
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/** 全項目に代表値を入れた保存済みプロフィール（各セクションの初期表示を横断的に検証するため）。 */
const savedProfile: Profile = {
  heightCm: 168,
  weightKg: 60.5,
  age: 34,
  gender: "female",
  bodyFatPct: 22.5,
  medicalNotes: "小麦アレルギー（軽度）",
  pregnancyStatus: "none",
  sleepHours: 7,
  alcoholHabit: "occasional",
  smokingHabit: "non_smoker",
  cookingSkill: "普通",
  cookingTimePreference: "30分以内",
  budgetPreference: "500〜800円",
  jobActivityLevel: "mixed",
  commuteMethod: "transit",
  averageDailySteps: 6000,
  exerciseRoutine: [
    { scene: "holiday", content: "ジョギング", frequencyPerWeek: 2, durationMinutes: 30, intensity: "moderate" },
  ],
  ngIngredients: ["パクチー"],
  preferredIngredients: ["鶏むね肉"],
  restrictionType: "low_carb",
  restrictionIntensity: "standard",
  restrictionNotes: "16時以降の糖質を控えたい",
  dietModeEnabled: true,
  goalWeightKg: 55,
  goalPeriodWeeks: 12,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

function heightInput(): HTMLInputElement {
  return screen.getByLabelText("身長") as HTMLInputElement;
}

/**
 * クライアント側の送信前検証（`validateFormLocally`, remediation round 1）をすべて通過する
 * 最小限の入力を行う。必須項目（身長・体重・年齢・性別・お仕事中の活動度・通勤手段）だけを
 * 埋め、それ以外は既定値（`restrictionType: "none"` は強度不要、`dietModeEnabled: false` は
 * 目標体重/期間不要、運動量テーブル0行は許可）のまま残す。これによりローカル検証を確実に
 * 通過させ、`saveProfile` 呼び出しに到達するテスト（サーバー側の応答を検証するテスト）を
 * 送信前ゲートに阻害されずに書ける。
 */
function fillMinimalValidForm(): void {
  fireEvent.change(heightInput(), { target: { value: "170" } });
  fireEvent.change(screen.getByLabelText("体重"), { target: { value: "60" } });
  fireEvent.change(screen.getByLabelText("年齢"), { target: { value: "30" } });
  fireEvent.click(screen.getByRole("radio", { name: "回答しない" }));
  fireEvent.click(screen.getByRole("radio", { name: "座り・立ち半々" }));
  fireEvent.click(screen.getByRole("radio", { name: "徒歩・自転車が中心" }));
}

describe("ProfilePage", () => {
  it("initializes all sections from an existing profile on mount (Requirement 7.1)", async () => {
    mockedGetProfile.mockResolvedValue({ ok: true, value: savedProfile });

    render(<ProfilePage />);

    await screen.findByDisplayValue("168");

    expect(heightInput().value).toBe("168");
    expect((screen.getByLabelText("体重") as HTMLInputElement).value).toBe("60.5");
    expect((screen.getByLabelText("年齢") as HTMLInputElement).value).toBe("34");
    expect((screen.getByRole("radio", { name: "女性" }) as HTMLInputElement).checked).toBe(true);

    expect((screen.getByLabelText("体脂肪率") as HTMLInputElement).value).toBe("22.5");

    expect((screen.getByLabelText("平均睡眠時間") as HTMLInputElement).value).toBe("7");
    expect((screen.getByRole("radio", { name: "たまに" }) as HTMLInputElement).checked).toBe(true);

    expect((screen.getByRole("radio", { name: "電車・バスなど" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("1日の平均歩数（分かれば）") as HTMLInputElement).value).toBe("6000");

    const routineRow = screen.getAllByRole("row")[1]!;
    expect(within(routineRow).getByRole("textbox", { name: "内容" })).toHaveProperty("value", "ジョギング");

    const ngGroup = screen.getByRole("group", { name: "NG食材・苦手な食材" });
    expect(within(ngGroup).getByText("パクチー")).toBeDefined();

    expect((screen.getByRole("radio", { name: "糖質制限" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "標準" }) as HTMLInputElement).checked).toBe(true);

    expect((screen.getByLabelText("目標体重") as HTMLInputElement).value).toBe("55");
    expect((screen.getByLabelText("目標達成期間") as HTMLInputElement).value).toBe("12");
  });

  it("initializes all sections to an empty state when no profile has been saved yet (Requirement 7.2)", async () => {
    mockedGetProfile.mockResolvedValue({ ok: true, value: null });

    render(<ProfilePage />);
    await screen.findByLabelText("身長");

    expect(heightInput().value).toBe("");
    expect((screen.getByLabelText("体重") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("年齢") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("radio", { name: "女性" })).toHaveProperty("checked", false);
    expect(screen.getByRole("radio", { name: "男性" })).toHaveProperty("checked", false);
    expect(screen.getByRole("radio", { name: "回答しない" })).toHaveProperty("checked", false);

    // ダイエットモードは既定で無効のため、目標体重・目標達成期間フィールドは表示されない。
    expect(screen.queryByLabelText("目標体重")).toBeNull();

    // 週間の運動量は0行、NG/好み食材は0件で表示され、クラッシュしない（4.9, 3.5）。
    expect(screen.getAllByRole("row")).toHaveLength(1); // ヘッダー行のみ
  });

  it("calls saveProfile with the current form state and reflects the saved response on success", async () => {
    mockedGetProfile.mockResolvedValue({ ok: true, value: null });
    mockedSaveProfile.mockResolvedValue({ ok: true, value: savedProfile });

    render(<ProfilePage />);
    await screen.findByLabelText("身長");

    fillMinimalValidForm();
    fireEvent.click(screen.getByRole("button", { name: "プロフィールを保存" }));

    await screen.findByText("保存しました");

    expect(mockedSaveProfile).toHaveBeenCalledTimes(1);
    const sentInput = mockedSaveProfile.mock.calls[0]![0];
    expect(sentInput.heightCm).toBe(170);

    // 成功後はサーバーからの正のレスポンスでフォーム全体が再初期化される。
    expect((screen.getByLabelText("体脂肪率") as HTMLInputElement).value).toBe("22.5");
    expect((screen.getByRole("radio", { name: "女性" }) as HTMLInputElement).checked).toBe(true);
  });

  it("runs client-side pre-submit validation and skips saveProfile when a section is locally invalid", async () => {
    mockedGetProfile.mockResolvedValue({ ok: true, value: null });

    render(<ProfilePage />);
    await screen.findByLabelText("身長");

    // 身長など必須項目を未入力のまま保存を試みる（design.md: 「送信前に同一ルールで検証して
    // ユーザーへ即時フィードバックする」）。ローカル検証で拒否され、`saveProfile` には到達しない。
    fireEvent.click(screen.getByRole("button", { name: "プロフィールを保存" }));

    const input = heightInput();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy!)?.textContent).not.toBe("");

    expect(mockedSaveProfile).not.toHaveBeenCalled();
  });

  it("maps a backend field error from a failed save onto the corresponding section (heightCm -> BasicInfoSection)", async () => {
    mockedGetProfile.mockResolvedValue({ ok: true, value: null });
    mockedSaveProfile.mockResolvedValue({
      ok: false,
      error: { type: "validation", fieldErrors: { heightCm: ["身長は正の数で入力してください。"] } },
    });

    render(<ProfilePage />);
    await screen.findByLabelText("身長");

    // ローカル検証をすべて通過する値を入力してから保存する。これによりローカル検証は
    // エラーを出さず `saveProfile` まで到達し、サーバーからの `heightCm` エラーが
    // 表示されることをローカル検証と切り分けて確認できる（design.md: 最終的な正としての
    // 検証はサーバー側が行う）。
    fillMinimalValidForm();
    fireEvent.click(screen.getByRole("button", { name: "プロフィールを保存" }));

    expect(await screen.findByText("身長は正の数で入力してください。")).toBeDefined();
    expect(heightInput().getAttribute("aria-invalid")).toBe("true");
  });

  it("maps a backend row-scoped exerciseRoutine field error onto the corresponding table row", async () => {
    mockedGetProfile.mockResolvedValue({ ok: true, value: savedProfile });
    mockedSaveProfile.mockResolvedValue({
      ok: false,
      error: {
        type: "validation",
        fieldErrors: { "exerciseRoutine.0.frequencyPerWeek": ["頻度は正の数で入力してください。"] },
      },
    });

    render(<ProfilePage />);
    await screen.findByDisplayValue("168");

    fireEvent.click(screen.getByRole("button", { name: "プロフィールを保存" }));

    expect(await screen.findByText("頻度は正の数で入力してください。")).toBeDefined();
  });

  it("scopes multi-row exerciseRoutine backend field errors to the correct row only", async () => {
    const twoRowProfile: Profile = {
      ...savedProfile,
      exerciseRoutine: [
        { scene: "commute", content: "徒歩", frequencyPerWeek: 5, durationMinutes: 15, intensity: "light" },
        { scene: "holiday", content: "ジョギング", frequencyPerWeek: 2, durationMinutes: 30, intensity: "moderate" },
      ],
    };
    mockedGetProfile.mockResolvedValue({ ok: true, value: twoRowProfile });
    mockedSaveProfile.mockResolvedValue({
      ok: false,
      error: {
        type: "validation",
        fieldErrors: { "exerciseRoutine.1.durationMinutes": ["1回の時間は正の数で入力してください。"] },
      },
    });

    render(<ProfilePage />);
    await screen.findByDisplayValue("168");

    fireEvent.click(screen.getByRole("button", { name: "プロフィールを保存" }));

    await screen.findByText("1回の時間は正の数で入力してください。");

    const dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows).toHaveLength(2);
    expect(within(dataRows[0]!).queryByText("1回の時間は正の数で入力してください。")).toBeNull();
    expect(within(dataRows[1]!).queryByText("1回の時間は正の数で入力してください。")).not.toBeNull();
  });

  it("cancel discards unsaved edits without calling saveProfile and reverts to the last-saved value (Requirement 7.5)", async () => {
    mockedGetProfile.mockResolvedValue({ ok: true, value: savedProfile });

    render(<ProfilePage />);
    await screen.findByDisplayValue("168");

    fireEvent.change(heightInput(), { target: { value: "999" } });
    expect(heightInput().value).toBe("999");

    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(heightInput().value).toBe("168");
    expect(mockedSaveProfile).not.toHaveBeenCalled();
  });

  it("shows the saved values across multiple sections after a simulated page reload (task 4.4 completion condition)", async () => {
    mockedGetProfile.mockResolvedValueOnce({ ok: true, value: null });
    mockedSaveProfile.mockResolvedValue({ ok: true, value: savedProfile });

    const { unmount } = render(<ProfilePage />);
    await screen.findByLabelText("身長");

    // ローカル検証を通過させるため、必須項目を最小限埋めてから保存する（下記の
    // アサーションはこの下書き値ではなく、モックされた `saveProfile` の成功応答
    // `savedProfile` が反映された値を検証する）。
    fillMinimalValidForm();
    fireEvent.click(screen.getByRole("button", { name: "プロフィールを保存" }));
    await screen.findByText("保存しました");

    // ページ再読み込みをシミュレートする: 一旦アンマウントし、`getProfile` が
    // 直前に保存された値を返すようにしたうえで再マウントする。
    unmount();
    cleanup();
    mockedGetProfile.mockResolvedValueOnce({ ok: true, value: savedProfile });

    render(<ProfilePage />);
    await screen.findByDisplayValue("168");

    expect((screen.getByLabelText("体重") as HTMLInputElement).value).toBe("60.5");
    expect((screen.getByLabelText("体脂肪率") as HTMLInputElement).value).toBe("22.5");
    expect((screen.getByLabelText("平均睡眠時間") as HTMLInputElement).value).toBe("7");
    expect((screen.getByLabelText("1日の平均歩数（分かれば）") as HTMLInputElement).value).toBe("6000");
    expect((screen.getByLabelText("目標体重") as HTMLInputElement).value).toBe("55");
    expect((screen.getByLabelText("目標達成期間") as HTMLInputElement).value).toBe("12");
    expect((screen.getByRole("radio", { name: "糖質制限" }) as HTMLInputElement).checked).toBe(true);

    const ngGroup = screen.getByRole("group", { name: "NG食材・苦手な食材" });
    expect(within(ngGroup).getByText("パクチー")).toBeDefined();
  });
});
