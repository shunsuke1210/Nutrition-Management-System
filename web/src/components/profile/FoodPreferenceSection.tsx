/**
 * 食の好み・NG食材セクション。
 *
 * mockup.html の「食の好み・NG食材」セクションに対応する（design.md: File Structure
 * Plan `components/profile/FoodPreferenceSection.tsx`）。NG食材一覧・好み食材一覧の
 * どちらも `IngredientChipList`（同ディレクトリ）を再利用して構成する（タスク4.3:
 * 「両リストで共通コンポーネントを再利用」）。`BasicInfoSection` 等（task 4.1/4.2）と
 * 同様に、自身の値・変更通知のみを責務とする独立したプレゼンテーションコンポーネント
 * として実装する。
 *
 * Requirements: 3.1（NG食材一覧の保持）, 3.2（好み食材一覧の保持）,
 * 3.3（食材名の追加）, 3.4（登録済み食材の削除）, 3.5（0件でも保存を許可）
 */
import { IngredientChipList } from "./IngredientChipList.js";

export interface FoodPreferenceSectionValue {
  ngIngredients: string[];
  preferredIngredients: string[];
}

export type FoodPreferenceField = keyof FoodPreferenceSectionValue;

export interface FoodPreferenceSectionProps {
  value: FoodPreferenceSectionValue;
  onChange: (field: FoodPreferenceField, value: string[]) => void;
}

export function FoodPreferenceSection({ value, onChange }: FoodPreferenceSectionProps) {
  return (
    <section className="form-section" aria-labelledby="food-preference-heading">
      <h3 id="food-preference-heading">食の好み・NG食材</h3>
      <p className="sec-sub">献立生成で避ける食材や、優先したい食材を登録できます。</p>
      <div className="field-grid">
        <IngredientChipList
          label="NG食材・苦手な食材"
          value={value.ngIngredients}
          onChange={(next) => onChange("ngIngredients", next)}
        />
        <IngredientChipList
          label="好きな食材・よく使ってほしい食材"
          value={value.preferredIngredients}
          onChange={(next) => onChange("preferredIngredients", next)}
        />
      </div>
    </section>
  );
}
