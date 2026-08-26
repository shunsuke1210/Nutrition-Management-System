/**
 * 運動習慣セクション（仕事中の活動度・通勤手段・平均歩数）。
 *
 * mockup.html の「運動習慣」セクションのうち、仕事中の活動度・通勤手段のpill-groupと
 * 1日の平均歩数の入力欄に対応する（design.md: File Structure Plan
 * `components/profile/ExerciseHabitSection.tsx`）。1週間の運動量テーブルは
 * `ExerciseRoutineTable`（同ディレクトリ）が別コンポーネントとして担当する。
 * `BasicInfoSection`/`BodyInfoSection`/`LifestyleSection`（task 4.1）と同様に、
 * 自身の値・変更通知・エラー表示のみを責務とする独立したプレゼンテーションコンポーネント
 * として実装する。
 *
 * Requirements: 4.1（お仕事中の活動度の単一選択）, 4.2（通勤手段の単一選択）,
 * 4.3（お仕事中の活動度・通勤手段が未選択の場合のエラー表示）,
 * 4.4（1日の平均歩数は任意入力）, 4.5（1日の平均歩数の負数を拒否）
 */
import type { ChangeEvent } from "react";
import {
  CommuteMethodSchema,
  JobActivityLevelSchema,
  ProfileSchema,
  type CommuteMethod,
  type JobActivityLevel,
} from "@nutrition/shared";

export interface ExerciseHabitSectionValue {
  jobActivityLevel: JobActivityLevel | null;
  commuteMethod: CommuteMethod | null;
  averageDailySteps: number | null;
}

export type ExerciseHabitField = keyof ExerciseHabitSectionValue;

export interface ExerciseHabitSectionProps {
  value: ExerciseHabitSectionValue;
  onChange: (field: ExerciseHabitField, value: ExerciseHabitSectionValue[ExerciseHabitField]) => void;
  /** フィールド名 → エラーメッセージ一覧（design.md: ValidationError.fieldErrors と同じ形） */
  errors?: Record<string, string[]>;
}

// 選択肢の値集合は各Schemaの `.options`（`@nutrition/shared`）から取得し、
// ハードコードしない（Requirements 4.1, 4.2）。ラベルのみ表示用に手動で対応付ける。
const JOB_ACTIVITY_LABELS: Record<JobActivityLevel, string> = {
  mostly_sedentary: "主に座って過ごす",
  mixed: "座り・立ち半々",
  mostly_active: "主に立つ・体を動かす仕事",
};

const JOB_ACTIVITY_OPTIONS: ReadonlyArray<{ value: JobActivityLevel; label: string }> =
  JobActivityLevelSchema.options.map((value) => ({ value, label: JOB_ACTIVITY_LABELS[value] }));

const COMMUTE_LABELS: Record<CommuteMethod, string> = {
  walk_or_bike: "徒歩・自転車が中心",
  transit: "電車・バスなど",
  car: "車・ほぼ歩かない",
};

const COMMUTE_OPTIONS: ReadonlyArray<{ value: CommuteMethod; label: string }> = CommuteMethodSchema.options.map(
  (value) => ({ value, label: COMMUTE_LABELS[value] }),
);

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
 * `ProfileSchema`（`@nutrition/shared`）からこのセクションが担当する3フィールドだけを
 * `.pick` した部分スキーマ。`BasicInfoSection.tsx` と同じ理由（`ProfileInputSchema` は
 * `.superRefine` を含む `ZodEffects` のため `.pick` できない）により `ProfileSchema`
 * （素の `ZodObject`）から部分スキーマを取り出して再利用する。`jobActivityLevel` /
 * `commuteMethod` は `ProfileSchema` 上も必須（非nullable）のため、`null`（未選択）を
 * 渡すと型不一致のissueが自然に発生し、Requirement 4.3の「未選択の場合のエラー」を
 * 手動再実装なしに表現できる。
 */
const ExerciseHabitValidationSchema = ProfileSchema.pick({
  jobActivityLevel: true,
  commuteMethod: true,
  averageDailySteps: true,
});

/**
 * `ExerciseHabitSectionValue` に対する必須・レンジ検証（Requirements 4.1-4.5）。
 *
 * design.md の Domain: UI Implementation Note に従い、`shared` パッケージの Zod
 * スキーマ（`ProfileSchema` の部分スキーマ）をそのまま再利用する。ルールの手動
 * 再実装は行わない。
 */
export function validateExerciseHabit(value: ExerciseHabitSectionValue): Record<string, string[]> {
  const result = ExerciseHabitValidationSchema.safeParse(value);
  return result.success ? {} : toFieldErrors(result.error.issues);
}

export function ExerciseHabitSection({ value, onChange, errors = {} }: ExerciseHabitSectionProps) {
  const jobActivityErrors = errors.jobActivityLevel ?? [];
  const commuteErrors = errors.commuteMethod ?? [];
  const stepsErrors = errors.averageDailySteps ?? [];

  return (
    <section className="form-section" aria-labelledby="exercise-habit-heading">
      <h3 id="exercise-habit-heading">運動習慣</h3>
      <p className="sec-sub">
        活動レベルはここでの内容から自動算出されます。できるだけ具体的に書くほど精度が上がります。
      </p>
      <div className="field-grid">
        <div className="field wide">
          <span id="job-activity-label">お仕事中の活動度</span>
          <div className="pill-group" role="radiogroup" aria-labelledby="job-activity-label">
            {JOB_ACTIVITY_OPTIONS.map((option) => (
              <span key={option.value}>
                <input
                  type="radio"
                  name="job-activity"
                  id={`job-activity-${option.value}`}
                  checked={value.jobActivityLevel === option.value}
                  onChange={() => onChange("jobActivityLevel", option.value)}
                />
                <label htmlFor={`job-activity-${option.value}`}>{option.label}</label>
              </span>
            ))}
          </div>
          {jobActivityErrors.length > 0 && (
            <p id="job-activity-error" role="alert" className="field-error">
              {jobActivityErrors.join(" ")}
            </p>
          )}
        </div>

        <div className="field wide">
          <span id="commute-method-label">通勤手段</span>
          <div className="pill-group" role="radiogroup" aria-labelledby="commute-method-label">
            {COMMUTE_OPTIONS.map((option) => (
              <span key={option.value}>
                <input
                  type="radio"
                  name="commute-method"
                  id={`commute-method-${option.value}`}
                  checked={value.commuteMethod === option.value}
                  onChange={() => onChange("commuteMethod", option.value)}
                />
                <label htmlFor={`commute-method-${option.value}`}>{option.label}</label>
              </span>
            ))}
          </div>
          {commuteErrors.length > 0 && (
            <p id="commute-method-error" role="alert" className="field-error">
              {commuteErrors.join(" ")}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="average-daily-steps">1日の平均歩数（分かれば）</label>
          <div className="unit-row">
            <input
              type="number"
              id="average-daily-steps"
              placeholder="例: 6000"
              value={value.averageDailySteps ?? ""}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                onChange("averageDailySteps", parseOptionalNumber(event.target.value))
              }
              aria-invalid={stepsErrors.length > 0}
              aria-describedby={stepsErrors.length > 0 ? "average-daily-steps-error" : undefined}
            />
            <span className="unit">歩/日</span>
          </div>
          <span className="hint">スマホや歩数計の記録があれば、より正確に算出できます（任意）。</span>
          {stepsErrors.length > 0 && (
            <p id="average-daily-steps-error" role="alert" className="field-error">
              {stepsErrors.join(" ")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
