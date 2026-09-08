/**
 * 「食事管理のみ」/「運動併用」の目標体重到達見込み週数を比較する2本組の棒グラフ。
 *
 * mockup.html の `.compare-bars`（行974-991）のマークアップ構造に対応する（design.md:
 * File Structure Plan `components/dashboard/charts/CompareBars.tsx`）。
 *
 * 責務境界（`GoalProgressBar.tsx`/`CalorieBalanceChart.tsx`と同じ方針）: 本コンポーネントは
 * 呼び出し元（`ExerciseSimulationSection.tsx`、本タスク）から渡された`dietOnlyWeeksToGoal`/
 * `dietPlusExerciseWeeksToGoal`/`scenarioLabel`をそのまま描画するだけの、状態を持たない
 * 純粋なプレゼンテーションコンポーネントである。`scenarioLabel`は`nutrition-engine`側で
 * 既に完成した人間可読な文字列（例:「週3回・30分の運動を追加」）であり、本コンポーネントは
 * それを再構成せずそのまま表示する。
 *
 * 週数が個別に`null`の場合（Requirement 15.4と同じ「進捗が0以下で見込みを算出できない」
 * 状態。`DietGoalStatusSection`の`GOAL_ETA_NO_PROGRESS_MESSAGE`と同じ性質、
 * `goalEta.estimatedWeeksToGoal===null`の前例に倣う）: 該当行は「約{}週」ではなく、
 * 意味の異なる専用のフォールバック文言を表示する（「約null週」というクラッシュ気味の
 * 表示や、0週という誤った情報を避けるため）。
 *
 * 棒の幅の算出（design.md・要件のいずれにも算出式の指定がない、本タスクの解決済み設計
 * 判断）: 行1（「運動なし」= 常に基準となるベースライン）は`dietOnlyWeeksToGoal`が非nullで
 * あれば常に100%（mockup.htmlの実例自体が`width:100%`という固定値であることに一致する）。
 * 行2（運動併用シナリオ）は、両方の値が非nullの場合にのみ
 * `dietPlusExerciseWeeksToGoal / dietOnlyWeeksToGoal * 100`という単純な比率として算出し、
 * 0-100にクランプする（`DietGoalStatusSection.computeFillPercent`の
 * `GoalProgressBar.fillPercent`算出や`NutrientSufficiencyList`の充足率算出と同種の、
 * 既に提供された2値の単純な比率であり、新規のドメイン計算ではない）。いずれかが`null`の
 * 場合や、ゼロ除算になる場合（`dietOnlyWeeksToGoal===0`）は比較の基準がないため0%として
 * 扱い、`NaN`/`Infinity`が`style`属性に到達することを防ぐ。
 *
 * Requirements: 15.1, 15.2
 */
export interface CompareBarsProps {
  dietOnlyWeeksToGoal: number | null;
  dietPlusExerciseWeeksToGoal: number | null;
  /** nutrition-engine側で既に完成した人間可読な文字列。再構成せずそのまま表示する。 */
  scenarioLabel: string;
}

const BASELINE_ROW_LABEL = "運動なし（食事管理のみ）";
const WEEKS_UNAVAILABLE_MESSAGE = "見込みを算出できません。";

/**
 * 週数テキストを整形する（例: "目標まで 約14週"）。`weeks===null`の場合は算出不能を示す
 * 専用のフォールバック文言を返す（本ファイル冒頭コメント参照）。`GoalEtaResult`系の値と
 * 同様に非整数の可能性があるため、`DietGoalStatusSection`の`約${Math.round(...)}週間後`と
 * 同じ規約で四捨五入する。
 */
function formatWeeksText(weeks: number | null): string {
  if (weeks === null) {
    return WEEKS_UNAVAILABLE_MESSAGE;
  }
  return `目標まで 約${Math.round(weeks)}週`;
}

/**
 * 行2（運動併用シナリオ）の棒の幅パーセントを算出する（0-100にクランプ済み）。
 * いずれかが`null`、またはゼロ除算になる場合は比較の基準がないため0を返す
 * （本ファイル冒頭コメント参照）。
 */
function computeComparisonFillPercent(
  dietOnlyWeeksToGoal: number | null,
  dietPlusExerciseWeeksToGoal: number | null,
): number {
  if (dietOnlyWeeksToGoal === null || dietPlusExerciseWeeksToGoal === null || dietOnlyWeeksToGoal <= 0) {
    return 0;
  }
  const rawPercent = (dietPlusExerciseWeeksToGoal / dietOnlyWeeksToGoal) * 100;
  return Math.min(100, Math.max(0, rawPercent));
}

export function CompareBars({
  dietOnlyWeeksToGoal,
  dietPlusExerciseWeeksToGoal,
  scenarioLabel,
}: CompareBarsProps) {
  const comparisonFillPercent = computeComparisonFillPercent(
    dietOnlyWeeksToGoal,
    dietPlusExerciseWeeksToGoal,
  );

  return (
    <div className="compare-bars">
      <div className="compare-row">
        <div className="label-row">
          <span>{BASELINE_ROW_LABEL}</span>
          <span className="weeks">{formatWeeksText(dietOnlyWeeksToGoal)}</span>
        </div>
        <div className="compare-track">
          <div
            className="compare-fill"
            style={{
              width: dietOnlyWeeksToGoal !== null ? "100%" : "0%",
              background: "var(--ink-muted)",
            }}
          />
        </div>
      </div>
      <div className="compare-row">
        <div className="label-row">
          <span>{scenarioLabel}</span>
          <span className="weeks">{formatWeeksText(dietPlusExerciseWeeksToGoal)}</span>
        </div>
        <div className="compare-track">
          <div
            className="compare-fill"
            style={{ width: `${comparisonFillPercent.toFixed(1)}%`, background: "var(--brand)" }}
          />
        </div>
      </div>
    </div>
  );
}
