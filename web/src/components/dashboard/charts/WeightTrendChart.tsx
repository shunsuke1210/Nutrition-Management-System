/**
 * 体重推移（実測）と目標達成予測の折れ線グラフ（ダイエット状況画面「体重推移と目標達成予測」、
 * task 6.3）。
 *
 * mockup.html の `.chart-card` 内 `<svg viewBox="0 0 660 210" ... role="img"
 * aria-label="体重推移と目標達成予測グラフ">`（行929-957）のマークアップ構造・視覚語彙
 * （Y軸グリッド線+値ラベル、目標体重の破線基準線+ラベル、実測の実線ポリライン、予測の破線
 * ポリライン、直近実測点の塗りつぶし丸マーカー、直近予測点の白抜き丸マーカー、`.chart-sub`
 * キャプション）に対応する。ただし本spec内の他の全チャート（`PfcBarChart`/
 * `CalorieBalanceChart`/`GoalProgressBar`）はいずれも棒グラフであり、本コンポーネントが本spec
 * 初の時系列折れ線グラフであるため、座標・スケーリングのロジックは本ファイルで新たに設計する
 * （mockup.htmlのピクセル座標・週オフセットX軸ラベルはあくまで視覚参考であり、そのまま
 * 再現する要件はない——X軸ラベルの簡略化については後述）。
 *
 * 責務境界（`PfcBarChart.tsx`/`CalorieBalanceChart.tsx`/`GoalProgressBar.tsx`と同じ方針）:
 * 本コンポーネントは呼び出し元（`WeightTrendSection.tsx`、本タスク）が既に解決済みの
 * `weightHistory`/`weightProjection`/`goalWeightKg`をpropsでそのまま受け取るだけの、状態を
 * 持たない純粋なプレゼンテーションコンポーネントである。
 *
 * 入力の前提を超えた防御（`weightHistory`/`weightProjection`は型上「時系列昇順」が期待される
 * が、design.mdの算出手順が保証するものであり、本コンポーネント自身がその前提を過信しない
 * ための安価な防御）: 描画直前に両配列を日付昇順へソートし直してから使用する。
 *
 * Y軸スケーリング（design.md・要件のいずれにも算出式の指定がない、本タスクの解決済み設計
 * 判断）: `weightHistory`の全`weightKg`・`weightProjection`の全`projectedWeightKg`・
 * `goalWeightKg`の3種全ての値を対象にmin/maxを取る（目標体重が実測/予測データ自身の範囲外に
 * あっても目標線が常にグラフ内に収まるようにするため）。そのスパンの10%
 * （スパンが0＝全値が同一の場合は0.5kg固定）を余白として上下にパディングした
 * `paddedMin`/`paddedMax`を算出し、その範囲を固定4本の等間隔グリッド線で分割し、各線の値を
 * そのまま小数第1位で表示する（mockup.htmlの71/68/65/62のような「きれいな丸め数値」軸は
 * 本タスクでは不要な複雑さと判断し、実装しない）。
 *
 * X軸スケーリング: `weightHistory`+`weightProjection`を合わせたデータセット全体の最古日付を
 * 起点(x=PLOT_LEFT)、最新日付を終点(x=PLOT_RIGHT)として、日数差
 * （`daysBetweenIso`、`server/src/menu-generation/menu-plan.service.ts`の`addDaysIso`や
 * `DietGoalStatusSection.tsx`/`CalorieBalanceSection.tsx`の同名関数と同じUTC真夜中基準の
 * 日付演算パターンに倣った、本ファイル非exportのローカルヘルパー。このコードベースには日付
 * 演算の共有ユーティリティが存在せず、各モジュールが独自に小さなヘルパーを持つのが確立された
 * 前例）に基づき線形にマッピングする。
 *
 * X軸ラベルの簡略化（mockup.htmlの「-6週」「今週」等の相対週オフセット表記は「今日」という、
 * 本コンポーネントが本来関与すべきでない概念を要求するため、要件13が求める「時系列グラフ」を
 * 満たす範囲で意図的に簡略化する）: 「今日が何週目か」は計算せず、データセット中の代表的な
 * 3点（最古日付・直近実測日付・（存在すれば）直近予測日付）にのみ、生のISO日付を"MM/DD"へ
 * 整形した簡易ラベルを表示する。
 *
 * 実測/予測の区別（Requirement 13.3）: 実測ポリラインは実線（`stroke-dasharray`なし）、
 * 予測ポリラインは破線（`stroke-dasharray`あり）とする。色のみに依存せず線種で区別することで
 * 曖昧さのない信号とする。予測ポリラインの視覚的連続性のため、`weightProjection`が空でない
 * 場合は実測ポリラインの最終座標を予測ポリラインの`points`文字列の先頭へレンダリング時にのみ
 * 追加する（`weightProjection`プロップ自体へ架空の`WeightProjectionPoint`を追加することは
 * しない）。
 *
 * Requirement 13.4（予測なし）: `weightProjection.length === 0`の場合、破線ポリライン・
 * 白抜き丸マーカー・「想定」ラベルのいずれも描画せず、実線ポリライン・目標線・「現在」
 * マーカーのみを描画する。
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */
import type { WeightProjectionPoint, WeightTrendPoint } from "@nutrition/shared";
import type { JSX } from "react";

export interface WeightTrendChartProps {
  weightHistory: WeightTrendPoint[];
  weightProjection: WeightProjectionPoint[];
  goalWeightKg: number;
}

const CHART_SUB_CAPTION =
  "実線＝記録済みの実測値／破線＝現在のペースを継続した場合の予測、点線＝目標体重";

// mockup.html（viewBox="0 0 660 210"）に合わせたレイアウト定数。
const VIEWBOX_WIDTH = 660;
const VIEWBOX_HEIGHT = 210;
const PLOT_LEFT = 44;
const PLOT_RIGHT = 620;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 160;
const X_AXIS_LABEL_Y = 192;
const GRID_LINE_COUNT = 4;

interface Point {
  x: number;
  y: number;
}

/**
 * `from`から`to`までの日数差（UTC真夜中基準）。`DietGoalStatusSection.tsx`/
 * `CalorieBalanceSection.tsx`の`addDaysIso`（加算方向）と対になる、本ファイル非exportの
 * ローカルヘルパー（ファイル冒頭コメント参照）。
 */
function daysBetweenIso(from: string, to: string): number {
  const parseUtc = (date: string): number => {
    const parts = date.split("-").map(Number);
    return Date.UTC(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1);
  };
  return Math.round((parseUtc(to) - parseUtc(from)) / 86_400_000);
}

/** "YYYY-MM-DD" -> "MM/DD"（X軸ラベル用の簡易書式。ファイル冒頭コメント参照）。 */
function formatDateLabel(date: string): string {
  const parts = date.split("-");
  return `${parts[1] ?? "??"}/${parts[2] ?? "??"}`;
}

/** SVG座標を小数第1位に丸める（mockup.htmlの座標精度に合わせた表示専用の丸め）。 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** `Point[]`をSVGの`points`属性文字列へ変換する。実測/予測どちらのポリラインにも使う共通処理。 */
function pointsToAttr(points: Point[]): string {
  return points.map((point) => `${round1(point.x)},${round1(point.y)}`).join(" ");
}

function byDateAsc<T extends { date: string }>(a: T, b: T): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}

export function WeightTrendChart({
  weightHistory,
  weightProjection,
  goalWeightKg,
}: WeightTrendChartProps): JSX.Element {
  // 呼び出し元の「時系列昇順」前提を過信せず、描画直前に防御的にソートする（ファイル冒頭コメント参照）。
  const sortedHistory = [...weightHistory].sort(byDateAsc);
  const sortedProjection = [...weightProjection].sort(byDateAsc);

  // データセット全体（実測+予測）の最古日付・最新日付をX軸のスケール起点/終点とする。
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const date of [...sortedHistory.map((p) => p.date), ...sortedProjection.map((p) => p.date)]) {
    if (earliest === null || date < earliest) {
      earliest = date;
    }
    if (latest === null || date > latest) {
      latest = date;
    }
  }
  const totalDays = earliest !== null && latest !== null ? daysBetweenIso(earliest, latest) : 0;

  function dateToX(date: string): number {
    if (earliest === null || totalDays === 0) {
      // データが1件以下、または全データが同一日付の場合は0除算を避け、左端に固定する。
      return PLOT_LEFT;
    }
    const offset = daysBetweenIso(earliest, date);
    return PLOT_LEFT + (offset / totalDays) * (PLOT_RIGHT - PLOT_LEFT);
  }

  // Y軸の値域: 実測・予測・目標体重の3種全てを含める（ファイル冒頭コメント参照。目標体重が
  // 実測/予測データの範囲外にあっても目標線が常に描画範囲内に収まるようにするため）。
  const allWeightValues = [
    ...sortedHistory.map((p) => p.weightKg),
    ...sortedProjection.map((p) => p.projectedWeightKg),
    goalWeightKg,
  ];
  const rawMin = Math.min(...allWeightValues);
  const rawMax = Math.max(...allWeightValues);
  const span = rawMax - rawMin;
  const pad = span === 0 ? 0.5 : span * 0.1;
  const paddedMin = rawMin - pad;
  const paddedMax = rawMax + pad;

  function weightToY(weightKg: number): number {
    const ratio = (paddedMax - weightKg) / (paddedMax - paddedMin);
    return PLOT_TOP + ratio * (PLOT_BOTTOM - PLOT_TOP);
  }

  const historyPoints: Point[] = sortedHistory.map((p) => ({ x: dateToX(p.date), y: weightToY(p.weightKg) }));
  const projectionPointsRaw: Point[] = sortedProjection.map((p) => ({
    x: dateToX(p.date),
    y: weightToY(p.projectedWeightKg),
  }));

  const lastHistoryPoint = historyPoints.length > 0 ? historyPoints[historyPoints.length - 1]! : null;
  const hasProjection = projectionPointsRaw.length > 0;
  // 予測ポリラインの視覚的連続性のため、実測ポリラインの最終座標をレンダリング時にのみ先頭へ
  // 追加する（`weightProjection`プロップ自体は変更しない。ファイル冒頭コメント参照）。
  const projectionPoints: Point[] =
    hasProjection && lastHistoryPoint !== null ? [lastHistoryPoint, ...projectionPointsRaw] : projectionPointsRaw;

  const goalY = weightToY(goalWeightKg);

  const gridLines = Array.from({ length: GRID_LINE_COUNT }, (_, index) => {
    const ratio = index / (GRID_LINE_COUNT - 1);
    const value = paddedMax - ratio * (paddedMax - paddedMin);
    const y = PLOT_TOP + ratio * (PLOT_BOTTOM - PLOT_TOP);
    return { y, value };
  });

  const lastHistory = sortedHistory.length > 0 ? sortedHistory[sortedHistory.length - 1]! : null;
  const lastProjection = sortedProjection.length > 0 ? sortedProjection[sortedProjection.length - 1]! : null;

  const xTicks: { x: number; label: string }[] = [];
  if (earliest !== null) {
    xTicks.push({ x: dateToX(earliest), label: formatDateLabel(earliest) });
  }
  if (lastHistory !== null) {
    xTicks.push({ x: dateToX(lastHistory.date), label: formatDateLabel(lastHistory.date) });
  }
  if (lastProjection !== null) {
    xTicks.push({ x: dateToX(lastProjection.date), label: formatDateLabel(lastProjection.date) });
  }

  return (
    <div className="chart-card">
      <div className="chart-sub">{CHART_SUB_CAPTION}</div>
      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        width="100%"
        height={VIEWBOX_HEIGHT}
        role="img"
        aria-label="体重推移と目標達成予測グラフ"
      >
        {gridLines.map((line, index) => (
          <g key={index}>
            <line x1={PLOT_LEFT} y1={line.y} x2={PLOT_RIGHT} y2={line.y} className="grid-line" />
            <text x={PLOT_LEFT - 10} y={line.y + 4} textAnchor="end">
              {line.value.toFixed(1)}
            </text>
          </g>
        ))}

        <line
          className="goal-line"
          x1={PLOT_LEFT}
          y1={goalY}
          x2={PLOT_RIGHT}
          y2={goalY}
          stroke="var(--chart-muted)"
          strokeWidth={1.5}
          strokeDasharray="2 4"
        />
        <text x={PLOT_RIGHT + 4} y={goalY + 3} fontWeight={700}>
          {`目標 ${goalWeightKg}kg`}
        </text>

        {historyPoints.length > 0 && (
          <polyline
            className="actual-line"
            points={pointsToAttr(historyPoints)}
            fill="none"
            stroke="var(--brand)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        )}

        {hasProjection && (
          <polyline
            className="projection-line"
            points={pointsToAttr(projectionPoints)}
            fill="none"
            stroke="var(--brand)"
            strokeWidth={2}
            strokeDasharray="1 5"
            strokeLinecap="round"
          />
        )}

        {lastHistoryPoint !== null && lastHistory !== null && (
          <>
            <circle
              className="marker-current"
              cx={round1(lastHistoryPoint.x)}
              cy={round1(lastHistoryPoint.y)}
              r={5.5}
              fill="var(--brand)"
            />
            <text
              x={round1(lastHistoryPoint.x)}
              y={round1(lastHistoryPoint.y) - 12}
              textAnchor="middle"
              fontWeight={700}
            >
              {`${lastHistory.weightKg}kg（現在）`}
            </text>
          </>
        )}

        {hasProjection && lastProjection !== null && (
          <>
            <circle
              className="marker-projected"
              cx={round1(dateToX(lastProjection.date))}
              cy={round1(weightToY(lastProjection.projectedWeightKg))}
              r={4}
              fill="none"
              stroke="var(--brand)"
              strokeWidth={1.5}
            />
            <text
              x={round1(dateToX(lastProjection.date))}
              y={round1(weightToY(lastProjection.projectedWeightKg)) + 14}
              textAnchor="middle"
            >
              {`${lastProjection.projectedWeightKg}kg想定`}
            </text>
          </>
        )}

        <g fill="var(--chart-muted)">
          {xTicks.map((tick, index) => (
            <text key={index} x={tick.x} y={X_AXIS_LABEL_Y} textAnchor="middle">
              {tick.label}
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
}
