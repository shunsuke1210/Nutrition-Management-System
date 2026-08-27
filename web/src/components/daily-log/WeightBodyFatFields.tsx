/**
 * 体重・体脂肪率の日次入力欄（「今日の記録」パネル）。
 *
 * mockup.html の「今日の記録」サイドバーカード（`.sidebar-card`）内、体重・体脂肪率の
 * `.log-field` 2行に対応する（design.md: File Structure Plan
 * `components/daily-log/WeightBodyFatFields.tsx`）。`DailyLogPanel`（task 5.3）が
 * まだ存在しないため、`BasicInfoSection`/`BodyInfoSection`（task 4.1）と同様に、自身の
 * 値・変更通知・エラー表示のみを責務とする独立したプレゼンテーションコンポーネント
 * として実装する。
 *
 * Requirements: 8.1（日付ごとに体重の記録を1件保持）, 8.2（体脂肪率は任意項目）,
 * 8.5（体重に0以下の値、体脂肪率に0%未満・100%超の値が入力された場合は入力を拒否し
 * エラーを提示する）
 */
import type { ChangeEvent } from "react";
import { DailyLogInputSchema } from "@nutrition/shared";

export interface WeightBodyFatFieldsValue {
  weightKg: number | null;
  bodyFatPct: number | null;
}

export type WeightBodyFatField = keyof WeightBodyFatFieldsValue;

export interface WeightBodyFatFieldsProps {
  value: WeightBodyFatFieldsValue;
  onChange: (field: WeightBodyFatField, value: WeightBodyFatFieldsValue[WeightBodyFatField]) => void;
  /** フィールド名 → エラーメッセージ一覧（design.md: ValidationError.fieldErrors と同じ形） */
  errors?: Record<string, string[]>;
}

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
 * `DailyLogInputSchema`（`@nutrition/shared`）からこのコンポーネントが担当する2フィールド
 * だけを `.pick` した部分スキーマ。
 *
 * `DailyLogInputSchema` は `ProfileInputSchema` と異なり、フィールド間の条件付き必須
 * （例: ダイエットモード有効時のみ目標体重が必須）を持たない素の `ZodObject`
 * （`.superRefine`/`.refine` を含まない）である。そのため `ProfileSchema` /
 * `ProfileInputSchema` のような「素のオブジェクト版」と「条件付き必須込みの版」への
 * スキーマの分割は不要で、`DailyLogInputSchema` をそのまま `.pick` できる。
 */
const WeightBodyFatValidationSchema = DailyLogInputSchema.pick({
  weightKg: true,
  bodyFatPct: true,
});

/**
 * `WeightBodyFatFieldsValue` に対するレンジ検証（Requirement 8.5）。
 *
 * `weightKg` は `DailyLogInputSchema` 上 `z.number().positive().optional()`
 * （`bodyFatPct` と異なり `.nullable()` ではない）。日次ログの部分更新
 * （design.md: `upsertLog` は未指定フィールドを既存値のまま保持する）では
 * 「未指定 = このフィールドを更新しない」を意味し、必須項目ではない。本コンポーネントは
 * 未入力状態を（`BasicInfoSection` 等、他セクション同様）UI上の空欄として `null` で
 * 表現するため、バリデーション呼び出し直前にのみ `weightKg` の `null → undefined`
 * の橋渡しを行う。これはレンジ判定ロジックの再実装ではなく、UIの「空欄」表現とスキーマの
 * 「未指定（optional）」表現の差異を吸収するアダプタである。`bodyFatPct` はスキーマ側で
 * 既に `.nullable()` のため、この変換は不要（Requirement 8.2: 体脂肪率は任意項目）。
 */
export function validateWeightBodyFat(value: WeightBodyFatFieldsValue): Record<string, string[]> {
  const result = WeightBodyFatValidationSchema.safeParse({
    weightKg: value.weightKg ?? undefined,
    bodyFatPct: value.bodyFatPct,
  });
  return result.success ? {} : toFieldErrors(result.error.issues);
}

export function WeightBodyFatFields({ value, onChange, errors = {} }: WeightBodyFatFieldsProps) {
  const weightErrors = errors.weightKg ?? [];
  const bodyFatErrors = errors.bodyFatPct ?? [];

  const handleNumberChange = (field: WeightBodyFatField) => (event: ChangeEvent<HTMLInputElement>) => {
    onChange(field, parseOptionalNumber(event.target.value));
  };

  return (
    <div className="weight-body-fat-fields">
      <div className="log-field">
        <label htmlFor="log-weight" className="l-label">
          体重
        </label>
        <input
          type="number"
          id="log-weight"
          step="0.1"
          value={value.weightKg ?? ""}
          onChange={handleNumberChange("weightKg")}
          aria-invalid={weightErrors.length > 0}
          aria-describedby={weightErrors.length > 0 ? "log-weight-error" : undefined}
        />
      </div>
      {weightErrors.length > 0 && (
        <p id="log-weight-error" role="alert" className="field-error">
          {weightErrors.join(" ")}
        </p>
      )}

      <div className="log-field">
        <label htmlFor="log-body-fat" className="l-label">
          体脂肪率
        </label>
        <input
          type="number"
          id="log-body-fat"
          step="0.1"
          value={value.bodyFatPct ?? ""}
          onChange={handleNumberChange("bodyFatPct")}
          aria-invalid={bodyFatErrors.length > 0}
          aria-describedby={bodyFatErrors.length > 0 ? "log-body-fat-error" : undefined}
        />
      </div>
      {bodyFatErrors.length > 0 && (
        <p id="log-body-fat-error" role="alert" className="field-error">
          {bodyFatErrors.join(" ")}
        </p>
      )}
    </div>
  );
}
