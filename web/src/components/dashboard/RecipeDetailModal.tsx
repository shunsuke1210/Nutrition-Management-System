/**
 * レシピ詳細モーダル（task 4.2）。
 *
 * mockup.html の `.modal-overlay` > `.modal-backdrop` + `.modal-panel`
 * （role="dialog" aria-label="レシピ詳細"、行996-1035）のマークアップ構造に対応する
 * （design.md: File Structure Plan `components/dashboard/RecipeDetailModal.tsx`）。
 * mockup.html自体は`<label for="recipe-modal">`によるCSSチェックボックスハックでモーダルの
 * 開閉を模しているが、本実装ではこれを実際のReact制御コンポーネント（`<button>`+`onClick`）に
 * 置き換える（`ModeToggle`/`PeriodToggle`/`MealCell`等、本specで既に確立された規約に倣う）。
 *
 * 責務境界（design.md Traceability table、Requirement 6.1, 8.1「オンデマンド」）:
 * 他のセクションコンポーネント（`NutritionSummarySection`等、`DashboardPage`が解決済みの
 * データをpropsで受け取るだけ）と異なり、design.mdのTraceability tableは
 * `mealSlotClient.generateRecipeDetail`を本コンポーネントに割り当てている。週間献立の
 * 28食枠すべてのレシピ詳細を事前に取得するのは要件8.1のオンデマンド生成方針に反し無駄が
 * 大きいため、食事セルクリックでモーダルが開いたタイミングで`generateRecipeDetail`を
 * 都度直接呼び出す。
 *
 * `useAsyncData`アダプタ（`useAsyncData.ts`のdocコメント参照）: `generateRecipeDetail`は
 * `Result<RecipeDetail, ApiError>`を解決し、決して例外を投げない。`useAsyncData`はfetch関数の
 * Promiseがrejectすることを前提とするため、本コンポーネントは自前で`Result`をアンラップし、
 * 失敗時は`result.error`をそのまま（`new Error(...)`でラップせず）throwすることで橋渡しする。
 * これにより`useAsyncData`の`error`フィールドには上流spec固有の`ApiError`がそのまま入る。
 *
 * `FeedbackControl`の埋め込み（task 4.3、Requirement 7.1-7.4）: 成功時コンテンツ
 * （`.extra-suggest`の直後、design.md Components table「材料・手順・カロリー・追加副菜提案・
 * FeedbackControlの表示」の記載順どおり最後）に`<FeedbackControl>`を配置する。
 * `key={`${weekStartDate}-${dayIndex}-${mealType}`}` を明示的に指定している。
 * `WeeklyMenuSection`の`selectedMeal`は`null`を経由せず別の食事枠へ直接遷移できるため
 * （本ファイル末尾の`re-fetches with new arguments when dayIndex/mealType props change`
 * テストが検証する挙動）、本コンポーネント自身はアンマウント/再マウントされず
 * `dayIndex`/`mealType`のみが新しいpropsとして渡ってくる。
 *
 * 実装時の検証で判明した点（正直な記録として残す）: 本コンポーネントは成功時コンテンツ全体を
 * `!isLoading && error === null && data !== null` の条件でゲートしており、`useAsyncData`の
 * `deps`（`weekStartDate`/`dayIndex`/`mealType`）が変わるたびに内部の`useEffect`が
 * 無条件に`setIsLoading(true)`を同期的に呼ぶ（`useAsyncData.ts`参照）。そのため実際には、
 * 食事枠が切り替わるたびにこの条件分岐自体がいったん`false`になり、`FeedbackControl`を含む
 * 成功時コンテンツ全体が新しいデータ取得の完了を待つ間、一度完全にアンマウントされてから
 * 再マウントされる（`key`の有無に関わらず、この一時的なローディング表示への切り替わりだけで
 * 既に新しいコンポーネントインスタンスが生成される）。つまり本コンポーネントの現在の実装では、
 * この`key`は「このモーダルが実際に辿る画面遷移」に対しては冗長である（`key`を外しても
 * 本ファイルの回帰テストは通る。ライブミューテーションテストで実測済み）。
 * それでもなお本タスクの解決済み設計判断としてこの`key`を維持する。理由: (1)
 * 将来ローディング中に直前のデータを表示し続ける方式（stale-while-revalidate的な変更）に
 * 移行した場合、この条件分岐によるアンマウントが起きなくなり、`key`が唯一の防御線になる、
 * (2) 明示的な`key`は「食事枠ごとに独立したフィードバック状態を持つ」という意図を
 * コードとして残せる、(3) 副作用がなく無害である。したがって`key`の実際のメカニズム自体
 * （同じ位置に別の`key`を持つ要素が来ると必ず再マウントされる、というReactの一般的な保証）は
 * `FeedbackControl.test.tsx`側で本コンポーネント/`useAsyncData`のローディングゲートとは
 * 独立した形で直接検証している（そちらを参照）。
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4
 */
import type { JSX } from "react";
import type { IsoDate, MealType, NutritionValues, RecipeDetail } from "@nutrition/shared";
import { generateRecipeDetail } from "../../api/mealSlotClient.js";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { FeedbackControl } from "./FeedbackControl.js";

export interface RecipeDetailModalProps {
  weekStartDate: IsoDate;
  dayIndex: number;
  mealType: MealType;
  /** 生成完了を待たず即座にヘッダー(h3)へ表示する、既に確定済みの料理名。 */
  dishName: string;
  onClose: () => void;
}

// mockup.html (行1001)の表示形式「月曜・昼食」に対応する、月曜始まりの完全形曜日ラベル。
// DayColumn.tsxのWEEKDAY_LABELS（単一文字の略称、「月」「火」…）とは表示形式が異なる別個の
// 局所定数であり、意図的に複製している（menu-generation設計の「dayIndex 0-6は月曜始まりの
// 固定順」という同一の前提に基づく、DayColumn.tsxとは独立したローカル定数）。
const WEEKDAY_FULL_LABELS = ["月曜", "火曜", "水曜", "木曜", "金曜", "土曜", "日曜"];

// MealCell.tsxのMEAL_TYPE_LABELSと同じ4値を意図的に複製している（このリポジトリのこのspec内で
// 確立された、コンポーネントごとの小さなローカルラベルマップの複製という慣行に倣う。
// AdviceCallout.tsxがNutrientSufficiencyList.tsxのラベルマップを複製するprecedent参照）。
const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: "朝食",
  lunch: "昼食",
  dinner: "夕食",
  snack: "間食",
};

const LOADING_MESSAGE = "生成中…";
const FAILURE_MESSAGE = "レシピ詳細の生成に失敗しました。";
const EXTRA_SUGGEST_HEADING = "もう一品追加するなら";

/** kcal表示用の整数丸め+桁区切り（NutritionSummarySection.tsx/DayColumn.tsxと同じ規約）。 */
function formatKcal(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/**
 * 材料の分量表示。ほとんどの単位は「分量+単位」の並び（例: "100g", "3個"）とし、分数変換
 * （例: "1/2本"）は行わずそのまま小数で表示する（スコープ外）。例外として"大さじ"/"小さじ"の
 * 2単位のみ、日本語の慣例（mockup.htmlの「大さじ1」「小さじ1/2」）に従い単位を分量の前に置く。
 */
function formatIngredientQuantity(quantity: number, unit: string): string {
  if (unit === "大さじ" || unit === "小さじ") {
    return `${unit}${quantity}`;
  }
  return `${quantity}${unit}`;
}

/**
 * 符号付きの丸めkcal文字列（例: "+15kcal", "-70kcal"）。formatKcalの丸め+桁区切りの規約に、
 * AdviceCallout.tsxのformatSignedKcalと同じ「非負値には明示的に+を付与する」規約を組み合わせる。
 */
function formatSignedKcalDelta(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded >= 0 ? "+" : "";
  return `${sign}${rounded.toLocaleString("en-US")}kcal`;
}

/**
 * 符号付きの小数第1位グラム文字列（例: "+2.1g", "-0.5g"）。
 * NutrientSufficiencyList.tsxのformatGrams1と同じ小数第1位の規約に、明示的符号を組み合わせる。
 */
function formatSignedGrams1(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}g`;
}

/** 追加副菜提案の栄養価増分4項目すべてを符号付きで表示する（cherry-pickせず全項目表示）。 */
function formatNutritionDelta(delta: NutritionValues): string {
  return [
    formatSignedKcalDelta(delta.energyKcal),
    `たんぱく質${formatSignedGrams1(delta.proteinG)}`,
    `脂質${formatSignedGrams1(delta.fatG)}`,
    `炭水化物${formatSignedGrams1(delta.carbG)}`,
  ].join("・");
}

export function RecipeDetailModal({
  weekStartDate,
  dayIndex,
  mealType,
  dishName,
  onClose,
}: RecipeDetailModalProps): JSX.Element {
  const { data, isLoading, error } = useAsyncData<RecipeDetail>(async () => {
    const result = await generateRecipeDetail(weekStartDate, dayIndex, mealType);
    if (!result.ok) {
      throw result.error;
    }
    return result.value;
  }, [weekStartDate, dayIndex, mealType]);

  const eyebrow = `${WEEKDAY_FULL_LABELS[dayIndex]}・${MEAL_TYPE_LABELS[mealType]}`;

  return (
    <div className="modal-overlay">
      <button type="button" className="modal-backdrop" aria-hidden="true" onClick={onClose} />
      <div className="modal-panel" role="dialog" aria-label="レシピ詳細">
        <div className="modal-head">
          <div>
            <div className="modal-eyebrow">{eyebrow}</div>
            <h3>{dishName}</h3>
          </div>
          <button type="button" className="modal-close" aria-label="閉じる" onClick={onClose}>
            ✕
          </button>
        </div>
        {isLoading && <p className="recipe-detail-loading">{LOADING_MESSAGE}</p>}
        {!isLoading && error !== null && <p className="recipe-detail-error">{FAILURE_MESSAGE}</p>}
        {!isLoading && error === null && data !== null && (
          <>
            <div className="recipe-meta">
              <span>調理時間 {data.cookingTimeMinutes}分</span>
              <span>{data.servings}人前</span>
              <span>{formatKcal(data.nutrition.energyKcal)}kcal</span>
            </div>
            <div className="recipe-card">
              <div>
                <h4>材料</h4>
                <ul className="ingredient-list">
                  {data.ingredients.map((ingredient, index) => (
                    <li key={`${ingredient.foodId}-${index}`}>
                      <span>{ingredient.name}</span>
                      <span>{formatIngredientQuantity(ingredient.quantity, ingredient.unit)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>作り方</h4>
                <ol className="step-list">
                  {data.steps.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
            {data.supplementarySuggestions.length > 0 && (
              <div className="extra-suggest">
                <h4>{EXTRA_SUGGEST_HEADING}</h4>
                {data.supplementarySuggestions.map((suggestion, index) => (
                  <div className="extra-item" key={`${suggestion.dishName}-${index}`}>
                    <span className="name">{suggestion.dishName}</span>
                    <span className="meta">{formatNutritionDelta(suggestion.nutritionDelta)}</span>
                  </div>
                ))}
              </div>
            )}
            <FeedbackControl
              key={`${weekStartDate}-${dayIndex}-${mealType}`}
              weekStartDate={weekStartDate}
              dayIndex={dayIndex}
              mealType={mealType}
            />
          </>
        )}
      </div>
    </div>
  );
}
