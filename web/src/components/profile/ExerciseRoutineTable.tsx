/**
 * 週間運動量テーブル（場面・内容・頻度・時間・強度の行の追加/削除）。
 *
 * mockup.html の「運動習慣」セクション内の「1週間の運動量」テーブルに対応する
 * （design.md: File Structure Plan `components/profile/ExerciseRoutineTable.tsx`）。
 * `BasicInfoSection` 等（task 4.1）と同様に、自身の値・変更通知・エラー表示のみを
 * 責務とする独立したプレゼンテーションコンポーネントとして実装する。行の識別は
 * 配列インデックスで行い（並べ替えは要件にないため、追加は末尾への追加・削除は
 * インデックス指定の除去のみをサポートする）、`ProfileInput.exerciseRoutine` と
 * 同じ形状（`ExerciseRoutineEntryInput[]`）をそのまま扱えるよう、行の値に合成IDを
 * 持たせない。
 *
 * Requirements: 4.6（場面・内容・頻度・時間・強度の複数行テーブル）,
 * 4.7（行の追加）, 4.8（行の削除）, 4.9（0件でも保存を許可）,
 * 4.10（頻度・時間が0以下の値を拒否）
 */
import type { ChangeEvent } from "react";
import {
  ExerciseIntensitySchema,
  ExerciseRoutineEntryInputSchema,
  RoutineSceneSchema,
  type ExerciseIntensity,
  type RoutineScene,
} from "@nutrition/shared";

/**
 * `ExerciseRoutineEntryInput`（`@nutrition/shared`）とほぼ同じ形状だが、`frequencyPerWeek` /
 * `durationMinutes` は編集中の未入力状態を表現するため `number | null` を許容する
 * （`BasicInfoSectionValue` 等が必須の数値フィールドに `number | null` を使う既存の
 * 慣習と同じ理由）。`scene` / `intensity` は `<select>` が常にいずれかの選択肢を
 * 保持する（未選択状態を表現しない）ため、非nullのままとする。
 */
export interface ExerciseRoutineRowValue {
  scene: RoutineScene;
  content: string;
  frequencyPerWeek: number | null;
  durationMinutes: number | null;
  intensity: ExerciseIntensity;
}

export interface ExerciseRoutineTableProps {
  value: readonly ExerciseRoutineRowValue[];
  onChange: (value: ExerciseRoutineRowValue[]) => void;
  /**
   * 行ごとのフィールドエラー一覧。`value` と同じインデックスに対応する
   * （design.md: ValidationError.fieldErrors を行単位に分解したもの）。
   * エラーがない行は `undefined` または空オブジェクトでよい。
   */
  errors?: ReadonlyArray<Record<string, string[]> | undefined>;
}

// 選択肢の値集合は各Schemaの `.options`（`@nutrition/shared`）から取得し、
// ハードコードしない（Requirement 4.6）。ラベルのみ表示用に手動で対応付ける。
const SCENE_LABELS: Record<RoutineScene, string> = {
  commute: "通勤",
  work: "仕事中",
  after_work: "帰宅後",
  holiday: "休日",
  other: "その他",
};

const SCENE_OPTIONS: ReadonlyArray<{ value: RoutineScene; label: string }> = RoutineSceneSchema.options.map(
  (value) => ({ value, label: SCENE_LABELS[value] }),
);

const INTENSITY_LABELS: Record<ExerciseIntensity, string> = {
  light: "軽い",
  moderate: "中程度",
  vigorous: "激しい",
};

const INTENSITY_OPTIONS: ReadonlyArray<{ value: ExerciseIntensity; label: string }> =
  ExerciseIntensitySchema.options.map((value) => ({ value, label: INTENSITY_LABELS[value] }));

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
 * 1行分の検証（Requirement 4.10）。
 *
 * `ProfileSchema.pick({ exerciseRoutine: true })` で配列全体を一括検証する方式ではなく、
 * `@nutrition/shared` が標準でexportしている行単体のスキーマ `ExerciseRoutineEntryInputSchema`
 * を再利用する。理由: 配列全体をpickしてvalidateすると、Zodのissue.pathが
 * `["exerciseRoutine", <index>, <field>]` という3要素になり、`BasicInfoSection` 等が
 * 採用している「`path[0]` をフィールド名として `Record<string, string[]>` に変換する」
 * 単純な `toFieldErrors` ではインデックスを取りこぼし、複数行に同名フィールド（例:
 * 2行とも `frequencyPerWeek` が不正）のエラーが1つのキーに混ざってしまい、
 * 「特定の行にスコープされたエラー表示」（タスクの要求）を素直に表現できない。
 * 行単体のスキーマであれば `path[0]` がそのまま行内のフィールド名になり、
 * 行ごとに独立した `Record<string, string[]>` を返せるため、こちらを採用する。
 */
export function validateExerciseRoutineRow(row: ExerciseRoutineRowValue): Record<string, string[]> {
  const result = ExerciseRoutineEntryInputSchema.safeParse(row);
  return result.success ? {} : toFieldErrors(result.error.issues);
}

/**
 * テーブル全体（複数行）の検証。各行を `validateExerciseRoutineRow` で検証し、
 * `value` と同じインデックスに対応する結果配列を返す。0行の場合は空配列を返し、
 * 保存を妨げない（Requirement 4.9）。
 */
export function validateExerciseRoutineTable(
  rows: readonly ExerciseRoutineRowValue[],
): Array<Record<string, string[]>> {
  return rows.map((row) => validateExerciseRoutineRow(row));
}

/** 「行を追加」で挿入する新規行の初期値。場面・強度は選択肢の先頭を既定値とする。 */
function createEmptyRow(): ExerciseRoutineRowValue {
  return {
    scene: SCENE_OPTIONS[0]!.value,
    content: "",
    frequencyPerWeek: null,
    durationMinutes: null,
    intensity: INTENSITY_OPTIONS[0]!.value,
  };
}

export function ExerciseRoutineTable({ value, onChange, errors = [] }: ExerciseRoutineTableProps) {
  const handleAddRow = () => {
    onChange([...value, createEmptyRow()]);
  };

  const handleRemoveRow = (index: number) => {
    onChange(value.filter((_, rowIndex) => rowIndex !== index));
  };

  function handleFieldChange<K extends keyof ExerciseRoutineRowValue>(
    index: number,
    field: K,
    fieldValue: ExerciseRoutineRowValue[K],
  ): void {
    onChange(value.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: fieldValue } : row)));
  }

  return (
    <div className="field wide" style={{ marginTop: 16 }}>
      <label id="exercise-routine-label">1週間の運動量（できるだけ細かく）</label>
      <p className="hint" style={{ margin: "0 0 8px" }}>
        「今日の記録」の追加運動は、その日限定の単発の運動を記録する欄です。
        <br />
        こちらには、通勤・仕事中・帰宅後・休日など、普段の1週間で平均的に行っている運動を、できるだけ細かく書いてください。
      </p>
      <div className="table-scroll">
        <table className="routine-table" aria-labelledby="exercise-routine-label">
          <thead>
            <tr>
              <th>場面</th>
              <th>内容</th>
              <th>頻度</th>
              <th>1回の時間</th>
              <th>強度</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {value.map((row, index) => {
              const rowErrors = errors[index] ?? {};
              const frequencyErrors = rowErrors.frequencyPerWeek ?? [];
              const durationErrors = rowErrors.durationMinutes ?? [];
              const frequencyErrorId = `routine-frequency-${index}-error`;
              const durationErrorId = `routine-duration-${index}-error`;

              return (
                <tr key={index}>
                  <td>
                    <select
                      aria-label="場面"
                      value={row.scene}
                      onChange={(event) =>
                        handleFieldChange(index, "scene", event.target.value as RoutineScene)
                      }
                    >
                      {SCENE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="text"
                      aria-label="内容"
                      value={row.content}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        handleFieldChange(index, "content", event.target.value)
                      }
                    />
                  </td>
                  <td>
                    <div className="unit-row">
                      <input
                        type="number"
                        aria-label="頻度"
                        value={row.frequencyPerWeek ?? ""}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          handleFieldChange(index, "frequencyPerWeek", parseOptionalNumber(event.target.value))
                        }
                        aria-invalid={frequencyErrors.length > 0}
                        aria-describedby={frequencyErrors.length > 0 ? frequencyErrorId : undefined}
                      />
                      <span className="unit">回/週</span>
                    </div>
                    {frequencyErrors.length > 0 && (
                      <p id={frequencyErrorId} role="alert" className="field-error">
                        {frequencyErrors.join(" ")}
                      </p>
                    )}
                  </td>
                  <td>
                    <div className="unit-row">
                      <input
                        type="number"
                        aria-label="1回の時間"
                        value={row.durationMinutes ?? ""}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          handleFieldChange(index, "durationMinutes", parseOptionalNumber(event.target.value))
                        }
                        aria-invalid={durationErrors.length > 0}
                        aria-describedby={durationErrors.length > 0 ? durationErrorId : undefined}
                      />
                      <span className="unit">分</span>
                    </div>
                    {durationErrors.length > 0 && (
                      <p id={durationErrorId} role="alert" className="field-error">
                        {durationErrors.join(" ")}
                      </p>
                    )}
                  </td>
                  <td>
                    <select
                      aria-label="強度"
                      value={row.intensity}
                      onChange={(event) =>
                        handleFieldChange(index, "intensity", event.target.value as ExerciseIntensity)
                      }
                    >
                      {INTENSITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="row-del"
                      aria-label="この行を削除"
                      onClick={() => handleRemoveRow(index)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="chip-add" style={{ marginTop: 10 }} onClick={handleAddRow}>
        ＋ 行を追加
      </button>
    </div>
  );
}
