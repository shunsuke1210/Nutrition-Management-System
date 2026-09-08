/**
 * 体重推移と目標達成予測セクション（ダイエット状況画面、task 6.3）。
 *
 * mockup.html の `#panel-diet` 内 `<section class="block">`（「体重推移と目標達成予測」、
 * 行924-958）に対応する（design.md: File Structure Plan
 * `components/dashboard/WeightTrendSection.tsx`）。`.block-head`（`<h2>`）は
 * `CalorieBalanceSection.tsx`/`DietGoalStatusSection.tsx`と同じ既存の判断（見出しの描画は
 * 将来の`DashboardPage`、task 7.1、へ委譲する）に倣い実装しない。
 *
 * 責務境界（design.md Components table、`DietGoalStatusSection.tsx`（task 6.1）と同じ方針）:
 * 本コンポーネントは`nutritionClient.getDietInsights`の呼び出しを行わず、`DashboardPage`
 * （task 7.1）が解決済みの`dietInsights`/`profile`を非nullのpropsとして受け取るのみ。
 * 実際の折れ線グラフの描画・スケーリングロジックは`WeightTrendChart`（本タスクで新規実装）に
 * 委譲する。
 *
 * `goalWeightKg`の非null前提（`DietGoalStatusSection.tsx`と同じ確立済みの規約）: 本画面は
 * ダイエットモード有効時のみ表示される前提であり、`ProfileInputSchema`の`superRefine`が
 * `dietModeEnabled === true`の場合に`goalWeightKg`を必須としているため非null保証される。
 *
 * 空データ時のフォールバック（design.md・要件のいずれにも明記された必須要件ではないが、
 * 本タスクの解決済み設計判断）: `dietInsights.weightHistory.length === 0`（体重記録が
 * 1件も無い）場合は`WeightTrendChart`を描画せず、簡潔なフォールバックメッセージを表示する。
 * 描画すべき実測推移が存在せず、X軸の範囲が定義できない退化した0点グラフを避けるため。
 * これは`weightProjection`の有無とは無関係（`weightProjection`が空配列であること自体は
 * Requirement 13.4が定める通常の「見込みを算出しない」状態であり、`WeightTrendChart`内部で
 * 完結して処理される。本フォールバックは「実測すら1件も無い」というより稀な退化ケース専用）。
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */
import type { DietInsights, Profile } from "@nutrition/shared";
import { WeightTrendChart } from "./charts/WeightTrendChart.js";

export interface WeightTrendSectionProps {
  /** `DashboardPage`（task 7.1）が解決済みの非null値としてpropsで受け取る。 */
  dietInsights: DietInsights;
  /** `goalWeightKg`（ファイル冒頭コメント参照）の取得に用いる。 */
  profile: Profile;
}

const NO_HISTORY_MESSAGE = "体重記録がありません。";

export function WeightTrendSection({ dietInsights, profile }: WeightTrendSectionProps) {
  if (dietInsights.weightHistory.length === 0) {
    // ファイル冒頭コメント参照: 実測推移が1件も無い退化ケースの専用フォールバック。
    return (
      <div className="weight-trend-section">
        <p className="weight-trend-empty">{NO_HISTORY_MESSAGE}</p>
      </div>
    );
  }

  // 本画面のPrecondition（ダイエットモード有効）により非null保証
  // （`DietGoalStatusSection.tsx`と同じ規約。`ProfileInputSchema`のsuperRefine参照）。
  const goalWeightKg = profile.goalWeightKg!;

  return (
    <div className="weight-trend-section">
      <WeightTrendChart
        weightHistory={dietInsights.weightHistory}
        weightProjection={dietInsights.weightProjection}
        goalWeightKg={goalWeightKg}
      />
    </div>
  );
}
