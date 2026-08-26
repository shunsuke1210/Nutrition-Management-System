/**
 * 基本情報セクション（身長・体重・年齢・性別）。
 *
 * mockup.html の「基本情報」セクション（身長・体重・年齢の数値入力 + 性別のpill-group）
 * のレイアウトに対応する（design.md: File Structure Plan `components/profile/BasicInfoSection.tsx`）。
 * `ProfilePage`（task 4.4）がまだ存在しないため、本コンポーネントは自身の値・変更通知・
 * エラー表示のみを責務とする独立したプレゼンテーションコンポーネントとして実装する。
 *
 * Requirements: 1.1（必須項目の保持）, 1.3（0以下・非現実的な値の拒否）, 1.4（性別の選択肢）
 */
import type { ChangeEvent } from "react";
import { GenderSchema, ProfileSchema, type Gender } from "@nutrition/shared";

export interface BasicInfoSectionValue {
  heightCm: number | null;
  weightKg: number | null;
  age: number | null;
  gender: Gender | null;
}

export type BasicInfoField = keyof BasicInfoSectionValue;

export interface BasicInfoSectionProps {
  value: BasicInfoSectionValue;
  onChange: (field: BasicInfoField, value: BasicInfoSectionValue[BasicInfoField]) => void;
  /** フィールド名 → エラーメッセージ一覧（design.md: ValidationError.fieldErrors と同じ形） */
  errors?: Record<string, string[]>;
}

// 選択肢の値集合は `GenderSchema.options`（`@nutrition/shared`）から取得し、
// ハードコードしない（Requirement 1.4）。ラベルのみ表示用に手動で対応付ける。
const GENDER_LABELS: Record<Gender, string> = {
  female: "女性",
  male: "男性",
  undisclosed: "回答しない",
};

const GENDER_OPTIONS: ReadonlyArray<{ value: Gender; label: string }> = GenderSchema.options.map(
  (value) => ({ value, label: GENDER_LABELS[value] }),
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
 * `ProfileSchema`（`@nutrition/shared`）からこのセクションが担当する4フィールドだけを
 * `.pick` した部分スキーマ。`ProfileInputSchema` は全フィールドを結合した `.superRefine`
 * （`ZodEffects`）のため `.pick` できないが、`ProfileSchema`（`ProfileInputShape.extend(...)`）
 * は素の `ZodObject` であり、条件付き必須（restrictionIntensity 等）を含まないこの
 * セクションのフィールド集合であれば `.pick` してもルールが変わらず安全に再利用できる。
 */
const BasicInfoValidationSchema = ProfileSchema.pick({
  heightCm: true,
  weightKg: true,
  age: true,
  gender: true,
});

/**
 * `BasicInfoSectionValue` に対する必須・レンジ検証（Requirements 1.1, 1.3, 1.4）。
 *
 * design.md の Domain: UI Implementation Note（「Zodスキーマ...をクライアント側でも
 * 再利用し...送信前に同一ルールで検証してユーザーへ即時フィードバックする」）に従い、
 * `shared` パッケージの Zod スキーマ（`ProfileSchema` の部分スキーマ）をそのまま
 * 再利用する。ルールの手動再実装は行わない。
 */
export function validateBasicInfo(value: BasicInfoSectionValue): Record<string, string[]> {
  const result = BasicInfoValidationSchema.safeParse(value);
  return result.success ? {} : toFieldErrors(result.error.issues);
}

export function BasicInfoSection({ value, onChange, errors = {} }: BasicInfoSectionProps) {
  const heightErrors = errors.heightCm ?? [];
  const weightErrors = errors.weightKg ?? [];
  const ageErrors = errors.age ?? [];
  const genderErrors = errors.gender ?? [];

  const handleNumberChange =
    (field: "heightCm" | "weightKg" | "age") => (event: ChangeEvent<HTMLInputElement>) => {
      onChange(field, parseOptionalNumber(event.target.value));
    };

  return (
    <section className="form-section" aria-labelledby="basic-info-heading">
      <h3 id="basic-info-heading">
        基本情報<span className="required-mark">必須</span>
      </h3>
      <p className="sec-sub">栄養計算の基礎となる情報です。</p>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="basic-height">身長</label>
          <div className="unit-row">
            <input
              type="number"
              id="basic-height"
              value={value.heightCm ?? ""}
              onChange={handleNumberChange("heightCm")}
              aria-invalid={heightErrors.length > 0}
              aria-describedby={heightErrors.length > 0 ? "basic-height-error" : undefined}
            />
            <span className="unit">cm</span>
          </div>
          {heightErrors.length > 0 && (
            <p id="basic-height-error" role="alert" className="field-error">
              {heightErrors.join(" ")}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="basic-weight">体重</label>
          <div className="unit-row">
            <input
              type="number"
              id="basic-weight"
              step="0.1"
              value={value.weightKg ?? ""}
              onChange={handleNumberChange("weightKg")}
              aria-invalid={weightErrors.length > 0}
              aria-describedby={weightErrors.length > 0 ? "basic-weight-error" : undefined}
            />
            <span className="unit">kg</span>
          </div>
          {weightErrors.length > 0 && (
            <p id="basic-weight-error" role="alert" className="field-error">
              {weightErrors.join(" ")}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="basic-age">年齢</label>
          <div className="unit-row">
            <input
              type="number"
              id="basic-age"
              value={value.age ?? ""}
              onChange={handleNumberChange("age")}
              aria-invalid={ageErrors.length > 0}
              aria-describedby={ageErrors.length > 0 ? "basic-age-error" : undefined}
            />
            <span className="unit">歳</span>
          </div>
          {ageErrors.length > 0 && (
            <p id="basic-age-error" role="alert" className="field-error">
              {ageErrors.join(" ")}
            </p>
          )}
        </div>

        <div className="field wide">
          <span id="basic-gender-label">性別</span>
          <div className="pill-group" role="radiogroup" aria-labelledby="basic-gender-label">
            {GENDER_OPTIONS.map((option) => (
              <span key={option.value}>
                <input
                  type="radio"
                  name="basic-gender"
                  id={`basic-gender-${option.value}`}
                  checked={value.gender === option.value}
                  onChange={() => onChange("gender", option.value)}
                />
                <label htmlFor={`basic-gender-${option.value}`}>{option.label}</label>
              </span>
            ))}
          </div>
          {genderErrors.length > 0 && (
            <p id="basic-gender-error" role="alert" className="field-error">
              {genderErrors.join(" ")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
