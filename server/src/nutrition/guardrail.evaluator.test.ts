import { describe, expect, it } from "vitest";
import {
  ENERGY_DENSITY_KCAL_PER_KG,
  MAX_WEEKLY_LOSS_PACE_RATIO,
  MIN_CALORIE_FLOOR,
} from "./constants.js";
import { evaluateGuardrails } from "./guardrail.evaluator.js";

/**
 * design.md #GuardrailEvaluator (Requirements 10.1, 10.2, 10.3, 11.1, 11.2, 11.3, 11.4)
 *
 * 判定式（design.md #GuardrailEvaluator 判定式ブロック）:
 *   isLossDirection = currentWeightKg > goalWeightKg
 *   maxSafeWeeklyLossKg = currentWeightKg * MAX_WEEKLY_LOSS_PACE_RATIO
 *   weeklyPaceKg = (currentWeightKg - goalWeightKg) / goalPeriodWeeks   // isLossDirection時のみ評価
 *
 *   // 最大減量ペース警告（isLossDirection時のみ）
 *   if isLossDirection and weeklyPaceKg > maxSafeWeeklyLossKg:
 *     suggestedGoalPeriodWeeks = ceil((currentWeightKg - goalWeightKg) / maxSafeWeeklyLossKg)
 *     suggestedGoalWeightKg    = round(currentWeightKg - maxSafeWeeklyLossKg * goalPeriodWeeks, 1)
 *
 *   // 最低摂取カロリー警告（方向に関わらず評価）
 *   if dietModeTargetCalorie < MIN_CALORIE_FLOOR[gender]:
 *     dailyCalorieAdjustmentOriginal = (currentWeightKg - goalWeightKg) * ENERGY_DENSITY_KCAL_PER_KG / (goalPeriodWeeks * 7)
 *     tdee = dietModeTargetCalorie + dailyCalorieAdjustmentOriginal   // DietModeCalculatorの式の逆算
 *     dailyCalorieAdjustmentNeeded = tdee - MIN_CALORIE_FLOOR[gender]
 *     // dailyCalorieAdjustmentNeeded > 0 の場合のみ:
 *     suggestedGoalPeriodWeeks = ceil((currentWeightKg - goalWeightKg) * ENERGY_DENSITY_KCAL_PER_KG / (dailyCalorieAdjustmentNeeded * 7))
 *     // 常に:
 *     suggestedGoalWeightKg = round(currentWeightKg - dailyCalorieAdjustmentNeeded * goalPeriodWeeks * 7 / ENERGY_DENSITY_KCAL_PER_KG, 1)
 *
 * 各テストケースの期待値はこの式から手計算で導出し、コメントに計算過程を残す。
 * 整数に厳密丸め込まれるceil()由来の値は `toBe`、循環小数の丸めを経由する
 * suggestedGoalWeightKg は浮動小数点誤差を吸収するため `toBeCloseTo` を用いる
 * （`diet-mode.calculator.test.ts` の既存方針を踏襲）。
 */
describe("evaluateGuardrails", () => {
  it("前提: 定数値が design.md 通りであること", () => {
    expect(MIN_CALORIE_FLOOR).toEqual({ male: 1500, female: 1200, undisclosed: 1500 });
    expect(MAX_WEEKLY_LOSS_PACE_RATIO).toBe(0.01);
    expect(ENERGY_DENSITY_KCAL_PER_KG).toBe(7700);
  });

  describe("パターン1: 最低カロリーのみ抵触（減量方向・安全なペース・目標カロリーが基準未満）", () => {
    // currentWeightKg=60, goalWeightKg=55, goalPeriodWeeks=20, gender=female, dietModeTargetCalorie=1125
    //
    // isLossDirection = 60 > 55 = true
    // maxSafeWeeklyLossKg = 60 * 0.01 = 0.6
    // weeklyPaceKg = (60 - 55) / 20 = 0.25  → 0.25 <= 0.6 なのでペース警告なし
    //
    // dailyCalorieAdjustmentOriginal = (60 - 55) * 7700 / (20 * 7) = 38500 / 140 = 275
    // tdee = 1125 + 275 = 1400
    // dailyCalorieAdjustmentNeeded = 1400 - 1200(female floor) = 200  (> 0)
    // suggestedGoalPeriodWeeks = ceil((60 - 55) * 7700 / (200 * 7)) = ceil(38500 / 1400) = ceil(27.5) = 28
    // suggestedGoalWeightKg = round(60 - (200 * 20 * 7) / 7700, 1) = round(60 - 28000/7700, 1)
    //                       = round(60 - 3.636363..., 1) = round(56.363636..., 1) = 56.4
    it("dietModeTargetCalorie=1125 < female floor(1200) で min_calorie_floor のみ抵触する", () => {
      const result = evaluateGuardrails(60, 55, 20, "female", 1125);

      expect(result.warnings).toHaveLength(1);
      const warning = result.warnings[0]!;
      expect(warning.type).toBe("min_calorie_floor");
      expect(typeof warning.message).toBe("string");
      expect(warning.message.length).toBeGreaterThan(0);
      expect(warning.suggestions.length).toBeGreaterThanOrEqual(1);

      const extendPeriod = warning.suggestions.find((s) => s.kind === "extend_period");
      const easeGoalWeight = warning.suggestions.find((s) => s.kind === "ease_goal_weight");
      expect(extendPeriod).toBeDefined();
      expect(extendPeriod!.suggestedGoalPeriodWeeks).toBe(28);
      expect(easeGoalWeight).toBeDefined();
      expect(easeGoalWeight!.suggestedGoalWeightKg).toBeCloseTo(56.4, 5);
    });
  });

  describe("パターン2: 最大ペースのみ抵触（減量方向・過度なペース・目標カロリーは基準を十分上回る）", () => {
    // currentWeightKg=70, goalWeightKg=65, goalPeriodWeeks=4, gender=male, dietModeTargetCalorie=1825
    //
    // isLossDirection = 70 > 65 = true
    // maxSafeWeeklyLossKg = 70 * 0.01 = 0.7
    // weeklyPaceKg = (70 - 65) / 4 = 1.25  → 1.25 > 0.7 なのでペース警告あり
    // suggestedGoalPeriodWeeks = ceil((70 - 65) / 0.7) = ceil(7.142857...) = 8
    // suggestedGoalWeightKg = round(70 - 0.7 * 4, 1) = round(70 - 2.8, 1) = round(67.2, 1) = 67.2
    //
    // dietModeTargetCalorie=1825 >= male floor(1500) なので min_calorie_floor は抵触しない
    it("weeklyPaceKg(1.25) > maxSafeWeeklyLossKg(0.7) で max_weekly_loss_pace のみ抵触する", () => {
      const result = evaluateGuardrails(70, 65, 4, "male", 1825);

      expect(result.warnings).toHaveLength(1);
      const warning = result.warnings[0]!;
      expect(warning.type).toBe("max_weekly_loss_pace");
      expect(warning.suggestions.length).toBeGreaterThanOrEqual(1);

      const extendPeriod = warning.suggestions.find((s) => s.kind === "extend_period");
      const easeGoalWeight = warning.suggestions.find((s) => s.kind === "ease_goal_weight");
      expect(extendPeriod).toBeDefined();
      expect(extendPeriod!.suggestedGoalPeriodWeeks).toBe(8);
      expect(easeGoalWeight).toBeDefined();
      expect(easeGoalWeight!.suggestedGoalWeightKg).toBeCloseTo(67.2, 5);
    });
  });

  describe("パターン3: 両方抵触（同じ体重/期間だが目標カロリーがさらに低い）", () => {
    // currentWeightKg=70, goalWeightKg=65, goalPeriodWeeks=4, gender=male, dietModeTargetCalorie=1000
    //
    // ペース警告: パターン2と currentWeightKg/goalWeightKg/goalPeriodWeeks が同一なので
    //   suggestedGoalPeriodWeeks=8, suggestedGoalWeightKg≈67.2 は変わらない。
    //
    // 最低カロリー警告:
    // dailyCalorieAdjustmentOriginal = (70 - 65) * 7700 / (4 * 7) = 38500 / 28 = 1375
    // tdee = 1000 + 1375 = 2375
    // dailyCalorieAdjustmentNeeded = 2375 - 1500(male floor) = 875  (> 0)
    // suggestedGoalPeriodWeeks = ceil((70 - 65) * 7700 / (875 * 7)) = ceil(38500 / 6125)
    //                          = ceil(6.2857142857...) = 7
    // suggestedGoalWeightKg = round(70 - (875 * 4 * 7) / 7700, 1) = round(70 - 24500/7700, 1)
    //                       = round(70 - 3.181818..., 1) = round(66.818181..., 1) = 66.8
    it("dietModeTargetCalorie=1000 でペース・最低カロリーの両方が独立に抵触する", () => {
      const result = evaluateGuardrails(70, 65, 4, "male", 1000);

      expect(result.warnings).toHaveLength(2);

      const paceWarning = result.warnings.find((w) => w.type === "max_weekly_loss_pace");
      const floorWarning = result.warnings.find((w) => w.type === "min_calorie_floor");
      expect(paceWarning).toBeDefined();
      expect(floorWarning).toBeDefined();

      expect(paceWarning!.suggestions.length).toBeGreaterThanOrEqual(1);
      const paceExtend = paceWarning!.suggestions.find((s) => s.kind === "extend_period");
      const paceEase = paceWarning!.suggestions.find((s) => s.kind === "ease_goal_weight");
      expect(paceExtend?.suggestedGoalPeriodWeeks).toBe(8);
      expect(paceEase?.suggestedGoalWeightKg).toBeCloseTo(67.2, 5);

      expect(floorWarning!.suggestions.length).toBeGreaterThanOrEqual(1);
      const floorExtend = floorWarning!.suggestions.find((s) => s.kind === "extend_period");
      const floorEase = floorWarning!.suggestions.find((s) => s.kind === "ease_goal_weight");
      expect(floorExtend?.suggestedGoalPeriodWeeks).toBe(7);
      expect(floorEase?.suggestedGoalWeightKg).toBeCloseTo(66.8, 5);
    });
  });

  describe("パターン4: いずれも抵触なし（安全なペース・基準を上回る目標カロリー）", () => {
    // currentWeightKg=70, goalWeightKg=65, goalPeriodWeeks=20, gender=male
    // weeklyPaceKg = (70 - 65) / 20 = 0.25 <= maxSafeWeeklyLossKg(0.7) → ペース抵触なし
    // dailyCalorieAdjustmentOriginal = (70-65)*7700/(20*7) = 38500/140 = 275
    // 想定tdee=2500 → dietModeTargetCalorie = 2500 - 275 = 2225 >= male floor(1500) → 抵触なし
    it("warnings が空配列で返る", () => {
      const result = evaluateGuardrails(70, 65, 20, "male", 2225);

      expect(result).toEqual({ warnings: [] });
    });
  });

  describe("パターン5: 維持・増量方向（最大ペースガードレールが方向でスキップされることの証明）", () => {
    // currentWeightKg=60, goalWeightKg=63（goalWeightKg > currentWeightKg、増量方向）,
    // goalPeriodWeeks=2, gender=male, dietModeTargetCalorie=3850
    //
    // isLossDirection = 60 > 63 = false → 本来ならペース判定自体がスキップされる。
    //
    // このテストが「たまたま抵触しなかった」だけでなく方向判定が実際にゲートしていることを
    // 証明するため、意図的に |goalWeightKg - currentWeightKg| / goalPeriodWeeks が
    // maxSafeWeeklyLossKg を大きく上回る入力を選ぶ:
    //   naive (誤って絶対値/符号反転で計算した場合) pace = |60 - 63| / 2 = 1.5 kg/週
    //   maxSafeWeeklyLossKg = 60 * 0.01 = 0.6 kg/週
    //   1.5 > 0.6 なので、方向判定を怠った実装であれば誤って max_weekly_loss_pace 警告を
    //   発生させてしまうはずの入力である。正しい実装は isLossDirection=false によって
    //   この判定自体をスキップし、警告を出さない。
    //
    // 最低カロリー側: dailyCalorieAdjustmentOriginal = (60-63)*7700/(2*7) = -23100/14 = -1650
    //   想定tdee=2200 → dietModeTargetCalorie = 2200 - (-1650) = 3850 >= male floor(1500) → 抵触なし
    it("goalWeightKg > currentWeightKg でペースが『大きく』見える入力でも max_weekly_loss_pace 警告が出ない", () => {
      const result = evaluateGuardrails(60, 63, 2, "male", 3850);

      expect(result).toEqual({ warnings: [] });
    });
  });

  describe("パターン6（remediation round 1）: 維持・増量方向での最低カロリー抵触（dailyCalorieAdjustmentNeeded <= 0 分岐）", () => {
    // currentWeightKg=50, goalWeightKg=51（goalWeightKg > currentWeightKg、維持/増量方向）,
    // goalPeriodWeeks=40, gender=female, dietModeTargetCalorie=1027.5
    //
    // isLossDirection = 50 > 51 = false → 最大減量ペース警告は評価されない（11.3、パターン5と同様）。
    //
    // dailyCalorieAdjustmentOriginal = (50 - 51) * 7700 / (40 * 7) = -7700 / 280 = -27.5
    // tdee = dietModeTargetCalorie + dailyCalorieAdjustmentOriginal = 1027.5 + (-27.5) = 1000
    // dailyCalorieAdjustmentNeeded = tdee - 1200(female floor) = 1000 - 1200 = -200  (<= 0)
    //
    // 維持・増量方向（currentWeightKg <= goalWeightKg）で min_calorie_floor が抵触する場合、
    // dailyCalorieAdjustmentOriginal = (currentWeightKg - goalWeightKg) * ENERGY_DENSITY_KCAL_PER_KG
    //   / (goalPeriodWeeks * 7) は必ず0以下になる（分子が0以下のため）。したがって
    // targetCalorie = tdee - dailyCalorieAdjustmentOriginal は常に tdee 以上であり、
    // targetCalorie < floor が成り立つには tdee < floor でなければならない。つまり
    // dailyCalorieAdjustmentNeeded = tdee - floor は維持・増量方向でmin_calorie_floorが
    // 抵触する限り「必ず」負になる（稀なエッジケースではなく、この方向でfloor抵触する
    // ケース全てで毎回通る経路である）。
    //
    // dailyCalorieAdjustmentNeeded <= 0 のため、extend_period提案は算出されない
    // （有限の期間延長ではtargetCalorieがtdeeに漸近するのみで、tdee自体がすでに floor 以下
    // である以上、基準を上回れないため）。ease_goal_weight提案のみが算出される:
    // suggestedGoalWeightKg = round(50 - (-200 * 40 * 7) / 7700, 1)
    //                       = round(50 - (-56000 / 7700), 1)
    //                       = round(50 + 7.272727..., 1)
    //                       = round(57.272727..., 1) = 57.3
    it("goalWeightKg > currentWeightKg でも min_calorie_floor が抵触し、extend_period は提案から genuinely 除外される", () => {
      const result = evaluateGuardrails(50, 51, 40, "female", 1027.5);

      expect(result.warnings).toHaveLength(1);
      const warning = result.warnings[0]!;
      expect(warning.type).toBe("min_calorie_floor");

      // extend_period が「値なしで存在」するのではなく、配列に genuinely 含まれていないことを
      // 検証する（プレースホルダーやInfinity付きで存在してはならない）。
      const extendPeriod = warning.suggestions.find((s) => s.kind === "extend_period");
      expect(extendPeriod).toBeUndefined();

      expect(warning.suggestions).toHaveLength(1);
      const easeGoalWeight = warning.suggestions.find((s) => s.kind === "ease_goal_weight");
      expect(easeGoalWeight).toBeDefined();
      expect(easeGoalWeight!.suggestedGoalWeightKg).toBeCloseTo(57.3, 5);
    });
  });
});
