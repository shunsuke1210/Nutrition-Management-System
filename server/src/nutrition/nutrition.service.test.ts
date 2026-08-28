import { describe, expect, it } from "vitest";
import type { ExerciseLogEntry } from "@nutrition/shared";
import { calculateMicronutrientTargets } from "./micronutrient.calculator.js";
import { calculatePfcRatio, calculatePfcTargets } from "./pfc.calculator.js";
import { calculateDietModeTargetCalorie } from "./diet-mode.calculator.js";
import { evaluateGuardrails } from "./guardrail.evaluator.js";
import { calculateDietInsights } from "./diet-insights.calculator.js";
import { WEIGHT_TREND_LONG_WINDOW_DAYS } from "./constants.js";
import type { DailyLogGateway, WeightLogPoint } from "./daily-log.gateway.js";
import type { ProfileGateway, ProfileSnapshot } from "./profile.gateway.js";
import { createNutritionService, mapActivityCoefficientToLabel } from "./nutrition.service.js";

/**
 * design.md #NutritionService (Requirements 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 12.1, 12.2, 13.4)
 * および「栄養目標値の算出フロー」シーケンス図、Addendum「活動レベル表示ラベル」。
 *
 * `NutritionService` は8つの計算モジュール（BmrCalculator, ActivityCoefficientCalculator,
 * PfcCalculator, MicronutrientCalculator, DietModeCalculator, GuardrailEvaluator,
 * ProfileGateway, DailyLogGateway）を、design.md のシーケンス図が定める呼び出し順序で
 * オーケストレーションする。個々の計算モジュール自体の正しさは各モジュール専用のテストで
 * 既に検証済みのため、本テストは「正しい引数が正しい順序で各モジュールに渡され、結果が
 * 正しく合成されること」（コンポジションの正しさ）を主眼に検証する。
 *
 * bmr / activityCoefficient / tdee / dailyExpenditure / activityLevelLabel /
 * dietModeCalorieTarget といったトップレベルの数値は、design.mdの数式から独立して手計算した
 * リテラル値と比較する（サービスがハードコードされたスタブ値を返しているのではなく、
 * 本物の計算モジュールを実引数で呼び出していることの証明）。PFC・微量栄養素・ガードレールの
 * ような複合値は、同一の（手計算で検証済みの）引数で実際の計算モジュールを直接呼び出した
 * 結果と深い等価比較することで、引数の受け渡しが正しいことを検証する。
 */

// --- テスト用フェイク ---

/** `ProfileGateway` の唯一の依存を差し替えるための、挙動を変更可能なフェイク。 */
function createFakeProfileGateway(initial: ProfileSnapshot | null): ProfileGateway & {
  setProfile(profile: ProfileSnapshot | null): void;
} {
  let current = initial;
  return {
    getCurrentProfile: () => current,
    setProfile(profile: ProfileSnapshot | null) {
      current = profile;
    },
  };
}

/**
 * `DailyLogGateway` の2つの依存（`getExerciseEntriesForDate` / `getWeightLogsInRange`）を
 * 差し替えるための、挙動を変更可能なフェイク。呼び出された日付・範囲を記録し、日付の受け渡しが
 * 正しいこと（Requirement 4.3, 14.1）も検証できるようにする。
 *
 * `getWeightLogsInRange` は実際の `DailyLogGateway`（`daily-log.gateway.ts`）と同様に、
 * 保持している体重ログの「プール」を `[from, to]` の閉区間（"YYYY-MM-DD" の文字列比較。
 * 辞書順=時系列順に一致するため妥当）で単純にフィルタリングして返す（固定の範囲キーに対する
 * ルックアップテーブルにはしない）。これにより、`getDietInsights` が算出する `from` が
 * 1日ずれただけでも、フィルタ結果（延いては `calculateDietInsights` に渡される点集合）が
 * 変化する、境界値に敏感なテストが書けるようにする（task 6.5 の日付範囲off-by-one検証）。
 */
function createFakeDailyLogGateway(
  initialExerciseEntries: Record<string, ExerciseLogEntry[]>,
  initialWeightLogPool: WeightLogPoint[] = [],
): DailyLogGateway & {
  setEntriesForDate(date: string, entries: ExerciseLogEntry[]): void;
  receivedDates: string[];
  setWeightLogPool(logs: WeightLogPoint[]): void;
  receivedWeightRanges: Array<{ from: string; to: string }>;
} {
  let entriesByDate = initialExerciseEntries;
  let weightLogPool = initialWeightLogPool;
  const receivedDates: string[] = [];
  const receivedWeightRanges: Array<{ from: string; to: string }> = [];
  return {
    receivedDates,
    receivedWeightRanges,
    getExerciseEntriesForDate: (date: string) => {
      receivedDates.push(date);
      return entriesByDate[date] ?? [];
    },
    setEntriesForDate(date: string, entries: ExerciseLogEntry[]) {
      entriesByDate = { ...entriesByDate, [date]: entries };
    },
    getWeightLogsInRange: (from: string, to: string) => {
      receivedWeightRanges.push({ from, to });
      return weightLogPool.filter((log) => log.date >= from && log.date <= to);
    },
    setWeightLogPool(logs: WeightLogPoint[]) {
      weightLogPool = logs;
    },
  };
}

/**
 * デフォルトは「BMR=1648.75, activityCoefficient=1.2, tdee=1978.5」となるよう手計算しやすい値
 * （weightKg=70, heightCm=175, age=30, gender=male, bodyFatPct=null(Mifflin-St Jeor),
 * jobActivityLevel=mostly_sedentary(base 1.2), commuteMethod=car(+0),
 * averageDailySteps=null(+0), exerciseRoutine=[](+0)）に固定した `ProfileSnapshot`。
 *
 * bmr = 10*70 + 6.25*175 - 5*30 + MIFFLIN_GENDER_OFFSET.male(5)
 *     = 700 + 1093.75 - 150 + 5 = 1648.75
 * activityCoefficient = clamp(1.2 + 0 + 0 + 0, 1.2, 1.9) = 1.2
 * tdee = 1648.75 * 1.2 = 1978.5
 */
function buildProfileSnapshot(overrides: Partial<ProfileSnapshot> = {}): ProfileSnapshot {
  return {
    heightCm: 175,
    weightKg: 70,
    age: 30,
    gender: "male",
    bodyFatPct: null,
    jobActivityLevel: "mostly_sedentary",
    commuteMethod: "car",
    averageDailySteps: null,
    exerciseRoutine: [],
    smokingHabit: null,
    alcoholHabit: null,
    restrictionType: "none",
    restrictionIntensity: null,
    dietModeEnabled: false,
    goalWeightKg: null,
    goalPeriodWeeks: null,
    ...overrides,
  };
}

function buildExerciseLogEntry(overrides: Partial<ExerciseLogEntry> = {}): ExerciseLogEntry {
  return {
    id: 1,
    activityName: "ランニング",
    durationMinutes: 30,
    estimatedCaloriesBurned: 200,
    ...overrides,
  };
}

describe("createNutritionService", () => {
  describe("プロフィール未登録の場合（Requirement 12.1）", () => {
    it("いかなる計算も行わず CalculationUnavailableError(profile_missing) を返す", () => {
      const profileGateway = createFakeProfileGateway(null);
      const dailyLogGateway = createFakeDailyLogGateway({});
      const service = createNutritionService(profileGateway, dailyLogGateway);

      const result = service.getSummary("2026-08-20");

      expect(result).toEqual({
        ok: false,
        error: {
          type: "calculation_unavailable",
          reason: "profile_missing",
          message: expect.any(String),
        },
      });
    });

    it("プロフィール未登録の場合、DailyLogGatewayを呼び出さない（早期終了）", () => {
      const profileGateway = createFakeProfileGateway(null);
      const dailyLogGateway = createFakeDailyLogGateway({});
      const service = createNutritionService(profileGateway, dailyLogGateway);

      service.getSummary("2026-08-20");

      expect(dailyLogGateway.receivedDates).toEqual([]);
    });
  });

  describe("ダイエットモード有効だが目標データが欠落している場合（Requirement 12.2）", () => {
    it("goalWeightKgが欠落 → CalculationUnavailableError(incomplete_diet_mode_data)", () => {
      const profile = buildProfileSnapshot({
        dietModeEnabled: true,
        goalWeightKg: null,
        goalPeriodWeeks: 10,
      });
      const profileGateway = createFakeProfileGateway(profile);
      const dailyLogGateway = createFakeDailyLogGateway({});
      const service = createNutritionService(profileGateway, dailyLogGateway);

      const result = service.getSummary("2026-08-20");

      expect(result).toEqual({
        ok: false,
        error: {
          type: "calculation_unavailable",
          reason: "incomplete_diet_mode_data",
          message: expect.any(String),
        },
      });
    });

    it("goalPeriodWeeksが欠落 → CalculationUnavailableError(incomplete_diet_mode_data)", () => {
      const profile = buildProfileSnapshot({
        dietModeEnabled: true,
        goalWeightKg: 65,
        goalPeriodWeeks: null,
      });
      const profileGateway = createFakeProfileGateway(profile);
      const dailyLogGateway = createFakeDailyLogGateway({});
      const service = createNutritionService(profileGateway, dailyLogGateway);

      const result = service.getSummary("2026-08-20");

      expect(result).toEqual({
        ok: false,
        error: {
          type: "calculation_unavailable",
          reason: "incomplete_diet_mode_data",
          message: expect.any(String),
        },
      });
    });

    it("両方が欠落 → CalculationUnavailableError(incomplete_diet_mode_data)", () => {
      const profile = buildProfileSnapshot({
        dietModeEnabled: true,
        goalWeightKg: null,
        goalPeriodWeeks: null,
      });
      const profileGateway = createFakeProfileGateway(profile);
      const dailyLogGateway = createFakeDailyLogGateway({});
      const service = createNutritionService(profileGateway, dailyLogGateway);

      const result = service.getSummary("2026-08-20");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toBe("incomplete_diet_mode_data");
      }
    });
  });

  describe("ダイエットモード有効かつ目標データが完備している場合（正常系のオーケストレーション全体）", () => {
    it("BMR・活動係数・TDEE・当日消費カロリー・PFC・微量栄養素・ダイエットモード目標・ガードレールが、design.mdの計算式通りに合成される", () => {
      const date = "2026-08-20";
      const profile = buildProfileSnapshot({
        dietModeEnabled: true,
        goalWeightKg: 65,
        goalPeriodWeeks: 10,
      });
      const exerciseEntries = [
        buildExerciseLogEntry({ id: 1, estimatedCaloriesBurned: 200 }),
        buildExerciseLogEntry({ id: 2, estimatedCaloriesBurned: 50 }),
      ];
      const profileGateway = createFakeProfileGateway(profile);
      const dailyLogGateway = createFakeDailyLogGateway({ [date]: exerciseEntries });
      const service = createNutritionService(profileGateway, dailyLogGateway);

      const result = service.getSummary(date);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected ok:true");
      }
      const summary = result.value;

      // --- トップレベルの数値: design.mdの数式から独立して手計算したリテラル値と比較する ---
      // bmr = 10*70 + 6.25*175 - 5*30 + 5(男性オフセット) = 700 + 1093.75 - 150 + 5 = 1648.75
      expect(summary.bmr).toBeCloseTo(1648.75, 6);
      // activityCoefficient = clamp(1.2(mostly_sedentary) + 0(car) + 0(steps null) + 0(exercise無し), 1.2, 1.9) = 1.2
      expect(summary.activityCoefficient).toBeCloseTo(1.2, 6);
      // tdee = bmr * activityCoefficient = 1648.75 * 1.2 = 1978.5
      expect(summary.tdee).toBeCloseTo(1978.5, 6);
      // dailyExpenditure = tdee + (200 + 50) = 1978.5 + 250 = 2228.5
      expect(summary.dailyExpenditure.date).toBe(date);
      expect(summary.dailyExpenditure.value).toBeCloseTo(2228.5, 6);
      // activityCoefficient=1.2 は [1.20, 1.375) 帯 → "かなり運動不足"
      expect(summary.activityLevelLabel).toBe("かなり運動不足");

      // --- normalMode: calorieTarget は TDEE と一致する（Requirement 5.1） ---
      expect(summary.normalMode.calorieTarget).toBeCloseTo(1978.5, 6);
      const expectedRatio = calculatePfcRatio("none", null);
      expect(summary.normalMode.pfcRatio).toEqual(expectedRatio);
      const expectedNormalPfc = calculatePfcTargets(summary.tdee, expectedRatio);
      expect(summary.normalMode.pfc.proteinKcal).toBeCloseTo(expectedNormalPfc.proteinKcal, 6);
      expect(summary.normalMode.pfc.fatKcal).toBeCloseTo(expectedNormalPfc.fatKcal, 6);
      expect(summary.normalMode.pfc.carbKcal).toBeCloseTo(expectedNormalPfc.carbKcal, 6);
      expect(summary.normalMode.pfc.proteinG).toBeCloseTo(expectedNormalPfc.proteinG, 6);
      expect(summary.normalMode.pfc.fatG).toBeCloseTo(expectedNormalPfc.fatG, 6);
      expect(summary.normalMode.pfc.carbG).toBeCloseTo(expectedNormalPfc.carbG, 6);
      // 独立した手計算による裏付け（Atwater係数、PFC比率 protein:0.15/fat:0.25/carb:0.60）
      expect(summary.normalMode.pfc.proteinKcal).toBeCloseTo(296.775, 3); // 1978.5*0.15
      expect(summary.normalMode.pfc.fatKcal).toBeCloseTo(494.625, 3); // 1978.5*0.25
      expect(summary.normalMode.pfc.carbKcal).toBeCloseTo(1187.1, 3); // 1978.5*0.60

      // --- micronutrients: gender=male, age=30(30-49区分), smokingHabit=null, alcoholHabit=null ---
      // MicronutrientCalculator自体の正しさは別ファイルで検証済みのため、ここでは
      // 「gender/age/smokingHabit/alcoholHabitが正しくそのまま渡されていること」を、
      // 実際の計算モジュールを同じ引数で直接呼び出した結果との深い等価比較で検証する。
      const expectedMicronutrients = calculateMicronutrientTargets("male", 30, null, null);
      expect(summary.normalMode.micronutrients).toEqual(expectedMicronutrients);

      // --- dietMode: dietModeCalorieTarget = tdee - (70-65)*7700/(10*7) = 1978.5 - 550 = 1428.5 ---
      expect(summary.dietMode).not.toBeNull();
      const dietMode = summary.dietMode!;
      expect(dietMode.calorieTarget).toBeCloseTo(1428.5, 6);
      expect(dietMode.pfcRatio).toEqual(expectedRatio); // 通常モードと同一のPFC比率を適用する
      const expectedDietPfc = calculatePfcTargets(dietMode.calorieTarget, expectedRatio);
      expect(dietMode.pfc.proteinKcal).toBeCloseTo(expectedDietPfc.proteinKcal, 6);
      expect(dietMode.pfc.fatKcal).toBeCloseTo(expectedDietPfc.fatKcal, 6);
      expect(dietMode.pfc.carbKcal).toBeCloseTo(expectedDietPfc.carbKcal, 6);
      // 独立した手計算による裏付け（1428.5 * ratio）
      expect(dietMode.pfc.proteinKcal).toBeCloseTo(214.275, 3); // 1428.5*0.15
      expect(dietMode.pfc.fatKcal).toBeCloseTo(357.125, 3); // 1428.5*0.25
      expect(dietMode.pfc.carbKcal).toBeCloseTo(857.1, 3); // 1428.5*0.60

      // --- guardrails: dietModeCalorieTarget(1428.5) < MIN_CALORIE_FLOOR.male(1500) → 警告発生 ---
      // GuardrailEvaluator自体の正しさは別ファイルで検証済みのため、ここでは
      // 「currentWeightKg/goalWeightKg/goalPeriodWeeks/gender/dietModeTargetCalorieが
      // 正しく渡されていること」を、実際の計算モジュールを同じ（手計算で検証済みの）引数で
      // 直接呼び出した結果との深い等価比較で検証する。
      const expectedGuardrails = evaluateGuardrails(70, 65, 10, "male", 1428.5);
      expect(dietMode.guardrails).toEqual(expectedGuardrails);
      expect(dietMode.guardrails.warnings).toHaveLength(1);
      expect(dietMode.guardrails.warnings[0]?.type).toBe("min_calorie_floor");
    });

    it("PFC比率が食事制限設定（タイプ×強度）に応じて調整され、通常モード・ダイエットモード両方に同一の比率が適用される（Requirements 7.1, 7.2, 9.1）", () => {
      const date = "2026-08-21";
      const profile = buildProfileSnapshot({
        restrictionType: "low_carb",
        restrictionIntensity: "standard",
        dietModeEnabled: true,
        goalWeightKg: 65,
        goalPeriodWeeks: 20,
      });
      const profileGateway = createFakeProfileGateway(profile);
      const dailyLogGateway = createFakeDailyLogGateway({});
      const service = createNutritionService(profileGateway, dailyLogGateway);

      const result = service.getSummary(date);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok:true");

      // design.md PfcCalculator調整テーブル: low_carb standard → protein:0.25, fat:0.40, carb:0.35
      const expectedRatio = { proteinPct: 0.25, fatPct: 0.4, carbPct: 0.35 };
      expect(result.value.normalMode.pfcRatio).toEqual(expectedRatio);
      expect(result.value.dietMode?.pfcRatio).toEqual(expectedRatio);
    });
  });

  describe("ダイエットモードが無効な場合（Requirement 8.2）", () => {
    it("dietMode: null を返し、通常モードの結果のみ算出する", () => {
      const profile = buildProfileSnapshot({ dietModeEnabled: false });
      const profileGateway = createFakeProfileGateway(profile);
      const dailyLogGateway = createFakeDailyLogGateway({});
      const service = createNutritionService(profileGateway, dailyLogGateway);

      const result = service.getSummary("2026-08-20");

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok:true");
      expect(result.value.dietMode).toBeNull();
      expect(result.value.normalMode.calorieTarget).toBeCloseTo(1978.5, 6);
    });

    it("goalWeightKg/goalPeriodWeeksがnullでもエラーにならない（dietModeEnabled=falseの場合は必須項目ではない）", () => {
      const profile = buildProfileSnapshot({
        dietModeEnabled: false,
        goalWeightKg: null,
        goalPeriodWeeks: null,
      });
      const profileGateway = createFakeProfileGateway(profile);
      const dailyLogGateway = createFakeDailyLogGateway({});
      const service = createNutritionService(profileGateway, dailyLogGateway);

      const result = service.getSummary("2026-08-20");

      expect(result.ok).toBe(true);
    });
  });

  describe("当日消費カロリーの算出（Requirements 4.1, 4.2, 4.3）", () => {
    it("指定日付の追加運動ログのみを合算し、他日付のログを含めない。ログが1件もない日付はTDEEをそのまま用いる", () => {
      const profile = buildProfileSnapshot();
      const profileGateway = createFakeProfileGateway(profile);
      const dailyLogGateway = createFakeDailyLogGateway({
        "2026-08-01": [
          buildExerciseLogEntry({ id: 1, estimatedCaloriesBurned: 100 }),
        ],
        "2026-08-02": [
          buildExerciseLogEntry({ id: 2, estimatedCaloriesBurned: 50 }),
          buildExerciseLogEntry({ id: 3, estimatedCaloriesBurned: 30 }),
        ],
      });
      const service = createNutritionService(profileGateway, dailyLogGateway);

      const result1 = service.getSummary("2026-08-01");
      const result2 = service.getSummary("2026-08-02");
      const result3 = service.getSummary("2026-08-03"); // ログなし

      expect(result1.ok && result1.value.dailyExpenditure.value).toBeCloseTo(1978.5 + 100, 6);
      expect(result2.ok && result2.value.dailyExpenditure.value).toBeCloseTo(1978.5 + 80, 6);
      expect(result3.ok && result3.value.dailyExpenditure.value).toBeCloseTo(1978.5, 6); // Requirement 4.2

      expect(dailyLogGateway.receivedDates).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    });
  });

  describe("キャッシュしないこと（Requirement 13.4）", () => {
    it("プロフィール・日次ログの状態が変化すれば、次回の呼び出し結果に反映される", () => {
      const date = "2026-08-20";
      const profileGateway = createFakeProfileGateway(
        buildProfileSnapshot({ weightKg: 70 }) // bmr=1648.75, tdee=1978.5
      );
      const dailyLogGateway = createFakeDailyLogGateway({
        [date]: [buildExerciseLogEntry({ id: 1, estimatedCaloriesBurned: 100 })],
      });
      const service = createNutritionService(profileGateway, dailyLogGateway);

      const result1 = service.getSummary(date);
      expect(result1.ok).toBe(true);
      if (!result1.ok) throw new Error("expected ok:true");
      expect(result1.value.bmr).toBeCloseTo(1648.75, 6);
      expect(result1.value.dailyExpenditure.value).toBeCloseTo(1978.5 + 100, 6);

      // プロフィール（体重）と日次ログ（運動記録）を両方変更する。
      // newBmr = 10*80 + 6.25*175 - 5*30 + 5 = 800 + 1093.75 - 150 + 5 = 1748.75
      // newTdee = 1748.75 * 1.2 = 2098.5
      profileGateway.setProfile(buildProfileSnapshot({ weightKg: 80 }));
      dailyLogGateway.setEntriesForDate(date, [
        buildExerciseLogEntry({ id: 2, estimatedCaloriesBurned: 500 }),
      ]);

      const result2 = service.getSummary(date);
      expect(result2.ok).toBe(true);
      if (!result2.ok) throw new Error("expected ok:true");
      expect(result2.value.bmr).toBeCloseTo(1748.75, 6);
      expect(result2.value.tdee).toBeCloseTo(2098.5, 6);
      expect(result2.value.dailyExpenditure.value).toBeCloseTo(2098.5 + 500, 6);

      // 変化が反映され、1回目と2回目の結果が異なることを明示的に確認する。
      expect(result2.value.bmr).not.toBeCloseTo(result1.value.bmr, 1);
      expect(result2.value.dailyExpenditure.value).not.toBeCloseTo(result1.value.dailyExpenditure.value, 1);
    });
  });

  describe("activityLevelLabelの4帯マッピング（Addendum「活動レベル表示ラベル」）", () => {
    it("かなり運動不足帯（activityCoefficient=1.2, mostly_sedentary基準）がactivityLevelLabelに設定される", () => {
      const profile = buildProfileSnapshot({
        jobActivityLevel: "mostly_sedentary",
        commuteMethod: "car",
        averageDailySteps: null,
        exerciseRoutine: [],
      });
      const service = createNutritionService(createFakeProfileGateway(profile), createFakeDailyLogGateway({}));

      const result = service.getSummary("2026-08-20");

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok:true");
      expect(result.value.activityCoefficient).toBeCloseTo(1.2, 6);
      expect(result.value.activityLevelLabel).toBe("かなり運動不足");
    });

    it("運動不足帯（activityCoefficient=1.375, mixed基準）がactivityLevelLabelに設定される", () => {
      const profile = buildProfileSnapshot({
        jobActivityLevel: "mixed",
        commuteMethod: "car",
        averageDailySteps: null,
        exerciseRoutine: [],
      });
      const service = createNutritionService(createFakeProfileGateway(profile), createFakeDailyLogGateway({}));

      const result = service.getSummary("2026-08-20");

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok:true");
      expect(result.value.activityCoefficient).toBeCloseTo(1.375, 6);
      expect(result.value.activityLevelLabel).toBe("運動不足");
    });

    it("ふつう帯（activityCoefficient=1.55, mostly_active基準）がactivityLevelLabelに設定される", () => {
      const profile = buildProfileSnapshot({
        jobActivityLevel: "mostly_active",
        commuteMethod: "car",
        averageDailySteps: null,
        exerciseRoutine: [],
      });
      const service = createNutritionService(createFakeProfileGateway(profile), createFakeDailyLogGateway({}));

      const result = service.getSummary("2026-08-20");

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok:true");
      expect(result.value.activityCoefficient).toBeCloseTo(1.55, 6);
      expect(result.value.activityLevelLabel).toBe("ふつう");
    });

    it("健康的帯（activityCoefficient=1.9=クランプ上限、mostly_active+徒歩通勤+高頻度運動）がactivityLevelLabelに設定される", () => {
      const profile = buildProfileSnapshot({
        jobActivityLevel: "mostly_active",
        commuteMethod: "walk_or_bike",
        averageDailySteps: 15000,
        exerciseRoutine: [
          {
            scene: "after_work",
            content: "高強度トレーニング",
            frequencyPerWeek: 7,
            durationMinutes: 120,
            intensity: "vigorous",
          },
        ],
      });
      const service = createNutritionService(createFakeProfileGateway(profile), createFakeDailyLogGateway({}));

      const result = service.getSummary("2026-08-20");

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok:true");
      // 大量の週間運動量により素の合計は1.9を超えるため、クランプ上限1.9に張り付く
      expect(result.value.activityCoefficient).toBeCloseTo(1.9, 6);
      expect(result.value.activityLevelLabel).toBe("健康的");
    });
  });

  describe("mapActivityCoefficientToLabel（境界値の厳密な検証）", () => {
    it("係数レンジ（1.20-1.90、幅0.70）を均等に4分割した各帯の境界で、design.mdのAddendum通りのラベルを返す", () => {
      // 帯: [1.20, 1.375) かなり運動不足 / [1.375, 1.55) 運動不足 /
      //     [1.55, 1.725) ふつう / [1.725, 1.90] 健康的
      expect(mapActivityCoefficientToLabel(1.2)).toBe("かなり運動不足"); // 下限
      expect(mapActivityCoefficientToLabel(1.374999)).toBe("かなり運動不足"); // 第1境界の直下
      expect(mapActivityCoefficientToLabel(1.375)).toBe("運動不足"); // 第1境界ちょうど → 上側の帯
      expect(mapActivityCoefficientToLabel(1.549999)).toBe("運動不足"); // 第2境界の直下
      expect(mapActivityCoefficientToLabel(1.55)).toBe("ふつう"); // 第2境界ちょうど → 上側の帯
      expect(mapActivityCoefficientToLabel(1.724999)).toBe("ふつう"); // 第3境界の直下
      expect(mapActivityCoefficientToLabel(1.725)).toBe("健康的"); // 第3境界ちょうど → 上側の帯
      expect(mapActivityCoefficientToLabel(1.899999)).toBe("健康的");
      expect(mapActivityCoefficientToLabel(1.9)).toBe("健康的"); // クランプ上限自体も最終帯に含む（閉区間）
    });
  });

  /**
   * design.md #NutritionService「`getDietInsights(date)` は...」
   * （Requirements 14.1, 14.2, 15.1, 16.1, 17.1）。
   *
   * `getSummary` とはガード節の順序が異なる（profile_missing → diet_mode_disabled →
   * incomplete_diet_mode_data の3段階）。`DietInsightsCalculator`（`calculateDietInsights`）
   * 自体の算出ロジックの正しさは task 6.3 の専用テストで既に検証済みのため、本テストは
   * 「正しい前提チェックが正しい順序で行われ、正しい引数（体重ログの取得範囲・現在の体重・
   * 目標体重・基準日）で `calculateDietInsights` に委譲されること」（コンポジションの正しさ）を
   * 主眼に検証する。
   */
  describe("getDietInsights", () => {
    describe("プロフィール未登録の場合（Requirement 14.2）", () => {
      it("いかなる計算も行わず CalculationUnavailableError(profile_missing) を返す", () => {
        const profileGateway = createFakeProfileGateway(null);
        const dailyLogGateway = createFakeDailyLogGateway({});
        const service = createNutritionService(profileGateway, dailyLogGateway);

        const result = service.getDietInsights("2026-08-20");

        expect(result).toEqual({
          ok: false,
          error: {
            type: "calculation_unavailable",
            reason: "profile_missing",
            message: expect.any(String),
          },
        });
      });

      it("プロフィール未登録の場合、DailyLogGateway.getWeightLogsInRangeを呼び出さない（早期終了）", () => {
        const profileGateway = createFakeProfileGateway(null);
        const dailyLogGateway = createFakeDailyLogGateway({});
        const service = createNutritionService(profileGateway, dailyLogGateway);

        service.getDietInsights("2026-08-20");

        expect(dailyLogGateway.receivedWeightRanges).toEqual([]);
      });
    });

    describe("ダイエットモードが無効な場合（Requirement 14.2。getSummaryと異なりここでは算出不可）", () => {
      it("CalculationUnavailableError(diet_mode_disabled) を返す", () => {
        const profile = buildProfileSnapshot({ dietModeEnabled: false });
        const profileGateway = createFakeProfileGateway(profile);
        const dailyLogGateway = createFakeDailyLogGateway({});
        const service = createNutritionService(profileGateway, dailyLogGateway);

        const result = service.getDietInsights("2026-08-20");

        expect(result).toEqual({
          ok: false,
          error: {
            type: "calculation_unavailable",
            reason: "diet_mode_disabled",
            message: expect.any(String),
          },
        });
      });

      it("goalWeightKg/goalPeriodWeeksが両方nullでも、dietModeEnabled=falseが優先されdiet_mode_disabledが返る（ガード節の順序の検証）", () => {
        const profile = buildProfileSnapshot({
          dietModeEnabled: false,
          goalWeightKg: null,
          goalPeriodWeeks: null,
        });
        const profileGateway = createFakeProfileGateway(profile);
        const dailyLogGateway = createFakeDailyLogGateway({});
        const service = createNutritionService(profileGateway, dailyLogGateway);

        const result = service.getDietInsights("2026-08-20");

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected ok:false");
        expect(result.error.reason).toBe("diet_mode_disabled");
      });

      it("ダイエットモードが無効な場合、DailyLogGateway.getWeightLogsInRangeを呼び出さない（早期終了）", () => {
        const profile = buildProfileSnapshot({ dietModeEnabled: false });
        const profileGateway = createFakeProfileGateway(profile);
        const dailyLogGateway = createFakeDailyLogGateway({});
        const service = createNutritionService(profileGateway, dailyLogGateway);

        service.getDietInsights("2026-08-20");

        expect(dailyLogGateway.receivedWeightRanges).toEqual([]);
      });
    });

    describe("ダイエットモード有効だが目標データが欠落している場合（Requirement 14.2）", () => {
      it("goalWeightKgが欠落 → CalculationUnavailableError(incomplete_diet_mode_data)", () => {
        const profile = buildProfileSnapshot({
          dietModeEnabled: true,
          goalWeightKg: null,
          goalPeriodWeeks: 10,
        });
        const profileGateway = createFakeProfileGateway(profile);
        const dailyLogGateway = createFakeDailyLogGateway({});
        const service = createNutritionService(profileGateway, dailyLogGateway);

        const result = service.getDietInsights("2026-08-20");

        expect(result).toEqual({
          ok: false,
          error: {
            type: "calculation_unavailable",
            reason: "incomplete_diet_mode_data",
            message: expect.any(String),
          },
        });
      });

      it("goalPeriodWeeksが欠落 → CalculationUnavailableError(incomplete_diet_mode_data)", () => {
        const profile = buildProfileSnapshot({
          dietModeEnabled: true,
          goalWeightKg: 65,
          goalPeriodWeeks: null,
        });
        const profileGateway = createFakeProfileGateway(profile);
        const dailyLogGateway = createFakeDailyLogGateway({});
        const service = createNutritionService(profileGateway, dailyLogGateway);

        const result = service.getDietInsights("2026-08-20");

        expect(result).toEqual({
          ok: false,
          error: {
            type: "calculation_unavailable",
            reason: "incomplete_diet_mode_data",
            message: expect.any(String),
          },
        });
      });

      it("目標データ欠落の場合、DailyLogGateway.getWeightLogsInRangeを呼び出さない（早期終了）", () => {
        const profile = buildProfileSnapshot({
          dietModeEnabled: true,
          goalWeightKg: null,
          goalPeriodWeeks: null,
        });
        const profileGateway = createFakeProfileGateway(profile);
        const dailyLogGateway = createFakeDailyLogGateway({});
        const service = createNutritionService(profileGateway, dailyLogGateway);

        service.getDietInsights("2026-08-20");

        expect(dailyLogGateway.receivedWeightRanges).toEqual([]);
      });
    });

    describe("前提を満たす場合（正常系: DietInsightsCalculatorへの委譲。Requirements 14.1, 15.1, 16.1, 17.1）", () => {
      it("WEIGHT_TREND_LONG_WINDOW_DAYS日分の体重ログ範囲をdateまでの区間で取得し、現在の体重・目標体重・dateとともにcalculateDietInsightsに委譲した結果をそのまま返す", () => {
        const date = "2026-08-20";
        const profile = buildProfileSnapshot({
          weightKg: 70,
          dietModeEnabled: true,
          goalWeightKg: 65,
          goalPeriodWeeks: 10,
        });
        const weightLogPool: WeightLogPoint[] = [
          { date: "2026-07-01", weightKg: 72 },
          { date: "2026-07-15", weightKg: 71.2 },
          { date: "2026-08-20", weightKg: 70 },
        ];
        const profileGateway = createFakeProfileGateway(profile);
        const dailyLogGateway = createFakeDailyLogGateway({}, weightLogPool);
        const service = createNutritionService(profileGateway, dailyLogGateway);

        const result = service.getDietInsights(date);

        // from は date(2026-08-20) から55日前（date込みでWEIGHT_TREND_LONG_WINDOW_DAYS=56暦日分）
        // の2026-06-26、toはdate自身。
        expect(WEIGHT_TREND_LONG_WINDOW_DAYS).toBe(56);
        expect(dailyLogGateway.receivedWeightRanges).toEqual([
          { from: "2026-06-26", to: date },
        ]);

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok:true");

        // calculateDietInsights自体の正しさは別ファイル（task 6.3）で検証済みのため、ここでは
        // 「weightLogs（プール全体がfrom〜toの範囲内のため全件）・currentWeightKg・goalWeightKg・
        // dateが正しく渡されていること」を、実際の計算モジュールを同じ引数で直接呼び出した結果との
        // 深い等価比較で検証する。
        const expected = calculateDietInsights(weightLogPool, 70, 65, date);
        expect(result.value).toEqual(expected);
      });
    });

    describe("体重ログ取得範囲のfrom算出（境界値の解釈の固定化）", () => {
      /**
       * design.mdの「dateから遡ってWEIGHT_TREND_LONG_WINDOW_DAYS日分」という記述には、
       * 軽微なoff-by-oneの曖昧さがある: (A) date自身を含めて閉区間の幅がちょうどN暦日になる
       * 解釈 `[date - (N-1)日, date]`（本実装が採用）か、(B) `[date - N日, date]`
       * （閉区間の幅がN+1暦日になる）か。
       *
       * 本テストは、両解釈がちょうど1日だけ異なる境界日（date=2026-08-20, N=56の場合:
       * (A)ではfrom=2026-06-26、(B)ではfrom=2026-06-25）の直前日（2026-06-25）に体重ログを
       * 配置し、(A)を採用した本実装ではその点が`getWeightLogsInRange`の取得範囲・延いては
       * `calculateDietInsights`への入力から除外されること、また対抗する解釈(B)を採用した場合の
       * 結果とは一致しないことを直接検証する。すなわち本テストは対抗する解釈(B)の下では
       * 失敗する（tasks.md Implementation Notes task 6.3の教訓に基づく）。
       */
      it("date=2026-08-20の場合、from=2026-06-26（date込みで56暦日分）となり、2026-06-25の体重ログはcalculateDietInsightsへの入力から除外される", () => {
        const date = "2026-08-20";
        const profile = buildProfileSnapshot({
          weightKg: 70,
          dietModeEnabled: true,
          goalWeightKg: 65,
          goalPeriodWeeks: 10,
        });
        // 対抗する解釈(B)なら含まれるはずの、fromの1日前の境界ログ
        const dayBeforeChosenFrom: WeightLogPoint = { date: "2026-06-25", weightKg: 73 };
        // 採用した解釈(A)のfrom当日（両解釈どちらでも含まれる）
        const chosenFromDate: WeightLogPoint = { date: "2026-06-26", weightKg: 72.9 };
        const withinRangeLog: WeightLogPoint = { date: date, weightKg: 70 };
        const weightLogPool = [dayBeforeChosenFrom, chosenFromDate, withinRangeLog];

        const profileGateway = createFakeProfileGateway(profile);
        const dailyLogGateway = createFakeDailyLogGateway({}, weightLogPool);
        const service = createNutritionService(profileGateway, dailyLogGateway);

        const result = service.getDietInsights(date);

        // 採用した解釈(A)通り、from=2026-06-26が渡される（2026-06-25は含まれない）。
        expect(dailyLogGateway.receivedWeightRanges).toEqual([
          { from: "2026-06-26", to: date },
        ]);

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok:true");

        // 採用した解釈(A)の下でcalculateDietInsightsに渡されるべきweightLogsは
        // dayBeforeChosenFrom(2026-06-25)を含まない2点のみ。
        const expectedUnderChosenInterpretation = calculateDietInsights(
          [chosenFromDate, withinRangeLog],
          70,
          65,
          date,
        );
        expect(result.value).toEqual(expectedUnderChosenInterpretation);

        // 対抗する解釈(B)（from=2026-06-25を含む）を採用した場合にcalculateDietInsightsへ
        // 渡されるはずだったweightLogs（3点）による結果とは一致しない
        // （回帰対象点集合が変わるため、weeklyRateOfChangeKgひいてはgoalEta.estimatedWeeksToGoal /
        // weightProjection / exerciseSimulation.dietPlusExerciseWeeksToGoalが変化する）。
        // すなわち本アサーションは対抗する解釈(B)の下では失敗する。
        const resultUnderAlternativeInterpretation = calculateDietInsights(
          weightLogPool,
          70,
          65,
          date,
        );
        expect(result.value).not.toEqual(resultUnderAlternativeInterpretation);
      });
    });
  });
});
