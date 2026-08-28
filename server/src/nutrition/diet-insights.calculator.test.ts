import { describe, expect, it } from "vitest";
import { calculateDietInsights } from "./diet-insights.calculator.js";
import type { WeightLogPoint } from "./daily-log.gateway.js";

/**
 * design.md #DietInsightsCalculator 算出手順 (Requirements 14.3-14.6, 15.1-15.4, 16.1-16.5, 17.1-17.5)
 *
 * 期待値は design.md の算出手順（最小二乗法による回帰・目標方向判定・ゴールETA・将来予測の
 * 線形外挿・停滞判定・運動併用シミュレーション）から手計算で導出する。回帰式は
 *   slopeKgPerDay = Σ((x_i - x̄)(y_i - ȳ)) / Σ((x_i - x̄)²), weeklyRateOfChangeKg = slopeKgPerDay * 7
 * であり、各テストケースのコメントに手計算の途中式を示す。
 *
 * 運動併用シミュレーションの消費カロリー計算 (17.3, ActivityCoefficientCalculatorと同一式形):
 *   weeklyBurnKcal = MET(moderate)=4.5 × 3.5 × currentWeightKg / 200 × 30 × 3
 * 週あたり体重変化量への換算 (17.4): additionalWeeklyProgressKg = weeklyBurnKcal / 7700
 *
 * 除算が割り切れず循環小数になる値（例: 80/7, 27/1.161）は toBeCloseTo を用いる
 * （bmr.calculator.test.ts / pfc.calculator.test.ts と同じ規約: 割り切れる値は
 * toBeCloseTo(x, 9) で実質的な完全一致を、循環小数は手計算で導出した近似値を
 * toBeCloseTo(x, 5) 程度の精度で検証する）。
 */
describe("calculateDietInsights", () => {
  describe("データ不足（14.5, 15.4, 16.5, 17.5）", () => {
    it("体重記録が1件もない場合（全記録がweightKg: null）", () => {
      const weightLogs: WeightLogPoint[] = [{ date: "2026-01-01", weightKg: null }];

      const result = calculateDietInsights(weightLogs, 70, 65, "2026-01-10");

      expect(result).toEqual({
        weightHistory: [],
        weightProjection: [],
        goalEta: { available: false },
        plateau: { status: "insufficient_data" },
        exerciseSimulation: { available: false },
      });
    });

    it("体重記録が1件のみの場合（null記録は前処理で除外される, 14.5）", () => {
      const weightLogs: WeightLogPoint[] = [
        { date: "2026-01-01", weightKg: 70 },
        { date: "2026-01-05", weightKg: null },
      ];

      const result = calculateDietInsights(weightLogs, 70, 65, "2026-01-10");

      expect(result).toEqual({
        weightHistory: [{ date: "2026-01-01", weightKg: 70 }],
        weightProjection: [],
        goalEta: { available: false },
        plateau: { status: "insufficient_data" },
        exerciseSimulation: { available: false },
      });
    });

    it("記録点は2件以上だが最初と最後の記録日の間隔が最小日数(14日)未満の場合（月境界をまたぐ、1月28日〜2月5日=8日）", () => {
      // daysBetween(2026-01-28, 2026-02-05) = 3(1月28日→1月31日) + 5(2月1日→2月5日) = 8 < 14
      const weightLogs: WeightLogPoint[] = [
        { date: "2026-01-28", weightKg: 80 },
        { date: "2026-02-05", weightKg: 79 },
      ];

      const result = calculateDietInsights(weightLogs, 79, 75, "2026-02-05");

      expect(result).toEqual({
        weightHistory: [
          { date: "2026-01-28", weightKg: 80 },
          { date: "2026-02-05", weightKg: 79 },
        ],
        weightProjection: [],
        goalEta: { available: false },
        plateau: { status: "insufficient_data" },
        exerciseSimulation: { available: false },
      });
    });

    it("境界値: 間隔がちょうど13日ではデータ不足、14日では算出可能になる", () => {
      const insufficient = calculateDietInsights(
        [
          { date: "2026-03-01", weightKg: 80 },
          { date: "2026-03-14", weightKg: 79 }, // 13日
        ],
        79,
        75,
        "2026-03-14",
      );
      expect(insufficient.goalEta).toEqual({ available: false });

      const sufficient = calculateDietInsights(
        [
          { date: "2026-03-01", weightKg: 80 },
          { date: "2026-03-15", weightKg: 79 }, // 14日
        ],
        79,
        75,
        "2026-03-15",
      );
      expect(sufficient.goalEta.available).toBe(true);
    });
  });

  describe("減量方向・順調（on_track）: 完全な算出結果の検証", () => {
    it("2点の記録（境界の14日間隔）・null記録混在・ゴールETA・将来予測・停滞判定(on_track)・運動併用シミュレーションがすべてdesign.md算出手順通りに算出される（14.3-14.6, 15.1, 16.1, 16.4, 17.1, 17.3, 17.4）", () => {
      // points = [(2026-01-01, 80), (2026-01-15, 78)]（null記録は除外, 14.5）
      // x: 0, 14 / y: 80, 78 → slope = (78-80)/14 = -1/7 (kg/day)
      // weeklyRateOfChangeKg = -1/7 × 7 = -1 (kg/週、ちょうど整数)
      const weightLogs: WeightLogPoint[] = [
        { date: "2026-01-01", weightKg: 80 },
        { date: "2026-01-08", weightKg: null },
        { date: "2026-01-15", weightKg: 78 },
      ];
      const currentWeightKg = 88;
      const goalWeightKg = 70;
      const asOfDate = "2026-01-15";

      const result = calculateDietInsights(weightLogs, currentWeightKg, goalWeightKg, asOfDate);

      // weightHistory: null記録を除外したpointsそのもの（14.6: 実測と将来予測を別配列で区別）
      expect(result.weightHistory).toEqual([
        { date: "2026-01-01", weightKg: 80 },
        { date: "2026-01-15", weightKg: 78 },
      ]);

      // directionSign = sign(88 - 70) = +1（減量方向）
      // weeklyProgressKg = +1 × -(-1) = 1
      // estimatedWeeksToGoal = |88 - 70| / 1 = 18 (15.1)
      expect(result.goalEta).toEqual({
        available: true,
        weeklyProgressKg: 1,
        estimatedWeeksToGoal: 18,
      });

      // weightProjection: 直近の記録日(2026-01-15, 78kg)を起点に4週分、
      // weeklyRateOfChangeKg(-1)を週単位で累積加算（1月→2月の月境界をまたぐ, 14.4）
      expect(result.weightProjection).toEqual([
        { date: "2026-01-22", projectedWeightKg: 77 },
        { date: "2026-01-29", projectedWeightKg: 76 },
        { date: "2026-02-05", projectedWeightKg: 75 },
        { date: "2026-02-12", projectedWeightKg: 74 },
      ]);

      // shortPoints = asOfDate(2026-01-15)から14日以内の点 = 両点とも該当（距離14, 0）
      // shortWeeklyRateOfChangeKg = 長期回帰と同一の2点 → -1(同一値)
      // shortWeeklyProgressKg = 1 も長期のweeklyProgressKg(1)と同一
      // 閾値 = 1 × 0.30 = 0.30。1 < 0.30 ではない → on_track (16.1, 16.4)
      expect(result.plateau).toEqual({ status: "on_track" });

      // 運動併用シミュレーション (17.1, 17.3, 17.4):
      // weeklyBurnKcal = 4.5 × 3.5 × 88 / 200 × 30 × 3
      //   = 15.75 × 88 / 200 × 30 × 3 = 1386 / 200 × 30 × 3 = 6.93 × 30 × 3 = 207.9 × 3 = 623.7
      // additionalWeeklyProgressKg = 623.7 / 7700 = 0.081（割り切れる）
      // combinedWeeklyProgressKg = 1 + 0.081 = 1.081
      // dietPlusExerciseWeeksToGoal = |88-70| / 1.081 = 18 / 1.081 ≈ 16.6512488
      //   (1081 × 16 = 17296, 18000-17296=704 → 704/1081 ≈ 0.6512488、長除法で手計算)
      expect(result.exerciseSimulation.available).toBe(true);
      if (result.exerciseSimulation.available) {
        expect(result.exerciseSimulation.scenarioLabel).toBe("週3回・30分の運動を追加");
        expect(result.exerciseSimulation.dietOnlyWeeksToGoal).toBe(18);
        expect(result.exerciseSimulation.dietPlusExerciseWeeksToGoal).toBeCloseTo(16.651249, 5);
      }
    });
  });

  describe("減量方向・停滞（plateaued）", () => {
    it("長期的には減量傾向だが直近の短期ペースが長期ペースの30%閾値を明確に下回る場合（月境界(3月→4月)をまたぐ, 16.1, 16.3, 17.1）", () => {
      // points: x(2026-03-01起点の経過日数) = 0, 14, 28, 42 / y = 100, 97, 94, 93.8
      // x̄ = 84/4 = 21, ȳ = 384.8/4 = 96.2
      // dx: -21, -7, 7, 21 / dy: 3.8, 0.8, -2.2, -2.4
      // Σ(dx×dy) = -79.8 -5.6 -15.4 -50.4 = -151.2, Σ(dx²) = 441+49+49+441=980
      // slopeKgPerDay = -151.2/980 = -27/175, weeklyRateOfChangeKg = -27/175 × 7 = -27/25 = -1.08（割り切れる）
      const weightLogs: WeightLogPoint[] = [
        { date: "2026-03-01", weightKg: 100 },
        { date: "2026-03-15", weightKg: 97 },
        { date: "2026-03-29", weightKg: 94 },
        { date: "2026-04-12", weightKg: 93.8 },
      ];
      const currentWeightKg = 88;
      const goalWeightKg = 61;
      const asOfDate = "2026-04-12";

      const result = calculateDietInsights(weightLogs, currentWeightKg, goalWeightKg, asOfDate);

      // directionSign = sign(88-61) = +1、weeklyProgressKg = -(-1.08) = 1.08
      // estimatedWeeksToGoal = |88-61| / 1.08 = 27 / 1.08 = 25（割り切れる。1.08はIEEE754
      // 二進浮動小数点では厳密値ではないため、toEqualではなくtoBeCloseToで比較する）
      expect(result.goalEta.available).toBe(true);
      if (result.goalEta.available) {
        expect(result.goalEta.weeklyProgressKg).toBeCloseTo(1.08, 9);
        expect(result.goalEta.estimatedWeeksToGoal).toBeCloseTo(25, 9);
      }

      // 将来予測: 直近記録日(2026-04-12, 93.8kg)起点、weeklyRateOfChangeKg(-1.08)を累積加算
      const projection = result.weightProjection;
      expect(projection[0].date).toBe("2026-04-19");
      expect(projection[0].projectedWeightKg).toBeCloseTo(92.72, 9);
      expect(projection[1].date).toBe("2026-04-26");
      expect(projection[1].projectedWeightKg).toBeCloseTo(91.64, 9);
      expect(projection[2].date).toBe("2026-05-03");
      expect(projection[2].projectedWeightKg).toBeCloseTo(90.56, 9);
      expect(projection[3].date).toBe("2026-05-10");
      expect(projection[3].projectedWeightKg).toBeCloseTo(89.48, 9);

      // shortPoints = asOfDate(2026-04-12)から14日以内 = (2026-03-29, 94) と (2026-04-12, 93.8)
      //   （2026-03-01と2026-03-15はそれぞれ距離42, 28で除外）
      // x: 0, 14 / y: 94, 93.8 → slope = (93.8-94)/14 = -0.2/14 = -1/70
      // shortWeeklyRateOfChangeKg = -1/70 × 7 = -0.1、shortWeeklyProgressKg = -(-0.1) = 0.1
      // 閾値 = 1.08 × 0.30 = 0.324。0.1 < 0.324 → plateaued (16.3)
      expect(result.plateau.status).toBe("plateaued");
      if (result.plateau.status === "plateaued") {
        expect(typeof result.plateau.message).toBe("string");
        expect(result.plateau.message.length).toBeGreaterThan(0);
      }

      // 運動併用シミュレーション: weeklyBurnKcal = 4.5×3.5×88/200×30×3 = 623.7（on_trackケースと同一のcurrentWeightKg）
      // additionalWeeklyProgressKg = 623.7/7700 = 0.081
      // combinedWeeklyProgressKg = 1.08 + 0.081 = 1.161
      // dietPlusExerciseWeeksToGoal = 27 / 1.161 = 27000/1161 = 1000/43 ≈ 23.255814
      expect(result.exerciseSimulation.available).toBe(true);
      if (result.exerciseSimulation.available) {
        expect(result.exerciseSimulation.dietOnlyWeeksToGoal).toBeCloseTo(25, 9);
        expect(result.exerciseSimulation.dietPlusExerciseWeeksToGoal).toBeCloseTo(23.255814, 5);
      }
    });
  });

  describe("維持方向（currentWeightKg === goalWeightKg, 15.2, 16.2, 17.2）", () => {
    it("目標体重に到達済みの場合、ゴールETAは0週、停滞判定はnot_applicable、運動併用シミュレーションはavailable:falseになる", () => {
      // points: x: 0, 14 / y: 75, 73 → slope = (73-75)/14 = -1/7、weeklyRateOfChangeKg = -1（割り切れる）
      const weightLogs: WeightLogPoint[] = [
        { date: "2026-05-01", weightKg: 75 },
        { date: "2026-05-15", weightKg: 73 },
      ];

      const result = calculateDietInsights(weightLogs, 75, 75, "2026-05-15");

      // directionSign = sign(75-75) = 0 → 特別分岐（15.2）
      expect(result.goalEta).toEqual({
        available: true,
        weeklyProgressKg: 0,
        estimatedWeeksToGoal: 0,
      });

      // 将来予測は方向に関わらず算出される（直近記録日2026-05-15, 73kg起点、weeklyRate=-1）
      // 5月→6月の月境界をまたぐ
      expect(result.weightProjection).toEqual([
        { date: "2026-05-22", projectedWeightKg: 72 },
        { date: "2026-05-29", projectedWeightKg: 71 },
        { date: "2026-06-05", projectedWeightKg: 70 },
        { date: "2026-06-12", projectedWeightKg: 69 },
      ]);

      // 維持方向のため、停滞判定・運動併用シミュレーションはいずれも評価対象外（16.2, 17.2）
      expect(result.plateau).toEqual({ status: "not_applicable" });
      expect(result.exerciseSimulation).toEqual({ available: false });
    });
  });

  describe("増量方向（currentWeightKg < goalWeightKg, 16.2, 17.2）", () => {
    it("増量方向でもゴールETA・将来予測は算出されるが、停滞判定・運動併用シミュレーションは評価対象外になる", () => {
      // points: x: 0, 5, 10, 15 / y: 70, 74, 75, 79（非共線, 4点の本格的な回帰）
      // x̄ = 30/4 = 7.5, ȳ = 298/4 = 74.5
      // dx: -7.5, -2.5, 2.5, 7.5 / dy: -4.5, -0.5, 0.5, 4.5
      // Σ(dx×dy) = 33.75 + 1.25 + 1.25 + 33.75 = 70, Σ(dx²) = 56.25×2 + 6.25×2 = 125
      // slopeKgPerDay = 70/125 = 0.56, weeklyRateOfChangeKg = 0.56 × 7 = 3.92（割り切れる、増加傾向）
      const weightLogs: WeightLogPoint[] = [
        { date: "2026-06-01", weightKg: 70 },
        { date: "2026-06-06", weightKg: 74 },
        { date: "2026-06-11", weightKg: 75 },
        { date: "2026-06-16", weightKg: 79 },
      ];
      const currentWeightKg = 79;
      const goalWeightKg = 90;
      const asOfDate = "2026-06-16";

      const result = calculateDietInsights(weightLogs, currentWeightKg, goalWeightKg, asOfDate);

      // directionSign = sign(79-90) = -1（増量方向）
      // weeklyProgressKg = -1 × -(3.92) = 3.92
      // estimatedWeeksToGoal = |79-90| / 3.92 = 11/3.92 = 275/98 ≈ 2.806122
      expect(result.goalEta.available).toBe(true);
      if (result.goalEta.available) {
        expect(result.goalEta.weeklyProgressKg).toBeCloseTo(3.92, 9);
        expect(result.goalEta.estimatedWeeksToGoal).toBeCloseTo(2.806122, 5);
      }

      // 将来予測: 直近記録日(2026-06-16, 79kg)起点、weeklyRateOfChangeKg(3.92)を累積加算
      // 6月→7月の月境界をまたぐ
      const projection = result.weightProjection;
      expect(projection[0]).toEqual({ date: "2026-06-23", projectedWeightKg: expect.any(Number) });
      expect(projection[0].projectedWeightKg).toBeCloseTo(82.92, 9);
      expect(projection[1].date).toBe("2026-06-30");
      expect(projection[1].projectedWeightKg).toBeCloseTo(86.84, 9);
      expect(projection[2].date).toBe("2026-07-07");
      expect(projection[2].projectedWeightKg).toBeCloseTo(90.76, 9);
      expect(projection[3].date).toBe("2026-07-14");
      expect(projection[3].projectedWeightKg).toBeCloseTo(94.68, 9);

      // 増量方向のため、停滞判定・運動併用シミュレーションはいずれも評価対象外（16.2, 17.2）
      expect(result.plateau).toEqual({ status: "not_applicable" });
      expect(result.exerciseSimulation).toEqual({ available: false });
    });
  });

  describe("減量方向だが目標方向への週あたり進捗が0以下（15.3）", () => {
    it("体重が増加傾向にあるため、ダイエットのみ・運動併用シミュレーションのいずれもゴール到達見込み週数が算出不可(null)になる", () => {
      // points: x: 0, 14 / y: 80, 82 → slope = (82-80)/14 = 1/7、weeklyRateOfChangeKg = 1（増加傾向、割り切れる）
      const weightLogs: WeightLogPoint[] = [
        { date: "2026-07-01", weightKg: 80 },
        { date: "2026-07-15", weightKg: 82 },
      ];
      const currentWeightKg = 82;
      const goalWeightKg = 75;
      const asOfDate = "2026-07-15";

      const result = calculateDietInsights(weightLogs, currentWeightKg, goalWeightKg, asOfDate);

      // directionSign = sign(82-75) = +1（減量方向）だが weeklyProgressKg = -(1) = -1 <= 0
      expect(result.goalEta).toEqual({
        available: true,
        weeklyProgressKg: -1,
        estimatedWeeksToGoal: null,
      });

      // 運動併用: weeklyBurnKcal = 4.5×3.5×82/200×30×3 = 581.175
      // additionalWeeklyProgressKg = 581.175/7700 ≈ 0.0754773（循環小数）
      // combinedWeeklyProgressKg = -1 + 0.0754773 ≈ -0.9245 < 0 → 運動を併用してもなお算出不可
      expect(result.exerciseSimulation.available).toBe(true);
      if (result.exerciseSimulation.available) {
        expect(result.exerciseSimulation.dietOnlyWeeksToGoal).toBeNull();
        expect(result.exerciseSimulation.dietPlusExerciseWeeksToGoal).toBeNull();
      }

      // 短期ペースも同じ2点から算出され、長期と同じく悪化方向 → 停滞（plateaued）と判定される
      expect(result.plateau.status).toBe("plateaued");
    });
  });

  describe("減量方向: ダイエットのみでは算出不可だが運動併用で正の進捗に転じる（17.1, 17.3, 17.4の価値検証）", () => {
    it("週あたり進捗がわずかに負でも、追加運動分の進捗を加えると合計が正に転じ、運動併用シミュレーションのみゴール到達見込みが算出される", () => {
      // points: x: 0, 14 / y: 80, 80.1 → slope = 0.1/14 = 1/140、weeklyRateOfChangeKg = 7/140 = 0.05（割り切れる）
      const weightLogs: WeightLogPoint[] = [
        { date: "2026-08-01", weightKg: 80 },
        { date: "2026-08-15", weightKg: 80.1 },
      ];
      const currentWeightKg = 88;
      const goalWeightKg = 80;
      const asOfDate = "2026-08-15";

      const result = calculateDietInsights(weightLogs, currentWeightKg, goalWeightKg, asOfDate);

      // directionSign = sign(88-80) = +1、weeklyProgressKg = -(0.05) = -0.05（ダイエットのみでは算出不可）
      // 0.05はIEEE754二進浮動小数点では厳密値ではないため、toEqualではなくtoBeCloseToで比較する
      expect(result.goalEta.available).toBe(true);
      if (result.goalEta.available) {
        expect(result.goalEta.weeklyProgressKg).toBeCloseTo(-0.05, 9);
        expect(result.goalEta.estimatedWeeksToGoal).toBeNull();
      }

      // additionalWeeklyProgressKg = (4.5×3.5×88/200×30×3)/7700 = 623.7/7700 = 0.081
      // combinedWeeklyProgressKg = -0.05 + 0.081 = 0.031 > 0 に転じる
      // dietPlusExerciseWeeksToGoal = |88-80| / 0.031 = 8/0.031 = 8000/31 ≈ 258.064516
      expect(result.exerciseSimulation.available).toBe(true);
      if (result.exerciseSimulation.available) {
        expect(result.exerciseSimulation.dietOnlyWeeksToGoal).toBeNull();
        expect(result.exerciseSimulation.dietPlusExerciseWeeksToGoal).toBeCloseTo(258.064516, 4);
      }
    });
  });

  describe("停滞判定に必要な短期データが不足（長期データは十分, 16.5）", () => {
    it("長期回帰・ゴールETAは算出できるが、直近14日以内に体重記録が1件もないため停滞判定はinsufficient_dataになる", () => {
      // points: x: 0, 20 / y: 90, 88 → slope = (88-90)/20 = -0.1、weeklyRateOfChangeKg = -0.7（割り切れる）
      // asOfDateは最終記録日から30日後のため、shortPoints(asOfDateから14日以内)は0件
      const weightLogs: WeightLogPoint[] = [
        { date: "2026-09-01", weightKg: 90 },
        { date: "2026-09-21", weightKg: 88 },
      ];
      const currentWeightKg = 88;
      const goalWeightKg = 80;
      const asOfDate = "2026-10-21"; // 2026-09-01から50日後、2026-09-21から30日後

      const result = calculateDietInsights(weightLogs, currentWeightKg, goalWeightKg, asOfDate);

      // directionSign = sign(88-80) = +1、weeklyProgressKg = -(-0.7) = 0.7
      // estimatedWeeksToGoal = |88-80| / 0.7 = 8/0.7 = 80/7 ≈ 11.428571
      expect(result.goalEta.available).toBe(true);
      if (result.goalEta.available) {
        expect(result.goalEta.weeklyProgressKg).toBeCloseTo(0.7, 9);
        expect(result.goalEta.estimatedWeeksToGoal).toBeCloseTo(11.428571, 5);
      }

      // shortPoints = points のうち asOfDate(2026-10-21)から14日以内のもの:
      //   2026-09-01は50日前、2026-09-21は30日前 → いずれも該当せず0件 < WEIGHT_TREND_MIN_DATA_POINTS(2)
      expect(result.plateau).toEqual({ status: "insufficient_data" });

      // 運動併用シミュレーション自体は減量方向のため評価される（dietOnlyWeeksToGoalはgoalEtaと同じ値）
      expect(result.exerciseSimulation.available).toBe(true);
      if (result.exerciseSimulation.available && result.goalEta.available) {
        expect(result.exerciseSimulation.dietOnlyWeeksToGoal).toBe(result.goalEta.estimatedWeeksToGoal);
      }
    });
  });

  describe("停滞判定の「直近」基準点はasOfDate（直近の記録日ではない）である（design.md算出手順コメント参照）", () => {
    it("記録後に数日の空白期間があり、asOfDateが最終記録日より後の場合、shortPointsはasOfDateから14日以内で絞り込まれる（直近の記録日を基準にした場合と異なる結果になる）", () => {
      // points: (2026-01-01, 90) / (2026-01-10, 85) / (2026-01-20, 84)
      //   全体の間隔 = daysBetween(2026-01-01, 2026-01-20) = 19日 >= 14（十分なデータ）
      // asOfDate = 2026-01-26（最終記録日2026-01-20から6日後。記録の空白期間を想定）
      //
      // asOfDate基準（本実装）でのshortPoints（asOfDateから14日以内）:
      //   2026-01-01: daysBetween(..., 2026-01-26) = 25日 → 対象外
      //   2026-01-10: daysBetween(..., 2026-01-26) = 16日 → 対象外
      //   2026-01-20: daysBetween(..., 2026-01-26) = 6日  → 対象
      //   → shortPoints = [(2026-01-20, 84)] の1件のみ → WEIGHT_TREND_MIN_DATA_POINTS(2)未満 →
      //     plateau = insufficient_data
      //
      // 対抗する解釈（直近の記録日=2026-01-20を基準にした場合、本実装とは異なる仮の計算）でのshortPoints:
      //   2026-01-01: daysBetween(..., 2026-01-20) = 19日 → 対象外
      //   2026-01-10: daysBetween(..., 2026-01-20) = 10日 → 対象（本実装では対象外だったこの点が含まれる）
      //   2026-01-20: daysBetween(..., 2026-01-20) = 0日  → 対象
      //   → shortPoints = [(2026-01-10, 85), (2026-01-20, 84)] の2件 → 十分なデータとなり、
      //     insufficient_dataではなく実際の回帰結果（on_track/plateaued）が返ってしまう
      //
      // つまり本テストは、実装の基準点をasOfDateから直近の記録日に変更すると
      // 「plateau.status === "insufficient_data"」というアサーションが失われる（＝赤くなる）
      // ことをもって、asOfDate基準で実装されていることを検証する（16.1, 16.5）。
      const weightLogs: WeightLogPoint[] = [
        { date: "2026-01-01", weightKg: 90 },
        { date: "2026-01-10", weightKg: 85 },
        { date: "2026-01-20", weightKg: 84 },
      ];
      const currentWeightKg = 88;
      const goalWeightKg = 80;
      const asOfDate = "2026-01-26";

      const result = calculateDietInsights(weightLogs, currentWeightKg, goalWeightKg, asOfDate);

      // directionSign = sign(88-80) = +1（減量方向）のため、停滞判定自体は評価対象になる
      // （全体のspanは19日 >= 14で十分なため、goalEtaは算出可能。この点はasOfDateの解釈に依存しない）
      expect(result.goalEta.available).toBe(true);

      // shortPointsがasOfDate基準で1件のみに絞り込まれるため、insufficient_dataになる。
      // 直近の記録日(2026-01-20)基準であれば2件（(2026-01-10,85), (2026-01-20,84)）になり、
      // insufficient_dataにはならない（実際の回帰結果が返る）ため、この結果はasOfDate基準でのみ成立する。
      expect(result.plateau).toEqual({ status: "insufficient_data" });
    });
  });

  describe("決定論性（design.md #DietInsightsCalculator: 決定論的な純粋関数）", () => {
    it("同一の入力に対して複数回呼び出しても常に同一の結果を返す", () => {
      const weightLogs: WeightLogPoint[] = [
        { date: "2026-01-01", weightKg: 80 },
        { date: "2026-01-08", weightKg: null },
        { date: "2026-01-15", weightKg: 78 },
      ];

      const first = calculateDietInsights(weightLogs, 88, 70, "2026-01-15");
      const second = calculateDietInsights(weightLogs, 88, 70, "2026-01-15");
      const third = calculateDietInsights(weightLogs, 88, 70, "2026-01-15");

      expect(second).toEqual(first);
      expect(third).toEqual(first);
    });
  });
});
