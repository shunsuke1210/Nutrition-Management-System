/**
 * DietInsightsCalculator（体重推移傾向・ゴールETA・停滞検知・運動併用シミュレーション算出モジュール）。
 *
 * design.md（`.kiro/specs/nutrition-engine/design.md`）の `DietInsightsCalculator` セクション
 * （Requirements 14.3-14.6, 15.1-15.4, 16.1-16.5, 17.1-17.5）に定義された算出手順をそのまま
 * 実装する純粋関数モジュール。`BmrCalculator` / `ActivityCoefficientCalculator` /
 * `PfcCalculator` / `DietModeCalculator` / `GuardrailEvaluator` と同じ「プレーンな関数を直接
 * export し、ファクトリでラップしない」規約に従う（外部依存を一切持たないため、そもそも注入すべき
 * 依存も存在しない）。
 *
 * - `weightLogs`（`DailyLogGateway.getWeightLogsInRange` が返す `WeightLogPoint[]`、
 *   日付昇順）から `weightKg` が `null` でない点のみを抽出したものを `points` とする。
 *   `weightLogs` は呼び出し元（`NutritionService`、task 6.5）が既に日付昇順で渡す契約
 *   （design.md #DailyLogGateway、および本ファイルのService Interfaceコメント
 *   `// asOfDateから遡ってWEIGHT_TREND_LONG_WINDOW_DAYS日分、日付昇順`）のため、
 *   本関数は独自の再ソートを行わない（`Array.filter` は要素順を保持するため、
 *   フィルタ後も日付昇順のまま）。
 * - 体重が記録された点数が `WEIGHT_TREND_MIN_DATA_POINTS`（2件）未満、または最初と最後の
 *   記録日の間隔が `WEIGHT_TREND_MIN_SPAN_DAYS`（14日）未満の場合、傾向線・将来予測・
 *   ゴールETA・停滞判定・運動併用シミュレーションのいずれも算出せず、データ不足を表す結果を
 *   返す（14.5, 15.4, 16.5, 17.5）。この早期リターンでも `weightHistory` は `points`
 *   （nullを除外した実測点、フィルタ前の生の `weightLogs` ではない）を返す。
 * - 傾向線・停滞判定はいずれも最小二乗法による回帰直線の傾き
 *   （`Σ((x_i - x̄)(y_i - ȳ)) / Σ((x_i - x̄)²)`）を用いる。長期回帰は `points` 全体、
 *   短期回帰（停滞判定用）は `points` のうち直近 `WEIGHT_TREND_SHORT_WINDOW_DAYS` 日以内の
 *   部分集合に対して、同一の回帰式・符号規則を適用する（design.md「同様の回帰・符号規則」）。
 *   このため回帰処理を `calculateWeeklyRateOfChangeKg` という非公開ヘルパーに共通化する
 *   （design.md の公開契約は `calculate` のみのため、export しない）。
 * - 「直近 `WEIGHT_TREND_SHORT_WINDOW_DAYS` 日以内」の基準点は `asOfDate`（本関数が呼び出し元
 *   から受け取る「現在」の基準日）とする。design.md の算出手順本文が `asOfDate` を明示的に
 *   参照するのはこの箇所のみであり（将来予測の起点は明示的に「直近の記録日」＝
 *   `points[points.length - 1].date` であり、`asOfDate` ではない）、`calculate` のシグネチャが
 *   `asOfDate` を独立した引数として要求している以上、本関数の内部で何らかの形で使用される
 *   はずである。体重が未記録の日が続き `points` の最終記録日が `asOfDate` から離れていても
 *   （＝直近の体重記録が古くても）、「直近」の停滞判定は常に「今」を基準に評価すべきという
 *   解釈に基づく。
 * - 目標到達見込み週数（ゴールETA）は減量・維持・増量のいずれの方向でも、`DietModeCalculator`
 *   （8.3）と同様に方向ごとの特別分岐を設けず、目標方向に符号を揃えた単一の式でカバーする
 *   （15.1, 15.2, 15.3）。
 * - 減量停滞の判定・運動併用シミュレーションは、現在の体重が目標体重を上回る場合
 *   （`directionSign === +1`）にのみ評価する。維持・増量方向では
 *   `plateau: { status: "not_applicable" }` / `exerciseSimulation: { available: false }`
 *   を返す（16.1, 16.2, 17.1, 17.2。`GuardrailEvaluator`の11.3と同じ方向判定）。
 * - 運動併用シミュレーションのMET換算式（`MET × 3.5 × weightKg / 200 × durationMinutes ×
 *   frequencyPerWeek`）は `ActivityCoefficientCalculator` の `ExerciseAdjustment` と
 *   同一の式形だが、design.mdが明示する通り既存コンポーネントの呼び出しではなく、本ファイル内で
 *   独立に適用する（`ActivityCoefficientCalculator` / `DietModeCalculator` 自体は
 *   importしない）。MET値は `constants.ts` の既存値（`ACTIVITY_COEFFICIENT_MET`）を、
 *   週あたり体重変化量への換算係数は `ENERGY_DENSITY_KCAL_PER_KG` を、それぞれそのまま参照し
 *   再定義しない（17.3, 17.4）。
 * - 決定論的な純粋関数であり、`Date.now()` / `Math.random()` 等の非決定的なAPIは一切使用しない。
 *   日付演算（経過日数の算出・日付への日数加算）はライブラリを用いず、"YYYY-MM-DD" を
 *   UTC深夜0時のタイムスタンプとして解釈した上でのミリ秒差分から算出する（タイムゾーンの
 *   影響を受けない、決定論的な計算にするため）。
 */
import type {
  DietInsights,
  ExerciseSimulationResult,
  GoalEtaResult,
  IsoDate,
  PlateauStatus,
  WeightProjectionPoint,
  WeightTrendPoint,
} from "@nutrition/shared";
import type { WeightLogPoint } from "./daily-log.gateway.js";
import {
  ACTIVITY_COEFFICIENT_MET,
  ENERGY_DENSITY_KCAL_PER_KG,
  EXERCISE_SIMULATION_SCENARIO,
  PLATEAU_PACE_RATIO_THRESHOLD,
  WEIGHT_PROJECTION_HORIZON_WEEKS,
  WEIGHT_TREND_MIN_DATA_POINTS,
  WEIGHT_TREND_MIN_SPAN_DAYS,
  WEIGHT_TREND_SHORT_WINDOW_DAYS,
} from "./constants.js";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" 形式の `IsoDate` を UTC深夜0時のミリ秒タイムスタンプへ変換する。 */
function toUtcMidnightMs(date: IsoDate): number {
  // IsoDateSchema（shared/src/nutrition.schema.ts）が "YYYY-MM-DD" 形式であることを
  // 既に検証済みの前提のため、分解した3要素は常に存在する
  // （tsconfig.base.json の noUncheckedIndexedAccess 対応のためタプル型にキャストする）。
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

/**
 * 2つの `IsoDate` 間の暦日数の差（`to` − `from`）を返す。
 * 両者をUTC深夜0時のタイムスタンプへ変換した上でのミリ秒差分から算出するため、
 * サマータイム等のローカルタイムゾーンの影響を受けず、月境界・年境界をまたいでも
 * 正しい暦日数を返す。
 */
function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMidnightMs(to) - toUtcMidnightMs(from)) / MILLISECONDS_PER_DAY);
}

/** `date` に `days` 日を加算した `IsoDate` を返す（UTC暦日ベース、月・年境界を正しく繰り上げる）。 */
function addDaysIso(date: IsoDate, days: number): IsoDate {
  const shifted = new Date(toUtcMidnightMs(date) + days * MILLISECONDS_PER_DAY);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `WeightLogPoint` のうち `weightKg` が `null` でないものを絞り込むための型ガード。 */
function hasRecordedWeight(log: WeightLogPoint): log is WeightLogPoint & { weightKg: number } {
  return log.weightKg !== null;
}

/**
 * 体重記録点の集合に対する最小二乗法による回帰直線の傾きから、週あたりの体重変化量
 * （`weeklyRateOfChangeKg`。正: 増加傾向、負: 減少傾向）を算出する。
 *
 * design.md 算出手順:
 *   x_i = points[i].date から points[0].date までの経過日数、y_i = points[i].weightKg
 *   slopeKgPerDay = Σ((x_i - x̄)(y_i - ȳ)) / Σ((x_i - x̄)²)
 *   weeklyRateOfChangeKg = slopeKgPerDay * 7
 *
 * 長期回帰（`points` 全体）・短期回帰（停滞判定用の直近部分集合）の両方が「同様の回帰・符号規則」
 * （design.md）を用いるため、本ヘルパーに共通化する。回帰のx軸原点（`regressionPoints[0].date`）
 * をどこに取るかは最小二乗法の傾きの値に影響しない（原点の平行移動は傾きを変えない）ため、
 * 長期・短期のどちらでも「その回帰対象集合の先頭点」を原点とすることで一貫させる。
 * `calculate` の公開契約はexportしない（design.mdのService Interfaceは`calculate`のみ）。
 */
function calculateWeeklyRateOfChangeKg(
  regressionPoints: ReadonlyArray<{ date: IsoDate; weightKg: number }>,
): number {
  // 呼び出し元（データ不足判定を通過した points、またはWEIGHT_TREND_MIN_DATA_POINTS件以上と
  // 確認済みのshortPoints）は常に1件以上の要素を持つため、先頭要素は必ず存在する
  // （noUncheckedIndexedAccess対応の非nullアサーション）。
  const referenceDate = regressionPoints[0]!.date;
  const offsets = regressionPoints.map((point) => ({
    x: daysBetween(referenceDate, point.date),
    y: point.weightKg,
  }));

  const pointCount = offsets.length;
  const xMean = offsets.reduce((sum, offset) => sum + offset.x, 0) / pointCount;
  const yMean = offsets.reduce((sum, offset) => sum + offset.y, 0) / pointCount;

  let numerator = 0;
  let denominator = 0;
  for (const offset of offsets) {
    const xDeviation = offset.x - xMean;
    numerator += xDeviation * (offset.y - yMean);
    denominator += xDeviation * xDeviation;
  }

  const slopeKgPerDay = numerator / denominator;
  return slopeKgPerDay * 7;
}

/**
 * 体重推移傾向・ゴールETA・停滞検知・運動併用シミュレーションを算出する
 * （design.md DietInsightsCalculator Service Interface: `calculate`）。
 *
 * @param weightLogs `asOfDate` から遡って `WEIGHT_TREND_LONG_WINDOW_DAYS` 日分の体重ログ
 *   （`DailyLogGateway.getWeightLogsInRange` の戻り値、日付昇順）
 * @param currentWeightKg 現在の体重（kg）
 * @param goalWeightKg 目標体重（kg）
 * @param asOfDate 基準日（"直近"の停滞判定ウィンドウの起点として用いる。design.md算出手順コメント参照）
 */
export function calculateDietInsights(
  weightLogs: WeightLogPoint[],
  currentWeightKg: number,
  goalWeightKg: number,
  asOfDate: IsoDate,
): DietInsights {
  const points: WeightTrendPoint[] = weightLogs
    .filter(hasRecordedWeight)
    .map((log) => ({ date: log.date, weightKg: log.weightKg }));

  // データ不足判定（14.5, 15.4, 16.5, 17.5）。`||` の短絡評価により、points.length が
  // WEIGHT_TREND_MIN_DATA_POINTS 未満（0件または1件）の場合は右辺（points[0] /
  // points[points.length-1] へのアクセスを含む）が評価されないため、右辺に到達する時点では
  // points.length >= 2 が保証されている（空配列アクセスによる例外は発生せず、
  // noUncheckedIndexedAccess対応の非nullアサーションもこの保証に基づく）。
  const isDataInsufficient =
    points.length < WEIGHT_TREND_MIN_DATA_POINTS ||
    daysBetween(points[0]!.date, points[points.length - 1]!.date) < WEIGHT_TREND_MIN_SPAN_DAYS;

  if (isDataInsufficient) {
    return {
      weightHistory: points,
      weightProjection: [],
      goalEta: { available: false },
      plateau: { status: "insufficient_data" },
      exerciseSimulation: { available: false },
    };
  }

  // 長期回帰（傾き→週あたり変化量）
  const weeklyRateOfChangeKg = calculateWeeklyRateOfChangeKg(points);

  // 目標方向（DietModeCalculatorと同じ考え方）
  const directionSign = Math.sign(currentWeightKg - goalWeightKg);
  const weeklyProgressKg = directionSign === 0 ? 0 : directionSign * -weeklyRateOfChangeKg;

  // ゴールETA（15.1, 15.2, 15.3）
  let goalEta: GoalEtaResult;
  if (directionSign === 0) {
    goalEta = { available: true, weeklyProgressKg: 0, estimatedWeeksToGoal: 0 };
  } else if (weeklyProgressKg > 0) {
    goalEta = {
      available: true,
      weeklyProgressKg,
      estimatedWeeksToGoal: Math.abs(currentWeightKg - goalWeightKg) / weeklyProgressKg,
    };
  } else {
    goalEta = { available: true, weeklyProgressKg, estimatedWeeksToGoal: null };
  }

  // 将来予測（14.4）: 直近の記録日（points の最終要素。asOfDateではない）を起点に、
  // WEIGHT_PROJECTION_HORIZON_WEEKS週分、週単位でweeklyRateOfChangeKgを累積加算する。
  // 早期リターンを通過しているため points.length >= 2 が保証されている
  // （noUncheckedIndexedAccess対応の非nullアサーション）。
  const lastRecordedPoint = points[points.length - 1]!;
  const weightProjection: WeightProjectionPoint[] = [];
  for (let week = 1; week <= WEIGHT_PROJECTION_HORIZON_WEEKS; week += 1) {
    weightProjection.push({
      date: addDaysIso(lastRecordedPoint.date, week * 7),
      projectedWeightKg: lastRecordedPoint.weightKg + weeklyRateOfChangeKg * week,
    });
  }

  // 停滞判定（16.1-16.5。減量方向（directionSign === +1）のみ評価）
  let plateau: PlateauStatus;
  if (directionSign !== 1) {
    plateau = { status: "not_applicable" };
  } else {
    const shortPoints = points.filter(
      (point) => daysBetween(point.date, asOfDate) <= WEIGHT_TREND_SHORT_WINDOW_DAYS,
    );

    if (shortPoints.length < WEIGHT_TREND_MIN_DATA_POINTS) {
      plateau = { status: "insufficient_data" };
    } else {
      const shortWeeklyRateOfChangeKg = calculateWeeklyRateOfChangeKg(shortPoints);
      const shortWeeklyProgressKg = directionSign * -shortWeeklyRateOfChangeKg;

      plateau =
        shortWeeklyProgressKg < weeklyProgressKg * PLATEAU_PACE_RATIO_THRESHOLD
          ? {
              status: "plateaued",
              message:
                "直近の減量ペースが長期的なペースに比べて明確に鈍化しています。停滞している可能性があります。",
            }
          : { status: "on_track" };
    }
  }

  // 運動併用シミュレーション（17.1-17.5。減量方向（directionSign === +1）のみ評価）
  let exerciseSimulation: ExerciseSimulationResult;
  if (directionSign !== 1) {
    exerciseSimulation = { available: false };
  } else {
    // MET換算式（ActivityCoefficientCalculatorのExerciseAdjustmentと同一の式形の、
    // 本コンポーネント内での独立した再適用。ActivityCoefficientCalculator自体は呼び出さない）。
    const met = ACTIVITY_COEFFICIENT_MET[EXERCISE_SIMULATION_SCENARIO.intensity];
    const weeklyBurnKcal =
      ((met * 3.5 * currentWeightKg) / 200) *
      EXERCISE_SIMULATION_SCENARIO.durationMinutes *
      EXERCISE_SIMULATION_SCENARIO.frequencyPerWeek;
    const additionalWeeklyProgressKg = weeklyBurnKcal / ENERGY_DENSITY_KCAL_PER_KG;
    const combinedWeeklyProgressKg = weeklyProgressKg + additionalWeeklyProgressKg;

    exerciseSimulation = {
      available: true,
      scenarioLabel: "週3回・30分の運動を追加",
      dietOnlyWeeksToGoal: goalEta.available ? goalEta.estimatedWeeksToGoal : null,
      dietPlusExerciseWeeksToGoal:
        combinedWeeklyProgressKg > 0
          ? Math.abs(currentWeightKg - goalWeightKg) / combinedWeeklyProgressKg
          : null,
    };
  }

  return { weightHistory: points, weightProjection, goalEta, plateau, exerciseSimulation };
}
