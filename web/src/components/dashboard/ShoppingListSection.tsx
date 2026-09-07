/**
 * 「買い物リスト（今週分）」セクション（栄養評価画面。design.md: File Structure Plan
 * `components/dashboard/ShoppingListSection.tsx`）。
 *
 * mockup.html の行757-801（`<section class="block">` > `.card` > `.shop-grid`（カテゴリ別
 * `.shop-cat` の並び））のマークアップ構造のうち、本コンポーネントは `.card`/`.shop-grid` 以下の
 * みを描画する。`.block-head`（`<h2>買い物リスト（今週分）</h2>`）はどの要件にも対応せず、
 * `WeeklyMenuSection.tsx`/`NutritionSummarySection.tsx` と同じ既存の判断（見出しの描画は
 * 将来の `DashboardPage`、task 7.1、へ委譲する）に倣い実装しない。
 *
 * 責務境界（design.md Components table / Requirement 8）: `menuPlanClient.getShoppingList()`
 * が返す `ShoppingList`（`menu-generation` が既に食材を合算・カテゴリ分類済み）を props で
 * そのまま受け取り、カテゴリ別に表示するだけの、状態を持たない純粋なプレゼンテーション
 * コンポーネントである。`menuPlanClient` は直接importせず（`WeeklyMenuSection.tsx` と同じ
 * 方針）、独自の単位変換・数量再計算・カテゴリ再分類は一切行わない（要件8.2, 8.3）。
 * `WeeklyMenuSection.tsx` と異なり、週全体/日単位の差し替えのような自身のアクションを
 * 持たないため、コールバックpropsは存在しない（`data`/`isLoading`/`error`のみ）。
 *
 * カテゴリのグループ化順序（Requirement 8.2）: `items`はフラット配列で返るため、
 * `ShoppingListCategorySchema`（`shared/src/menu.schema.ts`）のenum宣言順と同じ固定順序
 * （`CATEGORY_ORDER`）でグループ化して描画する。品目が0件のカテゴリは`.shop-cat`ブロック自体を
 * 描画しない（空見出しを表示しないという最小限のUI判断。空カテゴリの表示を求める要件はない）。
 * 各カテゴリ内の品目の並び順は`data.items`内の出現順をそのまま用いる（並べ替えを求める要件は
 * ない）。
 *
 * 数量表示（Requirement 8.4）: `item.displayQuantity`と`item.displayUnit`を数値と単位の間に
 * 空白を挟まず連結して表示する（例:「1/2玉」ではなく mockup.html の実例通り「0.5玉」）。
 * 分数変換は行わない（`RecipeDetailModal.tsx`の`formatIngredientQuantity`と同じ、材料の分量を
 * 小数のまま表示する既存の判断に倣う）。品目名と数量ブロックの間の空白は、mockup.html通り
 * `.qty`をブロック要素として分離することで表現し、テキストとして空白文字を挿入しない。
 *
 * 未生成時の代替表示（Requirement 8.5）: `menuPlanClient.getShoppingList`は対象週の週間献立
 * プランが未生成の場合 `Result.ok: true, value: null` を返す（`menuPlanClient.ts`冒頭コメント
 * 参照）。これは失敗ではなく正常な「未生成」状態であるため、`WeeklyMenuSection.tsx`と同じ
 * 4分岐の構造（読み込み中／取得失敗／未生成／生成済み）で表示を切り替える。ただし本コンポーネント
 * は生成アクションを持たないため、未生成時も「生成」ボタンは表示しない（要件8.5が求めるのは
 * 未生成である旨の表示のみであり、そこから生成する操作自体は本コンポーネントの責務外）。
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */
import type { ShoppingList, ShoppingListCategory, ShoppingListItem } from "@nutrition/shared";

export interface ShoppingListSectionProps {
  /** `menuPlanClient.getShoppingList()` の結果。対象週の週間献立プランが未生成の場合は `null`。 */
  data: ShoppingList | null;
  isLoading: boolean;
  error: unknown;
}

const LOADING_MESSAGE = "買い物リストを読み込み中です…";
const FETCH_ERROR_MESSAGE = "買い物リストの取得に失敗しました。";
const NOT_GENERATED_MESSAGE = "今週の献立がまだ生成されていないため、買い物リストはまだありません。";

/** `ShoppingListCategorySchema`（shared/src/menu.schema.ts）のenum宣言順と同じ固定順序。 */
const CATEGORY_ORDER: ShoppingListCategory[] = ["野菜・きのこ", "肉・魚", "乳製品・卵・豆", "調味料・その他"];

/** 品目名+数量ブロックの表示文字列（分数変換なし、数値と単位の間に空白なし）。 */
function formatDisplayQuantity(item: ShoppingListItem): string {
  return `${item.displayQuantity}${item.displayUnit}`;
}

/** カテゴリ別にグループ化する。`items`はフラット配列のため、固定順序で走査してバケット化する。 */
function groupByCategory(items: ShoppingListItem[]): Map<ShoppingListCategory, ShoppingListItem[]> {
  const grouped = new Map<ShoppingListCategory, ShoppingListItem[]>();
  for (const item of items) {
    const bucket = grouped.get(item.category);
    if (bucket) {
      bucket.push(item);
    } else {
      grouped.set(item.category, [item]);
    }
  }
  return grouped;
}

export function ShoppingListSection({ data, isLoading, error }: ShoppingListSectionProps) {
  if (data === null && isLoading) {
    return (
      <section className="shopping-list-section">
        <p className="shopping-list-loading">{LOADING_MESSAGE}</p>
      </section>
    );
  }

  if (data === null && !isLoading && error !== null) {
    return (
      <section className="shopping-list-section">
        <p className="shopping-list-fetch-error">{FETCH_ERROR_MESSAGE}</p>
      </section>
    );
  }

  if (data === null) {
    // isLoading===false && error===null: 対象週の週間献立プランがまだ生成されていない、
    // という正常な状態（Requirement 8.5）。本コンポーネントは生成アクションを持たないため、
    // `WeeklyMenuSection`の未生成時とは異なり生成ボタンは表示しない。
    return (
      <section className="shopping-list-section">
        <p className="shopping-list-not-generated">{NOT_GENERATED_MESSAGE}</p>
      </section>
    );
  }

  const grouped = groupByCategory(data.items);

  return (
    <section className="shopping-list-section">
      <div className="card">
        <div className="shop-grid">
          {CATEGORY_ORDER.filter((category) => (grouped.get(category)?.length ?? 0) > 0).map((category) => (
            <div className="shop-cat" key={category}>
              <h4>{category}</h4>
              <ul>
                {grouped.get(category)!.map((item) => (
                  <li key={item.foodId}>
                    <span className="box" />
                    {item.name}
                    <span className="qty">{formatDisplayQuantity(item)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
