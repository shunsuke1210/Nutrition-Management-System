import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MealType } from "@nutrition/shared";
import type { ApiError, Result } from "../../api/types.js";
import * as mealSlotClient from "../../api/mealSlotClient.js";
import { FeedbackControl } from "./FeedbackControl.js";

/**
 * `mealSlotClient`（本コンポーネントが直接呼び出す唯一のクライアント。design.md
 * Traceability table「7.1-7.4」参照）をモックする。RecipeDetailModal.test.tsxの
 * `vi.mock("../../api/mealSlotClient.js", ...)` + `vi.mocked(...)` と同じパターン。
 */
vi.mock("../../api/mealSlotClient.js", () => ({ submitFeedback: vi.fn() }));

const mockedSubmitFeedback = vi.mocked(mealSlotClient.submitFeedback);

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットし、モックの呼び出し履歴・実装も破棄する
// （RecipeDetailModal.test.tsx/ProfilePage.test.tsxと同じ方針）。
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/** 制御可能なPromiseを作る（useAsyncData.test.ts/RecipeDetailModal.test.tsxと同じパターン）。 */
function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const SOME_API_ERROR: ApiError = {
  type: "not_found",
  message: "meal slot not found",
};

describe("FeedbackControl", () => {
  it('renders both "好き" and "苦手" buttons, enabled, with no confirmation/error text initially', () => {
    render(<FeedbackControl weekStartDate="2026-09-01" dayIndex={0} mealType="lunch" />);

    const likeButton = screen.getByRole("button", { name: "好き" }) as HTMLButtonElement;
    const dislikeButton = screen.getByRole("button", { name: "苦手" }) as HTMLButtonElement;
    expect(likeButton.disabled).toBe(false);
    expect(dislikeButton.disabled).toBe(false);
    expect(screen.queryByText(/送信しました/)).toBeNull();
    expect(screen.queryByText(/失敗/)).toBeNull();
  });

  it('clicking "好き" calls submitFeedback with liked:true and the correct weekStartDate/dayIndex/mealType', () => {
    mockedSubmitFeedback.mockReturnValue(new Promise(() => {}));

    render(<FeedbackControl weekStartDate="2026-09-01" dayIndex={2} mealType="dinner" />);

    fireEvent.click(screen.getByRole("button", { name: "好き" }));

    expect(mockedSubmitFeedback).toHaveBeenCalledTimes(1);
    expect(mockedSubmitFeedback).toHaveBeenCalledWith("2026-09-01", 2, "dinner", true);
  });

  it('clicking "苦手" calls submitFeedback with liked:false and the correct weekStartDate/dayIndex/mealType', () => {
    mockedSubmitFeedback.mockReturnValue(new Promise(() => {}));

    render(<FeedbackControl weekStartDate="2026-09-03" dayIndex={5} mealType="breakfast" />);

    fireEvent.click(screen.getByRole("button", { name: "苦手" }));

    expect(mockedSubmitFeedback).toHaveBeenCalledTimes(1);
    expect(mockedSubmitFeedback).toHaveBeenCalledWith("2026-09-03", 5, "breakfast", false);
  });

  it("while the submit is pending, both buttons are disabled and no confirmation/error text is shown", () => {
    const deferred = createDeferred<Result<void, ApiError>>();
    mockedSubmitFeedback.mockReturnValue(deferred.promise);

    render(<FeedbackControl weekStartDate="2026-09-01" dayIndex={0} mealType="lunch" />);

    fireEvent.click(screen.getByRole("button", { name: "好き" }));

    // クリックされた「好き」ボタンは「送信中…」ラベルに差し替わり、もう一方の「苦手」ボタンは
    // 元のラベルのまま、両方とも無効化される（ファイル冒頭コメント参照）。
    const buttons = screen.getAllByRole("button") as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
    }
    expect((screen.getByRole("button", { name: "送信中…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "苦手" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/送信しました/)).toBeNull();
    expect(screen.queryByText(/失敗/)).toBeNull();
  });

  it('on success ("好き"), renders a confirmation distinguishing 好き from 苦手, and no longer renders selectable buttons', async () => {
    mockedSubmitFeedback.mockResolvedValue({ ok: true, value: undefined });

    render(<FeedbackControl weekStartDate="2026-09-01" dayIndex={0} mealType="lunch" />);

    fireEvent.click(screen.getByRole("button", { name: "好き" }));

    await screen.findByText(/「好き」を送信しました/);
    expect(screen.queryByText(/「苦手」を送信しました/)).toBeNull();
    expect(screen.queryByRole("button", { name: "好き" })).toBeNull();
    expect(screen.queryByRole("button", { name: "苦手" })).toBeNull();
  });

  it('on success ("苦手"), renders a confirmation distinguishing 苦手 from 好き, and no longer renders selectable buttons', async () => {
    mockedSubmitFeedback.mockResolvedValue({ ok: true, value: undefined });

    render(<FeedbackControl weekStartDate="2026-09-01" dayIndex={0} mealType="lunch" />);

    fireEvent.click(screen.getByRole("button", { name: "苦手" }));

    await screen.findByText(/「苦手」を送信しました/);
    expect(screen.queryByText(/「好き」を送信しました/)).toBeNull();
    expect(screen.queryByRole("button", { name: "好き" })).toBeNull();
    expect(screen.queryByRole("button", { name: "苦手" })).toBeNull();
  });

  it("on failure (result.ok:false), renders a failure message and both buttons are re-enabled/re-clickable, and re-clicking re-invokes submitFeedback (Requirement 7.4)", async () => {
    mockedSubmitFeedback.mockResolvedValueOnce({ ok: false, error: SOME_API_ERROR });

    render(<FeedbackControl weekStartDate="2026-09-01" dayIndex={0} mealType="lunch" />);

    fireEvent.click(screen.getByRole("button", { name: "好き" }));

    await screen.findByText(/失敗/);
    const likeButton = screen.getByRole("button", { name: "好き" }) as HTMLButtonElement;
    const dislikeButton = screen.getByRole("button", { name: "苦手" }) as HTMLButtonElement;
    expect(likeButton.disabled).toBe(false);
    expect(dislikeButton.disabled).toBe(false);
    expect(screen.queryByText(/送信しました/)).toBeNull();

    mockedSubmitFeedback.mockResolvedValueOnce({ ok: true, value: undefined });
    fireEvent.click(likeButton);

    expect(mockedSubmitFeedback).toHaveBeenCalledTimes(2);
    await screen.findByText(/「好き」を送信しました/);
  });

  it("on failure via promise rejection (defensive path), renders a failure message and re-enables both buttons", async () => {
    mockedSubmitFeedback.mockRejectedValueOnce(new Error("network down"));

    render(<FeedbackControl weekStartDate="2026-09-01" dayIndex={0} mealType="lunch" />);

    fireEvent.click(screen.getByRole("button", { name: "苦手" }));

    await screen.findByText(/失敗/);
    expect((screen.getByRole("button", { name: "好き" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "苦手" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("double-click guard: rapidly clicking the same button twice while a submit is in flight only invokes submitFeedback once", () => {
    const deferred = createDeferred<Result<void, ApiError>>();
    mockedSubmitFeedback.mockReturnValue(deferred.promise);

    render(<FeedbackControl weekStartDate="2026-09-01" dayIndex={0} mealType="lunch" />);

    const likeButton = screen.getByRole("button", { name: "好き" });
    fireEvent.click(likeButton);
    fireEvent.click(likeButton);
    fireEvent.click(likeButton);

    expect(mockedSubmitFeedback).toHaveBeenCalledTimes(1);
  });

  /**
   * `RecipeDetailModal.tsx`は`<FeedbackControl key={`${weekStartDate}-${dayIndex}-${mealType}`}>`
   * という明示的な`key`をつけている（design.md Components table、要件7.3/7.4に基づく解決済みの
   * 設計判断）。ただし本実装の検証で判明した点として（`RecipeDetailModal.tsx`冒頭コメント参照）、
   * `RecipeDetailModal`自身は成功時コンテンツ全体を`useAsyncData`の`isLoading`でゲートしており、
   * 食事枠が変わるたびにこの条件分岐が一度`false`になる（＝`FeedbackControl`を含む部分木が
   * 丸ごとアンマウントされる）ため、実際にモーダルを通した画面遷移では`key`の有無に関わらず
   * `FeedbackControl`は既に再マウントされてしまい、`RecipeDetailModal.test.tsx`側の
   * エンドツーエンドテストだけでは`key`自体のメカニズムを検証できない（ライブミューテーション
   * テストで実測・確認済み）。
   *
   * そのため本ブロックでは、`RecipeDetailModal`のローディングゲートを介さずに`FeedbackControl`
   * 単体へ直接同じ`key`規約を適用し、Reactの標準的な保証（同じツリー位置の要素でも`key`が
   * 変われば必ず既存インスタンスを破棄し新規マウントする。変わらなければ同一インスタンスとして
   * 内部状態を保持したままprops更新のみ行う）が実際にこのコンポーネントの状態機械に対して
   * 機能することを、`key`の有無を変えるライブミューテーションで直接証明する。
   */
  describe("key-based remount (isolated proof of RecipeDetailModal's key={...} design decision)", () => {
    function renderWithKey(key: string, dayIndex: number, mealType: MealType) {
      return render(
        <FeedbackControl key={key} weekStartDate="2026-09-01" dayIndex={dayIndex} mealType={mealType} />,
      );
    }

    it(
      "reproduces the leak the key prop prevents: WITHOUT a key change, FeedbackControl's submitted " +
        "state incorrectly persists when dayIndex/mealType change underneath it via rerender",
      async () => {
        mockedSubmitFeedback.mockResolvedValue({ ok: true, value: undefined });

        const { rerender } = renderWithKey("stable", 0, "lunch");
        fireEvent.click(screen.getByRole("button", { name: "好き" }));
        await screen.findByText(/「好き」を送信しました/);

        // keyを変えずにdayIndex/mealTypeだけを新しい食事枠のものに差し替える。
        rerender(<FeedbackControl key="stable" weekStartDate="2026-09-01" dayIndex={3} mealType="dinner" />);

        // Reactは同一インスタンスとみなし内部状態(status/submittedLiked)を保持し続けるため、
        // 前の食事枠の「送信済み」表示が新しい食事枠に対しても誤って残る(=リークの再現)。
        expect(screen.queryByText(/「好き」を送信しました/)).not.toBeNull();
        expect(screen.queryByRole("button", { name: "好き" })).toBeNull();
      },
    );

    it(
      "proves the fix: WITH a key derived from the meal identity (RecipeDetailModal's actual " +
        "`${weekStartDate}-${dayIndex}-${mealType}` pattern), changing dayIndex/mealType together " +
        "with a new key remounts FeedbackControl fresh instead of leaking the previous meal's state",
      async () => {
        mockedSubmitFeedback.mockResolvedValue({ ok: true, value: undefined });

        const { rerender } = renderWithKey("2026-09-01-0-lunch", 0, "lunch");
        fireEvent.click(screen.getByRole("button", { name: "好き" }));
        await screen.findByText(/「好き」を送信しました/);

        // keyも新しい食事枠を表す値に変える(RecipeDetailModal.tsxの実際の呼び出しパターンと同じ)。
        rerender(
          <FeedbackControl
            key="2026-09-01-3-dinner"
            weekStartDate="2026-09-01"
            dayIndex={3}
            mealType="dinner"
          />,
        );

        // Reactが別インスタンスとして扱い、フレッシュな`idle`状態からマウントし直す。
        expect(screen.queryByText(/送信しました/)).toBeNull();
        expect(screen.getByRole("button", { name: "好き" })).not.toBeNull();
        expect(screen.getByRole("button", { name: "苦手" })).not.toBeNull();
      },
    );
  });
});
