/**
 * 非AI（ルールベース）献立生成用のキュレーション済み主菜レシピDB（`rule-based-recipe.data.ts`、
 * task 17.2、新規）。
 *
 * task 17.1が導入した `MenuGenerator` インターフェース（`generate-menu-generation`/
 * `menu-generator.ts`）の2つ目の実装となる `RuleBasedMenuGenerator`（task 17.3以降、未着手）が、
 * Claude APIを一切呼ばずに献立候補を選定するための静的な候補プールが本ファイルである。
 * `eating-out-reference.data.ts`（task 13.4）と同じ「配列リテラル + 個別コメント」の慣行に
 * 倣うが、以下の点が異なる:
 *
 * - 栄養価（カロリー・PFC等）は一切ハードコードしない。各エントリは `ingredients`
 *   （食品ID・分量・単位）のみを保持し、実際の栄養価は実行時に `FoodCompositionRepository`
 *   （`food-composition.repository.ts`）を用いて `ingredients` から算出される前提とする。
 * - `unit` は常に `"g"` を用いる。`UnitConversionService.toGrams`（`unit-conversion.service.ts`）
 *   は `unitCode === "g"` の場合 `unit_conversions` テーブルへのアクセス自体を行わず必ず成功する
 *   ため、DBの `unit_conversions` シード状況に依存せず確実に動作する安全な選択である。
 *
 * ## 実在する食品IDのみを使用することについて
 *
 * 本ファイルの全 `foodId` は `server/src/db/migrations/010_seed_food_items.sql` を実際に読み、
 * 実在する361件の食品ID・食品名から手作業で選定した（推測で食品IDを作っていない）。
 * 存在しない食品IDを1件でも含めると、`RuleBasedMenuGenerator` が生成する献立が
 * `NutritionVerificationService.verifyDish`（`nutrition-verification.service.ts`）で
 * `food_id_not_found` エラーとなり、後続タスクが根本的に動作しなくなる。この整合性は
 * `rule-based-recipe.data.test.ts` が実際の一時SQLiteDB（`010_seed_food_items.sql`が
 * 投入された状態）に対して機械的に検証する。
 *
 * ## `tags` について（NG食材フィルタリング用）
 *
 * `tags` は `MenuProfileSnapshot.ngIngredients`/`preferredIngredients`（`profile.gateway.ts`）と
 * 同様の平易な日本語の食材名（例: "牛肉", "鮭", "卵"）であり、`food_items.name`（成分表の
 * 正式名称、例:「若鶏肉・むね・皮つき・生」に類する表記）そのままではなく、一般に使われる
 * 食材呼称を採用する（例: `11219` 鶏むね肉（皮つき・生）→ タグは "鶏肉"）。
 * `RuleBasedMenuGenerator`（task 17.3）はこの `tags` とユーザーの `ngIngredients` の
 * 重複判定でNG食材を含む候補を除外する想定である（`EatingOutSuggestionService` が
 * `ingredientTags` を用いる設計と同じ方針）。
 *
 * ## `restrictionSuitability` について（食事制限フィルタリング用）
 *
 * 各料理の実際の食材構成（主食の分量、脂質の多い食材の有無、たんぱく質源の有無）から
 * 機械的にではなく素直に判定した。判断の目安:
 *   - `low_carb`: 米・パン・麺・いも・砂糖等の炭水化物源を主要量含む料理は不適合とする。
 *   - `low_fat`: バター・脂身の多い肉（豚ばら肉・牛かた肉等）・脂の多い魚（さば・さんま・
 *     ぶり等）・チーズ等を主要量含む料理は不適合とする。
 *   - `high_protein`: 肉・魚・卵・大豆製品を主菜として主体的に使う料理を適合とする。
 *   - `calorie_only`: 特定の栄養素を除外する制限ではなく総カロリー管理のみが目的のため、
 *     食材構成によらず全料理が適合する（`none` と同様、常に含める）。
 * `none`（制限なし）は要件どおり全エントリに含める。
 *
 * ## 完了条件・カバレッジ
 *
 * `mealType` 別に各12品、合計48品（task 17.2本文の要求「各食事タイプ最低10品、計40品以上」を
 * 満たす）。朝食は準備が簡単なもの中心、間食は軽量なもの中心に分布させた。
 */
import type { MealType, RestrictionType } from "@nutrition/shared";

/** 非AI献立生成用レシピDBの1エントリ（ファイル冒頭コメント参照）。 */
export interface RuleBasedRecipeEntry {
  /** 料理名（日本語、具体的な料理名）。データセット内で一意。 */
  dishName: string;
  /** 対象の食事枠種別。 */
  mealType: MealType;
  /** この料理に用いる食材（食品ID・分量・単位）。単位は常に `"g"`。 */
  ingredients: { foodId: string; quantity: number; unit: "g" }[];
  /** NG食材フィルタリング用の平易な日本語タグ（ファイル冒頭コメント参照）。 */
  tags: readonly string[];
  /** この料理が適合する食事制限タイプ。`"none"` は常に含む。 */
  restrictionSuitability: readonly RestrictionType[];
  /** 何人前のレシピか。 */
  servings: number;
  /** 目安の調理時間（分）。 */
  cookingTimeMinutes: number;
  /** 簡潔な調理手順（3〜6行程度）。 */
  steps: readonly string[];
}

/**
 * キュレーション済みの主菜レシピDB本体（48件、mealType別に各12件）。
 */
export const RULE_BASED_RECIPES: readonly RuleBasedRecipeEntry[] = [
  // ============================================================
  // 朝食（breakfast、12件） — 準備が簡単なもの中心
  // ============================================================
  {
    // 食パン+卵+バターの定番トースト。1食分の目安分量。
    dishName: "目玉焼きトースト",
    mealType: "breakfast",
    ingredients: [
      { foodId: "01026", quantity: 60, unit: "g" }, // 角形食パン
      { foodId: "12004", quantity: 50, unit: "g" }, // 鶏卵（全卵・生）
      { foodId: "14017", quantity: 5, unit: "g" }, // 有塩バター
    ],
    tags: ["パン", "卵", "バター"],
    restrictionSuitability: ["none", "calorie_only"],
    servings: 1,
    cookingTimeMinutes: 5,
    steps: [
      "食パンをトースターでこんがり焼く",
      "フライパンにバターを熱し卵を割り入れて焼く",
      "トーストに目玉焼きをのせる",
    ],
  },
  {
    // 納豆1パック+ごはん茶碗1杯の目安分量。
    dishName: "納豆ごはん",
    mealType: "breakfast",
    ingredients: [
      { foodId: "01088", quantity: 150, unit: "g" }, // ごはん（精白米・うるち米）
      { foodId: "04046", quantity: 45, unit: "g" }, // 糸引き納豆
      { foodId: "17007", quantity: 5, unit: "g" }, // こいくちしょうゆ
    ],
    tags: ["米", "納豆"],
    restrictionSuitability: ["none", "calorie_only", "high_protein", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 5,
    steps: [
      "ごはんを茶碗によそう",
      "納豆によく混ぜたしょうゆを加える",
      "ごはんにのせる",
    ],
  },
  {
    // ハム1.5枚+卵1個の目安分量。
    dishName: "ハムエッグ",
    mealType: "breakfast",
    ingredients: [
      { foodId: "11176", quantity: 30, unit: "g" }, // ロースハム
      { foodId: "12004", quantity: 50, unit: "g" }, // 鶏卵（全卵・生）
      { foodId: "14006", quantity: 3, unit: "g" }, // 調合油（サラダ油）
    ],
    tags: ["豚肉", "卵"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 5,
    steps: [
      "フライパンに油を熱しハムを両面焼く",
      "卵を割り入れて好みの硬さまで焼く",
      "塩こしょうで味を調える",
    ],
  },
  {
    // 食パン1枚を卵液に浸して焼く目安分量。
    dishName: "フレンチトースト",
    mealType: "breakfast",
    ingredients: [
      { foodId: "01026", quantity: 60, unit: "g" }, // 角形食パン
      { foodId: "12004", quantity: 50, unit: "g" }, // 鶏卵（全卵・生）
      { foodId: "13003", quantity: 50, unit: "g" }, // 普通牛乳
      { foodId: "03003", quantity: 8, unit: "g" }, // 上白糖
      { foodId: "14017", quantity: 5, unit: "g" }, // 有塩バター
    ],
    tags: ["パン", "卵", "牛乳", "バター"],
    restrictionSuitability: ["none", "calorie_only"],
    servings: 1,
    cookingTimeMinutes: 10,
    steps: [
      "卵・牛乳・砂糖を混ぜて卵液を作る",
      "食パンを卵液によく浸す",
      "バターを熱したフライパンで両面をこんがり焼く",
    ],
  },
  {
    // 小鉢1杯分のヨーグルト+バナナ半分の目安分量。
    dishName: "ヨーグルトと果物",
    mealType: "breakfast",
    ingredients: [
      { foodId: "13025", quantity: 150, unit: "g" }, // ヨーグルト（全脂無糖）
      { foodId: "07107", quantity: 50, unit: "g" }, // バナナ（生）
      { foodId: "03022", quantity: 10, unit: "g" }, // はちみつ
    ],
    tags: ["ヨーグルト", "バナナ", "はちみつ"],
    restrictionSuitability: ["none", "calorie_only", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 3,
    steps: [
      "バナナを一口大に切る",
      "器にヨーグルトを盛りバナナをのせる",
      "はちみつをかける",
    ],
  },
  {
    // おにぎり1個+みそ汁1杯の目安分量。
    dishName: "鮭おにぎりと豆腐わかめの味噌汁",
    mealType: "breakfast",
    ingredients: [
      { foodId: "01088", quantity: 150, unit: "g" }, // ごはん（精白米・うるち米）
      { foodId: "10139", quantity: 20, unit: "g" }, // 塩さけ（しろさけ）
      { foodId: "09004", quantity: 1.5, unit: "g" }, // 焼きのり
      { foodId: "04038", quantity: 30, unit: "g" }, // 焼き豆腐
      { foodId: "09044", quantity: 2, unit: "g" }, // カットわかめ（乾）
      { foodId: "17045", quantity: 12, unit: "g" }, // 米みそ（淡色辛みそ）
    ],
    tags: ["米", "鮭", "のり", "豆腐", "わかめ", "味噌"],
    restrictionSuitability: ["none", "calorie_only", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 15,
    steps: [
      "塩さけを焼いてほぐす",
      "ごはんに混ぜてのりで握る",
      "鍋に豆腐とわかめを入れて煮立て味噌を溶く",
    ],
  },
  {
    // 卵2個+牛乳少々+ソーセージ2本の目安分量。
    dishName: "スクランブルエッグとソーセージ",
    mealType: "breakfast",
    ingredients: [
      { foodId: "12004", quantity: 100, unit: "g" }, // 鶏卵（全卵・生）
      { foodId: "13003", quantity: 20, unit: "g" }, // 普通牛乳
      { foodId: "11186", quantity: 60, unit: "g" }, // ウインナーソーセージ
      { foodId: "14006", quantity: 5, unit: "g" }, // 調合油（サラダ油）
    ],
    tags: ["卵", "牛乳", "豚肉"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 10,
    steps: [
      "フライパンでソーセージを焼く",
      "卵と牛乳を混ぜてフライパンに入れる",
      "半熟になるまで大きくかき混ぜながら火を通す",
    ],
  },
  {
    // 小鍋1杯分のミルクがゆの目安分量。
    dishName: "オートミールのミルクがゆ",
    mealType: "breakfast",
    ingredients: [
      { foodId: "01004", quantity: 30, unit: "g" }, // オートミール
      { foodId: "13003", quantity: 150, unit: "g" }, // 普通牛乳
      { foodId: "03022", quantity: 8, unit: "g" }, // はちみつ
      { foodId: "07107", quantity: 50, unit: "g" }, // バナナ（生）
    ],
    tags: ["オートミール", "牛乳", "バナナ", "はちみつ"],
    restrictionSuitability: ["none", "calorie_only", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 8,
    steps: [
      "鍋にオートミールと牛乳を入れ弱火で煮る",
      "とろみがついたら火を止める",
      "バナナとはちみつをのせる",
    ],
  },
  {
    // 焼き魚1切れ+みそ汁+ごはん軽めの目安分量。
    dishName: "焼きさばの朝食セット",
    mealType: "breakfast",
    ingredients: [
      { foodId: "10154", quantity: 70, unit: "g" }, // まさば（生）
      { foodId: "01088", quantity: 120, unit: "g" }, // ごはん（精白米・うるち米）
      { foodId: "04032", quantity: 50, unit: "g" }, // 木綿豆腐
      { foodId: "06226", quantity: 15, unit: "g" }, // 根深ねぎ（長ねぎ・生）
      { foodId: "17045", quantity: 12, unit: "g" }, // 米みそ（淡色辛みそ）
    ],
    tags: ["さば", "米", "豆腐", "ねぎ", "味噌"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 15,
    steps: [
      "さばに軽く塩をふりグリルで焼く",
      "鍋に豆腐とねぎを入れて味噌汁を作る",
      "ごはんと一緒に盛り付ける",
    ],
  },
  {
    // トースト1枚+カテージチーズ+トマト半分の目安分量。
    dishName: "カテージチーズトマトトースト",
    mealType: "breakfast",
    ingredients: [
      { foodId: "01208", quantity: 60, unit: "g" }, // 全粒粉パン
      { foodId: "13033", quantity: 50, unit: "g" }, // カテージチーズ
      { foodId: "06182", quantity: 50, unit: "g" }, // トマト（赤色トマト・生）
      { foodId: "14001", quantity: 5, unit: "g" }, // オリーブ油
    ],
    tags: ["パン", "チーズ", "トマト"],
    restrictionSuitability: ["none", "calorie_only", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 5,
    steps: [
      "全粒粉パンをトーストする",
      "トマトを薄切りにする",
      "トーストにカテージチーズとトマトをのせオリーブ油を垂らす",
    ],
  },
  {
    // グラス1杯分のスムージーの目安分量。
    dishName: "豆乳バナナスムージー",
    mealType: "breakfast",
    ingredients: [
      { foodId: "04053", quantity: 200, unit: "g" }, // 調製豆乳
      { foodId: "07107", quantity: 100, unit: "g" }, // バナナ（生）
      { foodId: "03022", quantity: 10, unit: "g" }, // はちみつ
    ],
    tags: ["豆乳", "バナナ", "はちみつ"],
    restrictionSuitability: ["none", "calorie_only", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 3,
    steps: [
      "バナナを適当な大きさに切る",
      "豆乳・バナナ・はちみつをミキサーにかける",
      "グラスに注ぐ",
    ],
  },
  {
    // 鶏むね肉1枚分+付け合わせ野菜の目安分量。
    dishName: "鶏むね肉のサラダ朝食プレート",
    mealType: "breakfast",
    ingredients: [
      { foodId: "11220", quantity: 80, unit: "g" }, // 鶏むね肉（皮なし・生）
      { foodId: "06313", quantity: 30, unit: "g" }, // サラダな（生）
      { foodId: "06183", quantity: 30, unit: "g" }, // ミニトマト（生）
      { foodId: "14001", quantity: 5, unit: "g" }, // オリーブ油
    ],
    tags: ["鶏肉", "レタス", "トマト"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "high_protein", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 12,
    steps: [
      "鶏むね肉を茹でるか蒸して火を通す",
      "粗熱を取り食べやすく切る",
      "サラダなとミニトマトと共に盛り付けオリーブ油をかける",
    ],
  },

  // ============================================================
  // 昼食（lunch、12件）
  // ============================================================
  {
    // 鶏むね肉1枚+ごはん茶碗大盛りの目安分量。
    dishName: "鶏むね肉の照り焼き定食",
    mealType: "lunch",
    ingredients: [
      { foodId: "11219", quantity: 120, unit: "g" }, // 鶏むね肉（皮つき・生）
      { foodId: "01088", quantity: 180, unit: "g" }, // ごはん（精白米・うるち米）
      { foodId: "17007", quantity: 10, unit: "g" }, // こいくちしょうゆ
      { foodId: "16025", quantity: 10, unit: "g" }, // 本みりん
      { foodId: "03003", quantity: 3, unit: "g" }, // 上白糖
      { foodId: "06061", quantity: 40, unit: "g" }, // キャベツ（生）
    ],
    tags: ["鶏肉", "米", "キャベツ"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 20,
    steps: [
      "鶏むね肉を一口大に切り焼く",
      "しょうゆ・みりん・砂糖を合わせたタレを絡める",
      "ごはんとせん切りキャベツを添えて盛り付ける",
    ],
  },
  {
    // 豚肉100g+彩り野菜の目安分量。
    dishName: "豚もも肉の野菜炒め定食",
    mealType: "lunch",
    ingredients: [
      { foodId: "11131", quantity: 100, unit: "g" }, // 豚もも肉（皮下脂肪なし・生）
      { foodId: "06061", quantity: 60, unit: "g" }, // キャベツ（生）
      { foodId: "06212", quantity: 30, unit: "g" }, // にんじん（皮つき・生）
      { foodId: "06245", quantity: 20, unit: "g" }, // 青ピーマン（生）
      { foodId: "14002", quantity: 5, unit: "g" }, // ごま油
      { foodId: "17007", quantity: 8, unit: "g" }, // こいくちしょうゆ
      { foodId: "01088", quantity: 180, unit: "g" }, // ごはん（精白米・うるち米）
    ],
    tags: ["豚肉", "キャベツ", "にんじん", "ピーマン", "米"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 15,
    steps: [
      "豚もも肉と野菜を一口大に切る",
      "ごま油で豚肉を炒め野菜を加えてさらに炒める",
      "しょうゆで味を調えごはんと共に盛り付ける",
    ],
  },
  {
    // さば1切れ+大根おろし少々の目安分量。
    dishName: "さばの塩焼き定食",
    mealType: "lunch",
    ingredients: [
      { foodId: "10154", quantity: 100, unit: "g" }, // まさば（生）
      { foodId: "01088", quantity: 180, unit: "g" }, // ごはん（精白米・うるち米）
      { foodId: "06132", quantity: 50, unit: "g" }, // だいこん（根・皮つき・生）
      { foodId: "17007", quantity: 5, unit: "g" }, // こいくちしょうゆ
    ],
    tags: ["さば", "米", "大根"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 15,
    steps: [
      "さばに塩をふりグリルで焼く",
      "大根をすりおろす",
      "ごはんと大根おろし・しょうゆを添えて盛り付ける",
    ],
  },
  {
    // 豆腐半丁+ひき肉少なめの目安分量。
    dishName: "麻婆豆腐丼",
    mealType: "lunch",
    ingredients: [
      { foodId: "04032", quantity: 150, unit: "g" }, // 木綿豆腐
      { foodId: "11163", quantity: 60, unit: "g" }, // 豚ひき肉
      { foodId: "06226", quantity: 20, unit: "g" }, // 根深ねぎ（長ねぎ・生）
      { foodId: "17004", quantity: 5, unit: "g" }, // トウバンジャン
      { foodId: "17007", quantity: 8, unit: "g" }, // こいくちしょうゆ
      { foodId: "14002", quantity: 5, unit: "g" }, // ごま油
      { foodId: "01088", quantity: 180, unit: "g" }, // ごはん（精白米・うるち米）
    ],
    tags: ["豆腐", "豚肉", "ねぎ", "米"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 20,
    steps: [
      "豚ひき肉をごま油で炒める",
      "豆腐とねぎ、調味料を加えて煮る",
      "ごはんにかけて盛り付ける",
    ],
  },
  {
    // 1人前のパスタ+ソースの目安分量。
    dishName: "スパゲッティミートソース",
    mealType: "lunch",
    ingredients: [
      { foodId: "01063", quantity: 90, unit: "g" }, // スパゲッティ（乾）
      { foodId: "11089", quantity: 80, unit: "g" }, // 牛ひき肉
      { foodId: "06153", quantity: 50, unit: "g" }, // たまねぎ（生）
      { foodId: "06184", quantity: 100, unit: "g" }, // トマト缶（ホール・食塩無添加）
      { foodId: "17036", quantity: 15, unit: "g" }, // トマトケチャップ
      { foodId: "14006", quantity: 5, unit: "g" }, // 調合油（サラダ油）
    ],
    tags: ["牛肉", "たまねぎ", "トマト", "パスタ"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 25,
    steps: [
      "たまねぎをみじん切りにして油で炒める",
      "牛ひき肉を加えて炒め、トマト缶とケチャップを加え煮込む",
      "茹でたスパゲッティに絡める",
    ],
  },
  {
    // えび5尾程度+ブロッコリーの目安分量。
    dishName: "エビとブロッコリーの塩炒め定食",
    mealType: "lunch",
    ingredients: [
      { foodId: "10321", quantity: 100, unit: "g" }, // くるまえび（養殖・生）
      { foodId: "06263", quantity: 80, unit: "g" }, // ブロッコリー（生）
      { foodId: "06223", quantity: 5, unit: "g" }, // にんにく（生）
      { foodId: "14006", quantity: 6, unit: "g" }, // 調合油（サラダ油）
      { foodId: "17012", quantity: 1, unit: "g" }, // 食塩
      { foodId: "01088", quantity: 180, unit: "g" }, // ごはん（精白米・うるち米）
    ],
    tags: ["えび", "ブロッコリー", "にんにく", "米"],
    restrictionSuitability: ["none", "calorie_only", "high_protein", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 15,
    steps: [
      "えびの殻をむき下処理する",
      "にんにくを油で香りが出るまで炒めエビとブロッコリーを加えて炒める",
      "塩で味を調えごはんと共に盛り付ける",
    ],
  },
  {
    // うどん1玉+豚しゃぶ肉の目安分量。
    dishName: "冷しゃぶサラダうどん",
    mealType: "lunch",
    ingredients: [
      { foodId: "01039", quantity: 200, unit: "g" }, // うどん（ゆで）
      { foodId: "11131", quantity: 80, unit: "g" }, // 豚もも肉（皮下脂肪なし・生）
      { foodId: "06312", quantity: 40, unit: "g" }, // レタス（土耕栽培・生）
      { foodId: "06182", quantity: 40, unit: "g" }, // トマト（赤色トマト・生）
      { foodId: "17029", quantity: 30, unit: "g" }, // めんつゆ（ストレート）
    ],
    tags: ["うどん", "豚肉", "レタス", "トマト"],
    restrictionSuitability: ["none", "calorie_only", "high_protein", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 15,
    steps: [
      "豚肉を茹でて冷水にとる",
      "うどんを茹でて冷水で締め器に盛る",
      "レタス・トマト・豚肉をのせつゆをかける",
    ],
  },
  {
    // うどん1玉+油揚げ1/2枚の目安分量。
    dishName: "きつねうどん",
    mealType: "lunch",
    ingredients: [
      { foodId: "01039", quantity: 200, unit: "g" }, // うどん（ゆで）
      { foodId: "04040", quantity: 20, unit: "g" }, // 油揚げ（生）
      { foodId: "06226", quantity: 15, unit: "g" }, // 根深ねぎ（長ねぎ・生）
      { foodId: "17029", quantity: 40, unit: "g" }, // めんつゆ（ストレート）
    ],
    tags: ["うどん", "油揚げ", "ねぎ"],
    restrictionSuitability: ["none", "calorie_only"],
    servings: 1,
    cookingTimeMinutes: 10,
    steps: [
      "うどんを茹でて器に盛る",
      "油揚げを甘辛く煮る",
      "つゆを注ぎねぎと油揚げをのせる",
    ],
  },
  {
    // 鶏ささみ2本程度+彩り野菜の目安分量。
    dishName: "サラダチキンと彩り野菜のプレート",
    mealType: "lunch",
    ingredients: [
      { foodId: "11227", quantity: 100, unit: "g" }, // 鶏ささみ（生）
      { foodId: "06263", quantity: 60, unit: "g" }, // ブロッコリー（生）
      { foodId: "06183", quantity: 40, unit: "g" }, // ミニトマト（生）
      { foodId: "14001", quantity: 5, unit: "g" }, // オリーブ油
    ],
    tags: ["鶏肉", "ブロッコリー", "トマト"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "high_protein", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 15,
    steps: [
      "鶏ささみを茹でて手で割く",
      "ブロッコリーを茹でる",
      "野菜と共に盛り付けオリーブ油と塩をかける",
    ],
  },
  {
    // 豚ばら肉100g+キムチの目安分量。
    dishName: "豚キムチ炒め定食",
    mealType: "lunch",
    ingredients: [
      { foodId: "11129", quantity: 100, unit: "g" }, // 豚ばら肉（脂身つき・生）
      { foodId: "06236", quantity: 80, unit: "g" }, // 白菜キムチ
      { foodId: "06207", quantity: 30, unit: "g" }, // にら（生）
      { foodId: "14002", quantity: 5, unit: "g" }, // ごま油
      { foodId: "01088", quantity: 180, unit: "g" }, // ごはん（精白米・うるち米）
    ],
    tags: ["豚肉", "キムチ", "にら", "米"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 15,
    steps: [
      "豚ばら肉を炒める",
      "キムチとにらを加えてさらに炒める",
      "ごま油で香りをつけごはんと共に盛り付ける",
    ],
  },
  {
    // まぐろの刺身用さく100g+アボカド半分の目安分量。
    dishName: "まぐろとアボカドの丼",
    mealType: "lunch",
    ingredients: [
      { foodId: "10252", quantity: 100, unit: "g" }, // きはだまぐろ（生）
      { foodId: "07006", quantity: 50, unit: "g" }, // アボカド（生）
      { foodId: "01088", quantity: 180, unit: "g" }, // ごはん（精白米・うるち米）
      { foodId: "17007", quantity: 8, unit: "g" }, // こいくちしょうゆ
      { foodId: "17081", quantity: 2, unit: "g" }, // 練りわさび
    ],
    tags: ["まぐろ", "アボカド", "米"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 10,
    steps: [
      "まぐろとアボカドを角切りにする",
      "しょうゆとわさびで和える",
      "ごはんにのせる",
    ],
  },
  {
    // ゴーヤ1/2本+豆腐半丁の目安分量。
    dishName: "野菜たっぷり豆腐チャンプルー",
    mealType: "lunch",
    ingredients: [
      { foodId: "04032", quantity: 150, unit: "g" }, // 木綿豆腐
      { foodId: "11129", quantity: 50, unit: "g" }, // 豚ばら肉（脂身つき・生）
      { foodId: "06205", quantity: 60, unit: "g" }, // にがうり（ゴーヤ・生）
      { foodId: "12004", quantity: 50, unit: "g" }, // 鶏卵（全卵・生）
      { foodId: "17007", quantity: 8, unit: "g" }, // こいくちしょうゆ
      { foodId: "01088", quantity: 150, unit: "g" }, // ごはん（精白米・うるち米）
    ],
    tags: ["豆腐", "豚肉", "ゴーヤ", "卵", "米"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 20,
    steps: [
      "ゴーヤをスライスして下茹でする",
      "豚肉を炒め豆腐とゴーヤを加えて炒める",
      "溶き卵を回し入れしょうゆで味を調える",
    ],
  },

  // ============================================================
  // 夕食（dinner、12件）
  // ============================================================
  {
    // 鮭1切れ+大根おろし少々の目安分量。
    dishName: "鮭の塩焼き定食",
    mealType: "dinner",
    ingredients: [
      { foodId: "10134", quantity: 100, unit: "g" }, // しろさけ（生）
      { foodId: "01088", quantity: 150, unit: "g" }, // ごはん（精白米・うるち米）
      { foodId: "06132", quantity: 50, unit: "g" }, // だいこん（根・皮つき・生）
      { foodId: "17012", quantity: 1, unit: "g" }, // 食塩
    ],
    tags: ["鮭", "米", "大根"],
    restrictionSuitability: ["none", "calorie_only", "high_protein", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 15,
    steps: [
      "しろさけに塩をふりグリルで焼く",
      "大根をすりおろす",
      "ごはんと大根おろしを添えて盛り付ける",
    ],
  },
  {
    // 豚ロース肉1枚+たまねぎの目安分量。
    dishName: "豚肉の生姜焼き定食",
    mealType: "dinner",
    ingredients: [
      { foodId: "11123", quantity: 120, unit: "g" }, // 豚ロース（脂身つき・生）
      { foodId: "06153", quantity: 50, unit: "g" }, // たまねぎ（生）
      { foodId: "06103", quantity: 5, unit: "g" }, // しょうが（皮なし・生）
      { foodId: "17007", quantity: 10, unit: "g" }, // こいくちしょうゆ
      { foodId: "16025", quantity: 8, unit: "g" }, // 本みりん
      { foodId: "01088", quantity: 180, unit: "g" }, // ごはん（精白米・うるち米）
      { foodId: "06061", quantity: 40, unit: "g" }, // キャベツ（生）
    ],
    tags: ["豚肉", "たまねぎ", "キャベツ", "米"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 20,
    steps: [
      "たまねぎを薄切りにする",
      "豚肉としょうが・調味料を絡めて焼く",
      "たまねぎとせん切りキャベツを添えて盛り付ける",
    ],
  },
  {
    // 牛もも肉100g+根菜の目安分量。
    dishName: "牛肉と根菜の煮物",
    mealType: "dinner",
    ingredients: [
      { foodId: "11048", quantity: 100, unit: "g" }, // 牛もも肉（乳用肥育牛・皮下脂肪なし・生）
      { foodId: "06132", quantity: 80, unit: "g" }, // だいこん（根・皮つき・生）
      { foodId: "06212", quantity: 40, unit: "g" }, // にんじん（皮つき・生）
      { foodId: "17007", quantity: 10, unit: "g" }, // こいくちしょうゆ
      { foodId: "03003", quantity: 5, unit: "g" }, // 上白糖
      { foodId: "16025", quantity: 10, unit: "g" }, // 本みりん
      { foodId: "01088", quantity: 150, unit: "g" }, // ごはん（精白米・うるち米）
    ],
    tags: ["牛肉", "大根", "にんじん", "米"],
    restrictionSuitability: ["none", "calorie_only", "high_protein", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 30,
    steps: [
      "牛肉と根菜を一口大に切る",
      "鍋に入れ調味料と水を加えて煮込む",
      "味が染みたら火を止めごはんと共に盛り付ける",
    ],
  },
  {
    // たら1切れ+きのこの目安分量。
    dishName: "たらのホイル焼き",
    mealType: "dinner",
    ingredients: [
      { foodId: "10205", quantity: 120, unit: "g" }, // まだら（生）
      { foodId: "08016", quantity: 40, unit: "g" }, // ぶなしめじ（生）
      { foodId: "06226", quantity: 20, unit: "g" }, // 根深ねぎ（長ねぎ・生）
      { foodId: "14017", quantity: 8, unit: "g" }, // 有塩バター
      { foodId: "17007", quantity: 5, unit: "g" }, // こいくちしょうゆ
      { foodId: "01088", quantity: 150, unit: "g" }, // ごはん（精白米・うるち米）
    ],
    tags: ["たら", "きのこ", "ねぎ", "バター", "米"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 20,
    steps: [
      "たらとしめじ、ねぎをアルミホイルに包む",
      "バターとしょうゆを加えて包み蒸し焼きにする",
      "ごはんと共に盛り付ける",
    ],
  },
  {
    // 鶏もも肉1枚+根菜の目安分量。
    dishName: "鶏肉と根菜の筑前煮",
    mealType: "dinner",
    ingredients: [
      { foodId: "11221", quantity: 100, unit: "g" }, // 鶏もも肉（皮つき・生）
      { foodId: "06317", quantity: 60, unit: "g" }, // れんこん（生）
      { foodId: "06212", quantity: 40, unit: "g" }, // にんじん（皮つき・生）
      { foodId: "08039", quantity: 30, unit: "g" }, // 生しいたけ（菌床栽培・生）
      { foodId: "17007", quantity: 10, unit: "g" }, // こいくちしょうゆ
      { foodId: "16025", quantity: 8, unit: "g" }, // 本みりん
      { foodId: "03003", quantity: 3, unit: "g" }, // 上白糖
      { foodId: "01088", quantity: 150, unit: "g" }, // ごはん（精白米・うるち米）
    ],
    tags: ["鶏肉", "れんこん", "にんじん", "しいたけ", "米"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 30,
    steps: [
      "鶏肉と野菜を一口大に切る",
      "鍋で鶏肉を炒め野菜を加える",
      "調味料と水を加えて煮込む",
    ],
  },
  {
    // ぶり1切れの目安分量。
    dishName: "ぶりの照り焼き",
    mealType: "dinner",
    ingredients: [
      { foodId: "10241", quantity: 100, unit: "g" }, // ぶり（成魚・生）
      { foodId: "17007", quantity: 10, unit: "g" }, // こいくちしょうゆ
      { foodId: "16025", quantity: 10, unit: "g" }, // 本みりん
      { foodId: "03003", quantity: 3, unit: "g" }, // 上白糖
      { foodId: "06132", quantity: 50, unit: "g" }, // だいこん（根・皮つき・生）
      { foodId: "01088", quantity: 150, unit: "g" }, // ごはん（精白米・うるち米）
    ],
    tags: ["ぶり", "大根", "米"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 15,
    steps: [
      "ぶりに下味をつける",
      "フライパンで両面を焼く",
      "しょうゆ・みりん・砂糖を加えて煮絡める",
    ],
  },
  {
    // 牛かた肉100g+豆腐・ねぎのすき焼き風の目安分量。
    dishName: "牛肉と豆腐のすき焼き風煮",
    mealType: "dinner",
    ingredients: [
      { foodId: "11030", quantity: 100, unit: "g" }, // 牛かた肉（乳用肥育牛・脂身つき・生）
      { foodId: "04038", quantity: 100, unit: "g" }, // 焼き豆腐
      { foodId: "06226", quantity: 40, unit: "g" }, // 根深ねぎ（長ねぎ・生）
      { foodId: "02005", quantity: 50, unit: "g" }, // しらたき
      { foodId: "17007", quantity: 15, unit: "g" }, // こいくちしょうゆ
      { foodId: "03003", quantity: 8, unit: "g" }, // 上白糖
      { foodId: "01088", quantity: 150, unit: "g" }, // ごはん（精白米・うるち米）
    ],
    tags: ["牛肉", "豆腐", "ねぎ", "しらたき", "米"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 25,
    steps: [
      "牛肉、豆腐、ねぎ、しらたきを鍋に並べる",
      "しょうゆと砂糖を加えた煮汁で煮る",
      "味が染みたらごはんと共に盛り付ける",
    ],
  },
  {
    // 鶏むね肉1枚にチーズを挟む目安分量。
    dishName: "鶏むね肉のチーズ焼き",
    mealType: "dinner",
    ingredients: [
      { foodId: "11220", quantity: 120, unit: "g" }, // 鶏むね肉（皮なし・生）
      { foodId: "13040", quantity: 20, unit: "g" }, // プロセスチーズ
      { foodId: "06182", quantity: 50, unit: "g" }, // トマト（赤色トマト・生）
      { foodId: "14001", quantity: 5, unit: "g" }, // オリーブ油
      { foodId: "01088", quantity: 150, unit: "g" }, // ごはん（精白米・うるち米）
    ],
    tags: ["鶏肉", "チーズ", "トマト", "米"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 20,
    steps: [
      "鶏むね肉を観音開きにしてチーズを挟む",
      "オリーブ油で両面を焼く",
      "トマトを添えごはんと共に盛り付ける",
    ],
  },
  {
    // さんま1尾+大根おろしの目安分量。
    dishName: "さんまの塩焼き定食",
    mealType: "dinner",
    ingredients: [
      { foodId: "10173", quantity: 120, unit: "g" }, // さんま（皮つき・生）
      { foodId: "06132", quantity: 60, unit: "g" }, // だいこん（根・皮つき・生）
      { foodId: "17007", quantity: 5, unit: "g" }, // こいくちしょうゆ
      { foodId: "01088", quantity: 150, unit: "g" }, // ごはん（精白米・うるち米）
    ],
    tags: ["さんま", "大根", "米"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 15,
    steps: [
      "さんまをグリルで焼く",
      "大根をすりおろす",
      "ごはんと大根おろし・しょうゆを添えて盛り付ける",
    ],
  },
  {
    // ひらめ1切れ+しいたけの目安分量。
    dishName: "ひらめのバター醤油ソテー",
    mealType: "dinner",
    ingredients: [
      { foodId: "10234", quantity: 120, unit: "g" }, // ひらめ（天然・生）
      { foodId: "08039", quantity: 30, unit: "g" }, // 生しいたけ（菌床栽培・生）
      { foodId: "14017", quantity: 8, unit: "g" }, // 有塩バター
      { foodId: "17007", quantity: 6, unit: "g" }, // こいくちしょうゆ
      { foodId: "01088", quantity: 150, unit: "g" }, // ごはん（精白米・うるち米）
    ],
    tags: ["ひらめ", "しいたけ", "バター", "米"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 15,
    steps: [
      "ひらめに軽く塩をふる",
      "バターでひらめとしいたけを焼く",
      "しょうゆを回しかけごはんと共に盛り付ける",
    ],
  },
  {
    // 豚もも肉100g+厚揚げ2/3枚の目安分量。
    dishName: "豚肉と厚揚げの味噌炒め",
    mealType: "dinner",
    ingredients: [
      { foodId: "11131", quantity: 100, unit: "g" }, // 豚もも肉（皮下脂肪なし・生）
      { foodId: "04039", quantity: 80, unit: "g" }, // 生揚げ（厚揚げ）
      { foodId: "06245", quantity: 30, unit: "g" }, // 青ピーマン（生）
      { foodId: "17045", quantity: 10, unit: "g" }, // 米みそ（淡色辛みそ）
      { foodId: "03003", quantity: 3, unit: "g" }, // 上白糖
      { foodId: "01088", quantity: 150, unit: "g" }, // ごはん（精白米・うるち米）
    ],
    tags: ["豚肉", "厚揚げ", "ピーマン", "味噌", "米"],
    restrictionSuitability: ["none", "calorie_only", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 20,
    steps: [
      "厚揚げを一口大に切る",
      "豚肉と厚揚げ、ピーマンを炒める",
      "味噌と砂糖で味を調えごはんと共に盛り付ける",
    ],
  },
  {
    // かつおのたたき用さく120gの目安分量。
    dishName: "かつおのたたき",
    mealType: "dinner",
    ingredients: [
      { foodId: "10086", quantity: 120, unit: "g" }, // かつお（春獲り・生）
      { foodId: "06226", quantity: 15, unit: "g" }, // 根深ねぎ（長ねぎ・生）
      { foodId: "06103", quantity: 5, unit: "g" }, // しょうが（皮なし・生）
      { foodId: "17007", quantity: 10, unit: "g" }, // こいくちしょうゆ
      { foodId: "01088", quantity: 150, unit: "g" }, // ごはん（精白米・うるち米）
    ],
    tags: ["かつお", "ねぎ", "米"],
    restrictionSuitability: ["none", "calorie_only", "high_protein", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 10,
    steps: [
      "かつおの表面を軽く炙る",
      "薄切りにして皿に盛る",
      "ねぎ・しょうがを添えしょうゆをかける",
    ],
  },

  // ============================================================
  // 間食（snack、12件） — 軽量なもの中心
  // ============================================================
  {
    dishName: "ヨーグルト",
    mealType: "snack",
    ingredients: [
      { foodId: "13053", quantity: 100, unit: "g" }, // ヨーグルト（低脂肪無糖）
      { foodId: "03022", quantity: 8, unit: "g" }, // はちみつ
    ],
    tags: ["ヨーグルト", "はちみつ"],
    restrictionSuitability: ["none", "calorie_only", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 2,
    steps: ["ヨーグルトを器に盛る", "はちみつをかける"],
  },
  {
    dishName: "ゆで卵",
    mealType: "snack",
    ingredients: [
      { foodId: "12005", quantity: 50, unit: "g" }, // 鶏卵（全卵・ゆで）
    ],
    tags: ["卵"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 12,
    steps: ["卵を水から茹でて沸騰後10〜12分ゆでる", "冷水にとって殻をむく"],
  },
  {
    dishName: "アーモンド一掴み",
    mealType: "snack",
    ingredients: [
      { foodId: "05040", quantity: 20, unit: "g" }, // アーモンド（いり・無塩）
    ],
    tags: ["アーモンド", "ナッツ"],
    restrictionSuitability: ["none", "calorie_only", "low_carb"],
    servings: 1,
    cookingTimeMinutes: 1,
    steps: ["アーモンドを小皿に盛る"],
  },
  {
    dishName: "バナナ",
    mealType: "snack",
    ingredients: [
      { foodId: "07107", quantity: 100, unit: "g" }, // バナナ（生）
    ],
    tags: ["バナナ"],
    restrictionSuitability: ["none", "calorie_only", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 1,
    steps: ["バナナの皮をむく"],
  },
  {
    dishName: "チーズ一切れ",
    mealType: "snack",
    ingredients: [
      { foodId: "13040", quantity: 20, unit: "g" }, // プロセスチーズ
    ],
    tags: ["チーズ"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "high_protein"],
    servings: 1,
    cookingTimeMinutes: 1,
    steps: ["プロセスチーズを一切れ取り分ける"],
  },
  {
    // さつまいも1本分の目安分量。
    dishName: "焼きいも",
    mealType: "snack",
    ingredients: [
      { foodId: "02045", quantity: 150, unit: "g" }, // さつまいも（皮つき・生）
    ],
    tags: ["さつまいも"],
    restrictionSuitability: ["none", "calorie_only", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 40,
    steps: [
      "さつまいもを洗いアルミホイルで包む",
      "オーブンでじっくり焼く",
      "竹串がすっと通ったら完成",
    ],
  },
  {
    dishName: "素焼きミックスナッツ",
    mealType: "snack",
    ingredients: [
      { foodId: "05014", quantity: 10, unit: "g" }, // くるみ（いり）
      { foodId: "05005", quantity: 10, unit: "g" }, // カシューナッツ（フライ・味付け）
    ],
    tags: ["くるみ", "カシューナッツ", "ナッツ"],
    restrictionSuitability: ["none", "calorie_only", "low_carb"],
    servings: 1,
    cookingTimeMinutes: 1,
    steps: ["くるみとカシューナッツを小皿に盛り合わせる"],
  },
  {
    dishName: "枝豆",
    mealType: "snack",
    ingredients: [
      { foodId: "06015", quantity: 80, unit: "g" }, // えだまめ（生）
      { foodId: "17012", quantity: 1, unit: "g" }, // 食塩
    ],
    tags: ["えだまめ"],
    restrictionSuitability: ["none", "calorie_only", "high_protein", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 8,
    steps: ["塩を入れた熱湯でえだまめを茹でる", "ざるにあげ塩をふる"],
  },
  {
    dishName: "プルーン",
    mealType: "snack",
    ingredients: [
      { foodId: "07082", quantity: 30, unit: "g" }, // プルーン（乾）
    ],
    tags: ["プルーン"],
    restrictionSuitability: ["none", "calorie_only", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 1,
    steps: ["プルーンを器に盛る"],
  },
  {
    dishName: "サラダチキン風蒸し鶏",
    mealType: "snack",
    ingredients: [
      { foodId: "11220", quantity: 80, unit: "g" }, // 鶏むね肉（皮なし・生）
      { foodId: "17012", quantity: 1, unit: "g" }, // 食塩
    ],
    tags: ["鶏肉"],
    restrictionSuitability: ["none", "calorie_only", "low_carb", "high_protein", "low_fat"],
    servings: 1,
    cookingTimeMinutes: 15,
    steps: [
      "鶏むね肉に塩をふり耐熱皿に入れる",
      "電子レンジで加熱し中まで火を通す",
      "粗熱を取り食べやすく切る",
    ],
  },
  {
    dishName: "カステラ一切れ",
    mealType: "snack",
    ingredients: [
      { foodId: "15009", quantity: 50, unit: "g" }, // カステラ
    ],
    tags: ["カステラ"],
    restrictionSuitability: ["none", "calorie_only"],
    servings: 1,
    cookingTimeMinutes: 1,
    steps: ["カステラを一切れ切り分ける"],
  },
  {
    dishName: "らっかせいとレーズンのミックス",
    mealType: "snack",
    ingredients: [
      { foodId: "05035", quantity: 15, unit: "g" }, // らっかせい（大粒種・いり）
      { foodId: "07117", quantity: 15, unit: "g" }, // 干しぶどう（レーズン）
    ],
    tags: ["らっかせい", "レーズン", "ナッツ"],
    restrictionSuitability: ["none", "calorie_only"],
    servings: 1,
    cookingTimeMinutes: 1,
    steps: ["らっかせいとレーズンを小皿に混ぜて盛る"],
  },
];
