/**
 * 曜日別カロリー差分の発散棒グラフ（ダイエット状況画面「摂取・消費カロリー収支（今週）」、
 * task 6.2）。
 *
 * mockup.html の `.chart-card` 内 `<svg viewBox="0 0 640 200" ... role="img"
 * aria-label="曜日ごとの目標カロリーとの差分">`（行878-917）+ `.legend-row`（行913-916）の
 * マークアップ構造に対応する（design.md: File Structure Plan
 * `components/dashboard/charts/CalorieBalanceChart.tsx`）。
 *
 * 責務境界（`PfcBarChart.tsx`/`GoalProgressBar.tsx`と同じ方針）: 本コンポーネントは呼び出し元
 * （`CalorieBalanceSection.tsx`、本タスク）が既に解決済みの7件の`{ weekdayLabel,
 * varianceKcal }`をpropsでそのまま受け取るだけの、状態を持たない純粋なプレゼンテーション
 * コンポーネントである。曜日ラベルの書式化（単一文字、`DayColumn.tsx`の`WEEKDAY_LABELS`と
 * 同じ形式）・実際の差分値の算出はいずれも呼び出し元の責務であり、本コンポーネントは
 * 受け取った値をそのまま描画するのみ。
 *
 * 欠測日の扱い（Requirement 12.1、本タスクの解決済み設計判断）: `varianceKcal === null`の
 * 日は棒（`<rect>`）自体を描画しない。「0」を補完して描画すると「ちょうど目標通りだった
 * （実測済み）」という誤った意味になってしまうため、欠測は棒の不在で表現する
 * （曜日ラベル自体はその日の位置を保つため常に描画する）。
 *
 * 棒の高さのスケーリング（design.md・要件のいずれにも算出式の指定がない、本タスクの
 * 解決済み設計判断）: 実データが存在する日の`|varianceKcal|`の最大値を基準に線形スケーリングし、
 * その最大値が`MAX_BAR_HEIGHT`（80px、mockup.htmlの最大例である+310kcal時の70pxに
 * やや余裕を持たせた値）に一致するよう正規化する。これにより変動幅が小さい週でも棒が
 * 不自然に小さくなりすぎず、変動幅が大きい週でも描画範囲(y: 0-200)を超えて描画されることが
 * ない。実データが1件もない、または全日0kcalの場合はゼロ除算を避けるため高さを一律0として
 * 扱う（全欠測の場合はそもそも`<rect>`が1つも描画されない）。
 *
 * 棒の向き（mockup.html自体のSVG座標の実例は、正負いずれの値も軸線(y=100)より上側にのみ
 * 描画しており符号を反映していないように見える——例えば"月曜: -180kcal"の`<rect>`も
 * "水曜: +120kcal"の`<rect>`も、いずれも`y + height = 100`という同じ上向きの配置になっている。
 * これは`.chart-sub`キャプション「0より下＝目標より少なく抑えられた日／0より上＝目標を
 * 超過した日」という説明文と矛盾するため、mockup.html側のサンプル座標の誤りと判断し、
 * 本実装ではキャプションの意味通りに、正の差分（目標超過）は軸線から上方向へ、負の差分
 * （目標未達）は下方向へ伸ばす、という一貫した発散棒グラフとして実装する）。
 *
 * Requirements: 12.1
 */
import type { JSX } from "react";

export interface CalorieBalanceDatum {
  /** 表示用に既に整形済みの単一文字の曜日ラベル（例: "月"）。書式化は呼び出し側の責務。 */
  weekdayLabel: string;
  /** 実績摂取カロリー - 目標エネルギー量。その日の実データが無ければ`null`。 */
  varianceKcal: number | null;
}

export interface CalorieBalanceChartProps {
  /** ちょうど7件、曜日インデックス（月曜始まり）順。 */
  data: CalorieBalanceDatum[];
}

const CHART_SUB_CAPTION = "0より下＝目標より少なく抑えられた日／0より上＝目標を超過した日";
const LEGEND_NEGATIVE_LABEL = "目標より少ない";
const LEGEND_POSITIVE_LABEL = "目標より多い";

// mockup.html (行884-910)のx座標の並びから逆算した固定レイアウト定数。
const AXIS_Y = 100;
const BAR_WIDTH = 48;
const X_START = 38;
const X_STEP = 86;
const MAX_BAR_HEIGHT = 80;
const VALUE_LABEL_GAP = 8;
const WEEKDAY_LABEL_Y = 118;

/** 符号付きの丸めkcal文字列（例: "+310", "-180"）。`AdviceCallout.tsx`と同じ規約。 */
function formatSignedKcal(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded >= 0 ? "+" : "";
  return `${sign}${rounded}`;
}

export function CalorieBalanceChart({ data }: CalorieBalanceChartProps): JSX.Element {
  // 実データが存在する日の|varianceKcal|の最大値（ファイル冒頭コメントのスケーリング方針）。
  const maxAbs = data.reduce((max, entry) => {
    if (entry.varianceKcal === null) {
      return max;
    }
    return Math.max(max, Math.abs(entry.varianceKcal));
  }, 0);

  return (
    <div className="chart-card">
      <div className="chart-sub">{CHART_SUB_CAPTION}</div>
      <svg viewBox="0 0 640 200" width="100%" height="200" role="img" aria-label="曜日ごとの目標カロリーとの差分">
        <line x1="20" y1={AXIS_Y} x2="620" y2={AXIS_Y} className="axis-line" />
        <g style={{ fontVariantNumeric: "tabular-nums" }}>
          {data.map((entry, index) => {
            const x = X_START + index * X_STEP;
            const centerX = x + BAR_WIDTH / 2;
            const variance = entry.varianceKcal;
            const hasBar = variance !== null;
            const height = hasBar && maxAbs > 0 ? (Math.abs(variance) / maxAbs) * MAX_BAR_HEIGHT : 0;
            const isPositive = hasBar && variance > 0;
            const rectY = isPositive ? AXIS_Y - height : AXIS_Y;
            const valueTextY = isPositive ? rectY - VALUE_LABEL_GAP : rectY + height + VALUE_LABEL_GAP + 6;

            return (
              <g key={index}>
                {hasBar && (
                  <>
                    <rect
                      className="bar-mark tooltip-target"
                      data-tip={`${entry.weekdayLabel}: ${formatSignedKcal(variance)}kcal`}
                      tabIndex={0}
                      x={x}
                      y={rectY}
                      width={BAR_WIDTH}
                      height={height}
                      rx="3"
                      fill={isPositive ? "var(--diverge-pos)" : "var(--diverge-neg)"}
                    />
                    <text x={centerX} y={valueTextY} textAnchor="middle">
                      {formatSignedKcal(variance)}
                    </text>
                  </>
                )}
                <text x={centerX} y={WEEKDAY_LABEL_Y} textAnchor="middle">
                  {entry.weekdayLabel}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="legend-row">
        <span className="item">
          <span className="sw" style={{ background: "var(--diverge-neg)" }} />
          {LEGEND_NEGATIVE_LABEL}
        </span>
        <span className="item">
          <span className="sw" style={{ background: "var(--diverge-pos)" }} />
          {LEGEND_POSITIVE_LABEL}
        </span>
      </div>
    </div>
  );
}
