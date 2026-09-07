/**
 * 推奨エネルギー量カード・PFC構成比・微量栄養素充足率一覧のセクション。
 *
 * mockup.html の「1日の推奨栄養量」ブロック（行586-627、`period-panel[data-panel="today"]`）
 * の `card-grid` 3枚（推奨エネルギー量／PFCバランス／ビタミン・ミネラル充足率）に対応する
 * （design.md: File Structure Plan `components/dashboard/NutritionSummarySection.tsx`、
 * Components table: 「推奨エネルギー量カード、PeriodToggle、PfcBarChart、
 * NutrientSufficiencyListの配置」）。
 *
 * 責務境界（design.md Components table / Requirements Traceability 1.1-1.5）:
 * `nutritionClient.getSummary()` / `menuPlanClient.getWeekPlan()` の呼び出しと結果の
 * 受け渡しは `DashboardPage`（task 7.1）が担う。本コンポーネントは既に解決済みの
 * `NutritionSummary` と当日の `DayMenu.dayNutrition` を props で受け取り、推奨エネルギー量
 * カードを直接描画しつつ `PfcBarChart` / `NutrientSufficiencyList` へ必要なフィールドを
 * 切り出して委譲するだけの、状態を持たない純粋なプレゼンテーションコンポーネントである。
 *
 * スコープ（task 3.4時点）: 本タスクは「今日」の表示のみを実装する。「今日」/「今週の
 * 計画平均」の切替（`PeriodToggle`、要件18）は後続タスク（3.5）の責務であり、本タスクの
 * 対象外（design.md File Structure Plan コメント「（今日/今週の計画平均の切替を含む）」は
 * 3.5がこのコンポーネントを拡張して満たす）。
 *
 * Requirement 1.5 との整合性: 推奨エネルギー量カードが表示する「活動量による加算」は
 * `tdee - bmr` という、`NutritionSummary` が既に算出済みの2つの最終値に対する単純な表示用
 * 引き算であり、BMR/TDEE算出式そのものの再実装ではない。これは要件18.3が明示的に許容する
 * 「7日間の単純平均・目標との比」と同種の「既に算出済みの出力に対する単純な四則演算」に
 * 分類される（`nutrition-engine`のドメインロジック自体を再実装するものではない）。
 *
 * Requirements: 1.1（推奨エネルギー量を基礎代謝量と活動量による加算分の内訳とともに表示）,
 * 1.2（PFCバランスをグラム量と構成比率の両方で表示、PfcBarChartへ委譲）,
 * 1.3（微量栄養素の目標量と充足率を項目名とともに表示、NutrientSufficiencyListへ委譲）,
 * 1.4（充足率100%超の実際の値をそのまま表示、NutrientSufficiencyListへ委譲）,
 * 1.5（充足率の算出以外の栄養計算を行わない）
 */
import type { NutritionSummary, VerifiedNutritionValues } from "@nutrition/shared";
import { PfcBarChart } from "./charts/PfcBarChart.js";
import { NutrientSufficiencyList } from "./charts/NutrientSufficiencyList.js";

export interface NutritionSummarySectionProps {
  /** `nutritionClient.getSummary()` の結果（bmr/tdee/PFC/微量栄養素目標値を含む）。 */
  nutritionSummary: NutritionSummary;
  /** `menuPlanClient.getWeekPlan()` が返す当日の `DayMenu.dayNutrition`（実績値）。 */
  dayNutrition: VerifiedNutritionValues;
}

/** kcal表示用の整数丸め+桁区切り（表示専用の単純な書式変換、ロケール固定で決定的にする）。 */
function formatKcal(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function NutritionSummarySection({ nutritionSummary, dayNutrition }: NutritionSummarySectionProps) {
  const { bmr, tdee, normalMode } = nutritionSummary;
  const activityAddon = tdee - bmr;

  return (
    <div className="card-grid">
      <div className="card">
        <h3>推奨エネルギー量</h3>
        <div className="hero-num">
          {formatKcal(tdee)}
          <small>kcal/日</small>
        </div>
        <div className="hero-sub">
          基礎代謝 {formatKcal(bmr)}kcal ・ 活動量による加算 +{formatKcal(activityAddon)}kcal
        </div>
      </div>
      <div className="card">
        <h3>PFCバランス</h3>
        <PfcBarChart pfcRatio={normalMode.pfcRatio} pfc={normalMode.pfc} />
      </div>
      <div className="card">
        <h3>ビタミン・ミネラル充足率</h3>
        <NutrientSufficiencyList targets={normalMode.micronutrients} actual={dayNutrition} />
      </div>
    </div>
  );
}
