/**
 * PFC構成比の横積み棒グラフ+凡例。
 *
 * mockup.html の `.stack-bar` + `.pfc-legend` セクション（design.md: File Structure Plan
 * `components/dashboard/charts/PfcBarChart.tsx`、Components table: 「PFC構成比の横積み棒」）
 * のマークアップ構造に対応する。
 *
 * 責務境界（design.md Components table / Requirements Traceability 1.2）:
 * `nutritionClient.getSummary()` の呼び出しと結果の受け渡しは `DashboardPage`（task 7.1）と
 * `NutritionSummarySection`（本タスク、task 3.4）が担う。本コンポーネントは既に解決済みの
 * `PfcRatio` / `PfcTargets` を props で受け取り、比率(0-1)を百分率表示に変換するだけの
 * 状態を持たない純粋なプレゼンテーションコンポーネントである（`ProfileStrip.tsx` 等と同じ方針）。
 *
 * バー・凡例の並び順は mockup.html の通り 炭水化物(carb) → たんぱく質(protein) → 脂質(fat)
 * の順に固定する（`--series-1/2/3` に対応）。
 *
 * Requirements: 1.2（炭水化物・たんぱく質・脂質のPFCバランスを、グラム量と構成比率の
 * 両方で表示する）, 18.2/18.3（「今週の計画平均」表示。グラム量の目標`PfcTargets`は
 * 日により変動する目標エネルギー量から逆算される値であり、7日分を平均するには
 * `nutrition-engine`への7回の再取得が必要になって要件18.3が許容する計算範囲を超えるため、
 * 週表示では`pfc`を省略し、単日でも変動しない`pfcRatio`のみを「平均{pct}%」として表示する
 * （mockup.html行643-647、design.md:375のPeriodToggle amendmentと同じ理由付け）。
 */
import type { PfcRatio, PfcTargets } from "@nutrition/shared";

export interface PfcBarChartProps {
  pfcRatio: PfcRatio;
  /** 省略時（「今週の計画平均」表示時）はグラム量を表示せず、パーセンテージのみを表示する。 */
  pfc?: PfcTargets;
}

const SERIES_COLOR = {
  carb: "var(--series-1)",
  protein: "var(--series-2)",
  fat: "var(--series-3)",
} as const;

/** 比率(0-1)を四捨五入した百分率の整数に変換する（表示専用の単純な書式変換）。 */
function toPercent(ratio: number): number {
  return Math.round(ratio * 100);
}

/** グラム量を四捨五入した整数に変換する（表示専用の単純な書式変換）。 */
function toGrams(grams: number): number {
  return Math.round(grams);
}

export function PfcBarChart({ pfcRatio, pfc }: PfcBarChartProps) {
  const carbPct = toPercent(pfcRatio.carbPct);
  const proteinPct = toPercent(pfcRatio.proteinPct);
  const fatPct = toPercent(pfcRatio.fatPct);

  return (
    <div className="pfc-bar-chart">
      <div className="stack-bar">
        <span style={{ width: `${carbPct}%`, background: SERIES_COLOR.carb }} />
        <span style={{ width: `${proteinPct}%`, background: SERIES_COLOR.protein }} />
        <span style={{ width: `${fatPct}%`, background: SERIES_COLOR.fat }} />
      </div>
      <div className="pfc-legend">
        <div className="row">
          <span className="dot" style={{ background: SERIES_COLOR.carb }} />
          <span className="label">炭水化物</span>
          <span className="val">{pfc ? `${toGrams(pfc.carbG)}g・${carbPct}%` : `平均${carbPct}%`}</span>
        </div>
        <div className="row">
          <span className="dot" style={{ background: SERIES_COLOR.protein }} />
          <span className="label">たんぱく質</span>
          <span className="val">
            {pfc ? `${toGrams(pfc.proteinG)}g・${proteinPct}%` : `平均${proteinPct}%`}
          </span>
        </div>
        <div className="row">
          <span className="dot" style={{ background: SERIES_COLOR.fat }} />
          <span className="label">脂質</span>
          <span className="val">{pfc ? `${toGrams(pfc.fatG)}g・${fatPct}%` : `平均${fatPct}%`}</span>
        </div>
      </div>
    </div>
  );
}
