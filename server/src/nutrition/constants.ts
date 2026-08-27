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

// --- MicronutrientCalculator: 喫煙・飲酒習慣による固定加算量 ---
// design.md #MicronutrientCalculator (Requirements 6.3, 6.4)
// research.md Design Decisions「喫煙・飲酒習慣の微量栄養素目標への反映方法」

/**
 * 喫煙者（`smokingHabit === "smoker"`）向けのビタミンC目標への固定加算量（mg/day）。
 *
 * 出典: 米国医学研究所（Institute of Medicine, 現 National Academies of Sciences,
 * Engineering, and Medicine）の "Dietary Reference Intakes for Vitamin C, Vitamin E,
 * Selenium, and Carotenoids"（2000）は、喫煙による酸化ストレス増大・ビタミンC代謝回転の
 * 増加を踏まえ、喫煙者の推奨量（RDA）を非喫煙者より一律 +35mg/day 高く設定している
 * （非喫煙者基準 男性90mg/女性75mg に対し、喫煙者は男性125mg/女性110mg。
 * https://ods.od.nih.gov/factsheets/VitaminC-HealthProfessional/ 等、複数の一次資料・
 * 専門機関の解説で一貫して引用される確立した値）。「日本人の食事摂取基準」自体は喫煙による
 * 付加量を数値化していないが、research.md Design Decisionsが要求する「頻度区分のみに基づく
 * 固定加算」の具体的な数値として、この国際的に広く採用されている+35mg/dayをそのまま採用する。
 */
export const SMOKING_VITAMIN_C_ADDITION_MG = 35;

/**
 * ⚠️ 暫定値（PROVISIONAL ESTIMATE） ⚠️
 *
 * 多量飲酒者（`alcoholHabit === "frequent"`）向けのビタミンB1目標への固定加算量（mg/day）。
 *
 * **本値は一次資料（厚生労働省の食事摂取基準、臨床ガイドライン等）から直接引用した数値
 * ではない。** SMOKING_VITAMIN_C_ADDITION_MG（IOM/National Academies DRIという確立した
 * 一次資料から直接引用）とは性質が異なり、本値は下記の類推（アナロジー）による
 * 暫定推定値である。実装時のレビューで一度「BLOCKED」として報告すべき内容であったが、
 * ユーザーの明示的判断により「推定値0.5mgを暫定採用」として受理された経緯を持つ
 * （2026-08-27 remediation round 1）。将来、管理栄養士・医師等の専門家による一次資料
 * 確認を経て、正式な数値に置き換えることを強く推奨する。
 *
 * 出典に関する注記（実装時に一次資料を確認したが、確立した固定加算値は見つからなかった）:
 * 「日本人の食事摂取基準」の解説、NIH Office of Dietary Supplements の Thiamin Health
 * Professional Fact Sheet（https://ods.od.nih.gov/factsheets/Thiamin-HealthProfessional/）、
 * および国内の飲酒とビタミンB1に関する複数の解説記事を確認したが、いずれも
 * 「アルコール代謝・吸収阻害によりビタミンB1必要量が増加する」という定性的な記述に
 * とどまり、SMOKING_VITAMIN_C_ADDITION_MGのような一般集団・食事由来の摂取を前提とした
 * 確立済みの「+Xmg/day」固定加算値は見つからなかった。ウェルニッケ脳症予防のための
 * 臨床的なチアミン予防投与量（アルコール依存症患者に対する経口/注射で100mg/day程度）は
 * 存在するが、これは診断された患者への医療的予防投与量であり、本specが対象とする
 * 一般利用者の「よく飲む」という食習慣区分に基づく食事摂取目標へそのまま転用するには
 * 大きすぎ、不適切である。
 *
 * **暫定値の算出方法（類推であり一次資料の裏付けはない）**: SMOKING_VITAMIN_C_ADDITION_MG
 * （非喫煙者基準100mgに対し+35mg、約35%相当の加算）と同程度の比率を、ビタミンB1の
 * 代表的な成人推奨量（男性30-49歳: 1.4mg, 1.4 × 0.35 ≈ 0.49 → 0.5に丸め）に機械的に
 * 適用しただけの値であり、飲酒とビタミンB1必要量との実際の用量反応関係を示す
 * エビデンスには基づいていない。
 *
 * 本アプリは健康関連情報を扱うため、管理栄養士等の専門家によるレビューを経て確定させる
 * ことを推奨するフォローアップ事項として扱う（research.md Design Decisions
 * 「喫煙・飲酒習慣の微量栄養素目標への反映方法」Trade-offs参照）。
 */
export const HEAVY_DRINKING_VITAMIN_B1_ADDITION_MG = 0.5;
