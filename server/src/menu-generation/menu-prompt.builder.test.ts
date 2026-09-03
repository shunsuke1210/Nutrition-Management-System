import { describe, expect, it } from "vitest";
import type { MealSlot, VerifiedNutritionValues } from "@nutrition/shared";
import type { MenuProfileSnapshot } from "./profile.gateway.js";
import type { NutritionTargetSnapshot } from "./nutrition.gateway.js";
import type { OtherDayContext } from "./menu-plan.repository.js";
import {
  buildDailyPrompt,
  buildRecipeDetailPrompt,
  buildWeeklyPrompt,
  type DislikedItemSummary,
} from "./menu-prompt.builder.js";

/**
 * design.md #MenuPromptBuilder (Requirements 2.1-2.6, 7.2, 7.3, 9.4, 10.3)
 *
 * `MenuPromptBuilder` は外部依存を持たない純粋関数群であり、テストはフェイクや実DBを
 * 一切用いずに、入力（`MenuProfileSnapshot` / `NutritionTargetSnapshot` /
 * `OtherDayContext[]` / `DislikedItemSummary[]` / `MealSlot`）から構築される
 * `ClaudePromptPayload`（`{system, userMessage}`）のテキスト内容を直接検証する。
 */

// --- フィクスチャ ---

function buildProfile(overrides: Partial<MenuProfileSnapshot> = {}): MenuProfileSnapshot {
  return {
    ngIngredients: ["ピーマン"],
    preferredIngredients: ["鶏むね肉"],
    restrictionType: "none",
    restrictionIntensity: null,
    restrictionNotes: null,
    cookingSkill: "beginner",
    cookingTimePreference: "under_15_minutes",
    budgetPreference: "budget_conscious",
    ...overrides,
  };
}

function buildTarget(overrides: Partial<NutritionTargetSnapshot> = {}): NutritionTargetSnapshot {
  return {
    calorieTarget: 2000,
    pfc: { proteinG: 120, fatG: 55, carbG: 250 },
    activityLevelLabel: "普通",
    guardrailWarningTypes: [],
    ...overrides,
  };
}

const BASE_NUTRITION: VerifiedNutritionValues = {
  energyKcal: 500,
  proteinG: 20,
  fatG: 15,
  carbG: 60,
  fiberG: 3,
  calciumMg: 80,
  ironMg: 2,
  vitaminAUg: 100,
  vitaminDUg: 1,
  vitaminB1Mg: 0.2,
  vitaminB2Mg: 0.2,
  vitaminCMg: 10,
  saltEquivalentG: 1.5,
};

function buildMealSlot(overrides: Partial<MealSlot> = {}): MealSlot {
  return {
    mealType: "dinner",
    dishName: "鶏むね肉のソテー",
    ingredients: [
      { foodId: "11221", quantity: 150, unit: "g" },
      { foodId: "06153", quantity: 1, unit: "個" },
    ],
    nutrition: { ...BASE_NUTRITION },
    ...overrides,
  };
}

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

function buildOtherDay(dayIndex: number, label: string): OtherDayContext {
  return {
    dayIndex,
    meals: MEAL_TYPES.map((mealType, i) => ({
      mealType,
      dishName: `${label}料理${dayIndex}-${i}`,
      foodIds: [`FOOD${dayIndex}${i}A`, `FOOD${dayIndex}${i}B`],
    })),
  };
}

function buildSixOtherDays(): OtherDayContext[] {
  // dayIndex 0-6のうち対象日(例: 3)を除く6日分。
  return [0, 1, 2, 4, 5, 6].map((dayIndex) => buildOtherDay(dayIndex, "他日"));
}

/** `system` を空行区切りのセクションに分割するテストヘルパー。 */
function splitSections(text: string): string[] {
  return text.split("\n\n");
}

describe("buildWeeklyPrompt", () => {
  describe("NG食材・好み食材の反映（Requirement 2.1, 2.3）", () => {
    it("NG食材は「除外」を明示する文言で、好み食材は「優先」を明示する文言で、それぞれ独立したセクションに含まれる", () => {
      const profile = buildProfile({
        ngIngredients: ["ピーマン", "ゴーヤ"],
        preferredIngredients: ["鶏むね肉", "ブロッコリー"],
      });
      const { system } = buildWeeklyPrompt(profile, {}, []);

      const sections = splitSections(system);
      const ngSection = sections.find((s) => s.includes("除外食材"));
      const preferredSection = sections.find((s) => s.includes("好み食材"));

      expect(ngSection).toBeDefined();
      expect(preferredSection).toBeDefined();

      // NGセクションは除外候補のみを含み、好み食材を含まない（スワップ検出）
      expect(ngSection).toContain("ピーマン");
      expect(ngSection).toContain("ゴーヤ");
      expect(ngSection).not.toContain("鶏むね肉");
      expect(ngSection).not.toContain("ブロッコリー");
      expect(ngSection).toMatch(/使用禁止|除外/);
      // 指示文そのものが好みセクション側の文言と入れ替わっていないこと（見出しだけのスワップ検出漏れを防ぐ）
      expect(ngSection).not.toMatch(/優先的に検討/);

      // 好みセクションは優先候補のみを含み、NG食材を含まない（スワップ検出）
      expect(preferredSection).toContain("鶏むね肉");
      expect(preferredSection).toContain("ブロッコリー");
      expect(preferredSection).not.toContain("ピーマン");
      expect(preferredSection).not.toContain("ゴーヤ");
      expect(preferredSection).toMatch(/優先/);
      expect(preferredSection).not.toMatch(/使用禁止/);

      // 文言そのものが同一（スワップ）でないこと
      expect(ngSection).not.toEqual(preferredSection);
    });
  });

  describe("食事制限タイプが「制限なし」の場合（Requirement 2.5）", () => {
    it("制限タイプ・強度に基づく文言を一切含まないが、NG除外・好み優先は含まれる", () => {
      const profile = buildProfile({
        ngIngredients: ["ピーマン"],
        preferredIngredients: ["鶏むね肉"],
        restrictionType: "none",
        restrictionIntensity: null,
      });
      const { system } = buildWeeklyPrompt(profile, {}, []);

      expect(system).not.toContain("食事制限タイプ・強度");
      expect(system).not.toContain("low_carb");
      expect(system).not.toContain("low_fat");
      expect(system).not.toContain("high_protein");
      expect(system).not.toContain("calorie_only");
      expect(system).not.toContain("低炭水化物");

      expect(system).toContain("ピーマン");
      expect(system).toContain("鶏むね肉");
    });
  });

  describe("食事制限タイプが「制限なし」以外の場合（Requirement 2.2）", () => {
    it("制限タイプ・強度が制約として明示的に含まれる", () => {
      const profile = buildProfile({
        restrictionType: "low_carb",
        restrictionIntensity: "strict",
      });
      const { system } = buildWeeklyPrompt(profile, {}, []);

      const sections = splitSections(system);
      const restrictionSection = sections.find((s) => s.includes("食事制限タイプ・強度"));

      expect(restrictionSection).toBeDefined();
      expect(restrictionSection).toContain("low_carb");
      expect(restrictionSection).toContain("strict");
    });
  });

  describe("restrictionNotes（自由記述、Requirement 2.4）", () => {
    it("非nullの場合、原文のまま（要約・改変されず）含まれ、食事制限限定ではなく一般的なガイダンスとして枠組まれる", () => {
      const nonDietaryNote = "朝食は毎日同じでよい";
      const profile = buildProfile({ restrictionNotes: nonDietaryNote });
      const { system } = buildWeeklyPrompt(profile, {}, []);

      const sections = splitSections(system);
      const notesSection = sections.find((s) => s.includes(nonDietaryNote));

      expect(notesSection).toBeDefined();
      // 原文がそのまま（一字一句）含まれる
      expect(system).toContain(nonDietaryNote);
      // 食事制限に限定しない一般的なガイダンスとして枠組まれている
      expect(notesSection).toMatch(/一般的|限定して解釈せず/);
    });

    it("restrictionTypeが「制限なし」であってもrestrictionNotesは独立して含まれる（食事制限設定によるゲーティングをしない）", () => {
      const nonDietaryNote = "朝食は毎日同じでよい";
      const profile = buildProfile({
        restrictionType: "none",
        restrictionIntensity: null,
        restrictionNotes: nonDietaryNote,
      });
      const { system } = buildWeeklyPrompt(profile, {}, []);

      expect(system).toContain(nonDietaryNote);
      // それでも制限タイプに基づく文言は含まれない
      expect(system).not.toContain("食事制限タイプ・強度");
    });

    it("nullの場合、自由記述セクション自体を含まない", () => {
      const profile = buildProfile({ restrictionNotes: null });
      const { system } = buildWeeklyPrompt(profile, {}, []);

      expect(system).not.toContain("その他の食事制限・要望");
    });
  });

  describe("調理スキル・調理時間・予算感（Requirement 2.6）", () => {
    it("cookingSkill/cookingTimePreference/budgetPreferenceがすべてプロンプトに含まれる", () => {
      const profile = buildProfile({
        cookingSkill: "advanced",
        cookingTimePreference: "under_15_minutes",
        budgetPreference: "budget_conscious",
      });
      const { system } = buildWeeklyPrompt(profile, {}, []);

      expect(system).toContain("advanced");
      expect(system).toContain("under_15_minutes");
      expect(system).toContain("budget_conscious");
    });

    it("すべてnullの場合も調理条件セクション自体は含まれ、各項目は「指定なし」として現れる", () => {
      const profile = buildProfile({
        cookingSkill: null,
        cookingTimePreference: null,
        budgetPreference: null,
      });
      const { system } = buildWeeklyPrompt(profile, {}, []);

      const sections = splitSections(system);
      const cookingSection = sections.find((s) => s.includes("調理に関する希望"));
      expect(cookingSection).toBeDefined();
      expect(cookingSection?.match(/指定なし/g)?.length).toBe(3);
    });
  });

  describe("苦手サマリの反映（Requirement 10.3）", () => {
    it("非空の場合、苦手な料理名・食品IDが「再提案を避ける」制約として含まれる", () => {
      const disliked: DislikedItemSummary[] = [
        { dishName: "しょうが焼き", foodIds: ["11001", "11002"] },
        { dishName: "ナポリタン", foodIds: ["01063"] },
      ];
      const { system } = buildWeeklyPrompt(buildProfile(), {}, disliked);

      const sections = splitSections(system);
      const dislikedSection = sections.find((s) => s.includes("苦手な料理・食材"));

      expect(dislikedSection).toBeDefined();
      expect(dislikedSection).toContain("しょうが焼き");
      expect(dislikedSection).toContain("11001");
      expect(dislikedSection).toContain("11002");
      expect(dislikedSection).toContain("ナポリタン");
      expect(dislikedSection).toContain("01063");
      expect(dislikedSection).toMatch(/再提案しないでください|避けて/);
    });

    it("空配列の場合でも、末尾に何も続かない不完全な文言にならず、「該当なし」の一文で完結する", () => {
      const { system } = buildWeeklyPrompt(buildProfile(), {}, []);

      const sections = splitSections(system);
      const dislikedSection = sections.find((s) => s.includes("苦手な料理・食材"));

      expect(dislikedSection).toBeDefined();
      expect(dislikedSection).toMatch(/ありません/);
      // 空の箇条書き行（例: 「- （使用食品ID: ）」のようなダングリング表現）が無いこと
      expect(dislikedSection).not.toMatch(/^- /m);
      expect(dislikedSection?.trim().endsWith("\n")).toBe(false);
    });
  });

  describe("週間の栄養目標（Requirement 1.5 のプロンプトへの反映）", () => {
    it("2件以上の異なる日付の目標値が、それぞれ区別可能な形でuserMessageに含まれる", () => {
      const targets: Record<string, NutritionTargetSnapshot> = {
        "2026-01-05": buildTarget({
          calorieTarget: 1800,
          pfc: { proteinG: 100, fatG: 50, carbG: 150 },
        }),
        "2026-01-06": buildTarget({
          calorieTarget: 2200,
          pfc: { proteinG: 130, fatG: 60, carbG: 220 },
        }),
      };
      const { userMessage } = buildWeeklyPrompt(buildProfile(), targets, []);

      expect(userMessage).toContain("2026-01-05");
      expect(userMessage).toContain("2026-01-06");
      expect(userMessage).toContain("1800");
      expect(userMessage).toContain("2200");

      const lines = userMessage.split("\n");
      const line05 = lines.find((l) => l.includes("2026-01-05"));
      const line06 = lines.find((l) => l.includes("2026-01-06"));
      expect(line05).toContain("1800");
      expect(line05).not.toContain("2200");
      expect(line06).toContain("2200");
      expect(line06).not.toContain("1800");
    });

    it("オブジェクトの挿入順が日付順と逆でも、出力は常に日付キーの昇順になる（挿入順依存でないことの確認）", () => {
      const targetsReversed: Record<string, NutritionTargetSnapshot> = {
        "2026-01-06": buildTarget({ calorieTarget: 2200 }),
        "2026-01-05": buildTarget({ calorieTarget: 1800 }),
      };
      const { userMessage } = buildWeeklyPrompt(buildProfile(), targetsReversed, []);

      const index05 = userMessage.indexOf("2026-01-05");
      const index06 = userMessage.indexOf("2026-01-06");
      expect(index05).toBeGreaterThanOrEqual(0);
      expect(index06).toBeGreaterThanOrEqual(0);
      expect(index05).toBeLessThan(index06);
    });
  });

  describe("決定論性（design.md Postconditions）", () => {
    it("深い等価だが参照の異なる入力に対し、常にバイト単位で同一の出力を返す", () => {
      const profileA = buildProfile({
        ngIngredients: ["ピーマン", "ゴーヤ"],
        preferredIngredients: ["鶏むね肉"],
        restrictionType: "low_carb",
        restrictionIntensity: "strict",
        restrictionNotes: "麺類は控えめにしてほしい",
      });
      const targetsA: Record<string, NutritionTargetSnapshot> = {
        "2026-01-05": buildTarget({ calorieTarget: 1800 }),
        "2026-01-06": buildTarget({ calorieTarget: 2200 }),
      };
      const dislikedA: DislikedItemSummary[] = [{ dishName: "しょうが焼き", foodIds: ["11001"] }];

      // JSON往復により参照を完全に切り離した「深い等価だが別参照」の入力を作る。
      const profileB = JSON.parse(JSON.stringify(profileA)) as MenuProfileSnapshot;
      const targetsB = JSON.parse(JSON.stringify(targetsA)) as Record<string, NutritionTargetSnapshot>;
      const dislikedB = JSON.parse(JSON.stringify(dislikedA)) as DislikedItemSummary[];

      expect(profileB).not.toBe(profileA);
      expect(targetsB).not.toBe(targetsA);

      const resultA = buildWeeklyPrompt(profileA, targetsA, dislikedA);
      const resultB = buildWeeklyPrompt(profileB, targetsB, dislikedB);

      expect(resultA).toEqual(resultB);
      expect(resultA.system).toBe(resultB.system);
      expect(resultA.userMessage).toBe(resultB.userMessage);
    });
  });
});

describe("buildDailyPrompt", () => {
  describe("残り6日分のコンテキストと重複回避の指示（Requirement 7.2, 7.3）", () => {
    it("残り6日分の料理名・食品IDがすべて含まれ、かつ重複回避を求める明示的な指示が含まれる", () => {
      const otherDays = buildSixOtherDays();
      const { userMessage } = buildDailyPrompt(buildProfile(), buildTarget(), otherDays, []);

      for (const day of otherDays) {
        for (const meal of day.meals) {
          expect(userMessage).toContain(meal.dishName);
          for (const foodId of meal.foodIds) {
            expect(userMessage).toContain(foodId);
          }
        }
      }

      // 単なる列挙ではなく、重複を避けるようにという明示的な指示文が含まれる
      expect(userMessage).toMatch(/重複しないよう|重複を避けて/);
    });

    it("6日分すべてのdayIndexが現れる", () => {
      const otherDays = buildSixOtherDays();
      const { userMessage } = buildDailyPrompt(buildProfile(), buildTarget(), otherDays, []);

      for (const day of otherDays) {
        expect(userMessage).toContain(`Day${day.dayIndex}`);
      }
    });
  });

  describe("プロフィール制約・苦手サマリの反映（buildWeeklyPromptと同様、Requirement 2, 10.3）", () => {
    it("NG食材の除外・好み食材の優先・苦手サマリがsystemに含まれる", () => {
      const profile = buildProfile({
        ngIngredients: ["ピーマン"],
        preferredIngredients: ["鶏むね肉"],
      });
      const disliked: DislikedItemSummary[] = [{ dishName: "しょうが焼き", foodIds: ["11001"] }];
      const { system } = buildDailyPrompt(profile, buildTarget(), buildSixOtherDays(), disliked);

      expect(system).toContain("ピーマン");
      expect(system).toContain("鶏むね肉");
      expect(system).toContain("しょうが焼き");
    });
  });

  describe("決定論性（design.md Postconditions）", () => {
    it("深い等価だが参照の異なる入力に対し、常にバイト単位で同一の出力を返す", () => {
      const profileA = buildProfile({ restrictionType: "high_protein", restrictionIntensity: "light" });
      const targetA = buildTarget({ calorieTarget: 1900 });
      const otherDaysA = buildSixOtherDays();
      const dislikedA: DislikedItemSummary[] = [{ dishName: "ナポリタン", foodIds: ["01063"] }];

      const profileB = JSON.parse(JSON.stringify(profileA)) as MenuProfileSnapshot;
      const targetB = JSON.parse(JSON.stringify(targetA)) as NutritionTargetSnapshot;
      const otherDaysB = JSON.parse(JSON.stringify(otherDaysA)) as OtherDayContext[];
      const dislikedB = JSON.parse(JSON.stringify(dislikedA)) as DislikedItemSummary[];

      const resultA = buildDailyPrompt(profileA, targetA, otherDaysA, dislikedA);
      const resultB = buildDailyPrompt(profileB, targetB, otherDaysB, dislikedB);

      expect(resultA).toEqual(resultB);
    });
  });
});

describe("buildRecipeDetailPrompt", () => {
  describe("補助副菜提案へのNG食材・食事制限制約の適用指示（Requirement 9.4）", () => {
    it("NG食材の除外と食事制限の制約が、補助副菜提案にも適用される旨の明示的な指示を含む", () => {
      const profile = buildProfile({
        ngIngredients: ["ピーマン"],
        restrictionType: "low_carb",
        restrictionIntensity: "standard",
      });
      const meal = buildMealSlot();
      const { system } = buildRecipeDetailPrompt(meal, profile);

      expect(system).toContain("ピーマン");
      expect(system).toContain("low_carb");
      expect(system).toContain("補助副菜");
      expect(system).toMatch(/同様に適用/);
    });
  });

  describe("確定済み食材・分量の提示", () => {
    it("食事種別・料理名・食材（食品ID/分量/単位）がuserMessageに含まれる", () => {
      const meal = buildMealSlot({
        mealType: "lunch",
        dishName: "鮭の塩焼き定食",
        ingredients: [{ foodId: "10134", quantity: 80, unit: "g" }],
      });
      const { userMessage } = buildRecipeDetailPrompt(meal, buildProfile());

      expect(userMessage).toContain("lunch");
      expect(userMessage).toContain("鮭の塩焼き定食");
      expect(userMessage).toContain("10134");
      expect(userMessage).toContain("80");
    });
  });

  describe("食事制限タイプが「制限なし」の場合", () => {
    it("制限タイプに基づく文言は含まれないが、NG食材の除外指示は含まれる", () => {
      const profile = buildProfile({ restrictionType: "none", restrictionIntensity: null });
      const { system } = buildRecipeDetailPrompt(buildMealSlot(), profile);

      expect(system).not.toContain("食事制限タイプ・強度");
      expect(system).toContain("ピーマン");
    });
  });

  describe("決定論性（design.md Postconditions）", () => {
    it("深い等価だが参照の異なる入力に対し、常にバイト単位で同一の出力を返す", () => {
      const profileA = buildProfile({ restrictionType: "calorie_only", restrictionIntensity: "standard" });
      const mealA = buildMealSlot();

      const profileB = JSON.parse(JSON.stringify(profileA)) as MenuProfileSnapshot;
      const mealB = JSON.parse(JSON.stringify(mealA)) as MealSlot;

      const resultA = buildRecipeDetailPrompt(mealA, profileA);
      const resultB = buildRecipeDetailPrompt(mealB, profileB);

      expect(resultA).toEqual(resultB);
    });
  });
});
