/**
 * 食事制限設定セクション（タイプ・強度・自由記述）。
 *
 * mockup.html の「食事制限設定」セクションのレイアウトに対応する（design.md:
 * File Structure Plan `components/profile/DietRestrictionSection.tsx`）。
 * `BasicInfoSection` 等（task 4.1/4.2）と同様に、自身の値・変更通知・エラー表示のみを
 * 責務とする独立したプレゼンテーションコンポーネントとして実装する。
 *
 * Requirements: 5.1（制限タイプの単一選択）, 5.2（制限強度の単一選択）,
 * 5.3（タイプが「制限なし」以外のとき強度を必須とする）,
 * 5.4（タイプが「制限なし」のとき強度未選択でも保存を許可する）,
 * 5.5（自由記述欄は任意入力）
 */
import {
  ProfileSchema,
  RestrictionIntensitySchema,
  RestrictionTypeSchema,
  type RestrictionIntensity,
  type RestrictionType,
} from "@nutrition/shared";

export interface DietRestrictionSectionValue {
  restrictionType: RestrictionType | null;
  restrictionIntensity: RestrictionIntensity | null;
  restrictionNotes: string | null;
}

export type DietRestrictionField = keyof DietRestrictionSectionValue;

export interface DietRestrictionSectionProps {
  value: DietRestrictionSectionValue;
  onChange: (field: DietRestrictionField, value: DietRestrictionSectionValue[DietRestrictionField]) => void;
  /** フィールド名 → エラーメッセージ一覧（design.md: ValidationError.fieldErrors と同じ形） */
  errors?: Record<string, string[]>;
}

// 選択肢の値集合は各Schemaの `.options`（`@nutrition/shared`）から取得し、
// ハードコードしない（Requirements 5.1, 5.2）。ラベルのみ表示用に手動で対応付ける。
const RESTRICTION_TYPE_LABELS: Record<RestrictionType, string> = {
  none: "制限なし",
  low_carb: "糖質制限",
  low_fat: "脂質制限",
  high_protein: "高たんぱく",
  calorie_only: "カロリー制限のみ",
};

const RESTRICTION_TYPE_OPTIONS: ReadonlyArray<{ value: RestrictionType; label: string }> =
  RestrictionTypeSchema.options.map((value) => ({ value, label: RESTRICTION_TYPE_LABELS[value] }));

const RESTRICTION_INTENSITY_LABELS: Record<RestrictionIntensity, string> = {
  light: "ゆるやか",
  standard: "標準",
  strict: "しっかり",
};

const RESTRICTION_INTENSITY_OPTIONS: ReadonlyArray<{ value: RestrictionIntensity; label: string }> =
  RestrictionIntensitySchema.options.map((value) => ({ value, label: RESTRICTION_INTENSITY_LABELS[value] }));

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
 *
 * このスキーマ単体では「タイプが『制限なし』以外のとき強度必須」という
 * クロスフィールド条件（Requirement 5.3, 5.4）は表現できない —
 * `ProfileSchema` はこの条件付きルールを持たない素の `ZodObject` であり、
 * その条件は `ProfileInputSchema.superRefine` にのみ存在する。しかし
 * `ProfileInputSchema` は他の無関係なフィールド（`jobActivityLevel` 等）も
 * 必須とする全フィールド結合スキーマのため、このセクション単体の検証には使えない。
 * そのため、このクロスフィールド条件のみ `validateDietRestriction`内でローカルに
 * 手動チェックする（レンジ/必須ルールの重複ではなく、`.pick` で表現不可能な
 * 条件付きルールであるための正当なケース）。
 */
const DietRestrictionValidationSchema = ProfileSchema.pick({
  restrictionType: true,
  restrictionIntensity: true,
  restrictionNotes: true,
});

/**
 * `DietRestrictionSectionValue` に対する検証（Requirements 5.1-5.5）。
 *
 * design.md の Domain: UI Implementation Note に従い、`shared` パッケージの Zod
 * スキーマ（`ProfileSchema` の部分スキーマ）を基本ルール（選択肢の妥当性等）として
 * 再利用し、`.pick` で表現できないクロスフィールド条件（5.3, 5.4）のみ追加でチェックする。
 */
export function validateDietRestriction(value: DietRestrictionSectionValue): Record<string, string[]> {
  const result = DietRestrictionValidationSchema.safeParse(value);
  const fieldErrors = result.success ? {} : toFieldErrors(result.error.issues);

  // Requirement 5.3: タイプが「制限なし」以外に設定された場合、強度の選択を必須とする。
  // タイプが未選択（null）の場合は、restrictionType 自体のエラー（上記の pick 検証）に
  // 委ね、ここでは強度必須を追加しない。
  if (
    value.restrictionType !== null &&
    value.restrictionType !== "none" &&
    value.restrictionIntensity === null
  ) {
    const messages = fieldErrors.restrictionIntensity ?? (fieldErrors.restrictionIntensity = []);
    messages.push("restrictionType が「制限なし」以外の場合、restrictionIntensity は必須です。");
  }

  return fieldErrors;
}

export function DietRestrictionSection({ value, onChange, errors = {} }: DietRestrictionSectionProps) {
  const restrictionTypeErrors = errors.restrictionType ?? [];
  const restrictionIntensityErrors = errors.restrictionIntensity ?? [];
  const intensityRequired = value.restrictionType !== null && value.restrictionType !== "none";

  return (
    <section className="form-section" aria-labelledby="diet-restriction-heading">
      <h3 id="diet-restriction-heading">食事制限設定</h3>
      <p className="sec-sub">ダイエット向け献立の方向性に反映されます。</p>
      <div className="field-grid">
        <div className="field wide">
          <span id="restriction-type-label">制限のタイプ</span>
          <div className="pill-group" role="radiogroup" aria-labelledby="restriction-type-label">
            {RESTRICTION_TYPE_OPTIONS.map((option) => (
              <span key={option.value}>
                <input
                  type="radio"
                  name="restriction-type"
                  id={`restriction-type-${option.value}`}
                  checked={value.restrictionType === option.value}
                  onChange={() => onChange("restrictionType", option.value)}
                />
                <label htmlFor={`restriction-type-${option.value}`}>{option.label}</label>
              </span>
            ))}
          </div>
          {restrictionTypeErrors.length > 0 && (
            <p id="restriction-type-error" role="alert" className="field-error">
              {restrictionTypeErrors.join(" ")}
            </p>
          )}
        </div>

        <div className="field wide">
          <span id="restriction-intensity-label">制限の強度</span>
          {intensityRequired && <span className="required-mark">必須</span>}
          <div className="pill-group" role="radiogroup" aria-labelledby="restriction-intensity-label">
            {RESTRICTION_INTENSITY_OPTIONS.map((option) => (
              <span key={option.value}>
                <input
                  type="radio"
                  name="restriction-intensity"
                  id={`restriction-intensity-${option.value}`}
                  checked={value.restrictionIntensity === option.value}
                  onChange={() => onChange("restrictionIntensity", option.value)}
                />
                <label htmlFor={`restriction-intensity-${option.value}`}>{option.label}</label>
              </span>
            ))}
          </div>
          <span className="hint">「制限なし」を選んだ場合、強度の指定は不要です。</span>
          {restrictionIntensityErrors.length > 0 && (
            <p id="restriction-intensity-error" role="alert" className="field-error">
              {restrictionIntensityErrors.join(" ")}
            </p>
          )}
        </div>

        <div className="field wide">
          <label htmlFor="restriction-notes">その他の食事制限・献立への要望（自由記述）</label>
          <textarea
            id="restriction-notes"
            placeholder='例：「16時以降の糖質を控えたい」'
            value={value.restrictionNotes ?? ""}
            onChange={(event) =>
              onChange("restrictionNotes", event.target.value === "" ? null : event.target.value)
            }
          />
          <span className="hint">
            献立生成時にAIへの参考情報として渡されます。「制限なし」を選んだ場合でも、献立に関しての希望があれば入力してください。
          </span>
        </div>
      </div>
    </section>
  );
}
