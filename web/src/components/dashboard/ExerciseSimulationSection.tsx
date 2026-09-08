/**
 * 運動併用シミュレーションセクション: 食事管理のみ/運動併用の目標体重到達見込み週数の比較表示。
 *
 * mockup.html の「運動を組み合わせた場合のシミュレーション」ブロック内の`.card`
 * （行974-991、`<h2>`/`.block-head`部分を除く）に対応する（design.md: File Structure Plan
 * `components/dashboard/ExerciseSimulationSection.tsx`）。
 *
 * 責務境界（`DietGoalStatusSection.tsx`（task 6.1）と同じ方針。design.md Components table
 * 参照）: `dietInsights.exerciseSimulation`は`DashboardPage`（task 7.1）が解決済みの非null値
 * としてpropsで受け取り、本コンポーネント自身は`nutritionClient`を呼び出さない。他の
 * 画面内サブセクション（例: `CalorieBalanceSection.tsx`）と同様、自身の`<h2>`/`.block-head`
 * は持たず、将来の`DashboardPage`側でセクション見出しと共に配置される想定（既存の確立された
 * 前例に倣う）。
 *
 * `exerciseSimulation.available===false`の場合（Requirement 15.3: 体重記録の不足、または
 * ダイエット目標が減量方向でないことにより算出しない場合）は何も描画しない
 * （`null`を返す）。
 *
 * Requirements: 15.1, 15.2, 15.3
 */
import type { JSX } from "react";
import type { ExerciseSimulationResult } from "@nutrition/shared";
import { CompareBars } from "./charts/CompareBars.js";

export interface ExerciseSimulationSectionProps {
  /** `DashboardPage`（task 7.1）が解決済みの非null値としてpropsで受け取る。 */
  exerciseSimulation: ExerciseSimulationResult;
}

export function ExerciseSimulationSection({
  exerciseSimulation,
}: ExerciseSimulationSectionProps): JSX.Element | null {
  if (!exerciseSimulation.available) {
    // Requirement 15.3: 体重記録の不足、またはダイエット目標が減量方向でないことにより
    // 算出しない場合は表示しない。
    return null;
  }

  return (
    <div className="card">
      <CompareBars
        dietOnlyWeeksToGoal={exerciseSimulation.dietOnlyWeeksToGoal}
        dietPlusExerciseWeeksToGoal={exerciseSimulation.dietPlusExerciseWeeksToGoal}
        scenarioLabel={exerciseSimulation.scenarioLabel}
      />
    </div>
  );
}
