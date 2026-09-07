/**
 * 安全ガードレール警告、または安全ペースであることの表示。
 *
 * mockup.html の `.status-callout.good`（行848-856）/ `.status-callout.warning`
 * （行858-865）のマークアップ構造に対応する（design.md: File Structure Plan
 * `components/dashboard/GuardrailWarningCallout.tsx`、Components table:
 * 「ガードレール警告または安全表示」）。
 *
 * mockup.html 行858-865 の `.status-callout.warning` ブロックは、`<span
 * class="s-example-label">ガードレールの動作例</span>` が明示する通り、mockup.html自体を
 * 読む人間向けの説明用デモ（「仮に『4週間で8kg減』を目標に指定した場合」という仮定のシナリオ
 * を示すイラストレーション）であり、実データとして再現すべきライブコンテンツではないため、
 * 本コンポーネントはこの具体的な文言（および `.s-example-label`）を再現しない
 * （`AdviceCallout.tsx` が mockup の捏造された食品提案理由付けを意図的に採用しなかった前例と
 * 同じ方針）。
 *
 * 同様に、安全時（行853）の「週あたりの減量ペースは体重の約0.6%で、推奨上限（体重の1%/週）
 * の範囲内です。」という具体的なパーセンテージも、`GuardrailResult` が安全時に提供する値
 * （空の `warnings` 配列のみ）には存在しないため採用せず、汎用的で正直な文言に置き換える。
 *
 * 責務境界: 本コンポーネントは `nutritionSummary.dietMode.guardrails.warnings`
 * （`DietGoalStatusSection` が既に解決済み）を props で受け取り描画するだけの、状態を持たない
 * 純粋なプレゼンテーションコンポーネントである。
 *
 * Requirements: 11.1（最低摂取カロリー基準または最大減量ペース上限のガードレール警告を返す
 * 場合、該当する警告メッセージを表示する）, 11.2（ガードレール警告表示時、修正提案
 * （期間延長案・目標体重緩和案等）をあわせて表示する）, 11.3（ガードレール警告が発生して
 * いない場合、警告を表示せず安全なペースであることが分かる表示を行う）
 */
import type { GuardrailSuggestion, GuardrailWarning } from "@nutrition/shared";

export interface GuardrailWarningCalloutProps {
  warnings: GuardrailWarning[];
}

const SAFE_TITLE = "安全ペース判定：問題なし";
const SAFE_BODY = "現在の減量ペースは安全な範囲内です。";

/**
 * 修正提案1件の表示文言。Requirement 11.2 の literal terminology
 * （「期間延長案」「目標体重緩和案」）をそのまま用いる。`suggestedGoalPeriodWeeks` /
 * `suggestedGoalWeightKg` は schema上 optional であるため、欠落時は数値を捏造せず
 * 種別ラベルのみを表示する。
 */
function formatSuggestion(suggestion: GuardrailSuggestion): string {
  if (suggestion.kind === "extend_period") {
    return suggestion.suggestedGoalPeriodWeeks !== undefined
      ? `期間延長案: 目標期間を${suggestion.suggestedGoalPeriodWeeks}週間以上に延ばす`
      : "期間延長案";
  }
  return suggestion.suggestedGoalWeightKg !== undefined
    ? `目標体重緩和案: 目標体重を${suggestion.suggestedGoalWeightKg}kgまで緩和する`
    : "目標体重緩和案";
}

export function GuardrailWarningCallout({ warnings }: GuardrailWarningCalloutProps) {
  if (warnings.length === 0) {
    return (
      <div className="status-callout good">
        <span className="s-icon">✓</span>
        <div>
          <div className="s-title">{SAFE_TITLE}</div>
          <div className="s-body">{SAFE_BODY}</div>
        </div>
      </div>
    );
  }

  return (
    <>
      {warnings.map((warning, index) => (
        <div className="status-callout warning" key={`${warning.type}-${index}`}>
          <span className="s-icon">⚠</span>
          <div>
            <div className="s-title">{warning.message}</div>
            <div className="s-body">
              <ul>
                {warning.suggestions.map((suggestion, suggestionIndex) => (
                  <li key={suggestionIndex}>{formatSuggestion(suggestion)}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
