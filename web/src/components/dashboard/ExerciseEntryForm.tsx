/**
 * 当日の追加運動記録フォーム（ダイエット状況画面「摂取・消費カロリー収支（今週）」、
 * task 6.2）。
 *
 * mockup.html の `.block-actions` 内 `<button class="btn-ghost" type="button">＋ 運動を記録
 * </button>`（行876）に対応するトリガーボタンと、それをクリックした際に展開する入力フォームを
 * 実装する。mockup.html自体にはトリガーボタンのマークアップしか存在しないため
 * （`ManualCalorieOverrideForm.tsx`冒頭コメント参照）、`FeedbackControl.tsx`のprecedentに倣い
 * 独自のクラス名・展開フォーム構造を定義する。
 *
 * 責務境界（`FeedbackControl.tsx`/`ManualCalorieOverrideForm.tsx`と同じ方針）:
 * `dailyLogClient.addExerciseEntry`を本コンポーネント自身が直接呼び出す、オンデマンドかつ
 * 単発のユーザー操作。
 *
 * 状態機械（Requirement 12.5, 12.6, 12.7）: `ManualCalorieOverrideForm.tsx`と同じ4状態
 * （"collapsed"/"editing"/"submitting"/"failed"）。失敗時は3フィールドすべての入力値を
 * 保持したまま失敗メッセージを表示する（要件12.7）。成功時は"collapsed"へ戻り3フィールドを
 * クリアし、`onSaved`を呼び出す（呼び出し元`CalorieBalanceSection`が週データを再取得する
 * 契機になる）。
 *
 * Requirements: 12.5, 12.6, 12.7
 */
import { useState, type ChangeEvent } from "react";
import type { IsoDate } from "@nutrition/shared";
import { addExerciseEntry } from "../../api/dailyLogClient.js";

export interface ExerciseEntryFormProps {
  /** 常に`today`（CalorieBalanceSection経由）が渡される。 */
  date: IsoDate;
  onSaved: () => void;
}

type FormPhase = "collapsed" | "editing" | "submitting" | "failed";

interface DraftValue {
  activityName: string;
  durationMinutes: string;
  estimatedCaloriesBurned: string;
}

const EMPTY_DRAFT: DraftValue = { activityName: "", durationMinutes: "", estimatedCaloriesBurned: "" };

const TRIGGER_LABEL = "＋ 運動を記録";
const SUBMIT_LABEL = "保存する";
const PROCESSING_LABEL = "保存中…";
const CANCEL_LABEL = "キャンセル";
const FAILURE_MESSAGE = "運動記録の登録に失敗しました。";
const ACTIVITY_LABEL = "運動内容";
const DURATION_LABEL = "時間（分）";
const CALORIES_LABEL = "想定消費カロリー";

/** 空文字は「未入力」として扱う（`CalorieIntakeField.tsx`/`ExerciseLogList.tsx`と同じ規約）。 */
function parseOptionalNumber(raw: string): number | null {
  if (raw === "") {
    return null;
  }
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

export function ExerciseEntryForm({ date, onSaved }: ExerciseEntryFormProps) {
  const [phase, setPhase] = useState<FormPhase>("collapsed");
  const [draft, setDraft] = useState<DraftValue>(EMPTY_DRAFT);

  function openForm() {
    setDraft(EMPTY_DRAFT);
    setPhase("editing");
  }

  function closeForm() {
    setPhase("collapsed");
    setDraft(EMPTY_DRAFT);
  }

  function handleFieldChange(field: keyof DraftValue) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const rawValue = event.target.value;
      setDraft((current) => ({ ...current, [field]: rawValue }));
    };
  }

  function handleSubmit() {
    // 二重送信防止のガード（"failed"からの再送信は許可する。FeedbackControl.tsxと同じ方針）。
    if (phase === "submitting") {
      return;
    }
    const durationMinutes = parseOptionalNumber(draft.durationMinutes);
    const estimatedCaloriesBurned = parseOptionalNumber(draft.estimatedCaloriesBurned);
    if (draft.activityName === "" || durationMinutes === null || estimatedCaloriesBurned === null) {
      // 未入力・非数値のフィールドがある場合は送信しない（`ExerciseEntryInput`は全フィールド
      // 必須。要件10.5相当のサーバー側検証を無駄撃ちしない最小限のガード）。
      return;
    }
    setPhase("submitting");
    addExerciseEntry(date, {
      activityName: draft.activityName,
      durationMinutes,
      estimatedCaloriesBurned,
    }).then(
      (result) => {
        if (result.ok) {
          closeForm();
          onSaved();
        } else {
          setPhase("failed");
        }
      },
      () => {
        // addExerciseEntry自身は例外を投げない設計だが、防御的にrejectも同じ失敗表示に落とす
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
    <div className="exercise-entry-form">
      <input
        type="text"
        aria-label={ACTIVITY_LABEL}
        value={draft.activityName}
        disabled={isSubmitting}
        onChange={handleFieldChange("activityName")}
      />
      <input
        type="number"
        aria-label={DURATION_LABEL}
        value={draft.durationMinutes}
        disabled={isSubmitting}
        onChange={handleFieldChange("durationMinutes")}
      />
      <input
        type="number"
        aria-label={CALORIES_LABEL}
        value={draft.estimatedCaloriesBurned}
        disabled={isSubmitting}
        onChange={handleFieldChange("estimatedCaloriesBurned")}
      />
      <button type="button" className="btn-ghost" disabled={isSubmitting} onClick={handleSubmit}>
        {isSubmitting ? PROCESSING_LABEL : SUBMIT_LABEL}
      </button>
      <button type="button" className="btn-ghost" disabled={isSubmitting} onClick={closeForm}>
        {CANCEL_LABEL}
      </button>
      {phase === "failed" && <p className="exercise-entry-error">{FAILURE_MESSAGE}</p>}
    </div>
  );
}
