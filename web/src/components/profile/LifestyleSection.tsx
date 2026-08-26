/**
 * 生活習慣セクション（睡眠・飲酒・喫煙・調理スキル/時間・予算感）。
 *
 * mockup.html の「生活習慣」セクションのレイアウトに対応する
 * （design.md: File Structure Plan `components/profile/LifestyleSection.tsx`）。
 * すべて拡張項目（任意入力）であり、`BasicInfoSection` / `BodyInfoSection` 同様に
 * 自身の値・変更通知・エラー表示のみを責務とする独立したプレゼンテーションコンポーネント
 * として実装する。
 *
 * `cookingSkill` / `cookingTimePreference` / `budgetPreference` は design.md の
 * `ProfileInput` 型上は自由文字列（enumなし）だが、mockup.html 上では固定の選択肢
 * （調理スキルはpill-group、調理時間・予算感はselect）として提示されているため、
 * その表示形式にそのまま従う（値は自由文字列として送信される）。
 *
 * Requirements: 2.1（拡張項目の保持）, 2.2（未入力のまま保存を許可）,
 * 2.4（睡眠時間の負数を拒否）
 */
import type { ChangeEvent } from "react";
import {
  AlcoholHabitSchema,
  ProfileSchema,
  SmokingHabitSchema,
  type AlcoholHabit,
  type SmokingHabit,
} from "@nutrition/shared";

export interface LifestyleSectionValue {
  sleepHours: number | null;
  alcoholHabit: AlcoholHabit | null;
  smokingHabit: SmokingHabit | null;
  cookingSkill: string | null;
  cookingTimePreference: string | null;
  budgetPreference: string | null;
}

export type LifestyleField = keyof LifestyleSectionValue;

export interface LifestyleSectionProps {
  value: LifestyleSectionValue;
  onChange: (field: LifestyleField, value: LifestyleSectionValue[LifestyleField]) => void;
  /** フィールド名 → エラーメッセージ一覧（design.md: ValidationError.fieldErrors と同じ形） */
  errors?: Record<string, string[]>;
}

// 選択肢の値集合は各Schemaの `.options`（`@nutrition/shared`）から取得し、
// ハードコードしない。ラベルのみ表示用に手動で対応付ける。
const ALCOHOL_LABELS: Record<AlcoholHabit, string> = {
  none: "しない",
  occasional: "たまに",
  frequent: "よく飲む",
};

const ALCOHOL_OPTIONS: ReadonlyArray<{ value: AlcoholHabit; label: string }> =
  AlcoholHabitSchema.options.map((value) => ({ value, label: ALCOHOL_LABELS[value] }));

const SMOKING_LABELS: Record<SmokingHabit, string> = {
  non_smoker: "吸わない",
  smoker: "吸う",
};

const SMOKING_OPTIONS: ReadonlyArray<{ value: SmokingHabit; label: string }> =
  SmokingHabitSchema.options.map((value) => ({ value, label: SMOKING_LABELS[value] }));

const COOKING_SKILL_OPTIONS: readonly string[] = ["初心者", "普通", "得意"];
const COOKING_TIME_OPTIONS: readonly string[] = ["15分以内", "30分以内", "1時間程度", "こだわらない"];
const BUDGET_OPTIONS: readonly string[] = ["500円以内", "500〜800円", "800〜1,200円", "こだわらない"];

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
 * `ProfileSchema`（`@nutrition/shared`）からこのセクションが担当する6フィールドだけを
 * `.pick` した部分スキーマ。`BasicInfoSection.tsx` と同じ理由（`ProfileInputSchema` は
 * `.superRefine` を含む `ZodEffects` のため `.pick` できない）により `ProfileSchema`
 * （素の `ZodObject`）から部分スキーマを取り出して再利用する。
 */
const LifestyleValidationSchema = ProfileSchema.pick({
  sleepHours: true,
  alcoholHabit: true,
  smokingHabit: true,
  cookingSkill: true,
  cookingTimePreference: true,
  budgetPreference: true,
});

/**
 * `LifestyleSectionValue` に対するレンジ検証（Requirement 2.4）。
 * 拡張項目はすべて任意のため、未入力（null）は常に許容する（Requirements 2.1, 2.2）。
 *
 * design.md の Domain: UI Implementation Note に従い、`shared` パッケージの Zod
 * スキーマ（`ProfileSchema` の部分スキーマ）をそのまま再利用する。ルールの手動
 * 再実装は行わない。
 */
export function validateLifestyle(value: LifestyleSectionValue): Record<string, string[]> {
  const result = LifestyleValidationSchema.safeParse(value);
  return result.success ? {} : toFieldErrors(result.error.issues);
}

export function LifestyleSection({ value, onChange, errors = {} }: LifestyleSectionProps) {
  const sleepErrors = errors.sleepHours ?? [];

  return (
    <section className="form-section" aria-labelledby="lifestyle-heading">
      <h3 id="lifestyle-heading">生活習慣</h3>
      <p className="sec-sub">睡眠・運動・嗜好など、精度向上に役立つ情報です（任意）。</p>
      <div className="field-grid">
        <div className="field wide">
          <label htmlFor="sleep-hours">平均睡眠時間</label>
          <div className="unit-row">
            <input
              type="number"
              id="sleep-hours"
              step="0.5"
              value={value.sleepHours ?? ""}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                onChange("sleepHours", parseOptionalNumber(event.target.value))
              }
              aria-invalid={sleepErrors.length > 0}
              aria-describedby={sleepErrors.length > 0 ? "sleep-hours-error" : undefined}
            />
            <span className="unit">時間/日</span>
          </div>
          {sleepErrors.length > 0 && (
            <p id="sleep-hours-error" role="alert" className="field-error">
              {sleepErrors.join(" ")}
            </p>
          )}
        </div>

        <div className="field wide">
          <span id="alcohol-habit-label">飲酒習慣</span>
          <div className="pill-group" role="radiogroup" aria-labelledby="alcohol-habit-label">
            {ALCOHOL_OPTIONS.map((option) => (
              <span key={option.value}>
                <input
                  type="radio"
                  name="alcohol-habit"
                  id={`alcohol-habit-${option.value}`}
                  checked={value.alcoholHabit === option.value}
                  onChange={() => onChange("alcoholHabit", option.value)}
                />
                <label htmlFor={`alcohol-habit-${option.value}`}>{option.label}</label>
              </span>
            ))}
          </div>
        </div>

        <div className="field wide">
          <span id="smoking-habit-label">喫煙習慣</span>
          <div className="pill-group" role="radiogroup" aria-labelledby="smoking-habit-label">
            {SMOKING_OPTIONS.map((option) => (
              <span key={option.value}>
                <input
                  type="radio"
                  name="smoking-habit"
                  id={`smoking-habit-${option.value}`}
                  checked={value.smokingHabit === option.value}
                  onChange={() => onChange("smokingHabit", option.value)}
                />
                <label htmlFor={`smoking-habit-${option.value}`}>{option.label}</label>
              </span>
            ))}
          </div>
        </div>

        <div className="field wide">
          <span id="cooking-skill-label">調理スキル</span>
          <div className="pill-group" role="radiogroup" aria-labelledby="cooking-skill-label">
            {COOKING_SKILL_OPTIONS.map((label) => (
              <span key={label}>
                <input
                  type="radio"
                  name="cooking-skill"
                  id={`cooking-skill-${label}`}
                  checked={value.cookingSkill === label}
                  onChange={() => onChange("cookingSkill", label)}
                />
                <label htmlFor={`cooking-skill-${label}`}>{label}</label>
              </span>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="cooking-time-preference">調理にかけられる時間</label>
          <select
            id="cooking-time-preference"
            value={value.cookingTimePreference ?? ""}
            onChange={(event) =>
              onChange("cookingTimePreference", event.target.value === "" ? null : event.target.value)
            }
          >
            <option value="">未選択</option>
            {COOKING_TIME_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="budget-preference">1食あたりの予算感</label>
          <select
            id="budget-preference"
            value={value.budgetPreference ?? ""}
            onChange={(event) =>
              onChange("budgetPreference", event.target.value === "" ? null : event.target.value)
            }
          >
            <option value="">未選択</option>
            {BUDGET_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
