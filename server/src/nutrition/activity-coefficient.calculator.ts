/**
 * ActivityCoefficientCalculator（活動係数算出モジュール）。
 *
 * design.md（`.kiro/specs/nutrition-engine/design.md`）の `ActivityCoefficientCalculator`
 * セクション（Requirements 1.1-1.5）に定義された計算式をそのまま実装する純粋関数モジュール。
 *
 * - 仕事中の活動度（`jobActivityLevel`）をベース係数とし、通勤手段（`commuteMethod`）・
 *   平均歩数（`averageDailySteps`）の加算補正、週間運動量（`exerciseRoutine`）をMET換算
 *   した消費カロリーからBMR比で加算する補正（`ExerciseAdjustment`）を合成する（1.1）。
 * - 利用者への活動レベルの直接選択は要求しない。運動習慣データのみから算出する（1.2）。
 * - `jobActivityLevel` / `commuteMethod` の欠落チェック（Requirement 1.3）は本コンポーネントの
 *   責務ではない。`BmrCalculator`（task 2.1）と同じパターンにより、その検証は
 *   `NutritionService` が `ProfileGateway` から取得したプロフィールの必須項目チェックとして
 *   行う（`user-profile` 側で必須項目として保証済みのため、本コンポーネントは型レベルで
 *   非null値のみを受け取る）。
 * - `averageDailySteps` が `null`、または `exerciseRoutine` が空配列の場合、それぞれの
 *   補正をゼロとして扱う（1.4）。
 * - 算出結果を `[ACTIVITY_COEFFICIENT_MIN, ACTIVITY_COEFFICIENT_MAX]`（1.20-1.90）の範囲に
 *   クランプする（1.5）。
 */
import type {
  CommuteMethod,
  ExerciseRoutineEntryInput,
  JobActivityLevel,
} from "@nutrition/shared";
import {
  ACTIVITY_COEFFICIENT_BASE,
  ACTIVITY_COEFFICIENT_COMMUTE_ADJUSTMENT,
  ACTIVITY_COEFFICIENT_MAX,
  ACTIVITY_COEFFICIENT_MET,
  ACTIVITY_COEFFICIENT_MIN,
  ACTIVITY_COEFFICIENT_STEP_ADJUSTMENT_TIERS,
} from "./constants.js";

/**
 * ActivityCoefficientCalculator の入力（design.md ActivityCoefficientCalculator
 * Service Interface: `ActivityCoefficientInput`）。
 *
 * `NutritionService` と `ActivityCoefficientCalculator` の間の内部契約であり、HTTP境界で
 * 検証される形状ではないため、Zod スキーマではなくプレーンな TypeScript 型として定義する
 * （`bmr.calculator.ts` の `BmrInput` と同じ方針）。列挙型（`JobActivityLevel` /
 * `CommuteMethod`）および `exerciseRoutine` の行の形状（`ExerciseRoutineEntryInput`）は
 * `@nutrition/shared` が既に定義するものをそのまま再利用し、重複定義しない
 * （`ExerciseRoutineEntryInput` は design.md の `ExerciseRoutineEntry`
 * `{ scene, content, frequencyPerWeek, durationMinutes, intensity }` と同一の形状）。
 */
export interface ActivityCoefficientInput {
  jobActivityLevel: JobActivityLevel;
  commuteMethod: CommuteMethod;
  /** 1日の平均歩数。登録なしは `null`（Requirement 1.4）。 */
  averageDailySteps: number | null;
  /** 場面別の週間運動量。登録が1件もない場合は空配列（Requirement 1.4）。 */
  exerciseRoutine: ExerciseRoutineEntryInput[];
  /** 週間運動量のMET換算に用いる体重（kg）。 > 0 */
  weightKg: number;
  /** `ExerciseAdjustment` の除数に用いるBMR（kcal/day）。 > 0 */
  bmr: number;
}

/** 指定された値を `[min, max]` の範囲に収める。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * `averageDailySteps` から `StepAdjustment` を求める（design.md 計算式ブロック:
 * `StepAdjustment(averageDailySteps)`）。
 *
 * `null` の場合はゼロとして扱う（1.4）。非nullの場合は
 * `ACTIVITY_COEFFICIENT_STEP_ADJUSTMENT_TIERS`（task 1.2で定義済みの半開区間
 * `[minSteps, maxSteps)` の5階層テーブル。`maxSteps === null` は上限なしを表す）を
 * 先頭から走査し、`minSteps <= averageDailySteps` かつ
 * (`maxSteps === null` または `averageDailySteps < maxSteps`) を満たす最初の階層の
 * `adjustment` を返す。テーブルは `[0, ∞)` を漏れなく被覆するため、非nullな非負の
 * `averageDailySteps` に対して必ずいずれかの階層が一致する。
 */
function resolveStepAdjustment(averageDailySteps: number | null): number {
  if (averageDailySteps === null) {
    return 0;
  }

  const tier = ACTIVITY_COEFFICIENT_STEP_ADJUSTMENT_TIERS.find(
    (candidate) =>
      averageDailySteps >= candidate.minSteps &&
      (candidate.maxSteps === null || averageDailySteps < candidate.maxSteps),
  );

  return tier?.adjustment ?? 0;
}

/**
 * `exerciseRoutine` の各行から `weeklyExerciseKcal` を合算する（design.md 計算式ブロック:
 * `weeklyExerciseKcal = Σ [ MET(intensity) × 3.5 × weightKg / 200 × durationMinutes × frequencyPerWeek ]`）。
 *
 * 空配列の場合は0を返す（1.4）。
 */
function calculateWeeklyExerciseKcal(
  exerciseRoutine: ExerciseRoutineEntryInput[],
  weightKg: number,
): number {
  return exerciseRoutine.reduce((total, entry) => {
    const met = ACTIVITY_COEFFICIENT_MET[entry.intensity];
    const rowKcal = ((met * 3.5 * weightKg) / 200) * entry.durationMinutes * entry.frequencyPerWeek;
    return total + rowKcal;
  }, 0);
}

/**
 * 活動係数を算出する（design.md ActivityCoefficientCalculator Service Interface: `calculate`）。
 *
 * 計算式（design.md 計算式ブロックをそのまま実装）:
 *   BaseCoefficient = ACTIVITY_COEFFICIENT_BASE[jobActivityLevel]
 *   CommuteAdjustment = ACTIVITY_COEFFICIENT_COMMUTE_ADJUSTMENT[commuteMethod]
 *   StepAdjustment = resolveStepAdjustment(averageDailySteps)
 *   weeklyExerciseKcal = Σ [ MET(intensity) × 3.5 × weightKg / 200 × durationMinutes × frequencyPerWeek ]
 *   ExerciseAdjustment = (weeklyExerciseKcal / 7) / bmr
 *   ActivityCoefficient = clamp(Base + Commute + Step + Exercise, ACTIVITY_COEFFICIENT_MIN, ACTIVITY_COEFFICIENT_MAX)
 */
export function calculateActivityCoefficient(input: ActivityCoefficientInput): number {
  const baseCoefficient = ACTIVITY_COEFFICIENT_BASE[input.jobActivityLevel];
  const commuteAdjustment = ACTIVITY_COEFFICIENT_COMMUTE_ADJUSTMENT[input.commuteMethod];
  const stepAdjustment = resolveStepAdjustment(input.averageDailySteps);

  const weeklyExerciseKcal = calculateWeeklyExerciseKcal(input.exerciseRoutine, input.weightKg);
  const exerciseAdjustment = weeklyExerciseKcal / 7 / input.bmr;

  const rawCoefficient = baseCoefficient + commuteAdjustment + stepAdjustment + exerciseAdjustment;

  return clamp(rawCoefficient, ACTIVITY_COEFFICIENT_MIN, ACTIVITY_COEFFICIENT_MAX);
}
