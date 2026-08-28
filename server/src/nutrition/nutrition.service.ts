/**
 * NutritionService（栄養計算のオーケストレーション）。
 *
 * design.md（`.kiro/specs/nutrition-engine/design.md`）の `NutritionService` セクション
 * （Requirements 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 12.1, 12.2, 13.4）および「栄養目標値の算出
 * フロー」シーケンス図に定義された通りに、各計算モジュール（`BmrCalculator` /
 * `ActivityCoefficientCalculator` / `PfcCalculator` / `MicronutrientCalculator` /
 * `DietModeCalculator` / `GuardrailEvaluator`）と2つのGateway（`ProfileGateway` /
 * `DailyLogGateway`）をオーケストレーションする。
 *
 * 呼び出し順序はシーケンス図の通りとする:
 *   1. ProfileGateway.getCurrentProfile()（null なら即座に profile_missing エラー, 12.1）
 *   2. DailyLogGateway.getExerciseEntriesForDate(date)
 *   3. BmrCalculator.calculate(bodyInfo)
 *   4. ActivityCoefficientCalculator.calculate(exerciseHabit, weightKg, bmr)
 *   5. tdee = bmr * activityCoefficient
 *   6. dailyExpenditure = tdee + sum(exerciseEntries)
 *   7. PfcCalculator.calculateRatio → PfcCalculator.calculateTargets(tdee, ratio) で通常モード
 *   8. MicronutrientCalculator.calculateTargets
 *   9. dietModeEnabled が true の場合のみ、目標体重・目標達成期間の完備チェック（12.2）を経て
 *      DietModeCalculator → PfcCalculator.calculateTargets（同一のPFC比率を適用）→
 *      GuardrailEvaluator を呼び出す。false の場合は dietMode: null とする（8.2）。
 *
 * 呼び出しのたびに ProfileGateway / DailyLogGateway から最新の値を取得し、結果を一切
 * キャッシュしない（13.4）。本モジュール自身は状態を持たない（クロージャ内の変数はDI対象の
 * Gateway参照のみであり、算出結果は保持しない）。
 */
import type {
  CalculationUnavailableError,
  CalculationUnavailableReason,
  DietInsights,
  IsoDate,
  NutritionSummary,
} from "@nutrition/shared";
import type { Result } from "../shared/result.js";
import { calculateBmr } from "./bmr.calculator.js";
import { calculateActivityCoefficient } from "./activity-coefficient.calculator.js";
import { calculatePfcRatio, calculatePfcTargets } from "./pfc.calculator.js";
import { calculateMicronutrientTargets } from "./micronutrient.calculator.js";
import { calculateDietModeTargetCalorie } from "./diet-mode.calculator.js";
import { evaluateGuardrails } from "./guardrail.evaluator.js";
import { calculateDietInsights } from "./diet-insights.calculator.js";
import { WEIGHT_TREND_LONG_WINDOW_DAYS } from "./constants.js";
import type { DailyLogGateway } from "./daily-log.gateway.js";
import type { ProfileGateway } from "./profile.gateway.js";

/** design.md #NutritionService Service Interface。 */
export interface NutritionService {
  getSummary(date: IsoDate): Result<NutritionSummary, CalculationUnavailableError>;
  getDietInsights(date: IsoDate): Result<DietInsights, CalculationUnavailableError>;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * "YYYY-MM-DD" 形式の `IsoDate` を UTC深夜0時のミリ秒タイムスタンプへ変換する。
 * `diet-insights.calculator.ts`（task 6.3）が採用する「UTC深夜0時解釈によるタイムゾーン非依存の
 * 日付演算」と同一の低レベルアプローチを、本ファイル内で独立に適用する（同モジュールの公開契約は
 * `calculate`（＝`calculateDietInsights`）のみであり、内部の日付演算ヘルパーはexportされていない
 * ためimportできない。設計判断としても、各ファイルが自身の入出力に必要な日付演算だけを持つ方が
 * 依存関係が単純になる）。
 */
function toUtcMidnightMs(date: IsoDate): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

/**
 * `date` から `days` 日前の `IsoDate` を返す（UTC暦日ベース、月・年境界を正しく繰り下げる）。
 * `getDietInsights` が `DailyLogGateway.getWeightLogsInRange` の `from` 引数を算出するためだけに
 * 使う、狭い用途の内部ヘルパー。
 */
function subtractDaysIso(date: IsoDate, days: number): IsoDate {
  const shifted = new Date(toUtcMidnightMs(date) - days * MILLISECONDS_PER_DAY);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 活動レベル表示ラベルの4帯の境界値
 * （design.md Addendum「活動レベル表示ラベル」: 係数レンジ 1.20-1.90（幅0.70）を
 * 均等に4分割。各帯の幅は0.175）。
 *
 * `LOW_UPPER_BOUND = 1.375` は「かなり運動不足」と「運動不足」の境界、
 * `NORMAL_UPPER_BOUND = 1.55` は「運動不足」と「ふつう」の境界、
 * `HEALTHY_LOWER_BOUND = 1.725` は「ふつう」と「健康的」の境界を表す。
 *
 * 境界の帰属は下側の帯を開区間側（境界値自体は上側の帯に含める）とする半開区間
 * `[下限, 上限)` の連なりとして扱い、最終帯（健康的）のみクランプ上限1.90を含む閉区間
 * `[1.725, 1.90]` とする（1.90はActivityCoefficientCalculatorのクランプ上限であり、
 * これを下回る帯が存在しないため、自然に最終帯の一部として扱われる）。
 */
const ACTIVITY_LEVEL_LABEL_LOW_UPPER_BOUND = 1.375;
const ACTIVITY_LEVEL_LABEL_NORMAL_UPPER_BOUND = 1.55;
const ACTIVITY_LEVEL_LABEL_HEALTHY_LOWER_BOUND = 1.725;

const ACTIVITY_LEVEL_LABEL_VERY_LOW = "かなり運動不足";
const ACTIVITY_LEVEL_LABEL_LOW = "運動不足";
const ACTIVITY_LEVEL_LABEL_NORMAL = "ふつう";
const ACTIVITY_LEVEL_LABEL_HEALTHY = "健康的";

/**
 * 活動係数（1.20-1.90の範囲にクランプ済み）を、design.md Addendumの4段階表示ラベルに
 * マッピングする。`ActivityCoefficientCalculator` の出力には含まれない、表示専用の
 * 変換であるため（design.mdの記述通り）本サービス層に置く。
 *
 * 境界は「1.20-1.375: かなり運動不足 / 1.375-1.55: 運動不足 / 1.55-1.725: ふつう /
 * 1.725-1.90: 健康的」という記載を、下側を含む半開区間の連なりとして解釈する
 * （境界値ちょうどは常に上側の帯に属する。例: 1.375 は「運動不足」、1.55 は「ふつう」、
 * 1.725 は「健康的」）。クランプ上限の1.90自体は次の帯が存在しないため「健康的」帯に
 * 含まれる（閉区間）。
 */
export function mapActivityCoefficientToLabel(activityCoefficient: number): string {
  if (activityCoefficient < ACTIVITY_LEVEL_LABEL_LOW_UPPER_BOUND) {
    return ACTIVITY_LEVEL_LABEL_VERY_LOW;
  }
  if (activityCoefficient < ACTIVITY_LEVEL_LABEL_NORMAL_UPPER_BOUND) {
    return ACTIVITY_LEVEL_LABEL_LOW;
  }
  if (activityCoefficient < ACTIVITY_LEVEL_LABEL_HEALTHY_LOWER_BOUND) {
    return ACTIVITY_LEVEL_LABEL_NORMAL;
  }
  return ACTIVITY_LEVEL_LABEL_HEALTHY;
}

/** `CalculationUnavailableError` を組み立てる（design.md Error Envelope）。 */
function calculationUnavailableError(
  reason: CalculationUnavailableReason,
  message: string,
): CalculationUnavailableError {
  return { type: "calculation_unavailable", reason, message };
}

/**
 * `NutritionService` を生成する（design.md #NutritionService Service Interface）。
 *
 * `user-profile` 側で構築済みの `ProfileGateway` / `DailyLogGateway` を受け取るだけの
 * DI（依存性注入）ファクトリ関数パターンであり、`createProfileGateway` /
 * `createDailyLogGateway` と同じ規約に揃えている。本関数自身はGatewayの構築（DB接続等）を
 * 一切行わない。
 */
export function createNutritionService(
  profileGateway: ProfileGateway,
  dailyLogGateway: DailyLogGateway,
): NutritionService {
  function getSummary(date: IsoDate): Result<NutritionSummary, CalculationUnavailableError> {
    // 1. ProfileGateway.getCurrentProfile()（design.md シーケンス図、Requirement 12.1）
    const profile = profileGateway.getCurrentProfile();
    if (profile === null) {
      return {
        ok: false,
        error: calculationUnavailableError(
          "profile_missing",
          "プロフィールが未登録のため、栄養目標値を算出できません。先にプロフィールを登録してください。",
        ),
      };
    }

    // 2. DailyLogGateway.getExerciseEntriesForDate(date)（design.md シーケンス図）
    const exerciseEntries = dailyLogGateway.getExerciseEntriesForDate(date);

    // 3. BmrCalculator.calculate(bodyInfo)
    const bmr = calculateBmr({
      weightKg: profile.weightKg,
      heightCm: profile.heightCm,
      age: profile.age,
      gender: profile.gender,
      bodyFatPct: profile.bodyFatPct,
    });

    // 4. ActivityCoefficientCalculator.calculate(exerciseHabit, weightKg, bmr)
    const activityCoefficient = calculateActivityCoefficient({
      jobActivityLevel: profile.jobActivityLevel,
      commuteMethod: profile.commuteMethod,
      averageDailySteps: profile.averageDailySteps,
      exerciseRoutine: profile.exerciseRoutine,
      weightKg: profile.weightKg,
      bmr,
    });

    // 5. tdee = bmr * activityCoefficient（Requirement 3.1）
    const tdee = bmr * activityCoefficient;

    // 6. dailyExpenditure = tdee + sum(exerciseEntries)（Requirements 4.1, 4.2, 4.3。
    //    指定日付以外のログは DailyLogGateway.getExerciseEntriesForDate(date) が構造上
    //    含めないため、ここでは当該日付の合計を加算するのみでよい）
    const exerciseCaloriesSum = exerciseEntries.reduce(
      (total, entry) => total + entry.estimatedCaloriesBurned,
      0,
    );
    const dailyExpenditureValue = tdee + exerciseCaloriesSum;

    // Addendum: 活動レベル表示ラベル
    const activityLevelLabel = mapActivityCoefficientToLabel(activityCoefficient);

    // 7. PfcCalculator.calculateRatio → calculateTargets(tdee, ratio) で通常モードのPFC
    const pfcRatio = calculatePfcRatio(profile.restrictionType, profile.restrictionIntensity);
    const normalModePfc = calculatePfcTargets(tdee, pfcRatio);

    // 8. MicronutrientCalculator.calculateTargets（ProfileSnapshotのsmokingHabit/alcoholHabitを渡す）
    const micronutrients = calculateMicronutrientTargets(
      profile.gender,
      profile.age,
      profile.smokingHabit,
      profile.alcoholHabit,
    );

    // 9. ダイエットモードの分岐（Requirement 12.2, 8.2）
    let dietMode: NutritionSummary["dietMode"] = null;

    if (profile.dietModeEnabled) {
      if (profile.goalWeightKg === null || profile.goalPeriodWeeks === null) {
        return {
          ok: false,
          error: calculationUnavailableError(
            "incomplete_diet_mode_data",
            "ダイエットモードが有効ですが、目標体重または目標達成期間が未設定のため、ダイエットモードの目標値を算出できません。",
          ),
        };
      }

      const dietModeCalorieTarget = calculateDietModeTargetCalorie(
        profile.weightKg,
        profile.goalWeightKg,
        profile.goalPeriodWeeks,
        tdee,
      );

      // 同一の（食事制限設定に応じて調整済みの）PFC比率をダイエットモードにも適用する
      // （design.md シーケンス図: Svc->Pfc: calculateTargets(dietModeCalorieTarget, pfcRatio)）。
      const dietModePfc = calculatePfcTargets(dietModeCalorieTarget, pfcRatio);

      const guardrails = evaluateGuardrails(
        profile.weightKg,
        profile.goalWeightKg,
        profile.goalPeriodWeeks,
        profile.gender,
        dietModeCalorieTarget,
      );

      dietMode = {
        calorieTarget: dietModeCalorieTarget,
        pfcRatio,
        pfc: dietModePfc,
        guardrails,
      };
    }

    // 10. 結果の組み立て（computedAtは呼び出しのたびに現在時刻を設定し、永続化しない）
    return {
      ok: true,
      value: {
        computedAt: new Date().toISOString(),
        bmr,
        activityCoefficient,
        activityLevelLabel,
        tdee,
        dailyExpenditure: {
          date,
          value: dailyExpenditureValue,
        },
        normalMode: {
          calorieTarget: tdee,
          pfcRatio,
          pfc: normalModePfc,
          micronutrients,
        },
        dietMode,
      },
    };
  }

  /**
   * design.md #NutritionService「`getDietInsights(date)` は...」（Requirements 14.1, 14.2,
   * 15.1, 16.1, 17.1）。
   *
   * `getSummary` とはチェック順序が異なる（3段階の逐次ガード節）: 1. profile_missing →
   * 2. diet_mode_disabled → 3. incomplete_diet_mode_data。`getSummary`にとって
   * `dietModeEnabled: false` は正常系（`dietMode: null`を返すだけ）だが、本メソッドは
   * 「ダイエットモードのインサイト」そのものが目的のため、無効な場合は算出不可として扱う
   * （design.mdの記述通り、`diet_mode_disabled` は本メソッド固有の新規理由）。
   */
  function getDietInsights(date: IsoDate): Result<DietInsights, CalculationUnavailableError> {
    // 1. ProfileGateway.getCurrentProfile()（design.md #NutritionService, Requirement 14.2前段）
    const profile = profileGateway.getCurrentProfile();
    if (profile === null) {
      return {
        ok: false,
        error: calculationUnavailableError(
          "profile_missing",
          "プロフィールが未登録のため、ダイエットインサイトを算出できません。先にプロフィールを登録してください。",
        ),
      };
    }

    // 2. dietModeEnabledがfalseの場合（design.md #NutritionService, Requirement 14.2）
    if (!profile.dietModeEnabled) {
      return {
        ok: false,
        error: calculationUnavailableError(
          "diet_mode_disabled",
          "ダイエットモードが無効なため、ダイエットインサイトを算出できません。ダイエットモードを有効にしてください。",
        ),
      };
    }

    // 3. goalWeightKg / goalPeriodWeeksのいずれかが欠落している場合
    //    （design.md #NutritionService, Requirement 14.2）
    if (profile.goalWeightKg === null || profile.goalPeriodWeeks === null) {
      return {
        ok: false,
        error: calculationUnavailableError(
          "incomplete_diet_mode_data",
          "ダイエットモードが有効ですが、目標体重または目標達成期間が未設定のため、ダイエットインサイトを算出できません。",
        ),
      };
    }

    // 前提を満たす場合、dateから遡ってWEIGHT_TREND_LONG_WINDOW_DAYS日分の体重ログを取得する
    // （design.md #NutritionService, Requirements 14.1, 14.3-14.6, 15, 16, 17）。
    //
    // 「dateから遡ってN日分」の解釈（design.mdの記述自体には軽微なoff-by-oneの曖昧さがある）:
    // 本実装は「date自身を含めて、暦日でちょうどN日分の閉区間」= [date - (N-1)日, date] という
    // 解釈を採用する（日本語の「過去N日分のデータ」という一般的な用法に合わせ、基準日自身を
    // 1日分としてカウントする。対抗する解釈 [date - N日, date] だと閉区間の幅がN+1暦日分になり、
    // 「N日分」という記述と字面上ズレる）。この選択は下のテストファイルの専用テストケースで、
    // 対抗する解釈では失敗する形に固定化されている（tasks.md Implementation Notes task 6.3の
    // 教訓: 曖昧さは選ぶだけでなく、対抗する解釈では失敗するテストで固定化しなければならない）。
    const from = subtractDaysIso(date, WEIGHT_TREND_LONG_WINDOW_DAYS - 1);
    const weightLogs = dailyLogGateway.getWeightLogsInRange(from, date);

    const dietInsights = calculateDietInsights(
      weightLogs,
      profile.weightKg,
      profile.goalWeightKg,
      date,
    );

    return { ok: true, value: dietInsights };
  }

  return { getSummary, getDietInsights };
}
