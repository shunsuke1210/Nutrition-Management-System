/**
 * nutrition-engine の計算定数モジュール。
 *
 * design.md（`.kiro/specs/nutrition-engine/design.md`）に記載された各計算式の
 * 数値定数をここに集約する。`BmrCalculator` / `ActivityCoefficientCalculator` /
 * `PfcCalculator` / `DietModeCalculator` / `GuardrailEvaluator`（いずれも本タスク以降で
 * 実装）は、このモジュールが定義する定数のみを参照し、計算式中にマジックナンバーを
 * 直接埋め込まない。
 *
 * 対象外: `DietInsightsCalculator` が用いる体重推移分析関連の定数
 * （`WEIGHT_TREND_LONG_WINDOW_DAYS` 等、design.md の DietInsightsCalculator セクション）は
 * tasks.md の task 6.2 のスコープであり、本ファイルには含めない。
 */
import type {
  CommuteMethod,
  ExerciseIntensity,
  Gender,
  JobActivityLevel,
  RestrictionIntensity,
  RestrictionType,
} from "@nutrition/shared";

// --- BmrCalculator: Mifflin-St Jeor式の性別オフセット ---
// design.md #BmrCalculator (Requirement 2.3)

/**
 * Mifflin-St Jeor式の性別オフセット。
 * `undisclosed` は male/female オフセットの平均値（(5 + -161) / 2 = -78）であり、
 * 性別未回答でも算出可能にする。
 */
export const MIFFLIN_GENDER_OFFSET: Readonly<Record<Gender, number>> = {
  male: 5,
  female: -161,
  undisclosed: -78,
};

// --- ActivityCoefficientCalculator: 活動係数の算出式 ---
// design.md #ActivityCoefficientCalculator > 計算式ブロック (Requirements 1.1-1.5)

/** お仕事中の活動度別のベース活動係数。 */
export const ACTIVITY_COEFFICIENT_BASE: Readonly<Record<JobActivityLevel, number>> = {
  mostly_sedentary: 1.2,
  mixed: 1.375,
  mostly_active: 1.55,
};

/** 通勤手段による加算補正。 */
export const ACTIVITY_COEFFICIENT_COMMUTE_ADJUSTMENT: Readonly<Record<CommuteMethod, number>> = {
  walk_or_bike: 0.05,
  transit: 0.025,
  car: 0.0,
};

/**
 * 平均歩数による加算補正の1階層分。
 * `minSteps`（以上）〜 `maxSteps`（未満。`null` の場合は上限なし）の範囲に
 * `adjustment` を適用する。`averageDailySteps` が `null` の場合の扱い（5,000未満と
 * 同一の階層を適用する）は呼び出し側の `ActivityCoefficientCalculator` が判定する。
 */
export interface StepAdjustmentTier {
  readonly minSteps: number;
  readonly maxSteps: number | null;
  readonly adjustment: number;
}

/**
 * 平均歩数による加算補正の5段階テーブル。
 * design.md: null または <5,000: +0.000 / 5,000-7,499: +0.025 / 7,500-9,999: +0.050 /
 * 10,000-12,499: +0.075 / >=12,500: +0.100
 */
export const ACTIVITY_COEFFICIENT_STEP_ADJUSTMENT_TIERS: readonly StepAdjustmentTier[] = [
  { minSteps: 0, maxSteps: 5000, adjustment: 0.0 },
  { minSteps: 5000, maxSteps: 7500, adjustment: 0.025 },
  { minSteps: 7500, maxSteps: 10000, adjustment: 0.05 },
  { minSteps: 10000, maxSteps: 12500, adjustment: 0.075 },
  { minSteps: 12500, maxSteps: null, adjustment: 0.1 },
];

/** 運動強度別のMET値（週間運動量の消費カロリー換算に用いる）。 */
export const ACTIVITY_COEFFICIENT_MET: Readonly<Record<ExerciseIntensity, number>> = {
  light: 3.0,
  moderate: 4.5,
  vigorous: 7.0,
};

/** 活動係数のクランプ範囲の下限。 */
export const ACTIVITY_COEFFICIENT_MIN = 1.2;

/** 活動係数のクランプ範囲の上限。 */
export const ACTIVITY_COEFFICIENT_MAX = 1.9;

// --- PfcCalculator: PFC比率調整テーブル ---
// design.md #PfcCalculator (Requirements 5.1, 7.1-7.3)

/** PFC比率の値（protein/fat/carbの3値、合計は1）。 */
export interface PfcRatioValues {
  readonly protein: number;
  readonly fat: number;
  readonly carb: number;
}

/** ベースのPFC比率（食事制限なし、またはカロリー制限のみの場合）。 */
export const PFC_BASE_RATIO: PfcRatioValues = {
  protein: 0.15,
  fat: 0.25,
  carb: 0.6,
};

/** PFC比率調整テーブルの1行。 */
export interface PfcRatioAdjustmentRow extends PfcRatioValues {
  readonly restrictionType: RestrictionType;
  /** `restrictionType` が `none` / `calorie_only` の場合は intensity を問わず `null`。 */
  readonly restrictionIntensity: RestrictionIntensity | null;
}

/**
 * 食事制限タイプ×強度によるPFC比率調整テーブル（design.md PfcCalculator セクションの表を
 * 11行そのまま再現する）。`none` / `calorie_only` は `restrictionIntensity` の値に関わらず
 * ベース比率（`PFC_BASE_RATIO`）を維持する（Requirement 7.3）。
 */
export const PFC_RATIO_ADJUSTMENT_TABLE: readonly PfcRatioAdjustmentRow[] = [
  { restrictionType: "none", restrictionIntensity: null, ...PFC_BASE_RATIO },
  { restrictionType: "calorie_only", restrictionIntensity: null, ...PFC_BASE_RATIO },
  { restrictionType: "low_carb", restrictionIntensity: "light", protein: 0.2, fat: 0.35, carb: 0.45 },
  { restrictionType: "low_carb", restrictionIntensity: "standard", protein: 0.25, fat: 0.4, carb: 0.35 },
  { restrictionType: "low_carb", restrictionIntensity: "strict", protein: 0.3, fat: 0.5, carb: 0.2 },
  { restrictionType: "low_fat", restrictionIntensity: "light", protein: 0.18, fat: 0.2, carb: 0.62 },
  { restrictionType: "low_fat", restrictionIntensity: "standard", protein: 0.2, fat: 0.15, carb: 0.65 },
  { restrictionType: "low_fat", restrictionIntensity: "strict", protein: 0.2, fat: 0.1, carb: 0.7 },
  { restrictionType: "high_protein", restrictionIntensity: "light", protein: 0.25, fat: 0.25, carb: 0.5 },
  { restrictionType: "high_protein", restrictionIntensity: "standard", protein: 0.3, fat: 0.25, carb: 0.45 },
  { restrictionType: "high_protein", restrictionIntensity: "strict", protein: 0.35, fat: 0.25, carb: 0.4 },
];

// --- DietModeCalculator: エネルギー収支換算定数 ---
// design.md #DietModeCalculator (Requirement 8.1)

/**
 * 体重1kgあたりのエネルギー収支換算係数（kcal/kg）。
 * `DietInsightsCalculator`（task 6.2以降）も同一の値を本定数から参照し、二重管理しない
 * （design.md #DietInsightsCalculator 17.4）。
 */
export const ENERGY_DENSITY_KCAL_PER_KG = 7700;

// --- GuardrailEvaluator: 安全ガードレール閾値 ---
// design.md #GuardrailEvaluator (Requirements 10.1, 11.1)

/** 性別に応じた最低摂取カロリー基準（kcal/day）。 */
export const MIN_CALORIE_FLOOR: Readonly<Record<Gender, number>> = {
  male: 1500,
  female: 1200,
  undisclosed: 1500,
};

/** 体重に対する週あたりの最大安全減量ペース比率（現在の体重の1%/週）。 */
export const MAX_WEEKLY_LOSS_PACE_RATIO = 0.01;
