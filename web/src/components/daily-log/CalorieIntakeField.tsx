/**
 * 摂取カロリー実績の表示・手動上書き欄（「今日の記録」パネル）。
 *
 * mockup.html の「今日の記録」サイドバーカード（`.sidebar-card`）内、摂取カロリーの
 * `.log-field`（自動反映値 `.auto-val` + 「実際と違う場合は修正」ボタン）に対応する
 * （design.md: File Structure Plan `components/daily-log/CalorieIntakeField.tsx`）。
 * `DailyLogPanel`（task 5.3）がまだ存在しないため、`WeightBodyFatFields`（本タスク）と
 * 同様に、自身の値・変更通知・エラー表示のみを責務とする独立したプレゼンテーション
 * コンポーネントとして実装する。
 *
 * design.md の「摂取カロリー実績のハイブリッド解決フロー」（`manualOverrideKcal` が
 * 存在すればそれを優先、なければ `plannedKcal`、いずれも無ければ未記録）に従い、
 * `calorieIntakeSource`（`@nutrition/shared` の `DailyLogEntry.calorieIntakeSource`）で
 * 表示モードを切り替える。
 *
 * タスクの観測可能な完了条件: 手動上書きを行っていない状態では計画kcalの値が
 * 「献立通り」等のタグ付きで表示され、上書き操作（「実際と違う場合は修正」ボタン）後は
 * 入力した値が表示される。
 *
 * Requirements: 9.1（手動上書き値が無い場合は計画献立kcalを既定値として扱う）,
 * 9.2（手動入力・修正した場合はその値を摂取カロリー実績として保存する）,
 * 9.4（摂取カロリー実績に負数が入力された場合は入力を拒否しエラーを提示する）
 */
import { useState, type ChangeEvent } from "react";
import { DailyLogInputSchema, type CalorieIntakeSource } from "@nutrition/shared";

export interface CalorieIntakeFieldValue {
  plannedKcal: number | null;
  manualOverrideKcal: number | null;
  calorieIntakeSource: CalorieIntakeSource;
}

export interface CalorieIntakeFieldProps {
  value: CalorieIntakeFieldValue;
  /** 手動上書き入力欄への変更を通知する（`null` は空欄への変更、上書き解除の意図を表す）。 */
  onChange: (manualOverrideKcal: number | null) => void;
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
 * `DailyLogInputSchema`（`@nutrition/shared`）からこのコンポーネントが担当する
 * `manualOverrideKcal` 1フィールドだけを `.pick` した部分スキーマ
 * （`WeightBodyFatFields.tsx` と同じ理由により、`DailyLogInputSchema` は素の
 * `ZodObject` のためそのまま `.pick` できる）。
 */
const CalorieIntakeValidationSchema = DailyLogInputSchema.pick({
  manualOverrideKcal: true,
});

/**
 * 手動上書き値に対するレンジ検証（Requirement 9.4: 負数を拒否）。
 *
 * `manualOverrideKcal` はスキーマ上 `z.number().min(0).nullable().optional()` であり、
 * `null`（上書き解除）を許容する。design.md の Domain: UI Implementation Note に従い、
 * `shared` パッケージの Zod スキーマをそのまま再利用し、レンジ判定を手動で再実装しない。
 */
export function validateCalorieIntake(manualOverrideKcal: number | null): Record<string, string[]> {
  const result = CalorieIntakeValidationSchema.safeParse({ manualOverrideKcal });
  return result.success ? {} : toFieldErrors(result.error.issues);
}

function formatKcal(kcal: number): string {
  return `${kcal.toLocaleString("ja-JP")}kcal`;
}

export function CalorieIntakeField({ value, onChange, errors = {} }: CalorieIntakeFieldProps) {
  // 表示モード（自動表示 or 手動上書き入力欄）はUI操作でのみ切り替わるローカル状態。
  // 初期値は `calorieIntakeSource === "manual"`（既に手動上書きが保存済みの日付を開いた
  // 場合は最初から入力欄を表示する）に従う（タスクの完了条件、Requirement 9.2）。
  const [isOverriding, setIsOverriding] = useState(() => value.calorieIntakeSource === "manual");
  const overrideErrors = errors.manualOverrideKcal ?? [];

  const handleOverrideChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(parseOptionalNumber(event.target.value));
  };

  return (
    <div className="calorie-intake-field">
      <div className="log-field">
        <span className="l-label">摂取カロリー</span>
        {isOverriding ? (
          <input
            type="number"
            aria-label="摂取カロリー"
            value={value.manualOverrideKcal ?? ""}
            onChange={handleOverrideChange}
            aria-invalid={overrideErrors.length > 0}
            aria-describedby={overrideErrors.length > 0 ? "calorie-override-error" : undefined}
          />
        ) : (
          <div className="auto-val">
            <span className="v">{value.plannedKcal !== null ? formatKcal(value.plannedKcal) : "未記録"}</span>
            {value.plannedKcal !== null && <span className="auto-tag">献立通り</span>}
          </div>
        )}
      </div>
      {overrideErrors.length > 0 && (
        <p id="calorie-override-error" role="alert" className="field-error">
          {overrideErrors.join(" ")}
        </p>
      )}
      {!isOverriding && (
        <div style={{ textAlign: "right" }}>
          <button type="button" className="btn-ghost" onClick={() => setIsOverriding(true)}>
            実際と違う場合は修正
          </button>
        </div>
      )}
    </div>
  );
}
