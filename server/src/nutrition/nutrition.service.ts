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
import type { DailyLogGateway } from "./daily-log.gateway.js";
import type { ProfileGateway } from "./profile.gateway.js";

/** design.md #NutritionService Service Interface。 */
export interface NutritionService {
  getSummary(date: IsoDate): Result<NutritionSummary, CalculationUnavailableError>;
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

  return { getSummary };
}
