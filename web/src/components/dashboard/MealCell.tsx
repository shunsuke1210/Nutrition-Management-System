/**
 * 1食分の食事セル（`DayColumn`の各 `.meal-row` を構成する部品、task 4.2）。
 *
 * mockup.html の `.meal-row`（行689-692、`.meal-type` + `.dish.dish-link`）のマークアップ
 * 構造に対応する（design.md: File Structure Plan `components/dashboard/MealCell.tsx`）。
 * mockup.html自体は`<label for="recipe-modal">`によるCSSチェックボックスハックで
 * モーダル表示を模しているが、本実装ではこれを実際のReact制御コンポーネント（`<button>`+
 * `onClick`）に置き換える（`ModeToggle`/`PeriodToggle`等、本specで既に確立された規約に倣う）。
 *
 * 責務境界（Requirement 6.1）: 本コンポーネントは状態を持たない純粋なプレゼンテーション
 * コンポーネントであり、クリック時に既に解決済みの`onClick`を呼ぶだけで、
 * レシピ詳細モーダルの表示制御・`mealSlotClient`の呼び出しは一切行わない（それらは親の
 * `WeeklyMenuSection`/`RecipeDetailModal`の責務）。
 *
 * スコープ外: mockup.htmlの`.badge-tag`/`.demo-badge`は`MealSlot`に対応するデータフィールドが
 * 存在しないため実装しない。
 *
 * Requirements: 6.1
 */
import type { JSX } from "react";
import type { MealType } from "@nutrition/shared";

export interface MealCellProps {
  mealType: MealType;
  dishName: string;
  onClick: () => void;
}

// DayColumn.tsxのMEAL_TYPE_ROWSと同じ4値を意図的に複製している（このリポジトリのこのspec内で
// 確立された、コンポーネントごとの小さなローカルラベルマップの複製という慣行に倣う）。
const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: "朝食",
  lunch: "昼食",
  dinner: "夕食",
  snack: "間食",
};

export function MealCell({ mealType, dishName, onClick }: MealCellProps): JSX.Element {
  return (
    <div className="meal-row">
      <div className="meal-type">{MEAL_TYPE_LABELS[mealType]}</div>
      <button type="button" className="dish dish-link" onClick={onClick}>
        {dishName}
      </button>
    </div>
  );
}
