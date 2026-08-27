/**
 * 「今日の記録」サイドバーパネルの組み立て（`WeightBodyFatFields` + `CalorieIntakeField` +
 * `ExerciseLogList`）。
 *
 * マウント時に当日日付で `GET /api/daily-logs/:date` を呼び出し、体重・体脂肪率・摂取カロリー・
 * 追加運動記録を初期表示する（design.md: Domain: UI (Presentation) Implementation Notes ——
 * 「`DailyLogPanel` は当日日付で `GET /api/daily-logs/:date` を初期取得し、各操作ごとに
 * 対応するエンドポイントを呼び出す」）。
 *
 * `ProfilePage`（task 4.4）の「1つの保存ボタンでフォーム全体を送信する」モデルとは異なり、
 * 本パネルは各保存操作（体重/体脂肪率、摂取カロリー手動上書き、運動記録の追加/削除）を
 * それぞれ独立した操作として対応するAPIへ送信する（タスク5.3の明示的な要求）。
 * 体重/体脂肪率の保存と摂取カロリー手動上書きの保存はいずれも `PUT /api/daily-logs/:date`
 * （`DailyLogInput`）を呼び出すが、design.md: API Contract に `manualOverrideKcal` 専用の
 * 別エンドポイントは存在しないため、送信するペイロードをそれぞれの関心事のフィールドのみに
 * 絞ることで独立性を保つ（体重/体脂肪率の保存では `manualOverrideKcal` を含めず、
 * 摂取カロリーの保存では `weightKg`/`bodyFatPct` を含めない）。これにより、
 * 摂取カロリー実績のハイブリッド解決（手動上書き優先、Requirement 9.3）を混乱させる
 * ペイロードを送らない。
 *
 * Requirements: 8.3（特定の日付の体重を記録した場合、その日付の体重記録を保存する）,
 * 9.2（摂取カロリー実績を手動で入力・修正した場合、その手動上書き値を保存する）,
 * 9.3（手動上書き値が保存されている間、計画献立kcalの既定値で自動的に置き換えない —
 * 本コンポーネントは `plannedKcal` を送信しないことでこれを担保する）,
 * 10.3（追加運動記録を登録した場合、当日の一覧に追加する）
 */
import { useEffect, useState } from "react";
import type { CalorieIntakeSource, DailyLogEntry, ExerciseEntryInput, ExerciseLogEntry, IsoDate } from "@nutrition/shared";
import { addExerciseEntry, getDailyLog, removeExerciseEntry, saveDailyLog } from "../../api/dailyLogClient.js";
import type { ApiError } from "../../api/types.js";
import {
  WeightBodyFatFields,
  validateWeightBodyFat,
  type WeightBodyFatFieldsValue,
} from "./WeightBodyFatFields.js";
import { CalorieIntakeField, validateCalorieIntake } from "./CalorieIntakeField.js";
import { ExerciseLogList } from "./ExerciseLogList.js";

type WeightBodyFatFieldsProps = Parameters<typeof WeightBodyFatFields>[0];

interface DailyLogFormState {
  weightKg: number | null;
  bodyFatPct: number | null;
  plannedKcal: number | null;
  manualOverrideKcal: number | null;
  calorieIntakeSource: CalorieIntakeSource;
  exerciseEntries: ExerciseLogEntry[];
}

/** 当日の記録が未作成（`GET /api/daily-logs/:date` が `null` を返す）場合の初期表示状態。 */
const EMPTY_FORM_STATE: DailyLogFormState = {
  weightKg: null,
  bodyFatPct: null,
  plannedKcal: null,
  manualOverrideKcal: null,
  calorieIntakeSource: "unrecorded",
  exerciseEntries: [],
};

/** 取得済みの `DailyLogEntry`（または未作成を表す `null`）をフォーム状態に変換する。 */
function toFormState(entry: DailyLogEntry | null): DailyLogFormState {
  if (entry === null) {
    return EMPTY_FORM_STATE;
  }
  return {
    weightKg: entry.weightKg,
    bodyFatPct: entry.bodyFatPct,
    plannedKcal: entry.plannedKcal,
    manualOverrideKcal: entry.manualOverrideKcal,
    calorieIntakeSource: entry.calorieIntakeSource,
    exerciseEntries: [...entry.exerciseEntries],
  };
}

/** ローカルのタイムゾーンで当日日付を `YYYY-MM-DD`（`IsoDate`）形式に変換する。 */
function todayIsoDate(): IsoDate {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 運動記録の追加/削除は `ExerciseLogList` 側で成功時のみ呼び出されるコールバックのため
 * （追加はバリデーションエラーの表示欄を自前で持ち、削除には失敗しうるクライアント側検証が
 * 存在しない）、`ValidationError`/`NotFoundError`/`UnknownError` のいずれであってもフィールド
 * 単位ではなく一括の一般エラーとして表示すれば十分である。`ValidationError` は
 * トップレベルの `message` を持たないため、`fieldErrors` の全メッセージを連結する。
 */
function apiErrorMessage(error: ApiError): string {
  if (error.type === "validation") {
    return Object.values(error.fieldErrors).flat().join(" ");
  }
  return error.message;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function DailyLogPanel() {
  // パネルは常に「今日」の記録のみを扱うため、マウント時に一度だけ算出し以後固定する。
  const [today] = useState(todayIsoDate);
  const [form, setForm] = useState<DailyLogFormState>(EMPTY_FORM_STATE);

  const [weightBodyFatErrors, setWeightBodyFatErrors] = useState<Record<string, string[]>>({});
  const [weightSaveStatus, setWeightSaveStatus] = useState<SaveStatus>("idle");

  const [calorieErrors, setCalorieErrors] = useState<Record<string, string[]>>({});
  const [calorieSaveStatus, setCalorieSaveStatus] = useState<SaveStatus>("idle");

  const [generalError, setGeneralError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getDailyLog(today).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setForm(toFormState(result.value));
      }
      // ネットワーク断・サーバーエラー時は初期表示を空のフォーム状態のまま保持する
      // （`ProfilePage` の `useEffect` と同じ規約。取得失敗自体は本タスクの明示的な
      // 観測可能条件の対象外）。
    });

    return () => {
      cancelled = true;
    };
  }, [today]);

  const handleWeightBodyFatChange: WeightBodyFatFieldsProps["onChange"] = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveWeightBodyFat = () => {
    const candidate: WeightBodyFatFieldsValue = { weightKg: form.weightKg, bodyFatPct: form.bodyFatPct };

    // 送信前クライアント側検証（design.md: 「送信前に同一ルールで検証してユーザーへ
    // 即時フィードバックする」、`ProfilePage.handleSave` と同じゲートパターン）。
    // ローカル検証に失敗した場合は `saveDailyLog` を呼び出さず、エラー表示のみを行う。
    const errors = validateWeightBodyFat(candidate);
    if (Object.keys(errors).length > 0) {
      setWeightBodyFatErrors(errors);
      setWeightSaveStatus("error");
      return;
    }

    setWeightBodyFatErrors({});
    setWeightSaveStatus("saving");
    setGeneralError(null);

    // `manualOverrideKcal` を含めないことで、摂取カロリーの保存操作と互いに独立させる
    // （ファイル冒頭コメント参照）。`weightKg` はスキーマ上 `number | undefined`
    // （`null` 非対応）のため、未入力を表す `null` は `undefined` へ変換して送信しない
    // （`WeightBodyFatFields.validateWeightBodyFat` と同じアダプタ）。
    void saveDailyLog(today, {
      weightKg: candidate.weightKg ?? undefined,
      bodyFatPct: candidate.bodyFatPct,
    }).then((result) => {
      if (result.ok) {
        setForm((prev) => ({
          ...prev,
          weightKg: result.value.weightKg,
          bodyFatPct: result.value.bodyFatPct,
        }));
        setWeightSaveStatus("saved");
        return;
      }

      if (result.error.type === "validation") {
        setWeightBodyFatErrors(result.error.fieldErrors);
      } else {
        setGeneralError(result.error.message);
      }
      setWeightSaveStatus("error");
    });
  };

  const handleCalorieChange = (manualOverrideKcal: number | null) => {
    setForm((prev) => ({ ...prev, manualOverrideKcal }));
  };

  const handleSaveCalorie = () => {
    // 送信前クライアント側検証（Requirement 9.4: 負数を拒否）。
    const errors = validateCalorieIntake(form.manualOverrideKcal);
    if (Object.keys(errors).length > 0) {
      setCalorieErrors(errors);
      setCalorieSaveStatus("error");
      return;
    }

    setCalorieErrors({});
    setCalorieSaveStatus("saving");
    setGeneralError(null);

    // `weightKg`/`bodyFatPct` を含めないことで体重/体脂肪率の保存操作と互いに独立させ、
    // かつ `plannedKcal` は `DailyLogInput` に存在しないフィールドのため送信しようがない
    // ——手動上書き値が計画kcalの再送信によって自動的に置き換わらないという不変条件
    // （design.md: Requirement 9.3, DailyLogService Invariants）を、送信ペイロードの形状面から
    // 担保する。
    void saveDailyLog(today, { manualOverrideKcal: form.manualOverrideKcal }).then((result) => {
      if (result.ok) {
        setForm((prev) => ({
          ...prev,
          manualOverrideKcal: result.value.manualOverrideKcal,
          plannedKcal: result.value.plannedKcal,
          calorieIntakeSource: result.value.calorieIntakeSource,
        }));
        setCalorieSaveStatus("saved");
        return;
      }

      if (result.error.type === "validation") {
        setCalorieErrors(result.error.fieldErrors);
      } else {
        setGeneralError(result.error.message);
      }
      setCalorieSaveStatus("error");
    });
  };

  const handleAddExerciseEntry = (input: ExerciseEntryInput) => {
    // `ExerciseLogList` は追加フォームの送信時に自身で `ExerciseEntryInputSchema` による
    // 検証を行い、失敗時はこのコールバックを呼び出さない（Requirement 10.5、
    // `ExerciseLogList.tsx` の `handleAdd`）。そのためここでの再検証は不要。
    setGeneralError(null);
    void addExerciseEntry(today, input).then((result) => {
      if (result.ok) {
        setForm((prev) => ({ ...prev, exerciseEntries: [...prev.exerciseEntries, result.value] }));
        return;
      }
      setGeneralError(apiErrorMessage(result.error));
    });
  };

  const handleRemoveExerciseEntry = (id: number) => {
    setGeneralError(null);
    void removeExerciseEntry(today, id).then((result) => {
      if (result.ok) {
        setForm((prev) => ({
          ...prev,
          exerciseEntries: prev.exerciseEntries.filter((entry) => entry.id !== id),
        }));
        return;
      }
      setGeneralError(apiErrorMessage(result.error));
    });
  };

  return (
    <div className="sidebar-card">
      <h3>今日の記録</h3>

      <WeightBodyFatFields
        value={{ weightKg: form.weightKg, bodyFatPct: form.bodyFatPct }}
        onChange={handleWeightBodyFatChange}
        errors={weightBodyFatErrors}
      />
      <div style={{ textAlign: "right", margin: "2px 0 10px" }}>
        <button
          type="button"
          className="btn-ghost"
          onClick={handleSaveWeightBodyFat}
          disabled={weightSaveStatus === "saving"}
        >
          体重・体脂肪率を保存
        </button>
      </div>
      {weightSaveStatus === "saved" && <p role="status">体重・体脂肪率を保存しました</p>}

      {/* `calorieIntakeSource === "manual"` かどうかで内部の表示モードの初期値を決める
          `CalorieIntakeField` の `useState` 初期化は日付単位でのみ意味を持つ。本パネルは
          常に同じ日付（`today`）を表示するため実際には再マウントは発生しないが、design.md
          Implementation Note (5.1) の指針に従い、将来の日付切り替えに備えて明示的に
          `key={today}` を付与しておく。 */}
      <CalorieIntakeField
        key={today}
        value={{
          plannedKcal: form.plannedKcal,
          manualOverrideKcal: form.manualOverrideKcal,
          calorieIntakeSource: form.calorieIntakeSource,
        }}
        onChange={handleCalorieChange}
        errors={calorieErrors}
      />
      <div style={{ textAlign: "right", margin: "2px 0 10px" }}>
        <button
          type="button"
          className="btn-ghost"
          onClick={handleSaveCalorie}
          disabled={calorieSaveStatus === "saving"}
        >
          摂取カロリーを保存
        </button>
      </div>
      {calorieSaveStatus === "saved" && <p role="status">摂取カロリーを保存しました</p>}

      <ExerciseLogList
        entries={form.exerciseEntries}
        onAdd={handleAddExerciseEntry}
        onRemove={handleRemoveExerciseEntry}
      />

      {generalError !== null && (
        <p role="alert" className="field-error">
          {generalError}
        </p>
      )}
    </div>
  );
}
