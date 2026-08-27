/**
 * ダイエットモード設定セクション（トグル・目標体重・目標達成期間）。
 *
 * mockup.html の「ダイエットモードを利用する」トグルセクションのレイアウトに対応する
 * （design.md: File Structure Plan `components/profile/DietModeSection.tsx`）。
 * `BasicInfoSection` 等（task 4.1/4.2）と同様に、自身の値・変更通知・エラー表示のみを
 * 責務とする独立したプレゼンテーションコンポーネントとして実装する。
 *
 * タスクの観測可能な完了条件: ダイエットモードのトグルをオンにすると目標体重・目標
 * 達成期間の入力欄が表示され、オフにすると非表示になる。目標フィールドは
 * `dietModeEnabled` が true のときのみレンダリングする。
 *
 * Requirements: 6.1（ダイエットモードの有効/無効の切り替え）,
 * 6.2（有効時は目標体重・目標達成期間を必須とする）,
 * 6.3（無効時は目標体重・目標達成期間の入力を不要とする）,
 * 6.4（有効時に目標体重・目標達成期間へ0以下の値が入力された場合は拒否する）
 */
import type { ChangeEvent } from "react";
import { ProfileSchema } from "@nutrition/shared";

export interface DietModeSectionValue {
  dietModeEnabled: boolean;
  goalWeightKg: number | null;
  goalPeriodWeeks: number | null;
}

export type DietModeField = keyof DietModeSectionValue;

export interface DietModeSectionProps {
  value: DietModeSectionValue;
  onChange: (field: DietModeField, value: DietModeSectionValue[DietModeField]) => void;
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
 * `ProfileSchema`（`@nutrition/shared`）からこのセクションが担当する3フィールドだけを
 * `.pick` した部分スキーマ。`goalWeightKg`/`goalPeriodWeeks` は `ProfileSchema` 上も
 * `z.number().positive().nullable()` のため、値が指定されている限り常に正数であることを
 * 要求する（Requirement 6.4 のレンジ検証を、`dietModeEnabled` の値にかかわらず
 * 一貫して再利用できる）。`BasicInfoSection.tsx` と同じ理由（`ProfileInputSchema` は
 * `.superRefine` を含む `ZodEffects` のため `.pick` できない）により `ProfileSchema`
 * （素の `ZodObject`）から部分スキーマを取り出して再利用する。
 *
 * このスキーマ単体では「`dietModeEnabled` が true のとき必須」というクロスフィールド
 * 条件（Requirement 6.2, 6.3）は表現できない — その条件は `ProfileInputSchema.superRefine`
 * にのみ存在し、そちらは他の無関係なフィールドも必須とする全フィールド結合スキーマの
 * ため、このセクション単体の検証には使えない。そのためこのクロスフィールド条件のみ
 * `validateDietMode` 内でローカルに手動チェックする（レンジ/必須ルールの重複ではなく、
 * `.pick` で表現不可能な条件付きルールであるための正当なケース）。
 */
const DietModeValidationSchema = ProfileSchema.pick({
  dietModeEnabled: true,
  goalWeightKg: true,
  goalPeriodWeeks: true,
});

/**
 * `DietModeSectionValue` に対する検証（Requirements 6.1-6.4）。
 *
 * design.md の Domain: UI Implementation Note に従い、`shared` パッケージの Zod
 * スキーマ（`ProfileSchema` の部分スキーマ）を基本ルール（正数チェック）として再利用し、
 * `.pick` で表現できないクロスフィールド条件（6.2, 6.3）のみ追加でチェックする。
 */
export function validateDietMode(value: DietModeSectionValue): Record<string, string[]> {
  const result = DietModeValidationSchema.safeParse(value);
  const fieldErrors = result.success ? {} : toFieldErrors(result.error.issues);

  // Requirement 6.2, 6.3: dietModeEnabled が true のときのみ目標体重・目標達成期間を
  // 必須とする。false のときは（別途 .pick 済みのレンジ検証以外の）追加の必須チェックを
  // 行わない。
  if (value.dietModeEnabled) {
    if (value.goalWeightKg === null) {
      const messages = fieldErrors.goalWeightKg ?? (fieldErrors.goalWeightKg = []);
      messages.push("dietModeEnabled が true の場合、goalWeightKg は必須です。");
    }
    if (value.goalPeriodWeeks === null) {
      const messages = fieldErrors.goalPeriodWeeks ?? (fieldErrors.goalPeriodWeeks = []);
      messages.push("dietModeEnabled が true の場合、goalPeriodWeeks は必須です。");
    }
  }

  return fieldErrors;
}

export function DietModeSection({ value, onChange, errors = {} }: DietModeSectionProps) {
  const goalWeightErrors = errors.goalWeightKg ?? [];
  const goalPeriodErrors = errors.goalPeriodWeeks ?? [];

  return (
    <section className="form-section" aria-labelledby="diet-mode-heading">
      <div className="toggle-row">
        <div>
          <div className="t-title" id="diet-mode-heading">
            ダイエットモードを利用する
          </div>
          <div className="t-desc">目標体重・目標期間を設定すると、ダイエット状況画面が利用できます。</div>
        </div>
        <input
          type="checkbox"
          id="diet-mode-toggle"
          aria-label="ダイエットモードを利用する"
          checked={value.dietModeEnabled}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange("dietModeEnabled", event.target.checked)}
          style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
        />
        <label htmlFor="diet-mode-toggle" className="switch-label"></label>
      </div>

      {value.dietModeEnabled && (
        <div className="diet-goal-fields" style={{ display: "grid" }}>
          <div className="field">
            <label htmlFor="goal-weight">目標体重</label>
            <div className="unit-row">
              <input
                type="number"
                id="goal-weight"
                step="0.1"
                value={value.goalWeightKg ?? ""}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  onChange("goalWeightKg", parseOptionalNumber(event.target.value))
                }
                aria-invalid={goalWeightErrors.length > 0}
                aria-describedby={goalWeightErrors.length > 0 ? "goal-weight-error" : undefined}
              />
              <span className="unit">kg</span>
            </div>
            {goalWeightErrors.length > 0 && (
              <p id="goal-weight-error" role="alert" className="field-error">
                {goalWeightErrors.join(" ")}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="goal-period">目標達成期間</label>
            <div className="unit-row">
              <input
                type="number"
                id="goal-period"
                value={value.goalPeriodWeeks ?? ""}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  onChange("goalPeriodWeeks", parseOptionalNumber(event.target.value))
                }
                aria-invalid={goalPeriodErrors.length > 0}
                aria-describedby={goalPeriodErrors.length > 0 ? "goal-period-error" : undefined}
              />
              <span className="unit">週間</span>
            </div>
            <span className="hint">安全なペースを超える設定には警告が表示されます。</span>
            {goalPeriodErrors.length > 0 && (
              <p id="goal-period-error" role="alert" className="field-error">
                {goalPeriodErrors.join(" ")}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
