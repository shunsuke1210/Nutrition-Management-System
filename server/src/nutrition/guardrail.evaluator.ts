/**
 * GuardrailEvaluator（ダイエット安全ガードレール判定モジュール）。
 *
 * design.md（`.kiro/specs/nutrition-engine/design.md`）の `GuardrailEvaluator` セクション
 * （Requirements 10.1, 10.2, 10.3, 11.1, 11.2, 11.3, 11.4）に定義された判定式をそのまま
 * 実装する純粋関数モジュール。
 *
 * - 性別に応じた最低摂取カロリー基準（`MIN_CALORIE_FLOOR`）は、ダイエットの方向
 *   （減量/維持/増量）に関わらず常に評価する（10.1-10.3）。
 * - 体重に対する週あたりの最大安全減量ペース（`MAX_WEEKLY_LOSS_PACE_RATIO` = 現在の体重の
 *   1%/週）は、減量方向（`currentWeightKg > goalWeightKg`）の場合のみ評価する。維持・増量
 *   方向ではこの判定自体をスキップする（11.3）。
 * - 抵触時は算出済みの目標カロリー・PFCを一切変更しない（本関数はそもそも目標カロリー・PFCを
 *   受け取らず、`dietModeTargetCalorie` を判定条件として参照するのみで、変更も返却もしない。
 *   10.3）。警告フラグと、少なくとも1件の修正提案（期間延長案 `extend_period` ・目標体重
 *   緩和案 `ease_goal_weight`）を返す（10.2, 11.2）。
 * - 両方に抵触した場合、両方の警告と対応する修正提案をそれぞれ独立に返す（11.4）。返す順序は
 *   design.md の「ガードレール判定フロー」フローチャート（AddPaceWarning → FloorCheck →
 *   AddFloorWarning → Result）に合わせ、`max_weekly_loss_pace` を先、`min_calorie_floor` を
 *   後とする。
 *
 * ## 修正提案の算出式
 *
 * ### 最大減量ペース警告（design.md 判定式ブロックにそのまま記載）
 * ```
 * suggestedGoalPeriodWeeks = ceil((currentWeightKg - goalWeightKg) / maxSafeWeeklyLossKg)
 * suggestedGoalWeightKg    = round(currentWeightKg - maxSafeWeeklyLossKg * goalPeriodWeeks, 1)
 * ```
 * design.md の判定式ブロックはこの警告について期間延長案・目標体重緩和案の両方の値を明示的に
 * 計算しているため、本実装も両方を `suggestions` に含める（要件の「少なくとも1件」という
 * 文言は下限を示すものであり、design.md が実際に算出する値を省く理由にはならない）。
 *
 * ### 最低摂取カロリー警告
 * design.md のコメント「同じ逆算式を『期間』または『目標体重』について解き直し、
 * dietModeTargetCalorie が MIN_CALORIE_FLOOR[gender] と等しくなる値を提案する」を、
 * `DietModeCalculator`（task 2.5, `diet-mode.calculator.ts`）の式
 * `targetCalorie = tdee - (currentWeightKg - goalWeightKg) * ENERGY_DENSITY_KCAL_PER_KG / (goalPeriodWeeks * 7)`
 * を対象変数について解き直すことで実装する。`DietModeCalculator` 自体は呼び出さない
 * （design.md「同じ数式の逆算であり、新たな計算モデルを導入しない」という注記の通り、
 * 軽量なローカルな逆算に留める。共有の抽象化は導入しない）。
 *
 * 本関数の入力には `tdee` が含まれない（design.md Service Interface の `evaluate` は `tdee`
 * を受け取らない）。しかし `dietModeTargetCalorie` と、判定対象の `currentWeightKg` /
 * `goalWeightKg` / `goalPeriodWeeks`（＝ `DietModeCalculator` が実際に使用した入力値）から、
 * `DietModeCalculator` と同一の式で `dailyCalorieAdjustmentOriginal` を再計算し、
 * `tdee = dietModeTargetCalorie + dailyCalorieAdjustmentOriginal` として `tdee` を一意に
 * 復元できる。これは新たな仮定を持ち込むものではなく、
 * `DietModeCalculator.calculateTargetCalorie` の式をそのまま逆向きに読むだけである。
 *
 * `dailyCalorieAdjustmentNeeded = tdee - MIN_CALORIE_FLOOR[gender]` を「目標カロリーが
 * ちょうど最低摂取カロリー基準と一致するために許容できる1日あたりのカロリー収支調整量」として
 * 定義すると:
 * - `suggestedGoalPeriodWeeks`（期間延長案、goalWeightKg を固定）:
 *   `ceil((currentWeightKg - goalWeightKg) * ENERGY_DENSITY_KCAL_PER_KG / (dailyCalorieAdjustmentNeeded * 7))`
 *   ただし `dailyCalorieAdjustmentNeeded <= 0`（tdee 自体がすでに最低摂取カロリー基準以下、
 *   つまりどれだけ期間を延ばしても targetCalorie は tdee に漸近するだけで基準を上回れない
 *   場合）は、有限の期間延長では基準を満たせないため、この提案を省略する（`suggestions`
 *   配列に含めない。`ease_goal_weight` 提案は常に算出可能なため、`suggestions` が空になる
 *   ことはなく、常に1件以上を保証できる）。
 * - `suggestedGoalWeightKg`（目標体重緩和案、goalPeriodWeeks を固定）:
 *   `round(currentWeightKg - dailyCalorieAdjustmentNeeded * goalPeriodWeeks * 7 / ENERGY_DENSITY_KCAL_PER_KG, 1)`
 *   こちらは `dailyCalorieAdjustmentNeeded` の符号に関わらず常に有限の値として算出できる
 *   （tdee 自体が基準以下の極端なケースでは現在の体重以上の値が提案される＝実質的に
 *   「減量ではなく維持・増量へ方針転換する」提案になるが、これは数式上自然に導かれる結果で
 *   あり、特別分岐は設けない）。
 */
import type {
  Gender,
  GuardrailResult,
  GuardrailSuggestion,
  GuardrailWarning,
} from "@nutrition/shared";
import { ENERGY_DENSITY_KCAL_PER_KG, MAX_WEEKLY_LOSS_PACE_RATIO, MIN_CALORIE_FLOOR } from "./constants.js";

/** 数値を小数第1位で四捨五入する（design.md #GuardrailEvaluator の `round(x, 1)` 表記に対応）。 */
function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * 安全ガードレール（最低摂取カロリー基準・最大減量ペース上限）を判定する
 * （design.md GuardrailEvaluator Service Interface: `evaluate`）。
 *
 * @param currentWeightKg 現在の体重（kg）
 * @param goalWeightKg 目標体重（kg）
 * @param goalPeriodWeeks 目標達成期間（週）
 * @param gender 性別（最低摂取カロリー基準 `MIN_CALORIE_FLOOR` の参照に用いる）
 * @param dietModeTargetCalorie `DietModeCalculator.calculateTargetCalorie` が算出した
 *   ダイエットモードの1日あたり目標カロリー（kcal/day）。本関数はこの値を判定条件として
 *   参照するのみで、変更・返却しない（10.3）。
 * @returns 抵触なしの場合は `{ warnings: [] }`。抵触した場合は該当する警告
 *   （`max_weekly_loss_pace` / `min_calorie_floor`）を、それぞれ独立に含む配列を返す（11.4）。
 */
export function evaluateGuardrails(
  currentWeightKg: number,
  goalWeightKg: number,
  goalPeriodWeeks: number,
  gender: Gender,
  dietModeTargetCalorie: number,
): GuardrailResult {
  const warnings: GuardrailWarning[] = [];

  const isLossDirection = currentWeightKg > goalWeightKg;
  const maxSafeWeeklyLossKg = currentWeightKg * MAX_WEEKLY_LOSS_PACE_RATIO;

  // 最大減量ペース警告（減量方向の場合のみ評価。11.3: 維持・増量方向ではこの判定自体を
  // スキップする。方向以外の理由で「たまたま抵触しない」のではなく、isLossDirection が
  // false の間は weeklyPaceKg を計算すらしない）。
  if (isLossDirection) {
    const weeklyPaceKg = (currentWeightKg - goalWeightKg) / goalPeriodWeeks;

    if (weeklyPaceKg > maxSafeWeeklyLossKg) {
      const suggestedGoalPeriodWeeks = Math.ceil(
        (currentWeightKg - goalWeightKg) / maxSafeWeeklyLossKg,
      );
      const suggestedGoalWeightKg = roundToOneDecimal(
        currentWeightKg - maxSafeWeeklyLossKg * goalPeriodWeeks,
      );

      warnings.push({
        type: "max_weekly_loss_pace",
        message:
          `週あたりの減量ペース（約${weeklyPaceKg.toFixed(2)}kg/週）が、` +
          `安全な上限（現在の体重の${(MAX_WEEKLY_LOSS_PACE_RATIO * 100).toFixed(0)}%＝約` +
          `${maxSafeWeeklyLossKg.toFixed(2)}kg/週）を超えています。` +
          "目標達成期間の延長、または目標体重の緩和を検討してください。",
        suggestions: [
          { kind: "extend_period", suggestedGoalPeriodWeeks },
          { kind: "ease_goal_weight", suggestedGoalWeightKg },
        ],
      });
    }
  }

  // 最低摂取カロリー警告（方向に関わらず常に評価する。10.1-10.3）。
  const minCalorieFloor = MIN_CALORIE_FLOOR[gender];

  if (dietModeTargetCalorie < minCalorieFloor) {
    // DietModeCalculator（diet-mode.calculator.ts）と同一の式で、今回の入力から
    // dailyCalorieAdjustment を再計算する。新たな計算モデルではなく、
    // DietModeCalculator.calculateTargetCalorie の式をそのまま再適用するだけである。
    const dailyCalorieAdjustmentOriginal =
      ((currentWeightKg - goalWeightKg) * ENERGY_DENSITY_KCAL_PER_KG) / (goalPeriodWeeks * 7);
    // targetCalorie = tdee - dailyCalorieAdjustmentOriginal だったので、tdee を逆算する
    // （本関数は tdee を直接受け取らないため、dietModeTargetCalorie から復元する）。
    const tdee = dietModeTargetCalorie + dailyCalorieAdjustmentOriginal;
    // 目標カロリーがちょうど最低摂取カロリー基準と一致するために許容できる、
    // 1日あたりのカロリー収支調整量。
    const dailyCalorieAdjustmentNeeded = tdee - minCalorieFloor;

    const suggestions: GuardrailSuggestion[] = [];

    // 期間延長案: dailyCalorieAdjustmentNeeded <= 0 の場合、tdee 自体がすでに最低摂取
    // カロリー基準以下であり、どれだけ期間を延ばしても targetCalorie は tdee に漸近する
    // のみで基準を上回れない（有限の期間延長案が存在しない）。この場合は本提案を省略する。
    if (dailyCalorieAdjustmentNeeded > 0) {
      const suggestedGoalPeriodWeeks = Math.ceil(
        ((currentWeightKg - goalWeightKg) * ENERGY_DENSITY_KCAL_PER_KG) /
          (dailyCalorieAdjustmentNeeded * 7),
      );

      suggestions.push({ kind: "extend_period", suggestedGoalPeriodWeeks });
    }

    // 目標体重緩和案: dailyCalorieAdjustmentNeeded の符号に関わらず常に有限の値として
    // 算出できるため、常に少なくともこの1件は提案に含まれる
    // （suggestions が空配列になることはない）。
    const suggestedGoalWeightKg = roundToOneDecimal(
      currentWeightKg -
        (dailyCalorieAdjustmentNeeded * goalPeriodWeeks * 7) / ENERGY_DENSITY_KCAL_PER_KG,
    );

    suggestions.push({ kind: "ease_goal_weight", suggestedGoalWeightKg });

    warnings.push({
      type: "min_calorie_floor",
      message:
        `ダイエットモードの目標カロリー（約${Math.round(dietModeTargetCalorie)}kcal/日）が、` +
        `性別に応じた最低摂取カロリー基準（${minCalorieFloor}kcal/日）を下回っています。` +
        "目標達成期間の延長、または目標体重の緩和を検討してください。",
      suggestions,
    });
  }

  return { warnings };
}
