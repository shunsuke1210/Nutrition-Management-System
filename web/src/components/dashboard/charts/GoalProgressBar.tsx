/**
 * 目標体重までの進捗バー（塗りつぶし幅+スケール表示）。
 *
 * mockup.html の `.goal-track` + `.goal-scale`（行844-845）のマークアップ構造に対応する
 * （design.md: File Structure Plan `components/dashboard/charts/GoalProgressBar.tsx`、
 * Components table: 「目標体重までの進捗バー」）。
 *
 * 責務境界: 本コンポーネントは `fillPercent`（呼び出し元が 0-100 にクランプ済みの値）を
 * そのまま描画するだけの、状態を持たない純粋なプレゼンテーションコンポーネントである
 * （`PfcBarChart.tsx` と同じ方針）。パーセンテージ自体の算出（このシステムには
 * 「ダイエット開始時体重」を記録するフィールドが存在しないため、`dietInsights.weightHistory`
 * の最も古い記録を開始体重の代理指標として用いる、という設計判断を含む）は呼び出し元
 * （`DietGoalStatusSection`、task 6.1）の責務であり、本コンポーネントはそれに関与しない
 * （design.md Components table: 本コンポーネント自身の記載は「目標体重までの進捗バー」の
 * みで、「あと{}kg・週{}kgペースで…」の見込みテキストは含まない）。
 *
 * Requirements: 10.2（現在の体重・目標体重・残りの体重差の表示のうち、目標体重・現在体重の
 * スケール表示部分）
 */
export interface GoalProgressBarProps {
  currentWeightKg: number;
  goalWeightKg: number;
  /** 0-100。呼び出し元でクランプ済みの値をそのまま描画する（本コンポーネントは計算しない）。 */
  fillPercent: number;
}

export function GoalProgressBar({ currentWeightKg, goalWeightKg, fillPercent }: GoalProgressBarProps) {
  return (
    <>
      <div className="goal-track">
        <div className="fill" style={{ width: `${fillPercent}%` }} />
      </div>
      <div className="goal-scale">
        <span>{goalWeightKg}kg（目標）</span>
        <span>{currentWeightKg}kg（現在）</span>
      </div>
    </>
  );
}
