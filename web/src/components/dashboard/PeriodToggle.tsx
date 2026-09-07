/**
 * 「今日」/「今週の計画平均」の表示期間切替コントロール。
 *
 * mockup.html の `.period-toggle` セクション（行588-591、`role="tablist"
 * aria-label="表示期間"`、ラベル「今日」「今週の計画平均」）のマークアップ構造に対応する
 * （design.md: File Structure Plan `components/dashboard/PeriodToggle.tsx`、Components
 * table: 「「今日」/「今週の計画平均」の切替コントロール」）。
 *
 * 責務境界（design.md Components table）: 表示期間の状態管理は、`NutritionSummarySection`
 * （task 3.5）を経由して最終的に `DashboardPage`（task 7.1、要件18.6の栄養評価画面/
 * ダイエット状況画面間の状態共有を担う）が持つ。本コンポーネントは `ModeToggle.tsx`
 * （task 3.1）と同じ方針で、現在の期間値・変更通知コールバック・週平均の利用可否のみを
 * 受け取る、状態を持たない純粋なプレゼンテーションコンポーネントである。
 *
 * Requirements: 18.1（「今日」と「今週の計画平均」を切り替える操作の提供）,
 * 18.4（今週の週間献立プランが未生成である場合、「今週の計画平均」の選択を利用不可にする）
 */
export type Period = "today" | "week";

export interface PeriodToggleProps {
  period: Period;
  onPeriodChange: (period: Period) => void;
  /** Requirement 18.4: 今週の週間献立プランが未生成の場合はfalseを渡す。 */
  weekAvailable: boolean;
}

const TODAY_LABEL = "今日";
const WEEK_LABEL = "今週の計画平均";
const WEEK_UNAVAILABLE_GUIDANCE = "今週の献立プランが未生成のため利用できません";

export function PeriodToggle({ period, onPeriodChange, weekAvailable }: PeriodToggleProps) {
  return (
    <div className="period-toggle" role="tablist" aria-label="表示期間">
      <button
        type="button"
        role="tab"
        aria-selected={period === "today"}
        className={period === "today" ? "active" : undefined}
        onClick={() => onPeriodChange("today")}
      >
        {TODAY_LABEL}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={period === "week"}
        aria-disabled={!weekAvailable}
        disabled={!weekAvailable}
        className={period === "week" ? "active" : undefined}
        title={weekAvailable ? undefined : WEEK_UNAVAILABLE_GUIDANCE}
        onClick={() => {
          // Requirement 18.4: 利用不可の場合、ネイティブのdisabled属性でクリックイベント
          // 自体がReactに届かないが、意図を明示するため二重にガードする（ModeToggleと同じ方針）。
          if (!weekAvailable) {
            return;
          }
          onPeriodChange("week");
        }}
      >
        {WEEK_LABEL}
      </button>
      {!weekAvailable && (
        <span className="period-toggle-guidance" role="note">
          {WEEK_UNAVAILABLE_GUIDANCE}
        </span>
      )}
    </div>
  );
}
