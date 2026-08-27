/**
 * task 7.5 (E2Eテスト) 用のテストスイート。
 *
 * ## なぜこのファイルが必要か
 * `web/package.json` / ルート `package.json` にはPlaywright/Cypress等のブラウザ自動化
 * フレームワークが導入されておらず、design.md の Technology Stack 表にもE2Eツールの指定が
 * 存在しない。design.md の「Testing Strategy > E2E/UI Tests」節（3項目）は task 7.5 の3つの
 * 観測可能な完了条件とほぼ同一の文言で、特定のツールを指定していない。
 *
 * 一方、`ProfilePage.test.tsx`（task 4.4）・`DietModeSection.test.tsx`（task 4.3）・
 * `DailyLogPanel.test.tsx`（task 5.3）には、それぞれのコンポーネント単体に対する
 * React Testing Library ベースの網羅的なテストが既に存在し、task 7.5 の3つの観測可能な
 * 完了条件のほぼすべてを個別には満たしている（詳細は各テストの参照コメント）。
 *
 * ただし、これら3ファイルはいずれも自身のコンポーネント（`ProfilePage` / `DailyLogPanel`）
 * のみを個別にマウントしてテストしており、task 6.1 で実際に組み立てられた `App`
 * （`ProfilePage` + `DailyLogPanel` を同一画面に同時マウントするルートページシェル）を
 * 一度も描画していない。`App.test.tsx`（task 6.1）も両方の見出しが描画されることのみを
 * 確認しており、インタラクティブなシナリオを駆動していない。
 *
 * 実際にブラウザで動くのは常に「`ProfilePage` と `DailyLogPanel` が同時にマウントされた
 * `App`」であり、両コンポーネントを個別にマウントするテストでは検出できない問題
 * （例: 両コンポーネントが偶然同じアクセシブルネームを持つフィールドを持っていた場合の
 * クエリの曖昧化 — 実際、本ファイル作成時に `ProfilePage` の「体重」「体脂肪率」フィールドと
 * `DailyLogPanel` の「体重」「体脂肪率」フィールドが同一のアクセシブルネームを持つことが
 * 判明した。個別マウントのテストでは重複しないため問題が顕在化しないが、`App` を実際に
 * 描画すると `screen.getByLabelText("体重")` は曖昧一致で例外を投げる）が、`App` を通した
 * シナリオでは検出できる。本ファイルはこの「実際に組み立てられた画面全体を描画し、
 * 両パネルにまたがるシナリオを駆動する」という、既存テストが埋めていない一点に絞った
 * E2E相当のテストを追加するものである。
 *
 * 上記の理由により、既存の `ProfilePage.test.tsx` / `DietModeSection.test.tsx` /
 * `DailyLogPanel.test.tsx` の内容を重複させることはせず（それらは変更しない）、`App`
 * 全体を描画した上でのみ意味を持つ検証（フィールドの重複によるクエリの曖昧化の回避を
 * 含む、実際のDOM構成に基づくシナリオ）に限定する。
 *
 * `profileClient` / `dailyLogClient`（design.md: Domain: UI Implementation Notes）を
 * モックし、実際のHTTP通信は行わない点は既存の `App.test.tsx` / `ProfilePage.test.tsx` /
 * `DailyLogPanel.test.tsx` と同じ規約に従う。
 *
 * Requirements: 7.1, 7.2（プロフィール再読み込み後の値の保持）,
 * 6.2, 6.3（ダイエットモードのトグルによる目標フィールドの表示切替と必須検証）,
 * 8.3（体重・体脂肪率の日次記録の保存）, 10.3, 10.4（追加運動記録の登録・削除）
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DailyLogEntry, ExerciseLogEntry, Profile } from "@nutrition/shared";
import { App } from "../App.js";
import * as profileClient from "../api/profileClient.js";
import * as dailyLogClient from "../api/dailyLogClient.js";

vi.mock("../api/profileClient.js", () => ({
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
}));

vi.mock("../api/dailyLogClient.js", () => ({
  getDailyLog: vi.fn(),
  saveDailyLog: vi.fn(),
  addExerciseEntry: vi.fn(),
  removeExerciseEntry: vi.fn(),
}));

const mockedGetProfile = vi.mocked(profileClient.getProfile);
const mockedSaveProfile = vi.mocked(profileClient.saveProfile);
const mockedGetDailyLog = vi.mocked(dailyLogClient.getDailyLog);
const mockedSaveDailyLog = vi.mocked(dailyLogClient.saveDailyLog);
const mockedAddExerciseEntry = vi.mocked(dailyLogClient.addExerciseEntry);
const mockedRemoveExerciseEntry = vi.mocked(dailyLogClient.removeExerciseEntry);

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットし、モックの呼び出し履歴・実装も破棄する
// （既存の `App.test.tsx` 等と同じ規約）。
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/** `DailyLogPanel` が常にマウントする `.sidebar-card`（「今日の記録」）コンテナを取得する。 */
function getSidebar(): HTMLElement {
  const sidebar = document.querySelector(".sidebar-card");
  if (sidebar === null) {
    throw new Error(".sidebar-card が見つかりません（DailyLogPanelが描画されていません）。");
  }
  return sidebar as HTMLElement;
}

/**
 * ローカル検証（`validateFormLocally`）をすべて通過する最小限の必須項目だけを埋める
 * （`ProfilePage.test.tsx` の `fillMinimalValidForm` と同じ値・同じ意図。他セクションの
 * 検証エラーに阻害されずに、対象シナリオ（ここではダイエットモードのトグル）だけを
 * 切り分けてテストするため）。
 */
function fillMinimalRequiredProfileFields(main: HTMLElement): void {
  fireEvent.change(within(main).getByLabelText("身長"), { target: { value: "170" } });
  fireEvent.change(within(main).getByLabelText("体重"), { target: { value: "60" } });
  fireEvent.change(within(main).getByLabelText("年齢"), { target: { value: "30" } });
  fireEvent.click(within(main).getByRole("radio", { name: "回答しない" }));
  fireEvent.click(within(main).getByRole("radio", { name: "座り・立ち半々" }));
  fireEvent.click(within(main).getByRole("radio", { name: "徒歩・自転車が中心" }));
}

const EMPTY_LOG: DailyLogEntry = {
  date: "2026-08-27",
  weightKg: null,
  bodyFatPct: null,
  plannedKcal: null,
  manualOverrideKcal: null,
  calorieIntakeActual: null,
  calorieIntakeSource: "unrecorded",
  exerciseEntries: [],
};

describe("Profile editing + Today's record — composed App E2E scenarios (task 7.5)", () => {
  it(
    "fills a representative field across every mockup.html profile section, saves, and the entered " +
      "values persist across a simulated full-app reload, alongside the Today's Record panel " +
      "(Requirements 7.1, 7.2)",
    async () => {
      mockedGetProfile.mockResolvedValueOnce({ ok: true, value: null });
      mockedGetDailyLog.mockResolvedValue({ ok: true, value: null });

      render(<App />);
      const main = screen.getByRole("main");
      await within(main).findByLabelText("身長");
      // 「今日の記録」パネルも同一画面に存在することを確認する（task 6.1 の合成）。
      expect(screen.getByRole("heading", { name: "今日の記録" })).toBeDefined();

      // --- 基本情報（必須） ---
      fireEvent.change(within(main).getByLabelText("身長"), { target: { value: "172" } });
      fireEvent.change(within(main).getByLabelText("体重"), { target: { value: "65.5" } });
      fireEvent.change(within(main).getByLabelText("年齢"), { target: { value: "41" } });
      fireEvent.click(within(main).getByRole("radio", { name: "女性" }));

      // --- 身体情報 ---
      fireEvent.change(within(main).getByLabelText("体脂肪率"), { target: { value: "24" } });
      fireEvent.click(within(main).getByRole("radio", { name: "授乳中" }));
      fireEvent.change(within(main).getByLabelText("既往症・アレルギー・服薬情報"), {
        target: { value: "小麦アレルギー（軽度）" },
      });

      // --- 生活習慣 ---
      fireEvent.change(within(main).getByLabelText("平均睡眠時間"), { target: { value: "6.5" } });
      fireEvent.click(within(main).getByRole("radio", { name: "しない" }));
      fireEvent.click(within(main).getByRole("radio", { name: "吸わない" }));
      fireEvent.click(within(main).getByRole("radio", { name: "得意" }));
      fireEvent.change(within(main).getByLabelText("調理にかけられる時間"), { target: { value: "30分以内" } });
      fireEvent.change(within(main).getByLabelText("1食あたりの予算感"), { target: { value: "500〜800円" } });

      // --- 運動習慣（お仕事中の活動度・通勤手段は必須） ---
      fireEvent.click(within(main).getByRole("radio", { name: "主に立つ・体を動かす仕事" }));
      fireEvent.click(within(main).getByRole("radio", { name: "徒歩・自転車が中心" }));
      fireEvent.change(within(main).getByLabelText("1日の平均歩数（分かれば）"), { target: { value: "8000" } });

      // --- 運動習慣: 週間の運動量テーブルに1行追加 ---
      fireEvent.click(within(main).getByRole("button", { name: "＋ 行を追加" }));
      const routineRow = within(main).getAllByRole("row")[1]!;
      fireEvent.change(within(routineRow).getByRole("textbox", { name: "内容" }), {
        target: { value: "ジョギング" },
      });
      fireEvent.change(within(routineRow).getByRole("spinbutton", { name: "頻度" }), { target: { value: "3" } });
      fireEvent.change(within(routineRow).getByRole("spinbutton", { name: "1回の時間" }), {
        target: { value: "45" },
      });

      // --- 食の好み・NG食材 ---
      const ngGroup = within(main).getByRole("group", { name: "NG食材・苦手な食材" });
      fireEvent.change(within(ngGroup).getByRole("textbox", { name: "NG食材・苦手な食材に追加する食材名" }), {
        target: { value: "パクチー" },
      });
      fireEvent.click(within(ngGroup).getByRole("button", { name: "＋ 追加" }));

      const preferredGroup = within(main).getByRole("group", { name: "好きな食材・よく使ってほしい食材" });
      fireEvent.change(
        within(preferredGroup).getByRole("textbox", { name: "好きな食材・よく使ってほしい食材に追加する食材名" }),
        { target: { value: "鶏むね肉" } },
      );
      fireEvent.click(within(preferredGroup).getByRole("button", { name: "＋ 追加" }));

      // --- 食事制限設定（「制限なし」以外を選ぶと強度が必須になる） ---
      fireEvent.click(within(main).getByRole("radio", { name: "糖質制限" }));
      fireEvent.click(within(main).getByRole("radio", { name: "標準" }));
      fireEvent.change(within(main).getByLabelText("その他の食事制限・献立への要望（自由記述）"), {
        target: { value: "揚げ物はできるだけ控えたい" },
      });

      // --- ダイエットモード ---
      fireEvent.click(within(main).getByRole("checkbox", { name: "ダイエットモードを利用する" }));
      fireEvent.change(within(main).getByLabelText("目標体重"), { target: { value: "58" } });
      fireEvent.change(within(main).getByLabelText("目標達成期間"), { target: { value: "20" } });

      const filledProfile: Profile = {
        heightCm: 172,
        weightKg: 65.5,
        age: 41,
        gender: "female",
        bodyFatPct: 24,
        medicalNotes: "小麦アレルギー（軽度）",
        pregnancyStatus: "lactating",
        sleepHours: 6.5,
        alcoholHabit: "none",
        smokingHabit: "non_smoker",
        cookingSkill: "得意",
        cookingTimePreference: "30分以内",
        budgetPreference: "500〜800円",
        jobActivityLevel: "mostly_active",
        commuteMethod: "walk_or_bike",
        averageDailySteps: 8000,
        exerciseRoutine: [
          { scene: "commute", content: "ジョギング", frequencyPerWeek: 3, durationMinutes: 45, intensity: "light" },
        ],
        ngIngredients: ["パクチー"],
        preferredIngredients: ["鶏むね肉"],
        restrictionType: "low_carb",
        restrictionIntensity: "standard",
        restrictionNotes: "揚げ物はできるだけ控えたい",
        dietModeEnabled: true,
        goalWeightKg: 58,
        goalPeriodWeeks: 20,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      };
      mockedSaveProfile.mockResolvedValue({ ok: true, value: filledProfile });

      fireEvent.click(within(main).getByRole("button", { name: "プロフィールを保存" }));
      await within(main).findByText("保存しました");

      // 全セクションにまたがる代表的なフィールドが、実際に入力した値のまま送信されたことを確認する。
      expect(mockedSaveProfile).toHaveBeenCalledTimes(1);
      const sentInput = mockedSaveProfile.mock.calls[0]![0];
      expect(sentInput.heightCm).toBe(172);
      expect(sentInput.bodyFatPct).toBe(24);
      expect(sentInput.pregnancyStatus).toBe("lactating");
      expect(sentInput.sleepHours).toBe(6.5);
      expect(sentInput.jobActivityLevel).toBe("mostly_active");
      expect(sentInput.exerciseRoutine).toEqual([
        { scene: "commute", content: "ジョギング", frequencyPerWeek: 3, durationMinutes: 45, intensity: "light" },
      ]);
      expect(sentInput.ngIngredients).toEqual(["パクチー"]);
      expect(sentInput.preferredIngredients).toEqual(["鶏むね肉"]);
      expect(sentInput.restrictionType).toBe("low_carb");
      expect(sentInput.restrictionIntensity).toBe("standard");
      expect(sentInput.dietModeEnabled).toBe(true);
      expect(sentInput.goalWeightKg).toBe(58);
      expect(sentInput.goalPeriodWeeks).toBe(20);

      // ページ再読み込みをシミュレートする: `App` 全体を一旦アンマウントし、`getProfile` が
      // 直前に保存された値を返すようにしたうえで再マウントする（`ProfilePage.test.tsx` の
      // 「reloadのシミュレーション」パターンを、`ProfilePage` 単体ではなく `App` 全体に適用する）。
      cleanup();
      mockedGetProfile.mockResolvedValueOnce({ ok: true, value: filledProfile });
      mockedGetDailyLog.mockResolvedValue({ ok: true, value: null });

      render(<App />);
      const reloadedMain = screen.getByRole("main");
      await within(reloadedMain).findByDisplayValue("172");

      expect(within(reloadedMain).getByLabelText("体重")).toHaveProperty("value", "65.5");
      expect(within(reloadedMain).getByLabelText("体脂肪率")).toHaveProperty("value", "24");
      expect(within(reloadedMain).getByRole("radio", { name: "授乳中" })).toHaveProperty("checked", true);
      expect(within(reloadedMain).getByLabelText("平均睡眠時間")).toHaveProperty("value", "6.5");
      expect(within(reloadedMain).getByRole("radio", { name: "しない" })).toHaveProperty("checked", true);
      expect(within(reloadedMain).getByRole("radio", { name: "得意" })).toHaveProperty("checked", true);
      expect(within(reloadedMain).getByLabelText("調理にかけられる時間")).toHaveProperty("value", "30分以内");
      expect(within(reloadedMain).getByRole("radio", { name: "主に立つ・体を動かす仕事" })).toHaveProperty(
        "checked",
        true,
      );
      expect(within(reloadedMain).getByLabelText("1日の平均歩数（分かれば）")).toHaveProperty("value", "8000");

      const persistedRow = within(reloadedMain).getAllByRole("row")[1]!;
      expect(within(persistedRow).getByRole("textbox", { name: "内容" })).toHaveProperty("value", "ジョギング");

      const persistedNgGroup = within(reloadedMain).getByRole("group", { name: "NG食材・苦手な食材" });
      expect(within(persistedNgGroup).getByText("パクチー")).toBeDefined();
      const persistedPreferredGroup = within(reloadedMain).getByRole("group", {
        name: "好きな食材・よく使ってほしい食材",
      });
      expect(within(persistedPreferredGroup).getByText("鶏むね肉")).toBeDefined();

      expect(within(reloadedMain).getByRole("radio", { name: "糖質制限" })).toHaveProperty("checked", true);
      expect(within(reloadedMain).getByRole("radio", { name: "標準" })).toHaveProperty("checked", true);
      expect(within(reloadedMain).getByLabelText("目標体重")).toHaveProperty("value", "58");
      expect(within(reloadedMain).getByLabelText("目標達成期間")).toHaveProperty("value", "20");

      // 再読み込み後も「今日の記録」パネルが同一画面に共存していることを確認する。
      expect(screen.getByRole("heading", { name: "今日の記録" })).toBeDefined();
    },
  );

  it(
    "the diet mode toggle shows/hides the goal fields and enforces required validation on save, " +
      "inside the fully composed App (Requirements 6.2, 6.3)",
    async () => {
      mockedGetProfile.mockResolvedValue({ ok: true, value: null });
      mockedGetDailyLog.mockResolvedValue({ ok: true, value: null });

      render(<App />);
      const main = screen.getByRole("main");
      await within(main).findByLabelText("身長");

      fillMinimalRequiredProfileFields(main);

      // ダイエットモードが無効な既定状態では目標フィールドは表示されない（Requirement 6.3）。
      expect(within(main).queryByLabelText("目標体重")).toBeNull();
      expect(within(main).queryByLabelText("目標達成期間")).toBeNull();

      // トグルをオンにすると目標フィールドが表示される（Requirement 6.2）。
      fireEvent.click(within(main).getByRole("checkbox", { name: "ダイエットモードを利用する" }));
      expect(within(main).getByLabelText("目標体重")).toBeDefined();
      expect(within(main).getByLabelText("目標達成期間")).toBeDefined();

      // 目標体重・目標達成期間を未入力のまま保存を試みると、ローカル検証で拒否され
      // `saveProfile` は呼び出されない（Requirement 6.2 の必須検証）。
      fireEvent.click(within(main).getByRole("button", { name: "プロフィールを保存" }));

      expect(mockedSaveProfile).not.toHaveBeenCalled();
      const goalWeightInput = within(main).getByLabelText("目標体重");
      expect(goalWeightInput.getAttribute("aria-invalid")).toBe("true");
      expect(
        within(main).getByText("dietModeEnabled が true の場合、goalWeightKg は必須です。"),
      ).toBeDefined();
      expect(
        within(main).getByText("dietModeEnabled が true の場合、goalPeriodWeeks は必須です。"),
      ).toBeDefined();

      // 目標体重・目標達成期間を入力すると保存できる。
      fireEvent.change(within(main).getByLabelText("目標体重"), { target: { value: "60" } });
      fireEvent.change(within(main).getByLabelText("目標達成期間"), { target: { value: "10" } });

      const savedWithDietMode: Profile = {
        heightCm: 170,
        weightKg: 60,
        age: 30,
        gender: "undisclosed",
        bodyFatPct: null,
        medicalNotes: null,
        pregnancyStatus: "none",
        sleepHours: null,
        alcoholHabit: null,
        smokingHabit: null,
        cookingSkill: null,
        cookingTimePreference: null,
        budgetPreference: null,
        jobActivityLevel: "mixed",
        commuteMethod: "walk_or_bike",
        averageDailySteps: null,
        exerciseRoutine: [],
        ngIngredients: [],
        preferredIngredients: [],
        restrictionType: "none",
        restrictionIntensity: null,
        restrictionNotes: null,
        dietModeEnabled: true,
        goalWeightKg: 60,
        goalPeriodWeeks: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      };
      mockedSaveProfile.mockResolvedValue({ ok: true, value: savedWithDietMode });

      fireEvent.click(within(main).getByRole("button", { name: "プロフィールを保存" }));
      await within(main).findByText("保存しました");

      expect(mockedSaveProfile).toHaveBeenCalledTimes(1);
      const sentInput = mockedSaveProfile.mock.calls[0]![0];
      expect(sentInput.dietModeEnabled).toBe(true);
      expect(sentInput.goalWeightKg).toBe(60);
      expect(sentInput.goalPeriodWeeks).toBe(10);

      // 保存成功後にトグルをオフにすると、目標フィールドは再び非表示になる（Requirement 6.3）。
      fireEvent.click(within(main).getByRole("checkbox", { name: "ダイエットモードを利用する" }));
      expect(within(main).queryByLabelText("目標体重")).toBeNull();
      expect(within(main).queryByLabelText("目標達成期間")).toBeNull();
    },
  );

  it(
    "Today's Record: saving weight/bodyFat and adding/removing an exercise entry work inside the " +
      "fully composed App without disturbing the profile panel mounted alongside it " +
      "(Requirements 8.3, 10.3, 10.4)",
    async () => {
      mockedGetProfile.mockResolvedValue({ ok: true, value: null });
      mockedGetDailyLog.mockResolvedValue({ ok: true, value: EMPTY_LOG });

      render(<App />);

      const main = screen.getByRole("main");
      await within(main).findByLabelText("身長");
      await waitFor(() => expect(mockedGetDailyLog).toHaveBeenCalledTimes(1));
      const today = mockedGetDailyLog.mock.calls[0]![0];

      const sidebar = getSidebar();
      await within(sidebar).findByLabelText("体重");

      // --- 体重・体脂肪率の保存（Requirement 8.3） ---
      fireEvent.change(within(sidebar).getByLabelText("体重"), { target: { value: "71.4" } });
      fireEvent.change(within(sidebar).getByLabelText("体脂肪率"), { target: { value: "23" } });

      const savedWeightEntry: DailyLogEntry = { ...EMPTY_LOG, weightKg: 71.4, bodyFatPct: 23 };
      mockedSaveDailyLog.mockResolvedValue({ ok: true, value: savedWeightEntry });

      fireEvent.click(within(sidebar).getByRole("button", { name: "体重・体脂肪率を保存" }));

      await within(sidebar).findByText("体重・体脂肪率を保存しました");
      expect(mockedSaveDailyLog).toHaveBeenCalledWith(today, { weightKg: 71.4, bodyFatPct: 23 });

      // --- 追加運動記録の登録（Requirement 10.3） ---
      fireEvent.change(within(sidebar).getByLabelText("種目"), { target: { value: "縄跳び" } });
      fireEvent.change(within(sidebar).getByLabelText("時間"), { target: { value: "20" } });
      fireEvent.change(within(sidebar).getByLabelText("想定消費カロリー"), { target: { value: "100" } });

      const newEntry: ExerciseLogEntry = {
        id: 9,
        activityName: "縄跳び",
        durationMinutes: 20,
        estimatedCaloriesBurned: 100,
      };
      mockedAddExerciseEntry.mockResolvedValue({ ok: true, value: newEntry });

      fireEvent.click(within(sidebar).getByRole("button", { name: "＋ 記録する" }));

      expect(mockedAddExerciseEntry).toHaveBeenCalledWith(today, {
        activityName: "縄跳び",
        durationMinutes: 20,
        estimatedCaloriesBurned: 100,
      });
      await within(sidebar).findByText("縄跳び・20分");
      expect(within(sidebar).getByText("+100kcal")).toBeDefined();

      // --- 追加運動記録の削除（Requirement 10.4） ---
      mockedRemoveExerciseEntry.mockResolvedValue({ ok: true, value: undefined });
      fireEvent.click(within(sidebar).getByRole("button", { name: "縄跳びを削除" }));

      expect(mockedRemoveExerciseEntry).toHaveBeenCalledWith(today, 9);
      await waitFor(() => expect(within(sidebar).queryByText("縄跳び・20分")).toBeNull());

      // クロスパネル検証: 「今日の記録」パネルでの一連の保存・追加・削除操作の間、
      // 同一画面に同時マウントされている `ProfilePage` 側のツリー・状態には影響がない
      // （`App` を実際に描画しないと検証できない、両パネルの独立性）。
      expect(screen.getByRole("heading", { name: "プロフィール" })).toBeDefined();
      expect(within(main).getByLabelText("身長")).toHaveProperty("value", "");
    },
  );
});
