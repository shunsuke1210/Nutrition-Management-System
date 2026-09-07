/**
 * 推奨エネルギー量カード・PFC構成比・微量栄養素充足率一覧のセクション。
 *
 * mockup.html の「1日の推奨栄養量」ブロック（行586-627、`period-panel[data-panel="today"]`、
 * および「今週の計画平均」パネル 行630-662、`period-panel[data-panel="week"]`）の
 * `card-grid` 3枚（推奨エネルギー量／PFCバランス／ビタミン・ミネラル充足率）に対応する
 * （design.md: File Structure Plan `components/dashboard/NutritionSummarySection.tsx`、
 * Components table: 「推奨エネルギー量カード、PeriodToggle、PfcBarChart、
 * NutrientSufficiencyListの配置」）。
 *
 * 責務境界（design.md Components table / Requirements Traceability 1.1-1.5, 18.1-18.4）:
 * `nutritionClient.getSummary()` / `menuPlanClient.getWeekPlan()` の呼び出しと結果の
 * 受け渡しは `DashboardPage`（task 7.1）が担う。本コンポーネントは既に解決済みの
 * `NutritionSummary`・当日の `DayMenu.dayNutrition`・今週の `WeekMenuPlan`（未生成時は
 * `null`）を props で受け取り、推奨エネルギー量カードを直接描画しつつ `PeriodToggle` /
 * `PfcBarChart` / `NutrientSufficiencyList` へ必要なフィールドを切り出して委譲するだけの、
 * 状態を持たない純粋なプレゼンテーションコンポーネントである。
 *
 * 期間状態の制御（task 3.5、Requirement 18.6との整合性）: 「今日」/「今週の計画平均」の
 * 選択状態は本コンポーネントが内部で保持せず、`period`/`onPeriodChange` としてPropsで
 * 受け取る（`ModeToggle`と同じ「状態を持たない制御されたコンポーネント」の方針）。これは
 * 要件18.6が要求する、栄養評価画面（本コンポーネント）とダイエット状況画面
 * （`DietGoalStatusSection`、task 6.1）の間での選択状態の共有を、両コンポーネントの親である
 * `DashboardPage`（task 7.1）がリフトアップした単一の状態で実現できるようにするためである。
 *
 * 「今週の計画平均」の算出（Requirement 18.2, 18.3）:
 * - 推奨エネルギー量: `weekPlan.days[].dayNutrition.energyKcal` 7件の単純平均
 *   （mockup.html行634「今週7日間の計画献立の平均値」の通り、`nutritionSummary.tdee`の
 *   平均ではなく`menu-generation`の実績値の平均を表示する。design.md:375が
 *   `DietGoalStatusSection`の「今週の平均」についてのみ`nutritionClient.getSummary`の
 *   7回呼び出しを認めているのは目標エネルギー量が`nutrition-engine`側の値だからであり、
 *   本カードが表示する値は実績値のため同じ理由付けは適用されない）
 * - PFCバランス: グラム量（目標値、日により変動）は表示せず、単日でも変動しない
 *   `pfcRatio`をそのまま「平均{pct}%」として`PfcBarChart`へ委譲する（同上の理由。
 *   グラム量の週平均には目標エネルギー量の7回再取得が必要になり18.3の許容範囲を超える）
 * - 微量栄養素充足率: `weekPlan.days[].dayNutrition`の13フィールドを単純平均した値を
 *   `actual`として`NutrientSufficiencyList`へ委譲する（`targets`は日により変動しない
 *   静的なプロフィール由来の値のため今日/週で共通）
 * いずれも「7件の単純平均」「平均実績と目標との比」のみであり、それ以外の栄養計算は行わない。
 *
 * Requirement 18.4（今週の週間献立プランが未生成の場合）: `weekPlan`が`null`の場合、
 * `PeriodToggle`の週オプションを利用不可にする。加えて、防御的に`period==="week"`が
 * `weekPlan===null`のまま指定された場合（本コンポーネント自身は`period`を制御しないため
 * 理論上あり得る）も、クラッシュ・NaN表示を避けて「未生成」である旨を表示する。
 *
 * Requirements: 1.1（推奨エネルギー量を基礎代謝量と活動量による加算分の内訳とともに表示）,
 * 1.2（PFCバランスをグラム量と構成比率の両方で表示、PfcBarChartへ委譲）,
 * 1.3（微量栄養素の目標量と充足率を項目名とともに表示、NutrientSufficiencyListへ委譲）,
 * 1.4（充足率100%超の実際の値をそのまま表示、NutrientSufficiencyListへ委譲）,
 * 1.5（充足率の算出以外の栄養計算を行わない）,
 * 18.1（「今日」/「今週の計画平均」の切替操作の提供）,
 * 18.2（「今週の計画平均」選択時、7日分のdayNutrition平均値と平均充足率を表示）,
 * 18.3（7件の単純平均・平均実績と目標との比以外の栄養計算を行わない）,
 * 18.4（今週の週間献立プランが未生成の場合、週平均の選択を利用不可にするか未生成を表示）
 */
import type { NutritionSummary, VerifiedNutritionValues, WeekMenuPlan } from "@nutrition/shared";
import { PeriodToggle, type Period } from "./PeriodToggle.js";
import { PfcBarChart } from "./charts/PfcBarChart.js";
import { NutrientSufficiencyList } from "./charts/NutrientSufficiencyList.js";

export interface NutritionSummarySectionProps {
  /** `nutritionClient.getSummary()` の結果（bmr/tdee/PFC/微量栄養素目標値を含む）。 */
  nutritionSummary: NutritionSummary;
  /** `menuPlanClient.getWeekPlan()` が返す当日の `DayMenu.dayNutrition`（実績値）。 */
  dayNutrition: VerifiedNutritionValues;
  /** `menuPlanClient.getWeekPlan()` の結果。対象週の週間献立プランが未生成の場合は `null`。 */
  weekPlan: WeekMenuPlan | null;
  /** 表示中の期間。`DashboardPage`（task 7.1）がリフトアップして保持する制御値。 */
  period: Period;
  onPeriodChange: (period: Period) => void;
}

const WEEK_ENERGY_CAPTION = "今週7日間の計画献立の平均値（運動量に応じて日により変動）";
const WEEK_MICRONUTRIENT_CAPTION =
  "今週7日間の計画献立を平均した値です。単日の偏りをならした傾向を確認できます。";
const WEEK_PLAN_NOT_GENERATED_MESSAGE = "今週の週間献立プランがまだ生成されていません。";

const VERIFIED_NUTRITION_KEYS: (keyof VerifiedNutritionValues)[] = [
  "energyKcal",
  "proteinG",
  "fatG",
  "carbG",
  "fiberG",
  "calciumMg",
  "ironMg",
  "vitaminAUg",
  "vitaminDUg",
  "vitaminB1Mg",
  "vitaminB2Mg",
  "vitaminCMg",
  "saltEquivalentG",
];

/**
 * `VerifiedNutritionValues`の13フィールドすべてを単純平均する（Requirement 18.3が許容する
 * 「7件の実績値の単純平均」のみ。栄養価算出式の再実装は行わない）。
 */
function averageVerifiedNutritionValues(days: VerifiedNutritionValues[]): VerifiedNutritionValues {
  const result = {} as VerifiedNutritionValues;
  for (const key of VERIFIED_NUTRITION_KEYS) {
    const total = days.reduce((sum, day) => sum + day[key], 0);
    result[key] = total / days.length;
  }
  return result;
}

/** kcal表示用の整数丸め+桁区切り（表示専用の単純な書式変換、ロケール固定で決定的にする）。 */
function formatKcal(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function NutritionSummarySection({
  nutritionSummary,
  dayNutrition,
  weekPlan,
  period,
  onPeriodChange,
}: NutritionSummarySectionProps) {
  const { bmr, tdee, normalMode } = nutritionSummary;
  const activityAddon = tdee - bmr;
  const weekAverage = weekPlan ? averageVerifiedNutritionValues(weekPlan.days.map((day) => day.dayNutrition)) : null;
  const showWeekNotGenerated = period === "week" && weekAverage === null;

  return (
    <div className="nutrition-summary-section">
      <PeriodToggle period={period} onPeriodChange={onPeriodChange} weekAvailable={weekPlan !== null} />

      {showWeekNotGenerated ? (
        <div className="card-grid period-panel" data-panel="week">
          <div className="card week-plan-unavailable">
            <p>{WEEK_PLAN_NOT_GENERATED_MESSAGE}</p>
          </div>
        </div>
      ) : (
        <div className="card-grid period-panel" data-panel={period}>
          <div className="card">
            <h3>推奨エネルギー量</h3>
            {period === "today" ? (
              <>
                <div className="hero-num">
                  {formatKcal(tdee)}
                  <small>kcal/日</small>
                </div>
                <div className="hero-sub">
                  基礎代謝 {formatKcal(bmr)}kcal ・ 活動量による加算 +{formatKcal(activityAddon)}kcal
                </div>
              </>
            ) : (
              <>
                <div className="hero-num">
                  {formatKcal(weekAverage!.energyKcal)}
                  <small>kcal/日</small>
                </div>
                <div className="hero-sub">{WEEK_ENERGY_CAPTION}</div>
              </>
            )}
          </div>
          <div className="card">
            <h3>PFCバランス</h3>
            <PfcBarChart pfcRatio={normalMode.pfcRatio} pfc={period === "today" ? normalMode.pfc : undefined} />
          </div>
          <div className="card">
            <h3>ビタミン・ミネラル充足率</h3>
            <NutrientSufficiencyList
              targets={normalMode.micronutrients}
              actual={period === "today" ? dayNutrition : weekAverage!}
              captionOverride={period === "week" ? WEEK_MICRONUTRIENT_CAPTION : undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}
