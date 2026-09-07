/**
 * 「外食時の代替提案」セクション（栄養評価画面。design.md: File Structure Plan
 * `components/dashboard/EatingOutTipSection.tsx`）。
 *
 * mockup.html の行803-815（`<section class="block">` > `.card.tip-card`（`.tip-icon`💡 +
 * 見出し・本文のテキスト2行））のマークアップ構造のうち、本コンポーネントは `.card.tip-card`
 * 以下のみを描画する。`.block-head`（`<h2>外食時の代替提案</h2>`）はどの要件にも対応せず、
 * `WeeklyMenuSection.tsx`/`ShoppingListSection.tsx` と同じ既存の判断（見出しの描画は将来の
 * `DashboardPage`、task 7.1、へ委譲する）に倣い実装しない。`.tip-icon`/`.tip-title`（本文相当）の
 * 内側2つの`<div>`はmockup.html上もクラス名を持たない（インラインstyleのみ）ため、本コンポーネント
 * でも新規クラス名を発明せずそのまま無クラスの`<div>`とする。
 *
 * 責務境界（design.md Components table / Requirement 9）: `mealSlotClient.getEatingOutSuggestion()`
 * が返す `EatingOutSuggestionResult` を props でそのまま受け取り、想定メニューと代替メニューの
 * カロリー・たんぱく質量の差をそのまま表示するだけの、状態を持たない純粋なプレゼンテーション
 * コンポーネントである。「本日の昼食」を判定して対象週/曜日/食事種別を決定し
 * `mealSlotClient.getEatingOutSuggestion` を呼び出すこと自体は本コンポーネントの責務ではなく、
 * 他の全セクションコンポーネント（`NutritionSummarySection`/`WeeklyMenuSection`/
 * `ShoppingListSection`等）と同様に将来の `DashboardPage`（task 7.1）が担う。そのため本ファイルは
 * `mealSlotClient` を一切importしない。
 *
 * 非表示ルール（Requirement 9.4、design.md: 本コンポーネントの中核判断）: 他の全セクション
 * （`WeeklyMenuSection`/`ShoppingListSection`が「読み込み中」「取得失敗」「未生成」をそれぞれ
 * 個別のメッセージで明示的に表示するのと異なり）、要件9は読み込み中・取得エラー時の表示について
 * 一切言及していない（要件6.5/6.6のような「生成中」「失敗」の明示的な表示要求がない）。要件9.4が
 * 明示する非表示条件は次の2つのみ:
 *   (1) 本日の昼食の食事枠が存在しない場合 → `mealSlotClient.getEatingOutSuggestion` が404
 *       (`error.type === "not_found"`) を返す。`useAsyncData`の契約（`useAsyncData.ts`冒頭
 *       コメント: 取得が一度も成功していない場合`data`は`null`のまま）により、この場合`data`は
 *       `null`のまま。
 *   (2) menu-generationが代替案なしと判定した場合 → 200成功だが `data.suggestion === null`
 *       （`EatingOutSuggestionResultSchema`コメント参照。生成失敗ではなく「該当なし」を表す
 *       正常応答）。
 * これに加え、読み込み中（`data`がまだ一度も成功取得されていない状態）も`useAsyncData`の契約上
 * `data === null`と同じ形で表れる。したがって `data === null || data.suggestion === null` という
 * 単一の条件が、読み込み中・404未検出・代替案なしの3状態すべてを正しく「何も表示しない」に
 * 分類する。`isLoading`/`error`を個別に分岐して異なるメッセージを出し分けることはしない
 * （唯一の付加的な「ヒント」セクションであり、表示すべき情報がない場合は静かに何も表示しない、
 * という要件9.4の最小限の読み方。`isLoading`/`error`が非デフォルト値でも`data`が有効な成功値
 * であれば表示を抑制してはならない＝バックグラウンド再取得中に隠れるような、どの要件にも
 * 求められていない挙動を持ち込まない）。
 *
 * 表示文言（Requirement 9.1-9.3）: 見出し「今日の昼食を外食にする場合」はmockup.html通りの
 * 固定文言（要件9.1が「本日の昼食」固定であることを裏付けており、データ由来のロジックを要しない
 * 定数文字列として正しい）。本文はmockup.htmlの実例文「牛丼並盛（約780kcal）の代わりに、
 * 定食チェーンの「焼き魚定食」（約620kcal・たんぱく質+8g）を選ぶと、本日の目標にかなり
 * 近づきます。」に倣うが、"定食チェーンの"という飲食店種別の接頭辞はどのフィールドにも
 * 裏付けがないmockupの演出文言であるため採用せず、`data.suggestion.alternativeMenuName`を
 * そのまま「」で囲んで表示する（mockupの引用スタイルは踏襲し、捏造した接頭辞は付与しない）。
 * kcal丸め表示は`RecipeDetailModal.tsx`のformatKcalと同じ`Math.round(value).toLocaleString
 * ("en-US")`規約、たんぱく質量の差の符号付き小数第1位表示は同ファイルのformatSignedGrams1と
 * 同じ規約（このリポジトリのこのspec内で確立された、コンポーネントごとの簡単な書式関数の局所的
 * 複製という慣行に倣う）。`proteinDeltaG`は`EatingOutSuggestionSchema`コメントが明記する通り
 * 代替メニューの方が低たんぱくな実例（例:「親子丼→かけうどん」で-18.5g）が現実に存在するため、
 * 常に符号を明示する。
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */
import type { EatingOutSuggestion, EatingOutSuggestionResult } from "@nutrition/shared";

export interface EatingOutTipSectionProps {
  /**
   * `mealSlotClient.getEatingOutSuggestion()` の結果。対象の食事枠が存在しない場合（404）は
   * 呼び出し元（将来の`DashboardPage`）が`useAsyncData`経由で渡す値として`null`のままとなる
   * （`data`/`isLoading`/`error`の意味は他の全セクションコンポーネントと同じ
   * `DashboardSectionProps<T>`形状。design.md: Shared Interface）。
   */
  data: EatingOutSuggestionResult | null;
  isLoading: boolean;
  error: unknown;
}

const TIP_TITLE = "今日の昼食を外食にする場合";

/** kcal表示用の整数丸め+桁区切り（RecipeDetailModal.tsx/NutritionSummarySection.tsxと同じ規約）。 */
function formatKcal(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** 符号付きの小数第1位グラム文字列（例: "+8.0g", "-18.5g"）。RecipeDetailModal.tsxのformatSignedGrams1と同じ規約。 */
function formatSignedGrams1(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}g`;
}

/** 本文テキストの組み立て（design.mdコメント参照。mockupの演出文言「定食チェーンの」は含めない）。 */
function buildTipBody(suggestion: EatingOutSuggestion): string {
  return (
    `${suggestion.typicalMenuName}（約${formatKcal(suggestion.typicalMenuKcal)}kcal）の代わりに、` +
    `「${suggestion.alternativeMenuName}」（約${formatKcal(suggestion.alternativeMenuKcal)}kcal・` +
    `たんぱく質${formatSignedGrams1(suggestion.proteinDeltaG)}）を選ぶと、本日の目標にかなり近づきます。`
  );
}

export function EatingOutTipSection({ data }: EatingOutTipSectionProps) {
  if (data === null || data.suggestion === null) {
    return null;
  }

  return (
    <section className="eating-out-tip-section">
      <div className="card tip-card">
        <div className="tip-icon">💡</div>
        <div>
          <div>{TIP_TITLE}</div>
          <div>{buildTipBody(data.suggestion)}</div>
        </div>
      </div>
    </section>
  );
}
