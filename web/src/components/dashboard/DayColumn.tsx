/**
 * 1週間のおすすめ献立セクション（`WeeklyMenuSection`, task 4.1）内の、1曜日分の献立カード。
 *
 * mockup.html の `.day-col`（行684-693ほか、`.day-head` > `.day-head-top`（`.name`/`.kcal`）+
 * `.regen-btn`、および朝食/昼食/夕食/間食の4件の `.meal-row`）のマークアップ構造に対応する
 * （design.md: File Structure Plan `components/dashboard/DayColumn.tsx`）。
 *
 * 責務境界（Requirements 4.3, 5.2, 5.4, 5.5, 5.6）: 本コンポーネントは既に解決済みの
 * `DayMenu`と、日単位差し替えの進行状況・禁止状態・直近の失敗メッセージのみをpropsで受け取る、
 * 状態を持たない・ネットワーク呼び出しを一切行わない純粋なプレゼンテーションコンポーネントで
 * ある。差し替えボタン押下時は、既に自分の`dayIndex`に束縛済みの`onRegenerate`を呼ぶだけで、
 * `menuPlanClient.regenerateDay`の呼び出し・ロック状態・エラー状態の管理は一切行わない
 * （それらはすべて親の`WeeklyMenuSection`の責務）。
 *
 * 曜日ラベル（Requirement 4.3）: menu-generation設計（design.md 行628）により
 * `weekStartDate`は月曜始まりで、`dayIndex` 0-6は月/火/水/木/金/土/日の固定順に対応する
 * （mockup.html 行684-753の曜日カードの並び順・単一文字ラベルと一致）。
 *
 * 食事の表示順（Requirement 4.3）: `DayMenu.meals`は`.length(4)`のみをスキーマで保証し、
 * 配列内の並び順は保証しない（`shared/src/menu.schema.ts`のコメント参照）。そのため
 * 表示順は固定の朝食/昼食/夕食/間食の順に`meals.find(m => m.mealType === type)`で
 * 都度検索して決定し、配列のインデックス順をそのまま信用しない。
 *
 * 食事セルのクリック（task 4.2, Requirement 6.1）: 各食事行は`MealCell`に委譲する。
 * `MealCell`自身の`.meal-row`/`.dish.dish-link`のマークアップ・クリックによる`onMealClick`
 * 呼び出しの実装はそちらの責務であり、`DayColumn`はここでも「既に自分のmealTypeに束縛済みの
 * コールバックを呼ぶだけ」という`onRegenerate`と同じ薄い委譲方針を保つ（レシピ詳細モーダルの
 * 表示制御・`mealSlotClient`の呼び出しは一切行わない。それらは`WeeklyMenuSection`/
 * `RecipeDetailModal`、いずれも本コンポーネントの外側の責務）。
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 17.4
 */
import type { JSX } from "react";
import type { DayMenu, MealType } from "@nutrition/shared";
import { MealCell } from "./MealCell.js";

export interface DayColumnProps {
  day: DayMenu;
  /** このカードの日単位差し替えが現在進行中か。 */
  isRegenerating: boolean;
  /** 週全体または他の曜日の差し替えが進行中で、このカードの操作も禁止すべきか。 */
  disabled: boolean;
  /** 直近のこのカードの差し替え失敗メッセージ。ない場合は null。 */
  errorMessage: string | null;
  /** 差し替えボタン押下時に呼ぶ、既に自分のdayIndexに束縛済みのコールバック。 */
  onRegenerate: () => void;
  /** 食事セルクリック時に呼ぶ、対象のmealTypeを渡すコールバック（Requirement 6.1）。 */
  onMealClick: (mealType: MealType) => void;
}

// menu-generation設計（design.md 行628）: weekStartDateは月曜始まり。dayIndex 0-6は
// この固定順（月/火/水/木/金/土/日）に対応し、mockup.html 行684-753の並びと一致する。
const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

// mockup.html (行689-692ほか) の表示順そのまま。日本語ラベル自体は`MealCell`が保持するため、
// ここでは表示順を決めるmealTypeのキー列挙のみを持つ。
const MEAL_TYPE_ROWS: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

const REGEN_BUTTON_LABEL = "差し替え";
const PROCESSING_LABEL = "処理中…";

/** kcal表示用の整数丸め+桁区切り（NutritionSummarySection.tsxのformatKcalと同じ規約）。 */
function formatKcal(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function DayColumn({
  day,
  isRegenerating,
  disabled,
  errorMessage,
  onRegenerate,
  onMealClick,
}: DayColumnProps): JSX.Element {
  const isDisabled = disabled || isRegenerating;

  return (
    <div className="day-col">
      <div className="day-head">
        <div className="day-head-top">
          <span className="name">{WEEKDAY_LABELS[day.dayIndex]}</span>
          <span className="kcal">{formatKcal(day.plannedKcal)}kcal</span>
        </div>
        <button
          type="button"
          className="regen-btn"
          disabled={isDisabled}
          aria-disabled={isDisabled}
          onClick={() => {
            // ネイティブのdisabled属性でクリックイベント自体がReactに届かないケースを
            // 前提としつつ、意図を明示するため二重にガードする（PeriodToggle/ModeToggleと
            // 同じ方針）。
            if (isDisabled) {
              return;
            }
            onRegenerate();
          }}
        >
          {isRegenerating ? PROCESSING_LABEL : REGEN_BUTTON_LABEL}
        </button>
      </div>
      {errorMessage !== null && <p className="day-regen-error">{errorMessage}</p>}
      {MEAL_TYPE_ROWS.map((key) => {
        const meal = day.meals.find((candidate) => candidate.mealType === key);
        return (
          <MealCell
            key={key}
            mealType={key}
            dishName={meal?.dishName ?? ""}
            onClick={() => onMealClick(key)}
          />
        );
      })}
    </div>
  );
}
