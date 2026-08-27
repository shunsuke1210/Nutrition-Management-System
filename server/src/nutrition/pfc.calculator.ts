/**
 * PfcCalculator（PFC比率調整・グラム換算モジュール）。
 *
 * design.md（`.kiro/specs/nutrition-engine/design.md`）の `PfcCalculator` セクション
 * （Requirements 5.1, 5.2, 5.3, 7.1, 7.2, 7.3, 7.4, 7.5, 9.1, 9.2）に定義された
 * 計算式をそのまま実装する純粋関数モジュール。
 *
 * - `calculateRatio`（本モジュールでは `calculatePfcRatio`）: `restrictionType` ×
 *   `restrictionIntensity` に応じたPFC比率を `constants.ts` の
 *   `PFC_RATIO_ADJUSTMENT_TABLE` から参照して返す（7.1, 7.2）。`restrictionType` が
 *   `none` / `calorie_only` の場合は `restrictionIntensity` の値に関わらずベース比率
 *   （`PFC_BASE_RATIO` = protein 0.15 / fat 0.25 / carb 0.60）を維持する（7.3）。
 *   「その他食事制限」の自由記述（`restrictionNotes`）は本モジュールの入力に含めない（7.4）。
 * - `calculateTargets`（本モジュールでは `calculatePfcTargets`）: 目標カロリーとPFC比率
 *   から、Atwater係数（たんぱく質4kcal/g、脂質9kcal/g、炭水化物4kcal/g。design.md
 *   `PfcCalculator` Responsibilities & Constraints に明記）を用いてグラム・カロリー換算値を
 *   算出する。`PFC_RATIO_ADJUSTMENT_TABLE` の各行は3値の合計が1になるよう構成されている
 *   ため、`proteinKcal + fatKcal + carbKcal` は常に `calorieTarget` と（浮動小数点誤差の
 *   範囲で）一致し、design.md が要求する±1kcalの許容誤差を満たす（5.3, 7.5）。
 *
 * 通常モード（Requirement 5.1, 5.2）とダイエットモード（Requirement 9.1, 9.2）は
 * いずれも「目標カロリーに調整後のPFC比率を適用する」という同一の `calculatePfcTargets`
 * 呼び出しで表現される。呼び出し元（`NutritionService`, task 3）がTDEEまたはダイエット
 * モード目標カロリーのいずれを渡すかを判断するだけであり、本モジュールはどちらの
 * カロリー値を受け取っても同一のロジックで動作する。
 */
import type {
  PfcRatio,
  PfcTargets,
  RestrictionIntensity,
  RestrictionType,
} from "@nutrition/shared";
import { PFC_BASE_RATIO, PFC_RATIO_ADJUSTMENT_TABLE, type PfcRatioValues } from "./constants.js";

/**
 * Atwater係数（design.md #PfcCalculator Responsibilities & Constraints:
 * 「グラム換算はAtwater係数（たんぱく質4kcal/g、脂質9kcal/g、炭水化物4kcal/g）を用いる」）。
 *
 * `constants.ts` の対象は「PFC比率調整テーブル」等の複数コンポーネントにまたがる名前付き
 * 定数であり、Atwater係数は `PfcCalculator` 固有の変換係数であるため本ファイル内に
 * ローカル定数として保持する（design.md はこれらを `constants.ts` の管理対象として
 * 明示していない）。
 */
const PROTEIN_KCAL_PER_G = 4;
const FAT_KCAL_PER_G = 9;
const CARB_KCAL_PER_G = 4;

/** `constants.ts` の `{protein, fat, carb}` 形状を `PfcRatio`（`{proteinPct, fatPct, carbPct}`）に変換する。 */
function toPfcRatio(values: PfcRatioValues): PfcRatio {
  return {
    proteinPct: values.protein,
    fatPct: values.fat,
    carbPct: values.carb,
  };
}

/**
 * 食事制限タイプ×強度に応じたPFC比率を算出する
 * （design.md PfcCalculator Service Interface: `calculateRatio`）。
 *
 * - `restrictionType` が `none` または `calorie_only` の場合、`restrictionIntensity` の値に
 *   関わらずベース比率（`PFC_BASE_RATIO`）を返す（Requirement 7.3の文言「強度に関わらず」を
 *   そのまま反映し、`restrictionIntensity` が非nullで渡された場合でも無視する）。
 * - それ以外（`low_carb` / `low_fat` / `high_protein`）は、`PFC_RATIO_ADJUSTMENT_TABLE` から
 *   `(restrictionType, restrictionIntensity)` の完全一致行を検索して返す。
 *
 *   `user-profile` の `ProfileInputSchema.superRefine`（`shared/src/profile.schema.ts`）に
 *   より、`restrictionType !== "none"` の場合 `restrictionIntensity` は必須（非null）として
 *   上流で保証されている。したがって本モジュールが正当な呼び出し元から受け取る限り、
 *   `low_carb` / `low_fat` / `high_protein` に対して `restrictionIntensity` が `null` に
 *   なることはない。ただし、この契約が破られた場合（テーブルに一致行が存在しない場合）は、
 *   `BmrCalculator` の `assertPositiveBmr` と同様の方針で、誤った比率を静かに返す・
 *   フォールバックするのではなく例外を投げて早期に問題を顕在化させる。
 */
export function calculatePfcRatio(
  restrictionType: RestrictionType,
  restrictionIntensity: RestrictionIntensity | null,
): PfcRatio {
  if (restrictionType === "none" || restrictionType === "calorie_only") {
    return toPfcRatio(PFC_BASE_RATIO);
  }

  const row = PFC_RATIO_ADJUSTMENT_TABLE.find(
    (candidate) =>
      candidate.restrictionType === restrictionType &&
      candidate.restrictionIntensity === restrictionIntensity,
  );

  if (!row) {
    throw new Error(
      "PfcCalculator: restrictionType=" +
        JSON.stringify(restrictionType) +
        " に対応する restrictionIntensity=" +
        JSON.stringify(restrictionIntensity) +
        " の調整テーブル行が見つかりません。" +
        "user-profileのProfileInputSchema.superRefineにより、restrictionTypeが'none'以外の" +
        "場合はrestrictionIntensityが必須のはずであり、この状態は契約違反を示します。",
    );
  }

  return toPfcRatio(row);
}

/**
 * 目標カロリーとPFC比率から、グラム・カロリー換算値を算出する
 * （design.md PfcCalculator Service Interface: `calculateTargets`）。
 *
 * Atwater係数（protein/carb=4kcal/g, fat=9kcal/g）でカロリーからグラムへ換算する。
 * `ratio` の3値（`proteinPct + fatPct + carbPct`）は常に1になるよう構成されているため、
 * `proteinKcal + fatKcal + carbKcal` は `calorieTarget` と一致する（5.3, 7.5）。
 * design.md はグラム値の丸めを明示的に要求していないため、換算後の生の数値をそのまま返す。
 */
export function calculatePfcTargets(calorieTarget: number, ratio: PfcRatio): PfcTargets {
  const proteinKcal = calorieTarget * ratio.proteinPct;
  const fatKcal = calorieTarget * ratio.fatPct;
  const carbKcal = calorieTarget * ratio.carbPct;

  return {
    proteinG: proteinKcal / PROTEIN_KCAL_PER_G,
    fatG: fatKcal / FAT_KCAL_PER_G,
    carbG: carbKcal / CARB_KCAL_PER_G,
    proteinKcal,
    fatKcal,
    carbKcal,
  };
}
