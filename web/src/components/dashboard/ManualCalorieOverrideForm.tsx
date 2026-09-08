/**
 * 当日の摂取カロリー手動修正フォーム（ダイエット状況画面「摂取・消費カロリー収支（今週）」、
 * task 6.2）。
 *
 * mockup.html の `.block-actions` 内 `<button class="btn-ghost" type="button">今日の摂取
 * カロリーを修正</button>`（行875）に対応するトリガーボタンと、それをクリックした際に展開する
 * 入力フォームを実装する。mockup.html自体にはトリガーボタンのマークアップしか存在せず、展開後の
 * フォーム自体のマークアップは存在しないため（design.md: File Structure Plan
 * `components/dashboard/ManualCalorieOverrideForm.tsx`）、`FeedbackControl.tsx`（task 4.3）の
 * precedent（マークアップが存在しない場合にクラス名・構造を独自に定義してよい）に倣う。
 *
 * 責務境界（`FeedbackControl.tsx`と同じ方針）: 本コンポーネントはオンデマンドかつ単発の
 * ユーザー操作であり、自身のライフタイムに閉じたリクエストである。`dailyLogClient.saveDailyLog`
 * を本コンポーネント自身が直接呼び出し、送信中/失敗状態の表示も自身の責務とする。
 * `saveDailyLog`のdocコメント通り、`DailyLogInput`に含めなかったフィールドは既存値を保持した
 * まま更新されないため、本コンポーネントは`manualOverrideKcal`の1フィールドのみを含めて呼び出す
 * （体重・体脂肪率は「今日の記録」パネル側の関心事であり無関係のため含めない）。
 *
 * 状態機械（Requirement 12.3, 12.4, 12.7）:
 * - "collapsed": 初期状態。トリガーボタンのみを表示する。
 * - "editing": トリガーボタンのクリックで遷移。入力欄（`currentOverrideKcal`があればプリフィル、
 *   無ければ空欄）+ 保存/キャンセルボタンを表示する。
 * - "submitting": 保存ボタン押下で遷移。二重送信防止のため入力欄・両ボタンを無効化する。
 * - "failed": 送信失敗（`result.ok === false`、またはPromiseのreject）で遷移。要件12.7の
 *   「入力前の表示状態を保持する」＝「送信前の操作可能な表示状態（入力済みの値を保った
 *   フォーム）に戻す」ことを意味する（`FeedbackControl.tsx`の"failed"と同じ解釈）ため、
 *   入力値を消さずにフォームを開いたまま保ち、失敗メッセージを表示する。再度保存ボタンを
 *   押せば同じハンドラで再送信を試みる。
 * - 成功時（`result.ok === true`）は"collapsed"へ戻り、`onSaved`を呼び出す（呼び出し元
 *   `CalorieBalanceSection`が週データを再取得する契機になる）。
 *
 * Requirements: 12.3, 12.4, 12.7
 */
import { useState, type ChangeEvent } from "react";
import type { IsoDate } from "@nutrition/shared";
import { saveDailyLog } from "../../api/dailyLogClient.js";

export interface ManualCalorieOverrideFormProps {
  /** 常に`today`（CalorieBalanceSection経由）が渡される。 */
  date: IsoDate;
  /** 既に手動修正が存在する場合に入力欄をプリフィルする。無ければ空欄で開始する。 */
  currentOverrideKcal: number | null;
  onSaved: () => void;
}

type FormPhase = "collapsed" | "editing" | "submitting" | "failed";

const TRIGGER_LABEL = "今日の摂取カロリーを修正";
const SUBMIT_LABEL = "保存する";
const PROCESSING_LABEL = "保存中…";
const CANCEL_LABEL = "キャンセル";
const FAILURE_MESSAGE = "摂取カロリーの修正に失敗しました。";
const INPUT_LABEL = "摂取カロリー";

/** 空文字は「未入力」として扱う（`CalorieIntakeField.tsx`/`ExerciseLogList.tsx`と同じ規約）。 */
function parseOptionalNumber(raw: string): number | null {
  if (raw === "") {
    return null;
  }
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

export function ManualCalorieOverrideForm({ date, currentOverrideKcal, onSaved }: ManualCalorieOverrideFormProps) {
  const [phase, setPhase] = useState<FormPhase>("collapsed");
  const [inputValue, setInputValue] = useState("");

  function openForm() {
    setInputValue(currentOverrideKcal !== null ? String(currentOverrideKcal) : "");
    setPhase("editing");
  }

  function closeForm() {
    setPhase("collapsed");
    setInputValue("");
  }

  function handleSubmit() {
    // 二重送信防止のガード（"failed"からの再送信は許可する。FeedbackControl.tsxと同じ方針）。
    if (phase === "submitting") {
      return;
    }
    const parsed = parseOptionalNumber(inputValue);
    if (parsed === null) {
      // 空欄・非数値では送信しない(要件12.3は「修正の入力」を前提としており、無効な入力を
      // そのままサーバーへ送る必要はない)。
      return;
    }
    setPhase("submitting");
    saveDailyLog(date, { manualOverrideKcal: parsed }).then(
      (result) => {
        if (result.ok) {
          closeForm();
          onSaved();
        } else {
          setPhase("failed");
        }
      },
      () => {
        // saveDailyLog自身は例外を投げない設計だが、防御的にrejectも同じ失敗表示に落とす
        // （FeedbackControl.tsxと同じ方針）。
        setPhase("failed");
      },
    );
  }

  if (phase === "collapsed") {
    return (
      <button type="button" className="btn-ghost" onClick={openForm}>
        {TRIGGER_LABEL}
      </button>
    );
  }

  const isSubmitting = phase === "submitting";

  return (
    <div className="manual-calorie-override-form">
      <input
        type="number"
        aria-label={INPUT_LABEL}
        value={inputValue}
        disabled={isSubmitting}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setInputValue(event.target.value)}
      />
      <button type="button" className="btn-ghost" disabled={isSubmitting} onClick={handleSubmit}>
        {isSubmitting ? PROCESSING_LABEL : SUBMIT_LABEL}
      </button>
      <button type="button" className="btn-ghost" disabled={isSubmitting} onClick={closeForm}>
        {CANCEL_LABEL}
      </button>
      {phase === "failed" && <p className="manual-calorie-override-error">{FAILURE_MESSAGE}</p>}
    </div>
  );
}
