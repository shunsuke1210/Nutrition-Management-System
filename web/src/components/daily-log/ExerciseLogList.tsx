/**
 * 追加運動記録の一覧・追加・削除UI（「今日の記録」パネル）。
 *
 * mockup.html の「今日の記録」サイドバーカード（`.sidebar-card`）内、追加運動セクション
 * （「＋ 記録する」ボタン + `.exercise-entry` の一覧）に対応する（design.md: File Structure
 * Plan `components/daily-log/ExerciseLogList.tsx`）。`DailyLogPanel`（task 5.3）がまだ
 * 存在しないため、`WeightBodyFatFields`/`CalorieIntakeField`（task 5.1）と同様に、自身の
 * 値・変更通知・エラー表示のみを責務とする独立したプレゼンテーションコンポーネントとして
 * 実装する。
 *
 * `IngredientChipList`（`components/profile/IngredientChipList.tsx`）の「一覧 + 常時表示の
 * 追加UI」という構成に倣い、mockup.html の「＋ 記録する」ボタンは追加フォームの表示/非表示を
 * 切り替えるトグルではなく、`活動名・時間・想定消費カロリー` の3フィールドを常時表示した
 * 追加フォームの送信ボタンとして扱う（`CalorieIntakeField` の自動表示/手動上書き入力欄の
 * トグルとは異なり、本コンポーネントは「1件の値の表示切替」ではなく「複数件のリストへの
 * 追加」であるため、`IngredientChipList`/`ExerciseRoutineTable` の「常時表示の追加UI」を
 * 踏襲する）。
 *
 * 追加操作の検証（Requirement 10.5: 時間・想定消費カロリーが0以下のとき拒否）は、
 * `@nutrition/shared` の `ExerciseEntryInputSchema` をそのまま再利用する（`entries`/
 * `ExerciseLogEntry` も同パッケージの型をそのまま用いる）。検証に失敗した場合は
 * `onAdd` を呼び出さず、フィールド単位のエラーのみを表示する（task 4.4の教訓:
 * 「ゲートはエラー表示と並行してコールバックを通してしまうのではなく、真に呼び出しを
 * 遮断しなければならない」）。
 *
 * Requirements: 10.1（日付ごとに追加運動記録を複数件保持）,
 * 10.2（種目・時間・想定消費カロリーを項目とする）, 10.3（追加操作で一覧に追加）,
 * 10.4（削除操作で一覧から除去）, 10.5（時間・想定消費カロリーが0以下の値を拒否）
 */
import { useState, type ChangeEvent } from "react";
import { ExerciseEntryInputSchema, type ExerciseEntryInput, type ExerciseLogEntry } from "@nutrition/shared";

/**
 * 追加フォームの編集中の値。`durationMinutes`/`estimatedCaloriesBurned` は未入力状態を
 * 表現するため `number | null` を許容する（`ExerciseRoutineRowValue` 等、既存の
 * 「編集中は null を許容する」慣習と同じ理由）。
 */
export interface ExerciseEntryDraftValue {
  activityName: string;
  durationMinutes: number | null;
  estimatedCaloriesBurned: number | null;
}

export interface ExerciseLogListProps {
  entries: readonly ExerciseLogEntry[];
  /** 追加操作（検証成功時のみ呼び出される）。 */
  onAdd: (entry: ExerciseEntryInput) => void;
  /** 削除操作。対象記録の `id` を渡す。 */
  onRemove: (id: number) => void;
  /**
   * 追加フォームのフィールド単位のエラー一覧（design.md: ValidationError.fieldErrors と
   * 同じ形）。将来的なサーバー側エラー（task 5.3でのAPI連携後）の表示に備えた任意の外部
   * 入力であり、本コンポーネント自身が行う検証結果（`localErrors`）が存在するフィールドは
   * そちらを優先して表示する。
   */
  errors?: Record<string, string[]>;
}

const EMPTY_DRAFT: ExerciseEntryDraftValue = {
  activityName: "",
  durationMinutes: null,
  estimatedCaloriesBurned: null,
};

function parseOptionalNumber(raw: string): number | null {
  if (raw === "") {
    return null;
  }
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Zod の `issues` が持つ最小限の形状（`server/src/profile/profile.service.ts` の
 * `ZodIssueLike` と同じ構造的型付けの考え方に従う。`zod` を `web` の直接依存に
 * 追加せずに済む）。
 */
interface FieldIssueLike {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** Zod の issues を `Record<string, string[]>`（design.md: ValidationError.fieldErrors）へ変換する。 */
function toFieldErrors(issues: readonly FieldIssueLike[]): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_root";
    const messages = fieldErrors[key] ?? (fieldErrors[key] = []);
    messages.push(issue.message);
  }
  return fieldErrors;
}

/**
 * 追加フォームの下書き値を `ExerciseEntryInputSchema`（`@nutrition/shared`）で検証する。
 * `durationMinutes`/`estimatedCaloriesBurned` は編集中は `null` を許容するが、スキーマ側は
 * `z.number().positive()`（必須）のため、検証直前にのみ `null → undefined` の橋渡しを行う
 * （`WeightBodyFatFields.validateWeightBodyFat` と同じアダプタパターン。UIの「空欄」表現と
 * スキーマの「値なし」表現の差異を吸収するものであり、レンジ判定ロジックの再実装ではない）。
 */
function parseDraft(draft: ExerciseEntryDraftValue) {
  return ExerciseEntryInputSchema.safeParse({
    activityName: draft.activityName,
    durationMinutes: draft.durationMinutes ?? undefined,
    estimatedCaloriesBurned: draft.estimatedCaloriesBurned ?? undefined,
  });
}

/** 追加フォームの下書き値に対する検証（Requirement 10.5）。エラーが無ければ空オブジェクトを返す。 */
export function validateExerciseEntry(draft: ExerciseEntryDraftValue): Record<string, string[]> {
  const result = parseDraft(draft);
  return result.success ? {} : toFieldErrors(result.error.issues);
}

function formatEntryLabel(entry: ExerciseLogEntry): string {
  return `${entry.activityName}・${entry.durationMinutes}分`;
}

export function ExerciseLogList({ entries, onAdd, onRemove, errors = {} }: ExerciseLogListProps) {
  const [draft, setDraft] = useState<ExerciseEntryDraftValue>(EMPTY_DRAFT);
  const [localErrors, setLocalErrors] = useState<Record<string, string[]>>({});

  // 直近の追加試行によるエラー（localErrors）を優先し、無ければ外部から渡されたエラー
  // （将来のサーバー側エラー等）を表示する。
  const activityErrors = localErrors.activityName ?? errors.activityName ?? [];
  const durationErrors = localErrors.durationMinutes ?? errors.durationMinutes ?? [];
  const caloriesErrors = localErrors.estimatedCaloriesBurned ?? errors.estimatedCaloriesBurned ?? [];

  const handleFieldChange = (field: keyof ExerciseEntryDraftValue) => (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value;
    setDraft((current) => ({
      ...current,
      [field]: field === "activityName" ? rawValue : parseOptionalNumber(rawValue),
    }));
  };

  const handleAdd = () => {
    const result = parseDraft(draft);
    if (!result.success) {
      setLocalErrors(toFieldErrors(result.error.issues));
      return;
    }
    onAdd(result.data);
    setDraft(EMPTY_DRAFT);
    setLocalErrors({});
  };

  return (
    <div className="exercise-log-list">
      <div className="log-field" style={{ borderTop: "1px dashed var(--border)", paddingTop: 10 }}>
        <span className="l-label">追加運動</span>
      </div>

      {entries.map((entry) => (
        <div className="exercise-entry" key={entry.id}>
          <span>{formatEntryLabel(entry)}</span>
          <span className="meta">+{entry.estimatedCaloriesBurned}kcal</span>
          <button
            type="button"
            className="row-del"
            aria-label={`${entry.activityName}を削除`}
            onClick={() => onRemove(entry.id)}
          >
            ✕
          </button>
        </div>
      ))}

      <div className="exercise-add-form field-grid" style={{ marginTop: 10 }}>
        <div className="field">
          <label htmlFor="log-exercise-activity">種目</label>
          <input
            type="text"
            id="log-exercise-activity"
            value={draft.activityName}
            onChange={handleFieldChange("activityName")}
            aria-invalid={activityErrors.length > 0}
            aria-describedby={activityErrors.length > 0 ? "log-exercise-activity-error" : undefined}
          />
          {activityErrors.length > 0 && (
            <p id="log-exercise-activity-error" role="alert" className="field-error">
              {activityErrors.join(" ")}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="log-exercise-duration">時間</label>
          <div className="unit-row">
            <input
              type="number"
              id="log-exercise-duration"
              value={draft.durationMinutes ?? ""}
              onChange={handleFieldChange("durationMinutes")}
              aria-invalid={durationErrors.length > 0}
              aria-describedby={durationErrors.length > 0 ? "log-exercise-duration-error" : undefined}
            />
            <span className="unit">分</span>
          </div>
          {durationErrors.length > 0 && (
            <p id="log-exercise-duration-error" role="alert" className="field-error">
              {durationErrors.join(" ")}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="log-exercise-calories">想定消費カロリー</label>
          <div className="unit-row">
            <input
              type="number"
              id="log-exercise-calories"
              value={draft.estimatedCaloriesBurned ?? ""}
              onChange={handleFieldChange("estimatedCaloriesBurned")}
              aria-invalid={caloriesErrors.length > 0}
              aria-describedby={caloriesErrors.length > 0 ? "log-exercise-calories-error" : undefined}
            />
            <span className="unit">kcal</span>
          </div>
          {caloriesErrors.length > 0 && (
            <p id="log-exercise-calories-error" role="alert" className="field-error">
              {caloriesErrors.join(" ")}
            </p>
          )}
        </div>

        <div className="field" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn-ghost" onClick={handleAdd}>
            ＋ 記録する
          </button>
        </div>
      </div>
    </div>
  );
}
