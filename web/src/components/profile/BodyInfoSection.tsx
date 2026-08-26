/**
 * 身体情報セクション（体脂肪率・妊娠授乳の状況・既往症等）。
 *
 * mockup.html の「身体情報」セクションのレイアウトに対応する
 * （design.md: File Structure Plan `components/profile/BodyInfoSection.tsx`）。
 * すべて拡張項目（任意入力）であり、`BasicInfoSection` 同様に自身の値・変更通知・
 * エラー表示のみを責務とする独立したプレゼンテーションコンポーネントとして実装する。
 *
 * Requirements: 2.1（拡張項目の保持）, 2.2（未入力のまま保存を許可）,
 * 2.3（体脂肪率0-100%の範囲外を拒否）, 2.5（妊娠/授乳の選択肢）
 */
import type { ChangeEvent } from "react";
import { PregnancyStatusSchema, ProfileSchema, type PregnancyStatus } from "@nutrition/shared";

export interface BodyInfoSectionValue {
  bodyFatPct: number | null;
  pregnancyStatus: PregnancyStatus;
  medicalNotes: string | null;
}

export type BodyInfoField = keyof BodyInfoSectionValue;

export interface BodyInfoSectionProps {
  value: BodyInfoSectionValue;
  onChange: (field: BodyInfoField, value: BodyInfoSectionValue[BodyInfoField]) => void;
  /** フィールド名 → エラーメッセージ一覧（design.md: ValidationError.fieldErrors と同じ形） */
  errors?: Record<string, string[]>;
}

// 選択肢の値集合は `PregnancyStatusSchema.options`（`@nutrition/shared`）から取得し、
// ハードコードしない（Requirement 2.5）。ラベルのみ表示用に手動で対応付ける。
const PREGNANCY_LABELS: Record<PregnancyStatus, string> = {
  none: "該当なし",
  pregnant: "妊娠中",
  lactating: "授乳中",
};

const PREGNANCY_OPTIONS: ReadonlyArray<{ value: PregnancyStatus; label: string }> =
  PregnancyStatusSchema.options.map((value) => ({ value, label: PREGNANCY_LABELS[value] }));

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
 * （素の `ZodObject`）から部分スキーマを取り出して再利用する。
 */
const BodyInfoValidationSchema = ProfileSchema.pick({
  bodyFatPct: true,
  pregnancyStatus: true,
  medicalNotes: true,
});

/**
 * `BodyInfoSectionValue` に対するレンジ検証（Requirement 2.3）。
 * 拡張項目はすべて任意のため、未入力（null）は常に許容する（Requirements 2.1, 2.2 —
 * `bodyFatPct`/`medicalNotes` は `ProfileSchema` 上も `.nullable()` のため、この
 * スキーマ再利用のままで許容される）。
 *
 * design.md の Domain: UI Implementation Note に従い、`shared` パッケージの Zod
 * スキーマ（`ProfileSchema` の部分スキーマ）をそのまま再利用する。ルールの手動
 * 再実装は行わない。
 */
export function validateBodyInfo(value: BodyInfoSectionValue): Record<string, string[]> {
  const result = BodyInfoValidationSchema.safeParse(value);
  return result.success ? {} : toFieldErrors(result.error.issues);
}

export function BodyInfoSection({ value, onChange, errors = {} }: BodyInfoSectionProps) {
  const bodyFatErrors = errors.bodyFatPct ?? [];

  return (
    <section className="form-section" aria-labelledby="body-info-heading">
      <h3 id="body-info-heading">身体情報</h3>
      <p className="sec-sub">分かる範囲で入力すると、計算の精度が上がります（任意）。</p>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="body-fat-pct">体脂肪率</label>
          <div className="unit-row">
            <input
              type="number"
              id="body-fat-pct"
              step="0.1"
              value={value.bodyFatPct ?? ""}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                onChange("bodyFatPct", parseOptionalNumber(event.target.value))
              }
              aria-invalid={bodyFatErrors.length > 0}
              aria-describedby={bodyFatErrors.length > 0 ? "body-fat-pct-error" : undefined}
            />
            <span className="unit">%</span>
          </div>
          {bodyFatErrors.length > 0 && (
            <p id="body-fat-pct-error" role="alert" className="field-error">
              {bodyFatErrors.join(" ")}
            </p>
          )}
        </div>

        <div className="field wide">
          <span id="pregnancy-status-label">妊娠・授乳の状況</span>
          <div className="pill-group" role="radiogroup" aria-labelledby="pregnancy-status-label">
            {PREGNANCY_OPTIONS.map((option) => (
              <span key={option.value}>
                <input
                  type="radio"
                  name="pregnancy-status"
                  id={`pregnancy-status-${option.value}`}
                  checked={value.pregnancyStatus === option.value}
                  onChange={() => onChange("pregnancyStatus", option.value)}
                />
                <label htmlFor={`pregnancy-status-${option.value}`}>{option.label}</label>
              </span>
            ))}
          </div>
        </div>

        <div className="field wide">
          <label htmlFor="medical-notes">既往症・アレルギー・服薬情報</label>
          <textarea
            id="medical-notes"
            placeholder="例: 小麦アレルギー（軽度）"
            value={value.medicalNotes ?? ""}
            onChange={(event) => onChange("medicalNotes", event.target.value === "" ? null : event.target.value)}
          />
          <span className="hint">献立生成時にNG食材として考慮されます。</span>
        </div>
      </div>
    </section>
  );
}
