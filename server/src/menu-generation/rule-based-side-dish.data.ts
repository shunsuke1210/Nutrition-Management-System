/**
 * 非AI（ルールベース）献立生成用のキュレーション済み補助副菜DB（`rule-based-side-dish.data.ts`、
 * task 17.2、新規）。
 *
 * `rule-based-recipe.data.ts`（主菜DB）が主菜1品分のフルレシピ（`servings`/
 * `cookingTimeMinutes`/`steps`込み）を保持するのに対し、本ファイルは「もう一品追加する場合の
 * 補助副菜提案」用の、より軽量なデータセットである。design.md の
 * `RecipeGenerationToolResult.supplementarySuggestions`（`claude-menu.client.ts` 参照）が
 * 実際に要求する形状は `{dishName, ingredients}[]` のみであり、レシピ手順・人数・調理時間までは
 * 必要としない。そのため本ファイルは `RuleBasedRecipeEntry` をそのまま使わず、
 * `servings`/`cookingTimeMinutes`/`steps` を持たない軽量版の `RuleBasedSideDishEntry` 型を
 * 別途定義する。
 *
 * 一方で `mealType`（対象食事枠との整合）・`tags`（NG食材フィルタリング）・
 * `restrictionSuitability`（食事制限フィルタリング）は主菜DBと全く同じ選定ロジックで
 * フィルタリングされる想定のため、軽量版でも保持する（判定方針は `rule-based-recipe.data.ts`
 * 冒頭コメントと同じ）。
 *
 * 食材1〜3種程度の簡単な副菜（おひたし・浅漬け・小鉢等）を中心にキュレーションしており、
 * `mealType` 別に各5件、合計20件（task 17.2本文の要求「各食事タイプ5品程度、計20品程度」を
 * 満たす）。食品IDの実在性・データ整合性の検証方針は主菜DBと同じ
 * （`rule-based-side-dish.data.test.ts` を参照）。
 */
import type { MealType, RestrictionType } from "@nutrition/shared";

/**
 * 非AI献立生成用の補助副菜DBの1エントリ。
 *
 * `RuleBasedRecipeEntry`（`rule-based-recipe.data.ts`）のサブセットであり、
 * `servings`/`cookingTimeMinutes`/`steps` を持たない（ファイル冒頭コメント参照）。
 */
export interface RuleBasedSideDishEntry {
  /** 料理名（日本語、具体的な料理名）。データセット内で一意。 */
  dishName: string;
  /** 対象の食事枠種別。 */
  mealType: MealType;
  /** この副菜に用いる食材（食品ID・分量・単位）。単位は常に `"g"`。 */
  ingredients: { foodId: string; quantity: number; unit: "g" }[];
  /** NG食材フィルタリング用の平易な日本語タグ。 */
  tags: readonly string[];
  /** この副菜が適合する食事制限タイプ。`"none"` は常に含む。 */
  restrictionSuitability: readonly RestrictionType[];
}

/**
 * キュレーション済みの補助副菜DB本体（20件、mealType別に各5件）。
 */
export const RULE_BASED_SIDE_DISHES: readonly RuleBasedSideDishEntry[] = [
  // ============================================================
  // 朝食向け（breakfast、5件）
  // ============================================================
  {
    dishName: "ミニトマトときゅうりのサラダ",
    mealType: "breakfast",
    ingredients: [
      { foodId: "06183", quantity: 40, unit: "g" }, // ミニトマト（生）
      { foodId: "06065", quantity: 50, unit: "g" }, // きゅうり（生）
      { foodId: "14001", quantity: 3, unit: "g" }, // オリーブ油
    ],
    tags: ["トマト", "きゅうり"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "low_fat"],
  },
  {
    dishName: "ほうれん草のバターソテー",
    mealType: "breakfast",
    ingredients: [
      { foodId: "06267", quantity: 70, unit: "g" }, // ほうれんそう（通年平均・生）
      { foodId: "14017", quantity: 5, unit: "g" }, // 有塩バター
    ],
    tags: ["ほうれん草", "バター"],
    restrictionSuitability: ["none", "calorie_only", "low_carb"],
  },
  {
    dishName: "キャベツとにんじんのコンソメスープ",
    mealType: "breakfast",
    ingredients: [
      { foodId: "06061", quantity: 40, unit: "g" }, // キャベツ（生）
      { foodId: "06212", quantity: 30, unit: "g" }, // にんじん（皮つき・生）
      { foodId: "17027", quantity: 3, unit: "g" }, // 固形ブイヨン
    ],
    tags: ["キャベツ", "にんじん"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "low_fat"],
  },
  {
    dishName: "味付け海苔とわかめの小鉢",
    mealType: "breakfast",
    ingredients: [
      { foodId: "09004", quantity: 1.5, unit: "g" }, // 焼きのり
      { foodId: "09045", quantity: 30, unit: "g" }, // 湯通し塩蔵わかめ（塩抜き）
    ],
    tags: ["のり", "わかめ"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "low_fat"],
  },
  {
    dishName: "きのこのコンソメスープ",
    mealType: "breakfast",
    ingredients: [
      { foodId: "08001", quantity: 40, unit: "g" }, // えのきたけ（生）
      { foodId: "08031", quantity: 30, unit: "g" }, // マッシュルーム（生）
      { foodId: "17027", quantity: 3, unit: "g" }, // 固形ブイヨン
    ],
    tags: ["きのこ"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "low_fat"],
  },

  // ============================================================
  // 昼食向け（lunch、5件）
  // ============================================================
  {
    dishName: "きゅうりの浅漬け",
    mealType: "lunch",
    ingredients: [
      { foodId: "06065", quantity: 80, unit: "g" }, // きゅうり（生）
      { foodId: "17012", quantity: 1, unit: "g" }, // 食塩
    ],
    tags: ["きゅうり"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "low_fat"],
  },
  {
    dishName: "ほうれん草のおひたし",
    mealType: "lunch",
    ingredients: [
      { foodId: "06267", quantity: 80, unit: "g" }, // ほうれんそう（通年平均・生）
      { foodId: "17007", quantity: 5, unit: "g" }, // こいくちしょうゆ
      { foodId: "10091", quantity: 1, unit: "g" }, // かつお節
    ],
    tags: ["ほうれん草", "かつお節"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "low_fat"],
  },
  {
    dishName: "わかめときゅうりの酢の物",
    mealType: "lunch",
    ingredients: [
      { foodId: "09045", quantity: 30, unit: "g" }, // 湯通し塩蔵わかめ（塩抜き）
      { foodId: "06065", quantity: 40, unit: "g" }, // きゅうり（生）
      { foodId: "17015", quantity: 8, unit: "g" }, // 穀物酢
    ],
    tags: ["わかめ", "きゅうり"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "low_fat"],
  },
  {
    dishName: "ひじきの煮物",
    mealType: "lunch",
    ingredients: [
      { foodId: "09050", quantity: 8, unit: "g" }, // ほしひじき（ステンレス釜・乾）
      { foodId: "06212", quantity: 20, unit: "g" }, // にんじん（皮つき・生）
      { foodId: "04040", quantity: 10, unit: "g" }, // 油揚げ（生）
      { foodId: "17007", quantity: 6, unit: "g" }, // こいくちしょうゆ
      { foodId: "03003", quantity: 2, unit: "g" }, // 上白糖
    ],
    tags: ["ひじき", "にんじん", "油揚げ"],
    restrictionSuitability: ["none", "calorie_only"],
  },
  {
    dishName: "ブロッコリーの温サラダ",
    mealType: "lunch",
    ingredients: [
      { foodId: "06263", quantity: 80, unit: "g" }, // ブロッコリー（生）
      { foodId: "17042", quantity: 8, unit: "g" }, // マヨネーズ（全卵型）
    ],
    tags: ["ブロッコリー", "マヨネーズ"],
    restrictionSuitability: ["none", "calorie_only", "low_carb"],
  },

  // ============================================================
  // 夕食向け（dinner、5件）
  // ============================================================
  {
    dishName: "冷奴",
    mealType: "dinner",
    ingredients: [
      { foodId: "04033", quantity: 100, unit: "g" }, // 絹ごし豆腐
      { foodId: "06226", quantity: 5, unit: "g" }, // 根深ねぎ（長ねぎ・生）
      { foodId: "17007", quantity: 5, unit: "g" }, // こいくちしょうゆ
    ],
    tags: ["豆腐", "ねぎ"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "low_fat", "high_protein"],
  },
  {
    dishName: "なすの煮浸し",
    mealType: "dinner",
    ingredients: [
      { foodId: "06191", quantity: 80, unit: "g" }, // なす（生）
      { foodId: "17029", quantity: 20, unit: "g" }, // めんつゆ（ストレート）
    ],
    tags: ["なす"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "low_fat"],
  },
  {
    dishName: "きんぴらごぼう",
    mealType: "dinner",
    ingredients: [
      { foodId: "06084", quantity: 60, unit: "g" }, // ごぼう（生）
      { foodId: "06212", quantity: 20, unit: "g" }, // にんじん（皮つき・生）
      { foodId: "14002", quantity: 4, unit: "g" }, // ごま油
      { foodId: "17007", quantity: 6, unit: "g" }, // こいくちしょうゆ
      { foodId: "03003", quantity: 3, unit: "g" }, // 上白糖
    ],
    tags: ["ごぼう", "にんじん"],
    restrictionSuitability: ["none", "calorie_only", "low_fat"],
  },
  {
    dishName: "白菜と豚肉のさっと煮",
    mealType: "dinner",
    ingredients: [
      { foodId: "06233", quantity: 100, unit: "g" }, // はくさい（生）
      { foodId: "11131", quantity: 40, unit: "g" }, // 豚もも肉（皮下脂肪なし・生）
      { foodId: "17028", quantity: 3, unit: "g" }, // 顆粒和風だし
    ],
    tags: ["白菜", "豚肉"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "low_fat", "high_protein"],
  },
  {
    dishName: "もやしのナムル",
    mealType: "dinner",
    ingredients: [
      { foodId: "06291", quantity: 80, unit: "g" }, // りょくとうもやし（生）
      { foodId: "14002", quantity: 3, unit: "g" }, // ごま油
      { foodId: "17012", quantity: 1, unit: "g" }, // 食塩
    ],
    tags: ["もやし"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "low_fat"],
  },

  // ============================================================
  // 間食向け（snack、5件）
  // ============================================================
  {
    dishName: "塩昆布キャベツ",
    mealType: "snack",
    ingredients: [
      { foodId: "06061", quantity: 60, unit: "g" }, // キャベツ（生）
      { foodId: "09022", quantity: 5, unit: "g" }, // 塩昆布
    ],
    tags: ["キャベツ", "昆布"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "low_fat"],
  },
  {
    dishName: "冷やしトマト",
    mealType: "snack",
    ingredients: [
      { foodId: "06182", quantity: 80, unit: "g" }, // トマト（赤色トマト・生）
      { foodId: "17012", quantity: 1, unit: "g" }, // 食塩
    ],
    tags: ["トマト"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "low_fat"],
  },
  {
    dishName: "カテージチーズ小皿",
    mealType: "snack",
    ingredients: [
      { foodId: "13033", quantity: 30, unit: "g" }, // カテージチーズ
    ],
    tags: ["チーズ"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "low_fat", "high_protein"],
  },
  {
    dishName: "きゅうりの浅漬け（間食向け少量）",
    mealType: "snack",
    ingredients: [
      { foodId: "06065", quantity: 50, unit: "g" }, // きゅうり（生）
      { foodId: "17012", quantity: 1, unit: "g" }, // 食塩
    ],
    tags: ["きゅうり"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "low_fat"],
  },
  {
    dishName: "素焼きアーモンド少量",
    mealType: "snack",
    ingredients: [
      { foodId: "05040", quantity: 10, unit: "g" }, // アーモンド（いり・無塩）
    ],
    tags: ["アーモンド", "ナッツ"],
    restrictionSuitability: ["none", "calorie_only", "low_carb"],
  },
];
