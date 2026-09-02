import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DayMenu, MealSlot, MealType, VerifiedNutritionValues } from "@nutrition/shared";
import { createConnection } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import type { Result } from "../shared/result.js";
import type { UnitConversionService, VerificationError } from "./unit-conversion.service.js";
import { createMenuPlanRepository, type MenuPlanRepository } from "./menu-plan.repository.js";

/**
 * `MenuPlanRepository`（task 5.1）のテスト。
 *
 * 実際の一時SQLiteデータベース（`createConnection` + `runMigrations`）を用いる
 * （`food-composition.repository.test.ts` / `profile.repository.test.ts` の precedent）。
 * CASCADE削除・トランザクションのロールバック・UNIQUE制約という実際のリレーショナルな
 * 振る舞いそのものが検証対象であり、DBをモックするとテストの目的が失われるため。
 *
 * `UnitConversionService` のみフェイクを用いる（`toGrams` は `quantity * 100` を返す決定論的
 * スタブ）。実際の単位換算ロジックは task 3.2 で既にテスト済みであり、本タスクの関心事は
 * 「`meal_ingredients.quantity_g` が `toGrams` の戻り値として書き込まれること」だけであるため。
 */

// --- フェイク UnitConversionService ---

/** フェイクの `toGrams` が1単位あたり返すグラム数（`quantity * 100`）。 */
const GRAMS_PER_FAKE_UNIT = 100;

interface FakeUnitConversionService extends UnitConversionService {
  calls: { foodId: string; quantity: number; unitCode: string }[];
}

/**
 * 決定論的な `toGrams` を持つフェイク。`failOnUnit` を渡した場合、その単位コードに対してのみ
 * `unit_not_found` を返す（`replaceWeek`/`replaceDay` の書き込み途中での失敗を再現し、
 * トランザクションのロールバックを検証するために使う）。
 */
function createFakeUnitConversionService(failOnUnit?: string): FakeUnitConversionService {
  const calls: FakeUnitConversionService["calls"] = [];
  return {
    calls,
    toGrams(foodId: string, quantity: number, unitCode: string): Result<number, VerificationError> {
      calls.push({ foodId, quantity, unitCode });
      if (failOnUnit !== undefined && unitCode === failOnUnit) {
        return {
          ok: false,
          error: {
            type: "unit_not_found",
            message: `fake: 単位 "${unitCode}" は解決できません`,
            foodId,
            unit: unitCode,
          },
        };
      }
      return { ok: true, value: quantity * GRAMS_PER_FAKE_UNIT };
    },
  };
}

// --- 日付・食品IDのフィクスチャ ---

const WEEK_A_START = "2026-09-07";
const WEEK_B_START = "2026-09-14";

/** 書き込み途中での失敗を起こすための、換算エントリが存在しないダミー単位コード。 */
const BROKEN_UNIT = "BROKEN_UNIT";

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return date.toISOString().slice(0, 10);
}

/**
 * `meal_ingredients.food_id` は `food_items(food_id)` への外部キーであり、
 * `createConnection` が `PRAGMA foreign_keys = ON` を設定するため、フィクスチャには
 * `010_seed_food_items.sql` が実際に投入している食品IDを用いなければならない。
 */
const FOOD_IDS: readonly string[] = [
  "01088",
  "12004",
  "01006",
  "01015",
  "01020",
  "01026",
  "01031",
  "01034",
];

function pickFoodId(index: number): string {
  const foodId = FOOD_IDS[index % FOOD_IDS.length];
  if (foodId === undefined) {
    throw new Error("fixture error: FOOD_IDS is empty");
  }
  return foodId;
}

const MEAL_TYPES: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack"];

// --- 栄養価のフィクスチャ ---

/**
 * 食種ごとの基準栄養価（13項目）。値はすべて 1/4 刻み（0.25 の倍数）に揃えてあり、
 * 2進浮動小数点で厳密に表現できるため、4食枠の合算値も誤差なく厳密一致で比較できる。
 */
const BASE_NUTRITION: Record<MealType, VerifiedNutritionValues> = {
  breakfast: {
    energyKcal: 420,
    proteinG: 18.5,
    fatG: 12.25,
    carbG: 55.5,
    fiberG: 4.25,
    calciumMg: 120,
    ironMg: 2.5,
    vitaminAUg: 180,
    vitaminDUg: 1.5,
    vitaminB1Mg: 0.25,
    vitaminB2Mg: 0.5,
    vitaminCMg: 30,
    saltEquivalentG: 1.25,
  },
  lunch: {
    energyKcal: 680,
    proteinG: 32.25,
    fatG: 22.5,
    carbG: 78.25,
    fiberG: 6.5,
    calciumMg: 90,
    ironMg: 3.25,
    vitaminAUg: 260,
    vitaminDUg: 2.25,
    vitaminB1Mg: 0.5,
    vitaminB2Mg: 0.75,
    vitaminCMg: 45,
    saltEquivalentG: 2.5,
  },
  dinner: {
    energyKcal: 750,
    proteinG: 40.5,
    fatG: 26.25,
    carbG: 80.5,
    fiberG: 7.25,
    calciumMg: 210,
    ironMg: 4.5,
    vitaminAUg: 320,
    vitaminDUg: 5.5,
    vitaminB1Mg: 0.75,
    vitaminB2Mg: 0.25,
    vitaminCMg: 60,
    saltEquivalentG: 3.25,
  },
  snack: {
    energyKcal: 150,
    proteinG: 5.75,
    fatG: 6.5,
    carbG: 18.75,
    fiberG: 1.5,
    calciumMg: 150,
    ironMg: 0.25,
    vitaminAUg: 40,
    vitaminDUg: 0.5,
    vitaminB1Mg: 0.25,
    vitaminB2Mg: 0.5,
    vitaminCMg: 15,
    saltEquivalentG: 0.25,
  },
};

/**
 * 日ごとに値をずらした食枠栄養価。`energyKcal` に `dayIndex`（整数）、`fiberG` に
 * `dayIndex * 0.25` を加算するため、日ごとの合算値は
 * `energyKcal = 2000 + 4 * dayIndex` / `fiberG = 19.5 + dayIndex` となり
 * （いずれも下の `EXPECTED_DAY0_NUTRITION` を手計算で導出した値と整合する）、
 * 他日の値が誤って混入した場合に必ず検出できる。
 */
function mealNutrition(
  mealType: MealType,
  dayIndex: number,
  energyBump = 0
): VerifiedNutritionValues {
  const base = BASE_NUTRITION[mealType];
  return {
    ...base,
    energyKcal: base.energyKcal + dayIndex + energyBump,
    fiberG: base.fiberG + dayIndex * 0.25,
  };
}

/**
 * dayIndex = 0 の4食枠（breakfast/lunch/dinner/snack）を手計算で合算した期待値。
 * 実装側の合算関数を再利用せず、リテラル値として独立に導出している。
 *   energyKcal: 420 + 680 + 750 + 150 = 2000
 *   proteinG: 18.5 + 32.25 + 40.5 + 5.75 = 97
 *   fatG: 12.25 + 22.5 + 26.25 + 6.5 = 67.5
 *   carbG: 55.5 + 78.25 + 80.5 + 18.75 = 233
 *   fiberG: 4.25 + 6.5 + 7.25 + 1.5 = 19.5
 *   calciumMg: 120 + 90 + 210 + 150 = 570
 *   ironMg: 2.5 + 3.25 + 4.5 + 0.25 = 10.5
 *   vitaminAUg: 180 + 260 + 320 + 40 = 800
 *   vitaminDUg: 1.5 + 2.25 + 5.5 + 0.5 = 9.75
 *   vitaminB1Mg: 0.25 + 0.5 + 0.75 + 0.25 = 1.75
 *   vitaminB2Mg: 0.5 + 0.75 + 0.25 + 0.5 = 2
 *   vitaminCMg: 30 + 45 + 60 + 15 = 150
 *   saltEquivalentG: 1.25 + 2.5 + 3.25 + 0.25 = 7.25
 */
const EXPECTED_DAY0_NUTRITION: VerifiedNutritionValues = {
  energyKcal: 2000,
  proteinG: 97,
  fatG: 67.5,
  carbG: 233,
  fiberG: 19.5,
  calciumMg: 570,
  ironMg: 10.5,
  vitaminAUg: 800,
  vitaminDUg: 9.75,
  vitaminB1Mg: 1.75,
  vitaminB2Mg: 2,
  vitaminCMg: 150,
  saltEquivalentG: 7.25,
};

/**
 * dayIndex = 5 の期待値（手計算）。
 *   energyKcal: (420+5) + (680+5) + (750+5) + (150+5) = 2020
 *   fiberG: (4.25+1.25) + (6.5+1.25) + (7.25+1.25) + (1.5+1.25) = 24.5
 *   他11項目は dayIndex に依存しないため EXPECTED_DAY0_NUTRITION と同一。
 */
const EXPECTED_DAY5_NUTRITION: VerifiedNutritionValues = {
  ...EXPECTED_DAY0_NUTRITION,
  energyKcal: 2020,
  fiberG: 24.5,
};

const TARGET_KCAL = 2100;

/** targetKcal を null にする日（`varianceKcal` が null になることの検証用）。 */
const NULL_TARGET_DAY_INDEX = 3;

// --- MealSlot / DayMenu のフィクスチャ ---

interface MealSlotFixtureOptions {
  /** dishName の接頭辞（既定 "day"）。再生成後の食枠と区別するために使う。 */
  label?: string;
  /** 各食枠の energyKcal に加算する値。 */
  energyBump?: number;
  /** この食種の1つ目の食材に使う単位コードを差し替える（書き込み失敗の再現用）。 */
  brokenUnitMealType?: MealType;
}

function buildMealSlot(
  mealType: MealType,
  dayIndex: number,
  options: MealSlotFixtureOptions = {}
): MealSlot {
  const mealIndex = MEAL_TYPES.indexOf(mealType);
  const label = options.label ?? "day";
  const firstUnit = options.brokenUnitMealType === mealType ? BROKEN_UNIT : "g";
  return {
    mealType,
    dishName: `${label}${dayIndex}-${mealType}-dish`,
    ingredients: [
      {
        foodId: pickFoodId(dayIndex + mealIndex),
        quantity: mealIndex + 1,
        unit: firstUnit,
      },
      {
        foodId: pickFoodId(dayIndex + mealIndex + 1),
        quantity: (mealIndex + 1) * 0.5,
        unit: "個",
      },
    ],
    nutrition: mealNutrition(mealType, dayIndex, options.energyBump ?? 0),
  };
}

function buildMeals(dayIndex: number, options: MealSlotFixtureOptions = {}): MealSlot[] {
  return MEAL_TYPES.map((mealType) => buildMealSlot(mealType, dayIndex, options));
}

/** テスト側の独立した合算実装（実装側の関数を再利用しない）。 */
function sumMealNutrition(meals: readonly MealSlot[]): VerifiedNutritionValues {
  return meals.reduce<VerifiedNutritionValues>(
    (total, meal) => ({
      energyKcal: total.energyKcal + meal.nutrition.energyKcal,
      proteinG: total.proteinG + meal.nutrition.proteinG,
      fatG: total.fatG + meal.nutrition.fatG,
      carbG: total.carbG + meal.nutrition.carbG,
      fiberG: total.fiberG + meal.nutrition.fiberG,
      calciumMg: total.calciumMg + meal.nutrition.calciumMg,
      ironMg: total.ironMg + meal.nutrition.ironMg,
      vitaminAUg: total.vitaminAUg + meal.nutrition.vitaminAUg,
      vitaminDUg: total.vitaminDUg + meal.nutrition.vitaminDUg,
      vitaminB1Mg: total.vitaminB1Mg + meal.nutrition.vitaminB1Mg,
      vitaminB2Mg: total.vitaminB2Mg + meal.nutrition.vitaminB2Mg,
      vitaminCMg: total.vitaminCMg + meal.nutrition.vitaminCMg,
      saltEquivalentG: total.saltEquivalentG + meal.nutrition.saltEquivalentG,
    }),
    {
      energyKcal: 0,
      proteinG: 0,
      fatG: 0,
      carbG: 0,
      fiberG: 0,
      calciumMg: 0,
      ironMg: 0,
      vitaminAUg: 0,
      vitaminDUg: 0,
      vitaminB1Mg: 0,
      vitaminB2Mg: 0,
      vitaminCMg: 0,
      saltEquivalentG: 0,
    }
  );
}

function buildDayMenu(
  weekStartDate: string,
  dayIndex: number,
  options: MealSlotFixtureOptions = {}
): DayMenu {
  const meals = buildMeals(dayIndex, options);
  const dayNutrition = sumMealNutrition(meals);
  const plannedKcal = dayNutrition.energyKcal;
  const targetKcal = dayIndex === NULL_TARGET_DAY_INDEX ? null : TARGET_KCAL;
  return {
    dayDate: addDays(weekStartDate, dayIndex),
    dayIndex,
    meals,
    dayNutrition,
    plannedKcal,
    targetKcal,
    varianceKcal: targetKcal === null ? null : plannedKcal - targetKcal,
  };
}

function buildWeek(
  weekStartDate: string,
  options: { label?: string; brokenUnitDayIndex?: number } = {}
): DayMenu[] {
  return [0, 1, 2, 3, 4, 5, 6].map((dayIndex) =>
    buildDayMenu(weekStartDate, dayIndex, {
      label: options.label,
      // 週の最終日（dayIndex = 6）で失敗させれば、0-5日目の書き込みが済んだ「途中」で
      // 失敗するため、ロールバックの有無を厳密に検証できる。
      brokenUnitMealType: options.brokenUnitDayIndex === dayIndex ? "breakfast" : undefined,
    })
  );
}

// --- 直接SQL検証用の行の型 ---

interface CountRow {
  count: number;
}

interface WeekPlanRow {
  week_start_date: string;
  generated_at: string;
  generation_source: string;
}

interface MealSlotIdentityRow {
  id: number;
  day_index: number;
  meal_type: string;
  dish_name: string;
  energy_kcal: number;
}

interface IngredientRow {
  food_id: string;
  quantity: number;
  unit_code: string;
  quantity_g: number;
}

interface DayMenuKcalRow {
  day_date: string;
  planned_kcal: number | null;
  target_kcal: number | null;
  variance_kcal: number | null;
}

interface TableInfoRow {
  name: string;
}

describe("MenuPlanRepository", () => {
  let tmpDir: string;
  let db: Database.Database;
  let unitConversionService: FakeUnitConversionService;
  let repository: MenuPlanRepository;

  function createRepositoryWith(fake: FakeUnitConversionService): MenuPlanRepository {
    return createMenuPlanRepository(db, fake);
  }

  function countWeekPlans(): number {
    return (db.prepare("SELECT COUNT(*) as count FROM week_menu_plans").get() as CountRow).count;
  }

  function countDayMenus(weekStartDate: string): number {
    return (
      db
        .prepare("SELECT COUNT(*) as count FROM day_menus WHERE week_start_date = ?")
        .get(weekStartDate) as CountRow
    ).count;
  }

  function countMealSlots(weekStartDate: string): number {
    return (
      db
        .prepare(
          `SELECT COUNT(*) as count
             FROM meal_slots ms
             JOIN day_menus dm ON ms.day_menu_id = dm.id
            WHERE dm.week_start_date = ?`
        )
        .get(weekStartDate) as CountRow
    ).count;
  }

  function countMealIngredients(weekStartDate: string): number {
    return (
      db
        .prepare(
          `SELECT COUNT(*) as count
             FROM meal_ingredients mi
             JOIN meal_slots ms ON mi.meal_slot_id = ms.id
             JOIN day_menus dm ON ms.day_menu_id = dm.id
            WHERE dm.week_start_date = ?`
        )
        .get(weekStartDate) as CountRow
    ).count;
  }

  function readWeekPlanRow(weekStartDate: string): WeekPlanRow | undefined {
    return db
      .prepare("SELECT week_start_date, generated_at, generation_source FROM week_menu_plans WHERE week_start_date = ?")
      .get(weekStartDate) as WeekPlanRow | undefined;
  }

  function readMealSlotIdentities(weekStartDate: string): MealSlotIdentityRow[] {
    return db
      .prepare(
        `SELECT ms.id, dm.day_index, ms.meal_type, ms.dish_name, ms.energy_kcal
           FROM meal_slots ms
           JOIN day_menus dm ON ms.day_menu_id = dm.id
          WHERE dm.week_start_date = ?
          ORDER BY dm.day_index ASC, ms.id ASC`
      )
      .all(weekStartDate) as MealSlotIdentityRow[];
  }

  function readIngredientRows(weekStartDate: string, dayIndex: number, mealType: MealType): IngredientRow[] {
    return db
      .prepare(
        `SELECT mi.food_id, mi.quantity, mi.unit_code, mi.quantity_g
           FROM meal_ingredients mi
           JOIN meal_slots ms ON mi.meal_slot_id = ms.id
           JOIN day_menus dm ON ms.day_menu_id = dm.id
          WHERE dm.week_start_date = ? AND dm.day_index = ? AND ms.meal_type = ?
          ORDER BY mi.id ASC`
      )
      .all(weekStartDate, dayIndex, mealType) as IngredientRow[];
  }

  function readDayMenuKcalRow(weekStartDate: string, dayIndex: number): DayMenuKcalRow | undefined {
    return db
      .prepare(
        `SELECT day_date, planned_kcal, target_kcal, variance_kcal
           FROM day_menus WHERE week_start_date = ? AND day_index = ?`
      )
      .get(weekStartDate, dayIndex) as DayMenuKcalRow | undefined;
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-menu-plan-repo-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    db = createConnection(dbPath);
    runMigrations(db);
    unitConversionService = createFakeUnitConversionService();
    repository = createRepositoryWith(unitConversionService);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("replaceWeek()", () => {
    it("persists a full 7-day plan and round-trips it through getActivePlan (Req 1.3, 6.1)", () => {
      const days = buildWeek(WEEK_A_START);

      const returned = repository.replaceWeek(WEEK_A_START, days);

      expect(returned.weekStartDate).toBe(WEEK_A_START);
      expect(typeof returned.generatedAt).toBe("string");
      expect(Number.isNaN(Date.parse(returned.generatedAt))).toBe(false);
      expect(returned.days).toHaveLength(7);

      const reloaded = repository.getActivePlan(WEEK_A_START);
      expect(reloaded).not.toBeNull();
      expect(reloaded).toEqual(returned);

      // 7日 × 4食枠 = 28、7日 × 4食枠 × 2食材 = 56 行
      expect(countDayMenus(WEEK_A_START)).toBe(7);
      expect(countMealSlots(WEEK_A_START)).toBe(28);
      expect(countMealIngredients(WEEK_A_START)).toBe(56);
    });

    it("writes all 13 VerifiedNutritionValues fields of each MealSlot into meal_slots columns verbatim (Req 4.7)", () => {
      const days = buildWeek(WEEK_A_START);
      repository.replaceWeek(WEEK_A_START, days);

      const plan = repository.getActivePlan(WEEK_A_START);
      const day2 = plan?.days.find((day) => day.dayIndex === 2);
      const dinner = day2?.meals.find((meal) => meal.mealType === "dinner");

      // BASE_NUTRITION.dinner に dayIndex=2 の加算（energyKcal +2、fiberG +0.5）を適用した値。
      expect(dinner?.nutrition).toEqual({
        energyKcal: 752,
        proteinG: 40.5,
        fatG: 26.25,
        carbG: 80.5,
        fiberG: 7.75,
        calciumMg: 210,
        ironMg: 4.5,
        vitaminAUg: 320,
        vitaminDUg: 5.5,
        vitaminB1Mg: 0.75,
        vitaminB2Mg: 0.25,
        vitaminCMg: 60,
        saltEquivalentG: 3.25,
      });
      expect(dinner?.dishName).toBe("day2-dinner-dish");
    });

    it("preserves each day's dayDate / plannedKcal / targetKcal / varianceKcal (Req 4.5, 11.1)", () => {
      const days = buildWeek(WEEK_A_START);
      repository.replaceWeek(WEEK_A_START, days);

      const plan = repository.getActivePlan(WEEK_A_START);

      expect(plan?.days.map((day) => day.dayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(plan?.days.map((day) => day.dayDate)).toEqual([
        "2026-09-07",
        "2026-09-08",
        "2026-09-09",
        "2026-09-10",
        "2026-09-11",
        "2026-09-12",
        "2026-09-13",
      ]);
      expect(plan?.days.map((day) => day.plannedKcal)).toEqual([
        2000, 2004, 2008, 2012, 2016, 2020, 2024,
      ]);
      // dayIndex = 3 のみ targetKcal が null であり、その日の varianceKcal も null になる。
      expect(plan?.days.map((day) => day.targetKcal)).toEqual([
        2100, 2100, 2100, null, 2100, 2100, 2100,
      ]);
      expect(plan?.days.map((day) => day.varianceKcal)).toEqual([
        -100, -96, -92, null, -84, -80, -76,
      ]);
    });

    it("computes quantity_g through the injected UnitConversionService while storing the original quantity/unit unchanged", () => {
      const days = buildWeek(WEEK_A_START);
      repository.replaceWeek(WEEK_A_START, days);

      const lunchOfDay0 = readIngredientRows(WEEK_A_START, 0, "lunch");
      // buildMealSlot: lunch は mealIndex = 1 なので quantity は 2 と 1（単位 g / 個）。
      expect(lunchOfDay0).toEqual([
        { food_id: pickFoodId(1), quantity: 2, unit_code: "g", quantity_g: 200 },
        { food_id: pickFoodId(2), quantity: 1, unit_code: "個", quantity_g: 100 },
      ]);

      // toGrams は全56食材について (foodId, quantity, unit) で呼ばれている。
      expect(unitConversionService.calls).toHaveLength(56);
      expect(unitConversionService.calls).toContainEqual({
        foodId: pickFoodId(1),
        quantity: 2,
        unitCode: "g",
      });
      expect(unitConversionService.calls).toContainEqual({
        foodId: pickFoodId(2),
        quantity: 1,
        unitCode: "個",
      });
    });

    it("writes generation_source = 'initial' on the first-ever replaceWeek for that week", () => {
      repository.replaceWeek(WEEK_A_START, buildWeek(WEEK_A_START));

      expect(readWeekPlanRow(WEEK_A_START)?.generation_source).toBe("initial");
    });

    it("writes generation_source = 'week_regenerate' when a week_menu_plans row already existed", () => {
      repository.replaceWeek(WEEK_A_START, buildWeek(WEEK_A_START));
      repository.replaceWeek(WEEK_A_START, buildWeek(WEEK_A_START, { label: "regen" }));

      expect(readWeekPlanRow(WEEK_A_START)?.generation_source).toBe("week_regenerate");
      // 週開始日は主キーであり、同一週に対して常に0または1行しか存在しない。
      expect(countWeekPlans()).toBe(1);
    });

    it("completely replaces the prior week's meal_slots / meal_ingredients — the old rows are genuinely gone (Req 6.1)", () => {
      repository.replaceWeek(WEEK_A_START, buildWeek(WEEK_A_START));
      const before = readMealSlotIdentities(WEEK_A_START);
      const beforeIds = before.map((row) => row.id);
      expect(before).toHaveLength(28);

      repository.replaceWeek(WEEK_A_START, buildWeek(WEEK_A_START, { label: "regen" }));

      const after = readMealSlotIdentities(WEEK_A_START);
      expect(after).toHaveLength(28);
      // 旧IDは1件も残っていない（論理的な上書きではなく物理的な全置換であること）。
      const afterIds = new Set(after.map((row) => row.id));
      for (const oldId of beforeIds) {
        expect(afterIds.has(oldId)).toBe(false);
      }
      // 旧IDを直接引いても行は存在しない。
      const survivingOldRows = (
        db
          .prepare(
            `SELECT COUNT(*) as count FROM meal_slots WHERE id IN (${beforeIds
              .map(() => "?")
              .join(",")})`
          )
          .get(...beforeIds) as CountRow
      ).count;
      expect(survivingOldRows).toBe(0);

      // 旧食枠に紐づいていた meal_ingredients も残らず、総数は56のまま。
      expect(countMealIngredients(WEEK_A_START)).toBe(56);
      expect(
        (db.prepare("SELECT COUNT(*) as count FROM meal_ingredients").get() as CountRow).count
      ).toBe(56);
      expect(after.every((row) => row.dish_name.startsWith("regen"))).toBe(true);
    });

    it("refreshes generated_at on regeneration", () => {
      repository.replaceWeek(WEEK_A_START, buildWeek(WEEK_A_START));
      const first = readWeekPlanRow(WEEK_A_START)?.generated_at ?? "";

      const second = repository.replaceWeek(WEEK_A_START, buildWeek(WEEK_A_START, { label: "regen" }));

      expect(readWeekPlanRow(WEEK_A_START)?.generated_at).toBe(second.generatedAt);
      expect(Date.parse(second.generatedAt)).toBeGreaterThanOrEqual(Date.parse(first));
    });

    it("never touches another week's data (Postconditions: 対象外の範囲には影響しない)", () => {
      repository.replaceWeek(WEEK_A_START, buildWeek(WEEK_A_START));
      const weekASnapshot = repository.getActivePlan(WEEK_A_START);
      const weekAIdentities = readMealSlotIdentities(WEEK_A_START);

      repository.replaceWeek(WEEK_B_START, buildWeek(WEEK_B_START, { label: "weekB" }));

      expect(repository.getActivePlan(WEEK_A_START)).toEqual(weekASnapshot);
      expect(readMealSlotIdentities(WEEK_A_START)).toEqual(weekAIdentities);
      expect(countWeekPlans()).toBe(2);
      expect(countMealSlots(WEEK_B_START)).toBe(28);
    });

    it("runs as ONE transaction: a toGrams failure on the last day rolls back every prior insert (first-time generation)", () => {
      const failingRepository = createRepositoryWith(createFakeUnitConversionService(BROKEN_UNIT));
      const days = buildWeek(WEEK_A_START, { brokenUnitDayIndex: 6 });

      expect(() => failingRepository.replaceWeek(WEEK_A_START, days)).toThrow(/BROKEN_UNIT/);

      // week_menu_plans の行も、先行して挿入された0-5日目の行も一切残っていない。
      expect(countWeekPlans()).toBe(0);
      expect(countDayMenus(WEEK_A_START)).toBe(0);
      expect(countMealSlots(WEEK_A_START)).toBe(0);
      expect(countMealIngredients(WEEK_A_START)).toBe(0);
      expect(repository.getActivePlan(WEEK_A_START)).toBeNull();
    });

    it("runs as ONE transaction: a toGrams failure during regeneration leaves the previously persisted week fully intact", () => {
      repository.replaceWeek(WEEK_A_START, buildWeek(WEEK_A_START));
      const snapshot = repository.getActivePlan(WEEK_A_START);
      const identities = readMealSlotIdentities(WEEK_A_START);

      const failingRepository = createRepositoryWith(createFakeUnitConversionService(BROKEN_UNIT));
      expect(() =>
        failingRepository.replaceWeek(
          WEEK_A_START,
          buildWeek(WEEK_A_START, { label: "regen", brokenUnitDayIndex: 6 })
        )
      ).toThrow(/BROKEN_UNIT/);

      // 削除も挿入もロールバックされ、generation_source も 'initial' のまま。
      expect(repository.getActivePlan(WEEK_A_START)).toEqual(snapshot);
      expect(readMealSlotIdentities(WEEK_A_START)).toEqual(identities);
      expect(readWeekPlanRow(WEEK_A_START)?.generation_source).toBe("initial");
      expect(countMealSlots(WEEK_A_START)).toBe(28);
      expect(countMealIngredients(WEEK_A_START)).toBe(56);
    });
  });

  describe("replaceDay()", () => {
    beforeEach(() => {
      repository.replaceWeek(WEEK_A_START, buildWeek(WEEK_A_START));
    });

    it("replaces ONLY the target day's 4 meal_slots and leaves the other 6 days byte-for-byte untouched (Req 7.1, 7.4)", () => {
      const before = readMealSlotIdentities(WEEK_A_START);
      const otherDaysBefore = before.filter((row) => row.day_index !== 2);
      const targetDayBefore = before.filter((row) => row.day_index === 2);
      expect(targetDayBefore).toHaveLength(4);
      expect(otherDaysBefore).toHaveLength(24);

      repository.replaceDay(
        WEEK_A_START,
        2,
        buildMeals(2, { label: "regen", energyBump: 300 }),
        3208,
        TARGET_KCAL
      );

      const after = readMealSlotIdentities(WEEK_A_START);
      const otherDaysAfter = after.filter((row) => row.day_index !== 2);
      const targetDayAfter = after.filter((row) => row.day_index === 2);

      // 他6日の行は id も内容も完全に同一。
      expect(otherDaysAfter).toEqual(otherDaysBefore);
      // 対象日の4行は物理的に置き換わっている（旧idは残らない）。
      expect(targetDayAfter).toHaveLength(4);
      const targetOldIds = new Set(targetDayBefore.map((row) => row.id));
      expect(targetDayAfter.every((row) => !targetOldIds.has(row.id))).toBe(true);
      expect(targetDayAfter.every((row) => row.dish_name.startsWith("regen"))).toBe(true);
      expect(countMealSlots(WEEK_A_START)).toBe(28);
    });

    it("does not touch other days' meal_ingredients, and replaces the target day's ingredients", () => {
      const otherDayIngredientsBefore = readIngredientRows(WEEK_A_START, 5, "dinner");
      const totalBefore = countMealIngredients(WEEK_A_START);

      repository.replaceDay(
        WEEK_A_START,
        2,
        buildMeals(2, { label: "regen", energyBump: 300 }),
        3208,
        TARGET_KCAL
      );

      expect(readIngredientRows(WEEK_A_START, 5, "dinner")).toEqual(otherDayIngredientsBefore);
      expect(countMealIngredients(WEEK_A_START)).toBe(totalBefore);
      expect(readIngredientRows(WEEK_A_START, 2, "breakfast")).toHaveLength(2);
    });

    it("does not touch the other 6 days' day_menus kcal columns", () => {
      const otherDayKcalBefore = readDayMenuKcalRow(WEEK_A_START, 5);

      repository.replaceDay(
        WEEK_A_START,
        2,
        buildMeals(2, { label: "regen", energyBump: 300 }),
        3208,
        TARGET_KCAL
      );

      expect(readDayMenuKcalRow(WEEK_A_START, 5)).toEqual(otherDayKcalBefore);
    });

    it("returns a DayMenu whose dayNutrition is the sum of the 4 given meals and whose varianceKcal is dayNutrition.energyKcal - targetKcal", () => {
      // dayIndex = 2 / energyBump = 300:
      //   energyKcal = (2000 + 4*2) + 4*300 = 2008 + 1200 = 3208
      //   fiberG = 19.5 + 2 = 21.5、他11項目は EXPECTED_DAY0_NUTRITION と同一
      //   varianceKcal = 3208 - 2100 = 1108
      const result = repository.replaceDay(
        WEEK_A_START,
        2,
        buildMeals(2, { label: "regen", energyBump: 300 }),
        3208,
        TARGET_KCAL
      );

      expect(result.dayIndex).toBe(2);
      expect(result.dayDate).toBe("2026-09-09");
      expect(result.dayNutrition).toEqual({
        ...EXPECTED_DAY0_NUTRITION,
        energyKcal: 3208,
        fiberG: 21.5,
      });
      expect(result.plannedKcal).toBe(3208);
      expect(result.targetKcal).toBe(TARGET_KCAL);
      expect(result.varianceKcal).toBe(1108);
      expect(result.meals.map((meal) => meal.mealType)).toEqual([
        "breakfast",
        "lunch",
        "dinner",
        "snack",
      ]);
    });

    it("returns varianceKcal = null when targetKcal is null", () => {
      // dayIndex = 4 / energyBump = 300: energyKcal = (2000 + 16) + 1200 = 3216
      const result = repository.replaceDay(
        WEEK_A_START,
        4,
        buildMeals(4, { label: "regen", energyBump: 300 }),
        3216,
        null
      );

      expect(result.dayNutrition.energyKcal).toBe(3216);
      expect(result.targetKcal).toBeNull();
      expect(result.varianceKcal).toBeNull();
      expect(readDayMenuKcalRow(WEEK_A_START, 4)).toEqual({
        day_date: "2026-09-11",
        planned_kcal: 3216,
        target_kcal: null,
        variance_kcal: null,
      });
    });

    it("stores the plannedKcal argument as given while deriving varianceKcal from the meals' own energy sum", () => {
      // plannedKcal 引数（9999）と食枠合算値（(2000 + 24) + 1200 = 3224）を意図的に食い違わせ、
      // varianceKcal が 3224 - 2100 = 1124 として合算値から導出されることを固定する。
      const result = repository.replaceDay(
        WEEK_A_START,
        6,
        buildMeals(6, { label: "regen", energyBump: 300 }),
        9999,
        TARGET_KCAL
      );

      expect(result.plannedKcal).toBe(9999);
      expect(result.dayNutrition.energyKcal).toBe(3224);
      expect(result.varianceKcal).toBe(1124);
      expect(readDayMenuKcalRow(WEEK_A_START, 6)).toEqual({
        day_date: "2026-09-13",
        planned_kcal: 9999,
        target_kcal: TARGET_KCAL,
        variance_kcal: 1124,
      });
    });

    it("does not change week_menu_plans.generation_source (a day-level replace is not a week regeneration)", () => {
      repository.replaceDay(
        WEEK_A_START,
        2,
        buildMeals(2, { label: "regen", energyBump: 300 }),
        3208,
        TARGET_KCAL
      );

      expect(readWeekPlanRow(WEEK_A_START)?.generation_source).toBe("initial");
    });

    it("is reflected by a subsequent getActivePlan (only the target day changed)", () => {
      const before = repository.getActivePlan(WEEK_A_START);

      const replaced = repository.replaceDay(
        WEEK_A_START,
        2,
        buildMeals(2, { label: "regen", energyBump: 300 }),
        3208,
        TARGET_KCAL
      );

      const after = repository.getActivePlan(WEEK_A_START);
      expect(after?.days.find((day) => day.dayIndex === 2)).toEqual(replaced);
      for (const dayIndex of [0, 1, 3, 4, 5, 6]) {
        expect(after?.days.find((day) => day.dayIndex === dayIndex)).toEqual(
          before?.days.find((day) => day.dayIndex === dayIndex)
        );
      }
    });

    it("throws when no day_menus row exists for (weekStartDate, dayIndex)", () => {
      expect(() =>
        repository.replaceDay(WEEK_B_START, 0, buildMeals(0), 2000, TARGET_KCAL)
      ).toThrow(/2026-09-14/);
    });

    it("runs as ONE transaction: a toGrams failure on the last meal leaves the target day's original rows intact", () => {
      const before = readMealSlotIdentities(WEEK_A_START);
      const kcalBefore = readDayMenuKcalRow(WEEK_A_START, 2);

      const failingRepository = createRepositoryWith(createFakeUnitConversionService(BROKEN_UNIT));
      expect(() =>
        failingRepository.replaceDay(
          WEEK_A_START,
          2,
          buildMeals(2, { label: "regen", energyBump: 300, brokenUnitMealType: "snack" }),
          3208,
          TARGET_KCAL
        )
      ).toThrow(/BROKEN_UNIT/);

      expect(readMealSlotIdentities(WEEK_A_START)).toEqual(before);
      expect(readDayMenuKcalRow(WEEK_A_START, 2)).toEqual(kcalBefore);
      expect(countMealSlots(WEEK_A_START)).toBe(28);
      expect(countMealIngredients(WEEK_A_START)).toBe(56);
    });
  });

  describe("findOtherDays()", () => {
    beforeEach(() => {
      repository.replaceWeek(WEEK_A_START, buildWeek(WEEK_A_START));
    });

    it("returns exactly the other 6 days, ordered by dayIndex, excluding the target day (Req 7.2)", () => {
      const result = repository.findOtherDays(WEEK_A_START, 3);

      expect(result).toHaveLength(6);
      expect(result.map((day) => day.dayIndex)).toEqual([0, 1, 2, 4, 5, 6]);
    });

    it("projects ONLY dishName and foodIds per meal — no nutrition, no quantity, no unit is leaked (Req 7.2)", () => {
      const result = repository.findOtherDays(WEEK_A_START, 3);
      const day0 = result.find((day) => day.dayIndex === 0);

      expect(day0).toBeDefined();
      expect(Object.keys(day0 ?? {}).sort()).toEqual(["dayIndex", "meals"]);
      expect(day0?.meals).toHaveLength(4);
      for (const meal of day0?.meals ?? []) {
        expect(Object.keys(meal).sort()).toEqual(["dishName", "foodIds", "mealType"]);
      }

      // buildMealSlot: day0 の breakfast(mealIndex=0) は pickFoodId(0), pickFoodId(1)。
      expect(day0?.meals[0]).toEqual({
        mealType: "breakfast",
        dishName: "day0-breakfast-dish",
        foodIds: [pickFoodId(0), pickFoodId(1)],
      });
      expect(day0?.meals.map((meal) => meal.mealType)).toEqual([
        "breakfast",
        "lunch",
        "dinner",
        "snack",
      ]);
    });

    it("returns an empty array for a week with no persisted plan", () => {
      expect(repository.findOtherDays(WEEK_B_START, 0)).toEqual([]);
    });

    it("returns all 7 days when excludeDayIndex matches no persisted day", () => {
      // Preconditions（呼び出し元が dayIndex を 0-6 に検証済み）に反する入力だが、
      // クエリの意味論（「対象 index に等しくない日」）を明示的に固定しておく。
      expect(repository.findOtherDays(WEEK_A_START, 99).map((day) => day.dayIndex)).toEqual([
        0, 1, 2, 3, 4, 5, 6,
      ]);
    });
  });

  describe("findMealSlot()", () => {
    beforeEach(() => {
      repository.replaceWeek(WEEK_A_START, buildWeek(WEEK_A_START));
    });

    it("returns the MealSlot plus its REAL meal_slots.id row id (usable as recipe_details.meal_slot_id)", () => {
      const result = repository.findMealSlot(WEEK_A_START, 4, "lunch");

      expect(result).not.toBeNull();

      const expectedId = (
        db
          .prepare(
            `SELECT ms.id FROM meal_slots ms
               JOIN day_menus dm ON ms.day_menu_id = dm.id
              WHERE dm.week_start_date = ? AND dm.day_index = ? AND ms.meal_type = ?`
          )
          .get(WEEK_A_START, 4, "lunch") as { id: number } | undefined
      )?.id;

      expect(expectedId).toBeGreaterThan(0);
      expect(result?.id).toBe(expectedId);

      // 実在するIDであること（recipe_details.meal_slot_id の外部キーとして使える）。
      const exists = (
        db.prepare("SELECT COUNT(*) as count FROM meal_slots WHERE id = ?").get(result?.id) as CountRow
      ).count;
      expect(exists).toBe(1);

      expect(result?.mealType).toBe("lunch");
      expect(result?.dishName).toBe("day4-lunch-dish");
      expect(result?.ingredients).toEqual([
        { foodId: pickFoodId(5), quantity: 2, unit: "g" },
        { foodId: pickFoodId(6), quantity: 1, unit: "個" },
      ]);
      // BASE_NUTRITION.lunch + dayIndex=4（energyKcal +4、fiberG +1）
      expect(result?.nutrition).toEqual({
        energyKcal: 684,
        proteinG: 32.25,
        fatG: 22.5,
        carbG: 78.25,
        fiberG: 7.5,
        calciumMg: 90,
        ironMg: 3.25,
        vitaminAUg: 260,
        vitaminDUg: 2.25,
        vitaminB1Mg: 0.5,
        vitaminB2Mg: 0.75,
        vitaminCMg: 45,
        saltEquivalentG: 2.5,
      });
    });

    it("returns null for a week / dayIndex / mealType combination that does not exist", () => {
      expect(repository.findMealSlot(WEEK_B_START, 0, "breakfast")).toBeNull();
      expect(repository.findMealSlot(WEEK_A_START, 9, "breakfast")).toBeNull();
      // meal_type の CHECK 制約上ありえない値でも例外ではなく null を返す。
      expect(repository.findMealSlot(WEEK_A_START, 0, "brunch" as MealType)).toBeNull();
    });

    it("returns the newly inserted slot (new id) after replaceDay", () => {
      const before = repository.findMealSlot(WEEK_A_START, 2, "dinner");

      repository.replaceDay(
        WEEK_A_START,
        2,
        buildMeals(2, { label: "regen", energyBump: 300 }),
        3208,
        TARGET_KCAL
      );

      const after = repository.findMealSlot(WEEK_A_START, 2, "dinner");
      expect(after?.id).not.toBe(before?.id);
      expect(after?.dishName).toBe("regen2-dinner-dish");
    });
  });

  describe("getActivePlan()", () => {
    it("returns null for a weekStartDate with no persisted plan (Req 1.6)", () => {
      expect(repository.getActivePlan(WEEK_A_START)).toBeNull();
    });

    it("builds each DayMenu.dayNutrition by summing that day's 4 meal_slots rows across all 13 fields (Req 4.4, 4.7)", () => {
      repository.replaceWeek(WEEK_A_START, buildWeek(WEEK_A_START));

      const plan = repository.getActivePlan(WEEK_A_START);

      expect(plan?.days.find((day) => day.dayIndex === 0)?.dayNutrition).toEqual(
        EXPECTED_DAY0_NUTRITION
      );
      expect(plan?.days.find((day) => day.dayIndex === 5)?.dayNutrition).toEqual(
        EXPECTED_DAY5_NUTRITION
      );
      // 全7日について、その日の4食枠の合算値と一致する（他日の値が混入していない）。
      for (const day of plan?.days ?? []) {
        expect(day.dayNutrition).toEqual({
          ...EXPECTED_DAY0_NUTRITION,
          energyKcal: 2000 + 4 * day.dayIndex,
          fiberG: 19.5 + day.dayIndex,
        });
        expect(day.dayNutrition).toEqual(sumMealNutrition(day.meals));
      }
    });

    it("computes dayNutrition AT READ TIME, not from stored day_menus columns", () => {
      repository.replaceWeek(WEEK_A_START, buildWeek(WEEK_A_START));

      // day_menus には栄養価カラム（13項目）が一切存在しない（冗長な二重管理をしない設計）。
      const dayMenuColumns = (
        db.prepare("PRAGMA table_info(day_menus)").all() as TableInfoRow[]
      ).map((row) => row.name);
      expect(dayMenuColumns.sort()).toEqual(
        [
          "day_date",
          "day_index",
          "id",
          "planned_kcal",
          "target_kcal",
          "variance_kcal",
          "week_start_date",
        ].sort()
      );

      // meal_slots の値を直接書き換えると、getActivePlan の dayNutrition もそれに追随する。
      db.prepare(
        `UPDATE meal_slots SET energy_kcal = energy_kcal + 1000, iron_mg = iron_mg + 5
           WHERE day_menu_id = (SELECT id FROM day_menus WHERE week_start_date = ? AND day_index = ?)
             AND meal_type = 'breakfast'`
      ).run(WEEK_A_START, 0);

      const day0 = repository.getActivePlan(WEEK_A_START)?.days.find((day) => day.dayIndex === 0);
      expect(day0?.dayNutrition.energyKcal).toBe(3000);
      expect(day0?.dayNutrition.ironMg).toBe(15.5);
      // planned_kcal（day_menus の列）は書き換えていないので元の値のまま = 別管理であること。
      expect(day0?.plannedKcal).toBe(2000);
    });

    it("returns each day's meals in the order they were inserted (breakfast → lunch → dinner → snack)", () => {
      repository.replaceWeek(WEEK_A_START, buildWeek(WEEK_A_START));

      const plan = repository.getActivePlan(WEEK_A_START);
      for (const day of plan?.days ?? []) {
        expect(day.meals.map((meal) => meal.mealType)).toEqual([
          "breakfast",
          "lunch",
          "dinner",
          "snack",
        ]);
      }
    });

    it("returns the original ingredient quantity/unit (not the normalized grams)", () => {
      repository.replaceWeek(WEEK_A_START, buildWeek(WEEK_A_START));

      const breakfast = repository
        .getActivePlan(WEEK_A_START)
        ?.days.find((day) => day.dayIndex === 0)
        ?.meals.find((meal) => meal.mealType === "breakfast");

      expect(breakfast?.ingredients).toEqual([
        { foodId: pickFoodId(0), quantity: 1, unit: "g" },
        { foodId: pickFoodId(1), quantity: 0.5, unit: "個" },
      ]);
    });

    it("isolates weeks from one another", () => {
      repository.replaceWeek(WEEK_A_START, buildWeek(WEEK_A_START));
      repository.replaceWeek(WEEK_B_START, buildWeek(WEEK_B_START, { label: "weekB" }));

      const weekA = repository.getActivePlan(WEEK_A_START);
      const weekB = repository.getActivePlan(WEEK_B_START);

      expect(weekA?.weekStartDate).toBe(WEEK_A_START);
      expect(weekB?.weekStartDate).toBe(WEEK_B_START);
      expect(weekA?.days[0]?.dayDate).toBe("2026-09-07");
      expect(weekB?.days[0]?.dayDate).toBe("2026-09-14");
      expect(weekA?.days.every((day) => day.meals.every((meal) => meal.dishName.startsWith("day")))).toBe(
        true
      );
      expect(
        weekB?.days.every((day) => day.meals.every((meal) => meal.dishName.startsWith("weekB")))
      ).toBe(true);
    });
  });
});
