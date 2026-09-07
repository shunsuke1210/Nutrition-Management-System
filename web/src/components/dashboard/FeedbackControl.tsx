/**
 * 好き/苦手フィードバックコントロール（task 4.3）。`RecipeDetailModal`（task 4.2）内から、
 * 表示中の料理に対する満足度フィードバックの入力・送信・送信済み状態・失敗時の状態保持を
 * 提供する（design.md Components table: 「好き/苦手の選択、送信中/送信済み/失敗状態の表示」、
 * Traceability table「7.1-7.4 | 満足度フィードバックの入力 | RecipeDetailModal, FeedbackControl |
 * mealSlotClient.submitFeedback」）。
 *
 * mockup.htmlには本コンポーネントに対応するマークアップが存在しない（このspecの他の全
 * コンポーネントと異なり、参照すべき既存デザインがない）。そのため要件7.1-7.4を満たす
 * 最小限の構造・クラス名を独自に定義する。
 *
 * 責務境界（design.md Components table参照。`RecipeDetailModal`が`generateRecipeDetail`を
 * 直接呼び出す既存パターン（task 4.2のファイル冒頭コメント参照）と同じ理由に基づく）:
 * `submitFeedback`はオンデマンドかつ単発のユーザー操作であり、本コンポーネント自身の
 * ライフタイムに閉じたリクエストである。design.mdのComponents tableが本コンポーネント自身に
 * 送信中/送信済み/失敗状態の表示責務を割り当てているため、`mealSlotClient.submitFeedback`を
 * 本コンポーネントが直接呼び出す。`useAsyncData`はマウント時/依存配列変更時の自動fetchを
 * 前提とするフックであり、クリックで一度だけ発火する本コントロールの状態機械とは形が異なる
 * ため使用せず、素朴な`useState`によるローカルの状態機械（`FeedbackStatus`）で表現する。
 *
 * 状態機械（要件7.1-7.4）:
 * - "idle": 初期状態。「好き」「苦手」の2ボタンをともに有効表示する（要件7.1）。
 * - "submitting": いずれかのボタン押下で遷移。二重送信防止のため両ボタンを無効化する
 *   （どちらのボタンを押したかに関わらず、送信中は両方とも操作不可にする）。
 *   `WeeklyMenuSection.tsx`/`DayColumn.tsx`で確立済みの「処理中…」button-label swap規約を
 *   踏襲しつつ、本コンポーネントは2ボタン構成であるため、実際にクリックされた（＝送信が
 *   進行中の）ボタンのみラベルを`PROCESSING_LABEL`に差し替え、もう一方は元のラベルのまま
 *   disabledにする（両方を同じ「送信中…」に差し替えると、どちらの操作が進行中か、また
 *   どちらのボタンが「好き」でどちらが「苦手」かが送信中の間だけ区別不能になるため）。
 * - "submitted": 送信成功（`result.ok === true`）で遷移。要件7.3「入力済みの状態が分かる表示」
 *   を満たすため、選択可能な2ボタンの表示をやめ、どちらを選んだか分かる確認文言に置き換える
 *   （この食事枠に対する入力は完了しており終端状態）。
 * - "failed": 送信失敗（`result.ok === false`、または`submitFeedback`自体は例外を投げない
 *   はずだが防御的に扱うPromiseのreject）で遷移。要件7.4の「入力前の表示状態を保持する」は
 *   「送信前の操作可能な表示状態に戻す」ことを意味する（送信済みの見た目を保持する、という
 *   意味ではない）。そのため両ボタンを再度有効な状態で表示し、あわせて失敗メッセージを表示する。
 *   "failed"からのボタン再クリックは"idle"からと全く同じハンドラ・ガードで再送信を試みる。
 *
 * `RecipeDetailModal`側の呼び出し規約: `RecipeDetailModal`は表示中の食事が別の食事枠へ
 * 直接遷移する場合（`null`を経由しないケース、`WeeklyMenuSection`の`selectedMeal`遷移）でも
 * アンマウント/再マウントされないため、本コンポーネント自身の`status`/`submittedLiked`状態が
 * 別の食事枠へ誤って持ち越されるのを防ぐには、呼び出し側が食事枠の識別子（
 * `${weekStartDate}-${dayIndex}-${mealType}`）を`key`に指定して強制的に再マウントさせる
 * 必要がある（`RecipeDetailModal.tsx`側の対応するコメント参照）。
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */
import { useState } from "react";
import type { IsoDate, MealType } from "@nutrition/shared";
import { submitFeedback } from "../../api/mealSlotClient.js";

export interface FeedbackControlProps {
  weekStartDate: IsoDate;
  dayIndex: number;
  mealType: MealType;
}

type FeedbackStatus = "idle" | "submitting" | "submitted" | "failed";

const LIKE_LABEL = "好き";
const DISLIKE_LABEL = "苦手";
// WeeklyMenuSection.tsx/DayColumn.tsxで確立済みの「処理中…」button-label swap規約に倣う。
const PROCESSING_LABEL = "送信中…";
const FAILURE_MESSAGE = "フィードバックの送信に失敗しました。";

export function FeedbackControl({ weekStartDate, dayIndex, mealType }: FeedbackControlProps) {
  const [status, setStatus] = useState<FeedbackStatus>("idle");
  // 送信成功時にどちらを選んだかを覚えておく（要件7.3の確認文言に使う）。"submitted"状態でのみ
  // 意味を持ち、"failed"への遷移時はこの値を参照しない表示に戻すため保持し続けても問題ない。
  const [submittedLiked, setSubmittedLiked] = useState(false);
  // "submitting"中に実際にクリックされた方の値。ファイル冒頭コメント参照:
  // 進行中のボタンのみラベルをPROCESSING_LABELに差し替えるために使う。"submitting"時のみ意味を
  // 持つ値であり、他の状態では参照しない。
  const [pendingLiked, setPendingLiked] = useState(false);

  function handleSubmit(liked: boolean) {
    // 要件7.4のガード: 送信中または送信済みであれば二重送信を防ぐため何もしない。
    if (status === "submitting" || status === "submitted") {
      return;
    }
    setPendingLiked(liked);
    setStatus("submitting");
    submitFeedback(weekStartDate, dayIndex, mealType, liked).then(
      (result) => {
        if (result.ok) {
          setSubmittedLiked(liked);
          setStatus("submitted");
        } else {
          setStatus("failed");
        }
      },
      () => {
        // submitFeedback自身は例外を投げない設計（mealSlotClient.ts冒頭コメント参照）だが、
        // 防御的にrejectも同じ失敗表示に落とす。
        setStatus("failed");
      },
    );
  }

  if (status === "submitted") {
    return (
      <div className="feedback-control">
        <p className="feedback-submitted">{`「${submittedLiked ? LIKE_LABEL : DISLIKE_LABEL}」を送信しました。`}</p>
      </div>
    );
  }

  const isSubmitting = status === "submitting";

  return (
    <div className="feedback-control">
      <div className="feedback-buttons">
        <button
          type="button"
          className="feedback-like"
          disabled={isSubmitting}
          onClick={() => handleSubmit(true)}
        >
          {isSubmitting && pendingLiked ? PROCESSING_LABEL : LIKE_LABEL}
        </button>
        <button
          type="button"
          className="feedback-dislike"
          disabled={isSubmitting}
          onClick={() => handleSubmit(false)}
        >
          {isSubmitting && !pendingLiked ? PROCESSING_LABEL : DISLIKE_LABEL}
        </button>
      </div>
      {status === "failed" && <p className="feedback-error">{FAILURE_MESSAGE}</p>}
    </div>
  );
}
