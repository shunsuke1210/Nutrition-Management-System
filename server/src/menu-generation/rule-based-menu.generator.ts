/**
 * RuleBasedMenuGenerator — `MenuGenerator`（`menu-generator.ts`、task 17.1）の非AI実装
 * （`generateWeek`/`generateDay`はtask 17.3、`generateRecipe`はtask 17.4）。
 *
 * `ClaudeMenuGenerator`（`claude-menu.generator.ts`）がClaude Messages APIを呼び出すのに対し、
 * 本実装は`rule-based-recipe.data.ts`（task 17.2、主菜48件）・`rule-based-side-dish.data.ts`
 * （task 17.2、補助副菜20件）のキュレーション済みDBから機械的な優先順位フィルタ＋擬似乱数選定で
 * 献立・レシピ詳細を組み立てる。AI呼び出しを一切行わないため、レート制限・APIコスト・非決定性
 * （Claudeの応答揺れ）から独立して献立生成を提供できる代替経路である。
 *
 * ## 選定アルゴリズムの優先順位（tasks.md task 17.3本文の設計方針をそのまま実装する）
 * 各`(dayIndex, mealType)`スロットについて、以下の順でフィルタ・選定する:
 *
 * 1. **必須フィルタ（絶対に緩めない）**: `mealType`一致 かつ `tags`が`profile.ngIngredients`の
 *    いずれとも重複しない候補のみに絞る。重複判定は`eating-out-suggestion.service.ts`の
 *    `filterEligibleCandidates`（`!entry.ingredientTags.some(tag => ngIngredients.includes(tag))`）
 *    と同じ完全一致（`Array.prototype.includes`）方式に倣う。
 * 2. **必須フィルタ（苦手料理の除外）**: `dislikedSummary`の`dishName`と一致する候補を除外する。
 * 3. **食事制限フィルタ（ソフト、フォールバックあり）**: `restrictionType !== "none"`の場合、
 *    `restrictionSuitability`に`restrictionType`を含む候補に絞る。絞り込みの結果0件になった
 *    場合は、この食事制限フィルタのみを外し（1・2の必須フィルタは維持したまま）候補を復活させる
 *    （食事制限は健康上のソフトな目標であり、NG食材除外ほど絶対的な制約ではないため）。
 * 4. **バラエティ優先（ソフト）**: 既に選ばれた`dishName`（`generateWeek`は週内全体、
 *    `generateDay`は`otherDays`の同じ`mealType`）をできる限り避ける。除外後に候補が0件になる
 *    場合はこの制約を外し、通常通り全候補から選ぶ。
 * 5. **最終選定**: 上記フィルタを通過した候補群から、注入可能な擬似乱数関数`random`
 *    （既定は`Math.random`）で1件を選ぶ。
 * 6. **候補が最終的に0件（手順1・2の必須フィルタの時点で既に0件）の場合**: これは
 *    「そもそもmealType一致かつNG食材フィルタを満たす候補がDBに存在しない」という
 *    構造的な枯渇状態であり、`ClaudeGenerationError(type: "schema_validation_failed")`を
 *    どの`dayIndex`/`mealType`で枯渇したかを明記したメッセージ付きで返す（手順3・4は
 *    フォールバックを持つためここには到達しない＝必ず1件以上残る）。
 *
 * ## 分量スケーリング
 * 選んだ料理の全`ingredients`の`quantity`を、対象`mealType`に配分したkcal目標へ近づけるよう
 * 一律スケーリングする。1日の`calorieTarget`を4食へ配分する比率は、一般的な食事配分の目安
 * （朝食を軽め、夕食をやや重めにし、間食は補助的な位置づけとする配分）として
 * 朝食25% / 昼食30% / 夕食35% / 間食10%（合計100%）を採用した
 * （`MEAL_CALORIE_RATIOS`参照。他の妥当な配分比率でも構わないが、本実装はこれを採用する）。
 * `FoodCompositionRepository.findById`で各食材の`per100g.energyKcal`を取得し、素の合計kcal
 * （`quantity/100 * energyKcal`の合計）に対するスケール係数
 * （= 配分kcal / 素の合計kcal）を算出する。この係数を`[0.5, 2.0]`（元の分量の半分〜倍まで）に
 * クランプすることで、目標カロリーが極端な値であっても分量が異常（ほぼ0や非現実的に大量）に
 * ならないようにする。丸めは小数第1位（極端な精度は不要なため）。
 *
 * ## 決定論的テスト容易性について
 * 候補選択の唯一の乱数要素（手順5の最終選定）を`createRuleBasedMenuGenerator`の`random`
 * （`() => number`、`[0, 1)`を返す）として注入可能にする。テストは固定シーケンスを返す
 * フェイクを注入し、同一入力に対して常に同一の選定結果が得られることを検証できる。
 *
 * ## `generateWeek`の`targets`からdayIndexを復元する方法について
 * `MenuGenerator.generateWeek`が受け取る`targets`は`Record<IsoDate, NutritionTargetSnapshot>`
 * （日付文字列キー）であり、`dayIndex`を直接持たない。`menu-plan.service.ts`の
 * `runWeeklyGeneration`がこの`targetsRecord`を構築する際、`dayIndex`を0から6まで反復し
 * `dayDate = addDaysIso(weekStartDate, dayIndex)`をキーとして詰めている（すなわち
 * `targets`のキーを日付昇順に並べたときの位置がそのまま`dayIndex`と対応する）ため、本実装も
 * `menu-prompt.builder.ts`の`buildWeeklyTargetsSection`が採用する「`Object.keys(targets).sort()`
 * で日付昇順に並べる」という同じ決定論的な規約に倣い、ソート後のインデックスを`dayIndex`として
 * 復元する。
 *
 * ## `generateRecipe`（レシピ詳細生成、task 17.4）について
 * 対象`mealSlot.dishName`と完全一致する`RULE_BASED_RECIPES`のエントリが見つかれば、その
 * `servings`/`cookingTimeMinutes`/`steps`をそのまま返す。見つからない場合（他日再生成等で
 * 発生しうる整合性エッジケース）のフォールバック方針は`FALLBACK_RECIPE_DEFAULTS`のコメントを
 * 参照。`supplementarySuggestions`（1〜2件）は`RULE_BASED_SIDE_DISHES`から`mealSlot.mealType`
 * 一致・NG食材非重複の候補を選び、擬似乱数`random`で選定する（詳細は
 * `selectSupplementarySuggestions`のコメントを参照）。`generateWeek`/`generateDay`の
 * カロリースケーリングとは異なり、補助副菜の`ingredients`はスケーリングしない
 * （`recipe-detail.service.ts`が補助副菜の栄養増分を確定済みの`ingredients`からそのまま
 * 算出するため）。
 */
import {
  MealTypeSchema,
  type IngredientSelection,
  type IsoDate,
  type MealSlot,
  type MealType,
  type RestrictionType,
} from "@nutrition/shared";
import type { Result } from "../shared/result.js";
import type {
  ClaudeGenerationError,
  DailyGenerationToolResult,
  RecipeGenerationToolResult,
  WeeklyGenerationToolResult,
} from "./claude-menu.client.js";
import type { FoodCompositionRepository } from "./food-composition.repository.js";
import type { MenuGenerator } from "./menu-generator.js";
import type { OtherDayContext } from "./menu-plan.repository.js";
import type { DislikedItemSummary } from "./menu-prompt.builder.js";
import type { NutritionTargetSnapshot } from "./nutrition.gateway.js";
import type { MenuProfileSnapshot } from "./profile.gateway.js";
import { RULE_BASED_RECIPES, type RuleBasedRecipeEntry } from "./rule-based-recipe.data.js";
import { RULE_BASED_SIDE_DISHES, type RuleBasedSideDishEntry } from "./rule-based-side-dish.data.js";

// --- 定数 ---

/** 1週間の日数（`WeeklyGenerationToolResult.days`は常に7件、`claude-menu.client.ts`と同じ値）。 */
const DAYS_PER_WEEK = 7;

/**
 * mealType別の1日カロリー配分比率（合計100%）。ファイル冒頭コメント「分量スケーリング」参照。
 * 朝食を軽め・夕食をやや重めにし、間食は補助的な位置づけとする、一般的な食事配分の目安。
 */
const MEAL_CALORIE_RATIOS: Record<MealType, number> = {
  breakfast: 0.25,
  lunch: 0.3,
  dinner: 0.35,
  snack: 0.1,
};

/** スケール係数のクランプ範囲（元の分量の半分〜倍まで）。ファイル冒頭コメント参照。 */
const MIN_SCALE_FACTOR = 0.5;
const MAX_SCALE_FACTOR = 2.0;

/** 生成された1食枠の形状（週間・日単位の両方の`meals[]`要素と完全に同じ形状）。 */
type GeneratedMeal = { mealType: MealType; dishName: string; ingredients: IngredientSelection[] };

// --- 候補選定（フィルタ） ---

/**
 * NG食材フィルタの完全一致判定（`eating-out-suggestion.service.ts`の`filterEligibleCandidates`と
 * 同じ方式、`!entry.tags.some(tag => ngIngredients.includes(tag))`）。主菜の必須フィルタ
 * （`filterMandatoryCandidates`）と補助副菜の候補選定（`selectSideDishCandidatesForMealType`、
 * task 17.4、`generateRecipe`専用）の両方がこの1つの判定関数を共有する。
 */
function isFreeOfNgIngredients(tags: readonly string[], ngIngredients: readonly string[]): boolean {
  return !tags.some((tag) => ngIngredients.includes(tag));
}

/**
 * 手順1・2（必須フィルタ）: `mealType`一致 かつ NG食材非重複（`isFreeOfNgIngredients`） かつ
 * 苦手料理（`dislikedDishNames`）非該当の候補のみに絞る。
 * この関数の戻り値が空配列になることが、手順6の「候補が最終的に尽きた」エラーの唯一の発生源。
 */
function filterMandatoryCandidates(
  mealType: MealType,
  ngIngredients: readonly string[],
  dislikedDishNames: ReadonlySet<string>
): RuleBasedRecipeEntry[] {
  return RULE_BASED_RECIPES.filter((entry) => entry.mealType === mealType)
    .filter((entry) => isFreeOfNgIngredients(entry.tags, ngIngredients))
    .filter((entry) => !dislikedDishNames.has(entry.dishName));
}

/**
 * 手順3（食事制限フィルタ、ソフト）: `restrictionType`が`"none"`でなければ
 * `restrictionSuitability`に`restrictionType`を含む候補に絞る。絞り込み後に0件になる場合は
 * このフィルタのみを外し、元の（1・2は満たす）候補群をそのまま返す（フォールバック）。
 */
function filterByRestriction(
  candidates: readonly RuleBasedRecipeEntry[],
  restrictionType: RestrictionType
): RuleBasedRecipeEntry[] {
  if (restrictionType === "none") {
    return [...candidates];
  }
  const restricted = candidates.filter((entry) =>
    entry.restrictionSuitability.includes(restrictionType)
  );
  return restricted.length > 0 ? restricted : [...candidates];
}

/**
 * 手順4（バラエティ優先、ソフト）: `usedDishNames`に含まれない候補に絞る。絞り込み後に0件に
 * なる場合はこの制約を外し、元の候補群をそのまま返す（フォールバック）。
 */
function filterByVariety(
  candidates: readonly RuleBasedRecipeEntry[],
  usedDishNames: ReadonlySet<string>
): RuleBasedRecipeEntry[] {
  const notYetUsed = candidates.filter((entry) => !usedDishNames.has(entry.dishName));
  return notYetUsed.length > 0 ? notYetUsed : [...candidates];
}

/**
 * 手順5（最終選定）: `candidates`（1件以上、呼び出し元が保証する）から`random()`
 * （`[0, 1)`を返す注入可能な擬似乱数関数）で1件を選ぶ。`random()`が仕様上の上限である
 * 1に極めて近い値を返した場合でも配列範囲外を指さないよう、インデックスを
 * `candidates.length - 1`にクランプする。
 *
 * 主菜（`RuleBasedRecipeEntry`）・補助副菜（`RuleBasedSideDishEntry`、task 17.4）の両方の
 * 候補選定で共有するため`T`をジェネリックにしている（要素の形状に依存しない添字選定のみ）。
 */
function pickRandomEntry<T>(candidates: readonly T[], random: () => number): T {
  const rawIndex = Math.floor(random() * candidates.length);
  const index = Math.min(Math.max(rawIndex, 0), candidates.length - 1);
  // candidatesは呼び出し元が非空を保証するため、この添字アクセスは必ず値を返す。
  return candidates[index] as T;
}

/**
 * 対象スロット（`mealType`）について、手順1〜5を通しで適用し1件選定する。
 * 手順1・2を満たす候補が1件もない場合は`null`を返す（呼び出し元が`dayIndex`/`mealType`の
 * コンテキストを付与してエラーへ変換する、手順6）。
 */
function selectEntryForSlot(
  mealType: MealType,
  profile: MenuProfileSnapshot,
  dislikedDishNames: ReadonlySet<string>,
  usedDishNames: ReadonlySet<string>,
  random: () => number
): RuleBasedRecipeEntry | null {
  const mandatory = filterMandatoryCandidates(mealType, profile.ngIngredients, dislikedDishNames);
  if (mandatory.length === 0) {
    return null;
  }
  const restrictionFiltered = filterByRestriction(mandatory, profile.restrictionType);
  const varietyFiltered = filterByVariety(restrictionFiltered, usedDishNames);
  return pickRandomEntry(varietyFiltered, random);
}

// --- 分量スケーリング ---

/**
 * `entry`の全`ingredients`について、`FoodCompositionRepository.findById`で取得した
 * `per100g.energyKcal`から素の合計kcal（`quantity/100 * energyKcal`の合計）を算出する。
 * 食品IDが（本来ありえないが）DBに見つからない場合はその食材のkcal寄与を0として扱う
 * （`FoodCompositionRepository.findById`は該当行が存在しない場合に例外ではなく`null`を返す
 * 規約であるため、本関数もそれに倣い例外を投げない）。
 */
function computeRawTotalCalories(
  entry: RuleBasedRecipeEntry,
  foodCompositionRepository: FoodCompositionRepository
): number {
  return entry.ingredients.reduce((total, ingredient) => {
    const nutrition = foodCompositionRepository.findById(ingredient.foodId);
    const kcalPer100g = nutrition?.per100g.energyKcal ?? 0;
    return total + (ingredient.quantity / 100) * kcalPer100g;
  }, 0);
}

/**
 * `entry`の全`ingredients`の`quantity`を、`targetCalorieForSlot`（この食事枠に配分すべきkcal、
 * ファイル冒頭コメント「分量スケーリング」参照）に近づけるよう一律スケーリングする。
 *
 * スケール係数 = `targetCalorieForSlot / rawTotalCalories`を`[MIN_SCALE_FACTOR,
 * MAX_SCALE_FACTOR]`（0.5〜2.0）にクランプする。`rawTotalCalories`が0以下（食材のkcalが
 * すべて算出不能）の場合はスケーリングの基準が存在しないため係数1（無変更）を採用する。
 */
function scaleIngredientsToTarget(
  entry: RuleBasedRecipeEntry,
  targetCalorieForSlot: number,
  foodCompositionRepository: FoodCompositionRepository
): IngredientSelection[] {
  const rawTotalCalories = computeRawTotalCalories(entry, foodCompositionRepository);
  const rawScaleFactor = rawTotalCalories > 0 ? targetCalorieForSlot / rawTotalCalories : 1;
  const scaleFactor = Math.min(Math.max(rawScaleFactor, MIN_SCALE_FACTOR), MAX_SCALE_FACTOR);

  return entry.ingredients.map((ingredient) => ({
    foodId: ingredient.foodId,
    quantity: Math.round(ingredient.quantity * scaleFactor * 10) / 10,
    unit: ingredient.unit,
  }));
}

// --- targets（日付キー）からdayIndexを復元する ---

/**
 * `targets`（`Record<IsoDate, NutritionTargetSnapshot>`）のキーを日付昇順にソートし、
 * ソート後の位置を`dayIndex`として復元したMapを返す。ファイル冒頭コメント
 * 「`generateWeek`の`targets`からdayIndexを復元する方法について」参照。
 */
function buildDayIndexToTargetMap(
  targets: Record<IsoDate, NutritionTargetSnapshot>
): Map<number, NutritionTargetSnapshot> {
  const sortedDates = Object.keys(targets).sort();
  const map = new Map<number, NutritionTargetSnapshot>();
  sortedDates.forEach((date, dayIndex) => {
    map.set(dayIndex, targets[date] as NutritionTargetSnapshot);
  });
  return map;
}

/** 手順6のエラー（`ClaudeGenerationError`）を組み立てる。 */
function candidatesExhaustedError(context: string): ClaudeGenerationError {
  return {
    type: "schema_validation_failed",
    message:
      `${context}について、必須フィルタ（mealType一致・NG食材除外・苦手料理除外）を満たす` +
      "候補がRULE_BASED_RECIPESに1件も存在しません。",
  };
}

// --- レシピ詳細生成（generateRecipe、task 17.4） ---

/**
 * `RULE_BASED_RECIPES`に対象`dishName`が見つからない場合のフォールバック既定値。
 *
 * ## 発生しうる状況について
 * `generateRecipe`が受け取る`mealSlot.dishName`は、本来`generateWeek`/`generateDay`が
 * `RULE_BASED_RECIPES`から選定した値がそのまま`MenuPlanRepository`に永続化されたものであり、
 * 通常は必ず`RULE_BASED_RECIPES`中に見つかる。しかし以下のような整合性エッジケースでは
 * 「その時点の`RULE_BASED_RECIPES`に存在しないdishName」に対して`generateRecipe`が呼ばれうる:
 *   - 他日再生成（`generateDay`）や週次再生成の後、クライアント側が古い（置き換え前の）
 *     `mealSlot`情報でレシピ詳細を要求した場合
 *   - `RULE_BASED_RECIPES`のデータ自体が将来変更・削除され、既に永続化済みの献立が
 *     参照する`dishName`が失われた場合
 * `RecipeDetailService.generateForMealSlot`は生成前に対象の`meal_slots`存在確認を行うが
 * （design.md #RecipeDetailService Preconditions）、それは「食事枠の行が存在するか」の確認で
 * あり、その`dishName`が現在の`RULE_BASED_RECIPES`に含まれるかどうかまでは保証しない。
 *
 * ## フォールバック方針
 * `Result`のエラーとして扱わず（Claude実装の`generateRecipe`はプロンプトさえ渡せば必ずレシピ
 * 詳細を生成できるため、非AI実装だけがこの一点で失敗しうるのは非対称であり、呼び出し元
 * （`RecipeDetailService`）に本実装固有のエラー分岐を持ち込みたくない）、料理名に依存しない
 * 汎用的な調理手順・分量・調理時間を返す。ユーザーは実際の`dishName`と多少ずれた手順を見る
 * ことになるが、レシピ詳細機能自体は利用可能なままである（degrade gracefully）。
 */
const FALLBACK_RECIPE_DEFAULTS: Pick<RuleBasedRecipeEntry, "servings" | "cookingTimeMinutes" | "steps"> = {
  servings: 1,
  cookingTimeMinutes: 15,
  steps: [
    "材料を用意する。",
    "適切な調理方法（茹でる・焼く・炒める等）で加熱する。",
    "味を調え、器に盛り付ける。",
  ],
};

/**
 * 補助副菜候補を選定する（`generateRecipe`専用）。`mealType`一致（必須、`RULE_BASED_SIDE_DISHES`は
 * mealType別に必ず5件存在するため——`rule-based-side-dish.data.ts`冒頭コメント参照——ここが
 * 空になることはない）に絞った上で、NG食材フィルタ（`isFreeOfNgIngredients`、手順1・2と同じ
 * ロジックを再利用）を適用する。
 *
 * 主菜の必須フィルタ（`filterMandatoryCandidates`）と異なり、NG食材フィルタの結果が0件になる
 * 場合はこのフィルタのみを緩和し、mealType一致のみを満たす候補群を返す（フォールバック）。
 * `supplementarySuggestions`は`RecipeGenerationToolResult`/`RecipeDetailSchema`
 * （`shared/src/menu.schema.ts`の`.min(1).max(2)`）が常に1件以上を要求する付随的な追加提案
 * （もう一品）であり、主菜のように生成全体をハードエラーにしてまで守るべき制約ではないと判断した
 * （苦手料理除外・食事制限フィルタは、task本文が明示する選定基準（対象食事タイプ・NG食材のみ）の
 * 範囲外として、補助副菜選定には適用しない）。
 */
function selectSideDishCandidatesForMealType(
  mealType: MealType,
  ngIngredients: readonly string[]
): readonly RuleBasedSideDishEntry[] {
  const byMealType = RULE_BASED_SIDE_DISHES.filter((entry) => entry.mealType === mealType);
  const ngFiltered = byMealType.filter((entry) => isFreeOfNgIngredients(entry.tags, ngIngredients));
  return ngFiltered.length > 0 ? ngFiltered : byMealType;
}

/**
 * 2件目の補助副菜も提案に含めるかどうかを`random()`で決める閾値。`random() < 0.5`の場合のみ
 * 2件目を含める（単純な五分五分の既定方針）。1件のみでも`RecipeGenerationToolResult`の
 * 契約（1〜2件）を満たすため、2件目を必ず含める必然性はない。
 */
const SECOND_SUPPLEMENTARY_SUGGESTION_PROBABILITY = 0.5;

/**
 * `mealType`・`ngIngredients`から補助副菜提案を1〜2件選ぶ（design.md Requirement 9.1;
 * `RecipeGenerationToolResult.supplementarySuggestions`/`RecipeDetailSchema`の`.min(1).max(2)`）。
 *
 * 1件目は`selectSideDishCandidatesForMealType`の候補群から`pickRandomEntry`で選ぶ。2件目は
 * `SECOND_SUPPLEMENTARY_SUGGESTION_PROBABILITY`の確率で、1件目を除いた残り候補群から
 * 同じく`pickRandomEntry`で選ぶ（1件目と重複しないことを保証するため、候補群からdishNameで
 * 除外してから選定する）。候補群がそもそも1件しかない場合（現行の`RULE_BASED_SIDE_DISHES`
 * では発生しない）は2件目を選びようがないため1件のみを返す。
 *
 * 各提案の`ingredients`は対応する副菜データセットのエントリの`ingredients`をそのまま用いる
 * （design.mdの`RecipeDetailService`が補助副菜の栄養増分を`suggestion.ingredients`から直接
 * 算出するのみでスケーリングを行わないため——`recipe-detail.service.ts`参照——`generateWeek`/
 * `generateDay`の対象カロリーへのスケーリングはここでは行わない）。
 */
function selectSupplementarySuggestions(
  mealType: MealType,
  ngIngredients: readonly string[],
  random: () => number
): { dishName: string; ingredients: IngredientSelection[] }[] {
  const candidates = selectSideDishCandidatesForMealType(mealType, ngIngredients);
  const first = pickRandomEntry(candidates, random);
  const remainingCandidates = candidates.filter((entry) => entry.dishName !== first.dishName);
  const includeSecond =
    remainingCandidates.length > 0 && random() < SECOND_SUPPLEMENTARY_SUGGESTION_PROBABILITY;
  const selectedEntries = includeSecond
    ? [first, pickRandomEntry(remainingCandidates, random)]
    : [first];

  return selectedEntries.map((entry) => ({
    dishName: entry.dishName,
    ingredients: entry.ingredients,
  }));
}

/**
 * `deps.foodCompositionRepository`（分量スケーリング用のカロリー算出）・`deps.random`
 * （候補選定用の擬似乱数関数、既定は`Math.random`）に対する`MenuGenerator`を生成する。
 * `createClaudeMenuGenerator`（`claude-menu.generator.ts`）と同じDIファクトリ関数パターンに
 * 揃えている。
 */
export function createRuleBasedMenuGenerator(deps: {
  foodCompositionRepository: FoodCompositionRepository;
  random?: () => number;
}): MenuGenerator {
  const foodCompositionRepository = deps.foodCompositionRepository;
  const random = deps.random ?? Math.random;

  async function generateWeek(
    profile: MenuProfileSnapshot,
    targets: Record<IsoDate, NutritionTargetSnapshot>,
    dislikedSummary: DislikedItemSummary[]
  ): Promise<Result<WeeklyGenerationToolResult, ClaudeGenerationError>> {
    const dislikedDishNames = new Set(dislikedSummary.map((item) => item.dishName));
    const dayIndexToTarget = buildDayIndexToTargetMap(targets);
    // 週内全体で「既に選んだdishName」を蓄積する（手順4、バラエティ優先）。
    // 各料理のdishNameはRULE_BASED_RECIPES全体で一意かつmealType固定のため
    // （rule-based-recipe.data.test.tsが検証済み）、mealType別に分けずグローバルな1つの
    // Setで管理しても、他mealTypeの候補集合に影響を与えることはない。
    const usedDishNames = new Set<string>();
    const days: WeeklyGenerationToolResult["days"] = [];

    for (let dayIndex = 0; dayIndex < DAYS_PER_WEEK; dayIndex++) {
      const target = dayIndexToTarget.get(dayIndex);
      if (!target) {
        return {
          ok: false,
          error: {
            type: "schema_validation_failed",
            message: `dayIndex ${dayIndex} に対応する栄養目標がtargetsに見つかりません。`,
          },
        };
      }

      const meals: GeneratedMeal[] = [];
      for (const mealType of MealTypeSchema.options) {
        const entry = selectEntryForSlot(mealType, profile, dislikedDishNames, usedDishNames, random);
        if (!entry) {
          return {
            ok: false,
            error: candidatesExhaustedError(`dayIndex ${dayIndex} の ${mealType} 枠`),
          };
        }
        usedDishNames.add(entry.dishName);
        const ingredients = scaleIngredientsToTarget(
          entry,
          target.calorieTarget * MEAL_CALORIE_RATIOS[mealType],
          foodCompositionRepository
        );
        meals.push({ mealType, dishName: entry.dishName, ingredients });
      }

      days.push({ dayIndex, meals });
    }

    return { ok: true, value: { days } };
  }

  async function generateDay(
    profile: MenuProfileSnapshot,
    target: NutritionTargetSnapshot,
    otherDays: OtherDayContext[],
    dislikedSummary: DislikedItemSummary[]
  ): Promise<Result<DailyGenerationToolResult, ClaudeGenerationError>> {
    const dislikedDishNames = new Set(dislikedSummary.map((item) => item.dishName));
    const meals: GeneratedMeal[] = [];

    for (const mealType of MealTypeSchema.options) {
      // 手順4（バラエティ優先）: otherDays内の同じmealTypeで既に使われているdishNameを避ける。
      const usedDishNamesForMealType = new Set(
        otherDays.flatMap((day) =>
          day.meals.filter((meal) => meal.mealType === mealType).map((meal) => meal.dishName)
        )
      );
      const entry = selectEntryForSlot(
        mealType,
        profile,
        dislikedDishNames,
        usedDishNamesForMealType,
        random
      );
      if (!entry) {
        return { ok: false, error: candidatesExhaustedError(`${mealType} 枠`) };
      }
      const ingredients = scaleIngredientsToTarget(
        entry,
        target.calorieTarget * MEAL_CALORIE_RATIOS[mealType],
        foodCompositionRepository
      );
      meals.push({ mealType, dishName: entry.dishName, ingredients });
    }

    return { ok: true, value: { meals } };
  }

  async function generateRecipe(
    mealSlot: MealSlot & { id: number },
    profile: MenuProfileSnapshot
  ): Promise<Result<RecipeGenerationToolResult, ClaudeGenerationError>> {
    // 対象dishNameに対応するキュレーション済みエントリを探す。見つからない場合の方針は
    // `FALLBACK_RECIPE_DEFAULTS`のコメント参照（整合性エッジケースへのフォールバック、
    // エラーにはしない）。
    const recipeEntry = RULE_BASED_RECIPES.find((entry) => entry.dishName === mealSlot.dishName);
    const recipeDefaults = recipeEntry ?? FALLBACK_RECIPE_DEFAULTS;

    const supplementarySuggestions = selectSupplementarySuggestions(
      mealSlot.mealType,
      profile.ngIngredients,
      random
    );

    return {
      ok: true,
      value: {
        servings: recipeDefaults.servings,
        cookingTimeMinutes: recipeDefaults.cookingTimeMinutes,
        // `RuleBasedRecipeEntry.steps`/`FALLBACK_RECIPE_DEFAULTS.steps`はreadonly string[]だが、
        // `RecipeGenerationToolResult.steps`はstring[]のため、新しい配列へコピーする。
        steps: [...recipeDefaults.steps],
        supplementarySuggestions,
      },
    };
  }

  return { generateWeek, generateDay, generateRecipe };
}
