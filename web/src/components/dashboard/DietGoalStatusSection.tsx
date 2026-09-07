/**
 * ダイエット目標状況セクション: 目標エネルギー量・目標体重までの進捗・安全ガードレール判定。
 *
 * mockup.html の `#panel-diet` 内の最初の `.block`（「ダイエット目標の状況」、行819-866）の
 * `.card-grid` 3枚（目標エネルギー量／目標体重までの見込み／安全ペース判定）に対応する
 * （design.md: File Structure Plan `components/dashboard/DietGoalStatusSection.tsx`）。
 *
 * 責務境界（design.md Components table、`NutritionSummarySection.tsx`（task 3.4/3.5）と同じ
 * 方針）: 「今日」表示に必要な `nutritionSummary` / `dietInsights` / `profile` はいずれも
 * `DashboardPage`（task 7.1）が解決済みの非null値としてpropsで受け取る。
 * `nutritionSummary.dietMode` はこのダイエット状況画面自体がダイエットモード有効時のみ表示
 * される前提により非null保証されるが、防御的にnullチェックを行い、万一nullの場合は何も
 * 描画しない。
 *
 * 「今週の平均」の取得（Requirement 18.5、design.md:375）: `NutritionSummarySection` の
 * 「今週の計画平均」（既に取得済みの `menu-generation` データを再利用するだけで追加のAPI
 * 呼び出しを伴わない）とは異なり、目標エネルギー量は `nutrition-engine` 側の値であり、
 * `GET /api/nutrition/summary?date=` が単一日付しか受け付けないため、本コンポーネント自身が
 * `nutritionClient.getSummary` を対象週7日分の日付でそれぞれ呼び出し、7件の
 * `dietMode.calorieTarget` を単純平均する（design.md:375が明示的に許可する本タスク限定の
 * 例外。`RecipeDetailModal.tsx` と同様、`useAsyncData` + `Result` アンラップの直接呼び出し
 * パターンに従う）。`period==="today"` の間は7回のAPI呼び出しを一切行わない（`useAsyncData`
 * のfetchFnが即座に`null`へ解決する。遅延評価であり事前取得はしない）。
 *
 * `weekAvailable`（Requirement 18.5, 18.6）: `NutritionSummarySection` の `PeriodToggle` は
 * `menu-generation` の週間献立プランの有無に応じて `weekAvailable` を切り替えるが、本カードの
 * 週平均は `menu-generation` に一切依存しない純粋な `nutrition-engine` の計算であり、
 * ダイエットモード有効というこの画面自体の前提が既に満たされていれば常に算出可能なため、
 * `weekAvailable` は常に `true` を渡す。「今日」/「今週の平均」の選択状態自体
 * （`period`/`onPeriodChange`）は `NutritionSummarySection` と共有する制御されたpropsであり
 * （Requirement 18.6）、本コンポーネントは状態を内部で保持しない。
 *
 * `GoalProgressBar` の `fillPercent` 算出（design.mdにも要件にも算出式の指定がない、本タスク
 * の解決済み設計判断）: このシステムには「ダイエット開始時体重」を記録するフィールドが
 * 存在しない（`Profile.weightKg` は現在の体重のみ）。`dietInsights.weightHistory` の最も
 * 古い記録（時系列昇順の前提で先頭要素）を開始体重の代理指標として用いる。これは実際の
 * ダイエット開始日・開始体重ではなく、あくまで入手可能な体重記録のうち最も古いものである
 * という限界を正直に記録しておく（`computeFillPercent` のコメント参照）。
 *
 * ETA表示の3状態（Requirement 10.3, 10.5）: `goalEta.available === false`（体重記録不足等で
 * 算出不能）は「算出できません」、`goalEta.available === true && estimatedWeeksToGoal ===
 * null`（進捗が0以下、つまり目標方向に進んでいない）は「見込めません」という、意味の異なる
 * 別々のメッセージを表示する（前者はデータ不足、後者は「データはあるが今のペースでは届かない」
 * という別の状態であり、同じ文言にすると利用者に誤解を与えるため区別する）。
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 11.1, 11.2, 11.3, 18.5, 18.6
 */
import type { DietInsights, IsoDate, NutritionSummary, Profile, WeightTrendPoint } from "@nutrition/shared";
import { getSummary } from "../../api/nutritionClient.js";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { PeriodToggle, type Period } from "./PeriodToggle.js";
import { GoalProgressBar } from "./charts/GoalProgressBar.js";
import { GuardrailWarningCallout } from "./GuardrailWarningCallout.js";

export interface DietGoalStatusSectionProps {
  /** dietMode is guaranteed non-null here — this screen only renders when diet mode is enabled. */
  nutritionSummary: NutritionSummary;
  dietInsights: DietInsights;
  profile: Profile;
  /** For computing the 7 dates of the target week (Monday-start, matching this spec's established convention). */
  weekStartDate: IsoDate;
  /** Shared with NutritionSummarySection via a future DashboardPage (Requirement 18.6) — a controlled prop, not owned locally. */
  period: Period;
  onPeriodChange: (period: Period) => void;
}

const WEEK_ENERGY_CAPTION = "今週7日間の平均目標（運動量に応じて日により変動）";
const WEEK_AVERAGE_LOADING_MESSAGE = "今週の平均を算出中…";
const WEEK_AVERAGE_ERROR_MESSAGE = "今週の平均を算出できませんでした。";
const GOAL_ETA_UNAVAILABLE_MESSAGE = "見込み期間を算出できません。";
const GOAL_ETA_NO_PROGRESS_MESSAGE = "現在のペースでは目標体重への到達を見込めません。";

/** kcal表示用の整数丸め+桁区切り（NutritionSummarySection.tsx/DayColumn.tsx等と同じ規約）。 */
function formatKcal(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/**
 * 符号付きの丸め整数+桁区切り文字列（例: "+150", "-400"）。`AdviceCallout.tsx` の
 * `formatSignedKcal`/`RecipeDetailModal.tsx` の `formatSignedKcalDelta` と同じ「非負値には
 * 明示的に+を付与する」規約に、桁区切りを組み合わせる。
 */
function formatSignedNumber(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded >= 0 ? "+" : "";
  return `${sign}${rounded.toLocaleString("en-US")}`;
}

/** 小数第1位のkg文字列（例: "5.6", "0.4"）。`NutrientSufficiencyList.tsx` の規約と同じ。 */
function formatKg1(value: number): string {
  return value.toFixed(1);
}

/**
 * `date`（`YYYY-MM-DD`）に`days`日を加算し、UTC真夜中基準で正しく月/年をまたぐ`YYYY-MM-DD`を
 * 返す。このコードベースには日付演算の共有ユーティリティが存在しない
 * （`server/src/menu-generation/menu-plan.service.ts` の非export・モジュールローカルな
 * `addDaysIso`等、各モジュールが独自の小さな日付演算ヘルパーを持つのが確立された前例）。
 * 本ファイルもその前例に倣い、非exportのローカル関数として実装する。
 */
function addDaysIso(date: IsoDate, days: number): IsoDate {
  const parts = date.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const utcDate = new Date(Date.UTC(year, month - 1, day + days));
  return utcDate.toISOString().slice(0, 10) as IsoDate;
}

/**
 * `weightHistory` の先頭要素（時系列最も古い記録という前提）を「開始体重」の代理指標として、
 * 目標体重までの進捗率（0-100、クランプ済み）を算出する。実際のダイエット開始日・開始体重を
 * 記録するフィールドはこのシステムに存在しないため、あくまで入手可能な体重記録のうち最も
 * 古いものを使う近似であることを明示しておく（本ファイル冒頭コメント参照）。
 * `weightHistory` が空の場合は開始体重が不明なため進捗0%として扱う。
 */
function computeFillPercent(
  weightHistory: WeightTrendPoint[],
  currentWeightKg: number,
  goalWeightKg: number,
): number {
  const startWeightKg = weightHistory[0]?.weightKg ?? currentWeightKg;
  // 符号付き: 減量方向なら正、増量方向なら負。
  const totalJourneyKg = startWeightKg - goalWeightKg;
  if (totalJourneyKg === 0) {
    // 開始体重=目標体重（または weightHistory が空で currentWeightKg=goalWeightKg）の場合、
    // 0除算を避け進捗0%として扱う。
    return 0;
  }
  const progressedKg = startWeightKg - currentWeightKg;
  const rawPercent = (progressedKg / totalJourneyKg) * 100;
  // 逆方向に進んでいる場合・目標を超えて進んでいる場合の両方を0-100にクランプする。
  return Math.min(100, Math.max(0, rawPercent));
}

export function DietGoalStatusSection({
  nutritionSummary,
  dietInsights,
  profile,
  weekStartDate,
  period,
  onPeriodChange,
}: DietGoalStatusSectionProps) {
  // Rules of Hooksのため、以降の早期return分岐に関わらず本フックは常に同じ順序で呼び出す。
  const weekAverageState = useAsyncData<number | null>(async () => {
    if (period !== "week") {
      // 「今日」表示中は7回のAPI呼び出しを一切行わない（遅延評価、事前取得はしない）。
      return null;
    }
    const dates = [0, 1, 2, 3, 4, 5, 6].map((offset) => addDaysIso(weekStartDate, offset));
    const results = await Promise.all(dates.map((date) => getSummary(date)));

    const calorieTargets: number[] = [];
    for (const result of results) {
      if (!result.ok) {
        // 7件のうち1件でも失敗した場合、バッチ全体を失敗として扱う（部分平均は行わない）。
        throw new Error("今週の目標エネルギー量の取得に失敗しました。");
      }
      if (result.value.dietMode === null) {
        // このダイエット状況画面が呼び出す前提上あり得ないはずのデータ不整合。
        // 静かに無視せず失敗として扱う。
        throw new Error("今週の目標エネルギー量を算出できませんでした。");
      }
      calorieTargets.push(result.value.dietMode.calorieTarget);
    }

    const total = calorieTargets.reduce((sum, value) => sum + value, 0);
    return total / calorieTargets.length;
  }, [period, weekStartDate]);

  const { dietMode } = nutritionSummary;
  if (dietMode === null) {
    // 防御的分岐（本ファイル冒頭コメント参照）: この画面はダイエットモード有効時のみ表示
    // される前提のため、実際にはここに到達しない想定。クラッシュせず何も描画しない。
    return null;
  }

  const calorieDelta = dietMode.calorieTarget - nutritionSummary.tdee;

  // 本画面のPrecondition（ダイエットモード有効）により非null保証（`ProfileInputSchema` の
  // superRefine参照: dietModeEnabled===trueならgoalWeightKg/goalPeriodWeeksは必須）。
  const goalWeightKg = profile.goalWeightKg!;
  const remainingKg = Math.abs(profile.weightKg - goalWeightKg);
  const fillPercent = computeFillPercent(dietInsights.weightHistory, profile.weightKg, goalWeightKg);

  const { goalEta } = dietInsights;
  let etaMessage: string;
  if (!goalEta.available) {
    etaMessage = GOAL_ETA_UNAVAILABLE_MESSAGE;
  } else if (goalEta.estimatedWeeksToGoal === null) {
    etaMessage = GOAL_ETA_NO_PROGRESS_MESSAGE;
  } else {
    etaMessage =
      `あと ${formatKg1(remainingKg)}kg ・ 週${formatKg1(goalEta.weeklyProgressKg)}kgペースで ` +
      `約${Math.round(goalEta.estimatedWeeksToGoal)}週間後に到達見込み`;
  }

  return (
    <div className="diet-goal-status-section">
      <div className="card-grid">
        <div className="card">
          <h3>目標エネルギー量</h3>
          <PeriodToggle period={period} onPeriodChange={onPeriodChange} weekAvailable={true} />
          {period === "today" ? (
            <div className="period-panel" data-panel="today">
              <div className="hero-num">
                {formatKcal(dietMode.calorieTarget)}
                <small>kcal/日</small>
              </div>
              <div className="hero-sub">維持カロリーより {formatSignedNumber(calorieDelta)}kcal／日</div>
            </div>
          ) : (
            <div className="period-panel" data-panel="week">
              {weekAverageState.isLoading && (
                <p className="week-average-loading">{WEEK_AVERAGE_LOADING_MESSAGE}</p>
              )}
              {!weekAverageState.isLoading && weekAverageState.error !== null && (
                <p className="week-average-error">{WEEK_AVERAGE_ERROR_MESSAGE}</p>
              )}
              {!weekAverageState.isLoading &&
                weekAverageState.error === null &&
                weekAverageState.data !== null && (
                  <>
                    <div className="hero-num">
                      {formatKcal(weekAverageState.data)}
                      <small>kcal/日</small>
                    </div>
                    <div className="hero-sub">{WEEK_ENERGY_CAPTION}</div>
                  </>
                )}
            </div>
          )}
        </div>
        <div className="card">
          <h3>目標体重までの見込み</h3>
          <GoalProgressBar
            currentWeightKg={profile.weightKg}
            goalWeightKg={goalWeightKg}
            fillPercent={fillPercent}
          />
          <div className="hero-sub">{etaMessage}</div>
        </div>
        <div className="card">
          <GuardrailWarningCallout warnings={dietMode.guardrails.warnings} />
        </div>
      </div>
    </div>
  );
}
