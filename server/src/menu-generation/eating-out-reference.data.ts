/**
 * 外食メニュー参照データ（`eating-out-reference.data.ts`、task 13.4）。
 *
 * design.md「外食代替提案生成フロー」（要件15.1-15.7）が要求する、あらかじめキュレーション
 * された静的参照データ本体。`EatingOutSuggestionService`（task 13.5、未着手）は本ファイルの
 * `EATING_OUT_REFERENCE_DATA` から対象食事枠の`mealType`に合致し、かつユーザーのNG食材と
 * `ingredientTags`が重複しない候補を絞り込み（要件15.4, 15.5）、残った候補から
 * `alternativeMenuKcal`が対象食事枠の検証済みエネルギー量（`meal_slots.energy_kcal`）以下で
 * 最も近いものを選定する（要件15.2）。Claude APIは一切呼び出さない（要件15.7）。
 *
 * ## `EatingOutReferenceEntry` と（将来の）`EatingOutSuggestion`の関係
 *
 * design.mdが定義する`EatingOutSuggestion`（task 13.5がAPIレスポンスとして返す結果型。
 * 2026-09時点で`shared/src/menu.schema.ts`にはまだ存在しない。task 13.5が新規に
 * `@nutrition/shared`へ昇格させる想定）は次の5フィールドのみを持つ:
 *   `typicalMenuName` / `typicalMenuKcal` / `alternativeMenuName` / `alternativeMenuKcal` /
 *   `proteinDeltaG`（alternativeMenuの代表的なたんぱく質量 - typicalMenuの代表的なたんぱく質量）
 *
 * 一方、本ファイルの`EatingOutReferenceEntry`（参照データの生の1エントリ）は
 * `EatingOutSuggestionService`が「除外」「選定」を行うための候補プールであり、
 * `EatingOutSuggestion`より多くの情報を持つ必要がある。具体的には以下の2フィールドを
 * 追加で持つ:
 *   - `mealType`: 対象食事枠の`mealType`と一致する候補のみを対象とするため（要件15.5）。
 *   - `ingredientTags`: ユーザーのNG食材一覧との重複判定に使うため（要件15.4）。
 *
 * ### 設計判断1: `proteinDeltaG`を持たず`typicalMenuProteinG`/`alternativeMenuProteinG`を持つ
 *
 * tasks.md自身のtask 13.4本文は投入すべき情報として「たんぱく質増分」という言葉を使うが、
 * 本ファイルでは増分（差分）を直接持たず、typical/alternative双方の実際のたんぱく質量
 * （絶対値、常に正）を保持する。理由は3つ:
 *   1. 本specの検証要件（本タスクのブリーフの「Testing requirements」）が「positive
 *      typicalMenuKcal/alternativeMenuKcal/protein values」を要求しており、これは
 *      差分（負にもなり得る）ではなく絶対値であることを前提とした要求である。
 *   2. `EatingOutSuggestion.proteinDeltaG`のコメント自体が「alternativeMenuの"代表的な
 *      たんぱく質量" - typicalMenuの"代表的なたんぱく質量"」と定義しており、これは
 *      各メニューの実際のたんぱく質量が一次データとして存在することを前提にしている。
 *   3. 絶対値を保持する方が出典の追跡可能性が高い（例:
 *      「吉野家公式19.6g、やよい軒公式30.0g」という2つの実測値を個別に検証できる方が、
 *      「+10.4g」という差分だけを保持するより将来の保守者が出典を再確認しやすい）。
 * `EatingOutSuggestionService`（task 13.5）は`alternativeMenuProteinG - typicalMenuProteinG`
 * という1行の引き算で`EatingOutSuggestion.proteinDeltaG`を導出することを想定する。
 *
 * ### 設計判断2: `ingredientTags`はtypical・alternative双方の主要食材を1つの配列に統合する
 *
 * design.mdの要件15.4は「ユーザーのNG食材一覧に含まれる食材を主要な食材とする参照データの
 * 候補を除外する」と定めるが、「主要な食材」がtypicalMenu側のものかalternativeMenu側の
 * ものかを明記していない。本ファイルは、ユーザーに提示されるレスポンス
 * （`EatingOutSuggestion`）がtypicalMenuName/alternativeMenuNameの両方を含む以上、
 * ユーザーが「食べたくない食材」を指定した場合はそれが「置き換え前」「置き換え後」の
 * どちらのメニューに含まれていても提案自体を見せるべきではない、という判断で
 * **typical・alternative双方の主要食材を統合した単一の配列**を`ingredientTags`として
 * 保持する（typicalのみ、alternativeのみを保持する設計は不採用）。
 * 例えば「銀鮭の塩焼定食」を代替案とするエントリで、typicalMenuが「牛丼」であっても
 * ユーザーが「鮭」をNG食材に指定していれば、そのエントリ全体が候補から除外されるべきである
 * （ユーザーは牛丼のリスクを避けたくて代替案を求めているのに、代替案自体に鮭が含まれていては
 * 意味がない）。この判断はtask 13.5（`EatingOutSuggestionService`）の除外ロジックが
 * 「エントリ単位で`ingredientTags`とNG食材の重複を見る」という単純な実装で要件15.4を
 * 満たせることを意味し、task 13.5はこの設計を前提に実装してよい。
 *
 * `ingredientTags`の値は、`MenuProfileSnapshot.ngIngredients: string[]`（`profile.gateway.ts`）
 * と同様の平易な日本語の食材名（例: "牛肉", "鮭", "卵"）であり、`food_items.food_id`のような
 * 内部IDとは無関係である（本ファイルはMEXT食品成分DBと独立している）。文字列比較の具体的な
 * アルゴリズム（完全一致か部分一致か等）はtask 13.5の責務であり、本ファイルは比較しやすい
 * 単純な単語（助詞・括弧・活用を含まない食材名の名詞）のみをタグとして採用する。
 *
 * ### `category`フィールドについて
 *
 * `category`（丼もの/定食/麺類/ファストフード/カレー/その他）は`EatingOutSuggestionService`
 * の選定ロジックには使われない、本ファイル自身のテスト・保守者向けの分類ラベルである
 * （tasks.mdが要求する「丼もの・定食・麺類・ファストフード等の代表的な外食シーンを横断」する
 * カバレッジを、このフィールドを走査することで機械的に確認できるようにするため）。
 *
 * ## 出典・サンプリング方針（全体）
 *
 * 各エントリのカロリー・たんぱく質は次のいずれかの方針で決定した（エントリごとのコメントに
 * 個別に明記）:
 *   1. 実在チェーンの公式栄養成分情報（各社公式サイト・公式PDF、または当該公式値をそのまま
 *      転記していることが明記された栄養データサイト経由）。2026年9月時点でWebSearch/WebFetch
 *      により確認した値。チェーンで金額・分量が変動するメニューは「並盛」等の基本サイズを採用。
 *   2. 特定チェーンに紐付かない、日本の外食でよく知られる代表的な目安値（例:
 *      「ラーメン(あっさり系) 約450-550kcal」）。この場合は当該料理タイプの一般的な目安で
 *      あり特定商品の実測値ではないことをコメントに明記する。
 * 検索で複数の情報源が食い違う値を示した料理（例: 親子丼、日高屋の中華そばのたんぱく質量）は、
 * 特定チェーンの実測値としては採用せず、方針2（料理タイプの一般的な目安）として扱った。
 *
 * ## 将来の保守者への注意（design.md Revalidation Triggers）
 *
 * design.mdはこのファイルの更新を「買い物リストのカテゴリ分類結果・外食代替提案の選定結果への
 * 影響を再確認する必要がある」変更点として明記している。エントリを追加・変更した場合は
 * 本ファイルに対応する`.data.test.ts`（アルカロリー・たんぱく質・mealType・ingredientTagsの
 * 整合性を検証する）が再度パスすることを確認すること。
 */
import type { MealType } from "@nutrition/shared";

/**
 * 本ファイル内でのみ使用する分類ラベル（`EatingOutSuggestionService`の選定ロジックには
 * 使われない。上記ファイル冒頭コメント「`category`フィールドについて」を参照）。
 */
export type EatingOutCategory = "丼もの" | "定食" | "麺類" | "ファストフード" | "カレー" | "その他";

/**
 * 外食メニュー参照データの1エントリ（design.mdの`EatingOutSuggestion`とは別の型。
 * ファイル冒頭コメント「`EatingOutReferenceEntry`と（将来の）`EatingOutSuggestion`の関係」を
 * 参照）。
 */
export interface EatingOutReferenceEntry {
  /** 一般的な外食メニュー名（「置き換え前」）。 */
  typicalMenuName: string;
  /** `typicalMenuName`のおおよそのカロリー（kcal、常に正）。 */
  typicalMenuKcal: number;
  /** `typicalMenuName`の代表的なたんぱく質量（g、常に正）。出典はエントリごとのコメントを参照。 */
  typicalMenuProteinG: number;
  /** 代替メニュー名（「置き換え後」）。本エントリ自身の制約として`alternativeMenuKcal <= typicalMenuKcal`を満たす。 */
  alternativeMenuName: string;
  /** `alternativeMenuName`のおおよそのカロリー（kcal、常に正）。 */
  alternativeMenuKcal: number;
  /** `alternativeMenuName`の代表的なたんぱく質量（g、常に正）。出典はエントリごとのコメントを参照。 */
  alternativeMenuProteinG: number;
  /** 対象の食事枠`mealType`（`@nutrition/shared`の`MealTypeSchema`が定義する4値のいずれか）。 */
  mealType: MealType;
  /**
   * typical・alternative双方の主要食材を統合したタグ配列（NG食材除外用、要件15.4）。
   * 設計判断の詳細はファイル冒頭コメントを参照。
   */
  ingredientTags: readonly string[];
  /** 外食シーンの分類ラベル（selection ロジックには不使用、ファイル冒頭コメント参照）。 */
  category: EatingOutCategory;
}

/**
 * キュレーション済みの外食メニュー参照データ本体（37件）。
 *
 * `mealType`別の内訳（要件がbreakfast/snackの候補も要求するため、lunch/dinnerに偏らせない
 * ようにした。詳細は本ファイルの`.data.test.ts`が実データに対して検証する）:
 *   lunch: 11件 / dinner: 10件 / breakfast: 8件 / snack: 8件
 * `category`別の内訳:
 *   丼もの: 7件 / 定食: 3件 / 麺類: 5件 / ファストフード: 7件 / カレー: 2件 / その他: 13件
 */
export const EATING_OUT_REFERENCE_DATA: readonly EatingOutReferenceEntry[] = [
  // ============================================================
  // 丼もの
  // ============================================================
  {
    // 出典(typical): 吉野家公式栄養成分表（2026年7月時点の公式発表値。吉野家公式サイト
    // 「メニュー別・栄養成分・アレルギー物質一覧」PDF）633kcal・たんぱく質19.6g。
    // 出典(alternative): やよい軒公式メニュー情報「銀鮭の塩焼定食」499kcal・たんぱく質30.0g。
    typicalMenuName: "牛丼（並盛）",
    typicalMenuKcal: 633,
    typicalMenuProteinG: 19.6,
    alternativeMenuName: "銀鮭の塩焼定食",
    alternativeMenuKcal: 499,
    alternativeMenuProteinG: 30.0,
    mealType: "lunch",
    ingredientTags: ["牛肉", "玉ねぎ", "鮭"],
    category: "丼もの",
  },
  {
    // 出典(typical): 松屋フーズ公式サイト「牛めし」商品ページ 687kcal・たんぱく質17.1g
    // （店内飲食時の味噌汁込みの値）。
    // 出典(alternative): 丸亀製麺の公式データに基づく「釜玉うどん（並）」381kcal・たんぱく質16.1g。
    typicalMenuName: "牛めし（並盛）",
    typicalMenuKcal: 687,
    typicalMenuProteinG: 17.1,
    alternativeMenuName: "釜玉うどん（並）",
    alternativeMenuKcal: 381,
    alternativeMenuProteinG: 16.1,
    mealType: "lunch",
    ingredientTags: ["牛肉", "玉ねぎ", "うどん", "卵"],
    category: "丼もの",
  },
  {
    // 出典(typical): 特定チェーンの実測値ではなく、とんかつを乗せた卵とじ丼という料理タイプの
    // 一般的な目安（850kcal・たんぱく質32.0g）。カツ丼は複数の情報源で850-900kcal程度、
    // たんぱく質30g前後とされることが多い代表的な高カロリー丼。
    // 出典(alternative): やよい軒公式「銀鮭の塩焼定食」499kcal・たんぱく質30.0g（上記と同じ出典）。
    typicalMenuName: "カツ丼（並盛）",
    typicalMenuKcal: 850,
    typicalMenuProteinG: 32.0,
    alternativeMenuName: "銀鮭の塩焼定食",
    alternativeMenuKcal: 499,
    alternativeMenuProteinG: 30.0,
    mealType: "lunch",
    ingredientTags: ["豚肉", "卵", "鮭"],
    category: "丼もの",
  },
  {
    // 出典(typical): 特定チェーンの実測値ではなく、天ぷら（えび2-3本程度）を乗せた丼という
    // 料理タイプの一般的な目安（750kcal・たんぱく質20.0g）。天丼てんやのように小ぶりな
    // チェーン専門店（平均498kcal）よりボリュームのある、一般的な食堂・外食での天丼を想定。
    // 出典(alternative): 丸亀製麺公式データ「かけうどん（並）」299kcal・たんぱく質9.5g。
    typicalMenuName: "天丼（並盛）",
    typicalMenuKcal: 750,
    typicalMenuProteinG: 20.0,
    alternativeMenuName: "かけうどん（並）",
    alternativeMenuKcal: 299,
    alternativeMenuProteinG: 9.5,
    mealType: "lunch",
    ingredientTags: ["えび", "うどん"],
    category: "丼もの",
  },
  {
    // 出典(typical): 松屋フーズ公式サイト「牛めし」687kcal・たんぱく質17.1g（上記と同じ出典。
    // 夕食シーンでも同じメニューが選ばれる想定で別途エントリ化）。
    // 出典(alternative): やよい軒公式「銀鮭の塩焼定食」499kcal・たんぱく質30.0g。
    typicalMenuName: "牛めし（並盛）",
    typicalMenuKcal: 687,
    typicalMenuProteinG: 17.1,
    alternativeMenuName: "銀鮭の塩焼定食",
    alternativeMenuKcal: 499,
    alternativeMenuProteinG: 30.0,
    mealType: "dinner",
    ingredientTags: ["牛肉", "玉ねぎ", "鮭"],
    category: "丼もの",
  },
  {
    // 出典(typical): 特定チェーンの実測値ではなく、鶏肉と卵の親子丼という料理タイプの一般的な
    // 目安（650kcal・たんぱく質28.0g）。検索した複数の情報源間で親子丼のカロリー・たんぱく質量
    // に食い違いが見られたため（同一チェーンでも611kcal/27.0gと623kcal/10.0gの両方の記載が
    // 見つかった等）、特定チェーンの実測値としては採用せず一般的な目安とした。
    // 出典(alternative): 丸亀製麺公式データ「かけうどん（並）」299kcal・たんぱく質9.5g。
    typicalMenuName: "親子丼（並盛）",
    typicalMenuKcal: 650,
    typicalMenuProteinG: 28.0,
    alternativeMenuName: "かけうどん（並）",
    alternativeMenuKcal: 299,
    alternativeMenuProteinG: 9.5,
    mealType: "dinner",
    ingredientTags: ["鶏肉", "卵", "うどん"],
    category: "丼もの",
  },
  {
    // 出典(typical): 吉野家公式栄養成分表「牛丼（並盛）」633kcal・たんぱく質19.6g（上記と同じ
    // 出典。24時間営業の牛丼チェーンは朝食シーンでも定番のため朝食枠のエントリとして採用）。
    // 出典(alternative): セブンプレミアム「サラダチキン（プレーン）」の公表値（100gあたり
    // 107kcal・たんぱく質24.3gを1パック(約105g)相当に換算した目安）113kcal・たんぱく質24.9g。
    typicalMenuName: "牛丼（並盛）",
    typicalMenuKcal: 633,
    typicalMenuProteinG: 19.6,
    alternativeMenuName: "サラダチキン（プレーン）",
    alternativeMenuKcal: 113,
    alternativeMenuProteinG: 24.9,
    mealType: "breakfast",
    ingredientTags: ["牛肉", "玉ねぎ", "鶏肉"],
    category: "丼もの",
  },

  // ============================================================
  // 定食
  // ============================================================
  {
    // 出典(typical): やよい軒公式メニュー・栄養成分情報「しょうが焼定食」（もち麦ごはん普通盛）
    // 733kcal・たんぱく質26.7g。
    // 出典(alternative): やよい軒公式「銀鮭の塩焼定食」499kcal・たんぱく質30.0g。
    typicalMenuName: "しょうが焼定食",
    typicalMenuKcal: 733,
    typicalMenuProteinG: 26.7,
    alternativeMenuName: "銀鮭の塩焼定食",
    alternativeMenuKcal: 499,
    alternativeMenuProteinG: 30.0,
    mealType: "dinner",
    ingredientTags: ["豚肉", "鮭"],
    category: "定食",
  },
  {
    // 出典(typical): 特定チェーンの実測値ではなく、ハンバーグ＋ライス＋副菜という洋食定食の
    // 一般的な目安（800kcal・たんぱく質28.0g）。
    // 出典(alternative): やよい軒公式「銀鮭の塩焼定食」499kcal・たんぱく質30.0g。
    typicalMenuName: "ハンバーグ定食",
    typicalMenuKcal: 800,
    typicalMenuProteinG: 28.0,
    alternativeMenuName: "銀鮭の塩焼定食",
    alternativeMenuKcal: 499,
    alternativeMenuProteinG: 30.0,
    mealType: "dinner",
    ingredientTags: ["牛肉", "豚肉", "鮭"],
    category: "定食",
  },
  {
    // 出典(typical): 特定チェーンの実測値ではなく、揚げたてロースかつ＋ライス＋味噌汁という
    // 定食の一般的な目安（900kcal・たんぱく質30.0g）。
    // 出典(alternative): 丸亀製麺公式データ「釜玉うどん（並）」381kcal・たんぱく質16.1g。
    typicalMenuName: "とんかつ定食",
    typicalMenuKcal: 900,
    typicalMenuProteinG: 30.0,
    alternativeMenuName: "釜玉うどん（並）",
    alternativeMenuKcal: 381,
    alternativeMenuProteinG: 16.1,
    mealType: "dinner",
    ingredientTags: ["豚肉", "卵", "うどん"],
    category: "定食",
  },

  // ============================================================
  // 麺類
  // ============================================================
  {
    // 出典(typical): 特定チェーンの実測値ではなく、豚骨スープのこってり系ラーメン（麺＋スープ
    // ＋チャーシュー等）の一般的な目安（750kcal・たんぱく質28.0g）。
    // 出典(alternative): 特定チェーンの実測値ではなく、あっさり系の醤油ラーメン（中華そば）の
    // 一般的な目安（500kcal・たんぱく質22.0g）。日高屋の中華そば（636kcal、公式値）はこの
    // 目安より高カロリーだったため、より一般的なあっさり系の目安値を採用した。
    typicalMenuName: "とんこつラーメン",
    typicalMenuKcal: 750,
    typicalMenuProteinG: 28.0,
    alternativeMenuName: "醤油ラーメン（中華そば）",
    alternativeMenuKcal: 500,
    alternativeMenuProteinG: 22.0,
    mealType: "lunch",
    ingredientTags: ["豚肉", "麺"],
    category: "麺類",
  },
  {
    // 出典(typical): 特定チェーンの実測値ではなく、汁なし・油そば/まぜそば系（太麺＋肉そぼろ・
    // 味玉等のトッピング多め）の一般的な目安（850kcal・たんぱく質30.0g）。
    // 出典(alternative): 特定チェーンの実測値ではなく、ざるそば（そば＋つゆ、天ぷら等の
    // トッピングなし）の一般的な目安（350kcal・たんぱく質14.0g）。
    typicalMenuName: "まぜそば（油そば）",
    typicalMenuKcal: 850,
    typicalMenuProteinG: 30.0,
    alternativeMenuName: "ざるそば",
    alternativeMenuKcal: 350,
    alternativeMenuProteinG: 14.0,
    mealType: "lunch",
    ingredientTags: ["豚肉", "そば"],
    category: "麺類",
  },
  {
    // 出典(typical): 丸亀製麺公式データに基づく「釜玉うどん（並）」381kcal・たんぱく質16.1g。
    // 出典(alternative): 丸亀製麺公式データに基づく「かけうどん（並）」299kcal・たんぱく質9.5g。
    // どちらも丸亀製麺の同一公式データセットから転記した実在の同一チェーン内メニュー。
    typicalMenuName: "釜玉うどん（並）",
    typicalMenuKcal: 381,
    typicalMenuProteinG: 16.1,
    alternativeMenuName: "かけうどん（並）",
    alternativeMenuKcal: 299,
    alternativeMenuProteinG: 9.5,
    mealType: "lunch",
    ingredientTags: ["うどん", "卵"],
    category: "麺類",
  },
  {
    // 出典(typical): 特定チェーンの実測値ではなく、ベーコン（またはパンチェッタ）・卵・
    // チーズを使うカルボナーラの一般的な目安（800kcal・たんぱく質24.0g）。
    // 出典(alternative): 特定チェーンの実測値ではなく、きのこ・醤油ベースの和風パスタの
    // 一般的な目安（550kcal・たんぱく質16.0g）。
    typicalMenuName: "カルボナーラ",
    typicalMenuKcal: 800,
    typicalMenuProteinG: 24.0,
    alternativeMenuName: "和風きのこパスタ",
    alternativeMenuKcal: 550,
    alternativeMenuProteinG: 16.0,
    mealType: "dinner",
    ingredientTags: ["豚肉", "卵", "チーズ", "きのこ"],
    category: "麺類",
  },
  {
    // 出典(typical): 特定チェーンの実測値ではなく、味噌ベースのラーメン（バター・もやし等の
    // トッピングを含む）の一般的な目安（700kcal・たんぱく質26.0g）。
    // 出典(alternative): 特定チェーンの実測値ではなく、あっさり系の醤油ラーメン（中華そば）の
    // 一般的な目安（500kcal・たんぱく質22.0g、上記のとんこつラーメンのエントリと同じ目安値）。
    typicalMenuName: "味噌ラーメン",
    typicalMenuKcal: 700,
    typicalMenuProteinG: 26.0,
    alternativeMenuName: "醤油ラーメン（中華そば）",
    alternativeMenuKcal: 500,
    alternativeMenuProteinG: 22.0,
    mealType: "dinner",
    ingredientTags: ["豚肉", "麺"],
    category: "麺類",
  },

  // ============================================================
  // ファストフード
  // ============================================================
  {
    // 出典(typical): マクドナルド公式サイト「栄養成分一覧表」（2026年9月時点確認）
    // 「ビッグマック」524kcal・たんぱく質26.1g。
    // 出典(alternative): 同上「フィレオフィッシュ」338kcal・たんぱく質15.1g。
    typicalMenuName: "ビッグマック",
    typicalMenuKcal: 524,
    typicalMenuProteinG: 26.1,
    alternativeMenuName: "フィレオフィッシュ",
    alternativeMenuKcal: 338,
    alternativeMenuProteinG: 15.1,
    mealType: "lunch",
    ingredientTags: ["牛肉", "魚"],
    category: "ファストフード",
  },
  {
    // 出典(typical): マクドナルド公式サイト「栄養成分一覧表」「てりやきマックバーガー」
    // 485kcal・たんぱく質14.2g。
    // 出典(alternative): 同上「チーズバーガー」310kcal・たんぱく質15.9g。
    typicalMenuName: "てりやきマックバーガー",
    typicalMenuKcal: 485,
    typicalMenuProteinG: 14.2,
    alternativeMenuName: "チーズバーガー",
    alternativeMenuKcal: 310,
    alternativeMenuProteinG: 15.9,
    mealType: "lunch",
    ingredientTags: ["豚肉", "牛肉", "チーズ"],
    category: "ファストフード",
  },
  {
    // 出典(typical): マクドナルド公式サイト「栄養成分一覧表」「マックチキン」386kcal・
    // たんぱく質13.5g。
    // 出典(alternative): ケンタッキーフライドチキン公式栄養成分表（2025年11月時点確認）
    // 「オリジナルチキン」（1ピース、87g）218kcal・たんぱく質16.5g。
    typicalMenuName: "マックチキン",
    typicalMenuKcal: 386,
    typicalMenuProteinG: 13.5,
    alternativeMenuName: "オリジナルチキン（1ピース）",
    alternativeMenuKcal: 218,
    alternativeMenuProteinG: 16.5,
    mealType: "lunch",
    ingredientTags: ["鶏肉"],
    category: "ファストフード",
  },
  {
    // 出典(typical): マクドナルド公式サイト「栄養成分一覧表」「ビッグマック」524kcal・
    // たんぱく質26.1g（上記と同じ出典。夕食シーンでも選ばれる想定で別途エントリ化）。
    // 出典(alternative): 同上「ハンバーガー」259kcal・たんぱく質13.0g。
    typicalMenuName: "ビッグマック",
    typicalMenuKcal: 524,
    typicalMenuProteinG: 26.1,
    alternativeMenuName: "ハンバーガー",
    alternativeMenuKcal: 259,
    alternativeMenuProteinG: 13.0,
    mealType: "dinner",
    ingredientTags: ["牛肉"],
    category: "ファストフード",
  },
  {
    // 出典(typical): マクドナルド公式サイト「栄養成分一覧表」「ソーセージマフィン」397kcal・
    // たんぱく質15.5g（朝食限定メニュー）。
    // 出典(alternative): 同上「エッグマックマフィン」310kcal・たんぱく質18.6g（朝食限定メニュー）。
    typicalMenuName: "ソーセージマフィン",
    typicalMenuKcal: 397,
    typicalMenuProteinG: 15.5,
    alternativeMenuName: "エッグマックマフィン",
    alternativeMenuKcal: 310,
    alternativeMenuProteinG: 18.6,
    mealType: "breakfast",
    ingredientTags: ["豚肉", "卵", "チーズ"],
    category: "ファストフード",
  },
  {
    // 出典(typical): マクドナルド公式サイト「栄養成分一覧表」「ハッシュポテト」157kcal・
    // たんぱく質1.4g（朝食限定メニュー）。
    // 出典(alternative): 同上「サイドサラダ」10kcal・たんぱく質0.5g。
    typicalMenuName: "ハッシュポテト",
    typicalMenuKcal: 157,
    typicalMenuProteinG: 1.4,
    alternativeMenuName: "サイドサラダ",
    alternativeMenuKcal: 10,
    alternativeMenuProteinG: 0.5,
    mealType: "breakfast",
    ingredientTags: ["じゃがいも", "野菜"],
    category: "ファストフード",
  },
  {
    // 出典(typical): マクドナルド公式サイト「栄養成分一覧表」「マックフライポテト（S）」
    // 225kcal・たんぱく質3.0g（間食・サイドメニューとしての利用を想定）。
    // 出典(alternative): 同上「サイドサラダ」10kcal・たんぱく質0.5g。
    typicalMenuName: "マックフライポテト（S）",
    typicalMenuKcal: 225,
    typicalMenuProteinG: 3.0,
    alternativeMenuName: "サイドサラダ",
    alternativeMenuKcal: 10,
    alternativeMenuProteinG: 0.5,
    mealType: "snack",
    ingredientTags: ["じゃがいも", "野菜"],
    category: "ファストフード",
  },

  // ============================================================
  // カレー
  // ============================================================
  {
    // 出典(typical): カレーハウスCoCo壱番屋公式栄養成分情報（2026年9月1日時点の公式PDF
    // 「ココイチ 栄養成分情報」に基づく公式発表値）「ポークカレー（普通盛）」701kcal・
    // たんぱく質11.0g。
    // 出典(alternative): やよい軒公式「銀鮭の塩焼定食」499kcal・たんぱく質30.0g。
    typicalMenuName: "ポークカレー（普通盛）",
    typicalMenuKcal: 701,
    typicalMenuProteinG: 11.0,
    alternativeMenuName: "銀鮭の塩焼定食",
    alternativeMenuKcal: 499,
    alternativeMenuProteinG: 30.0,
    mealType: "lunch",
    ingredientTags: ["豚肉", "鮭"],
    category: "カレー",
  },
  {
    // 出典(typical): カレーハウスCoCo壱番屋公式栄養成分情報「ポークカレー（普通盛）」
    // 701kcal・たんぱく質11.0g（上記と同じ出典。夕食シーンでも選ばれる想定で別途エントリ化）。
    // 出典(alternative): マクドナルド公式サイト「栄養成分一覧表」「フィレオフィッシュ」
    // 338kcal・たんぱく質15.1g。
    typicalMenuName: "ポークカレー（普通盛）",
    typicalMenuKcal: 701,
    typicalMenuProteinG: 11.0,
    alternativeMenuName: "フィレオフィッシュ",
    alternativeMenuKcal: 338,
    alternativeMenuProteinG: 15.1,
    mealType: "dinner",
    ingredientTags: ["豚肉", "魚"],
    category: "カレー",
  },

  // ============================================================
  // その他（洋食・コンビニ・カフェ・スイーツ・スナック）
  // ============================================================
  {
    // 出典(typical): 特定チェーンの実測値ではなく、鶏肉・卵・ケチャップライスのオムライスの
    // 一般的な目安（750kcal・たんぱく質18.0g）。
    // 出典(alternative): やよい軒公式「銀鮭の塩焼定食」499kcal・たんぱく質30.0g。
    typicalMenuName: "オムライス",
    typicalMenuKcal: 750,
    typicalMenuProteinG: 18.0,
    alternativeMenuName: "銀鮭の塩焼定食",
    alternativeMenuKcal: 499,
    alternativeMenuProteinG: 30.0,
    mealType: "dinner",
    ingredientTags: ["卵", "鶏肉", "鮭"],
    category: "その他",
  },
  {
    // 出典(typical): 特定チェーンの実測値ではなく、コンビニで売られている菓子パン
    // （メロンパン）の一般的な目安（420kcal・たんぱく質8.0g）。
    // 出典(alternative): セブンイレブンの実在商品「紅鮭切り身おにぎり」の掲載値
    // 184kcal・たんぱく質5.9g。
    typicalMenuName: "メロンパン",
    typicalMenuKcal: 420,
    typicalMenuProteinG: 8.0,
    alternativeMenuName: "鮭おにぎり",
    alternativeMenuKcal: 184,
    alternativeMenuProteinG: 5.9,
    mealType: "breakfast",
    ingredientTags: ["小麦", "鮭"],
    category: "その他",
  },
  {
    // 出典(typical): セブンイレブンの実在商品「ハムカツサンド」の掲載値369kcal・
    // たんぱく質9.3g。
    // 出典(alternative): セブンイレブンの実在商品「紅鮭切り身おにぎり」の掲載値184kcal・
    // たんぱく質5.9g（上記と同じ出典）。
    typicalMenuName: "ハムカツサンド",
    typicalMenuKcal: 369,
    typicalMenuProteinG: 9.3,
    alternativeMenuName: "鮭おにぎり",
    alternativeMenuKcal: 184,
    alternativeMenuProteinG: 5.9,
    mealType: "breakfast",
    ingredientTags: ["豚肉", "鮭"],
    category: "その他",
  },
  {
    // 出典(typical): 特定チェーンの実測値ではなく、卵・ハム・チーズを挟んだボリュームのある
    // サンドイッチの一般的な目安（450kcal・たんぱく質15.0g）。
    // 出典(alternative): セブンイレブンの実在商品「紅鮭切り身おにぎり」の掲載値184kcal・
    // たんぱく質5.9g。
    typicalMenuName: "たまごハムチーズサンド",
    typicalMenuKcal: 450,
    typicalMenuProteinG: 15.0,
    alternativeMenuName: "鮭おにぎり",
    alternativeMenuKcal: 184,
    alternativeMenuProteinG: 5.9,
    mealType: "breakfast",
    ingredientTags: ["卵", "豚肉", "チーズ", "鮭"],
    category: "その他",
  },
  {
    // 出典(typical): セブンイレブンの実在商品「ハムカツサンド」の掲載値369kcal・
    // たんぱく質9.3g（上記と同じ出典）。
    // 出典(alternative): セブンプレミアム「サラダチキン（プレーン）」の公表値
    // （100gあたり107kcal・たんぱく質24.3gを1パック(約105g)相当に換算した目安）
    // 113kcal・たんぱく質24.9g。
    typicalMenuName: "ハムカツサンド",
    typicalMenuKcal: 369,
    typicalMenuProteinG: 9.3,
    alternativeMenuName: "サラダチキン（プレーン）",
    alternativeMenuKcal: 113,
    alternativeMenuProteinG: 24.9,
    mealType: "breakfast",
    ingredientTags: ["豚肉", "鶏肉"],
    category: "その他",
  },
  {
    // 出典(typical): 特定チェーンの実測値ではなく、バターを使ったクロワッサン1個の
    // 一般的な目安（300kcal・たんぱく質6.0g）。
    // 出典(alternative): 特定チェーンの実測値ではなく、ゆで卵1個の一般的な目安
    // （80kcal・たんぱく質7.0g、広く知られる鶏卵1個の栄養価に基づく）。
    typicalMenuName: "クロワッサン",
    typicalMenuKcal: 300,
    typicalMenuProteinG: 6.0,
    alternativeMenuName: "ゆで卵",
    alternativeMenuKcal: 80,
    alternativeMenuProteinG: 7.0,
    mealType: "breakfast",
    ingredientTags: ["小麦", "卵"],
    category: "その他",
  },
  {
    // 出典(typical): ミスタードーナツ公式発表値（2026年7月時点確認）「ポン・デ・リング」
    // 219kcal・たんぱく質1.2g。
    // 出典(alternative): セブンプレミアム「サラダチキン（プレーン）」の公表値
    // （100gあたり107kcal・たんぱく質24.3gを1パック(約105g)相当に換算した目安）
    // 113kcal・たんぱく質24.9g。
    typicalMenuName: "ポン・デ・リング",
    typicalMenuKcal: 219,
    typicalMenuProteinG: 1.2,
    alternativeMenuName: "サラダチキン（プレーン）",
    alternativeMenuKcal: 113,
    alternativeMenuProteinG: 24.9,
    mealType: "snack",
    ingredientTags: ["小麦", "鶏肉"],
    category: "その他",
  },
  {
    // 出典(typical): 特定チェーンの実測値ではなく、カフェで提供される標準的なショートケーキ
    // 1切れの一般的な目安（350kcal・たんぱく質5.0g）。
    // 出典(alternative): 特定チェーンの実測値ではなく、無糖ヨーグルト1カップの一般的な目安
    // （90kcal・たんぱく質8.0g）。
    typicalMenuName: "ショートケーキ",
    typicalMenuKcal: 350,
    typicalMenuProteinG: 5.0,
    alternativeMenuName: "無糖ヨーグルト",
    alternativeMenuKcal: 90,
    alternativeMenuProteinG: 8.0,
    mealType: "snack",
    ingredientTags: ["乳", "卵", "小麦"],
    category: "その他",
  },
  {
    // 出典(typical): 特定チェーンの実測値ではなく、和菓子の大福1個の一般的な目安
    // （220kcal・たんぱく質4.0g）。
    // 出典(alternative): 特定チェーンの実測値ではなく、ゆで卵1個の一般的な目安
    // （80kcal・たんぱく質7.0g、上記と同じ目安値）。
    typicalMenuName: "大福",
    typicalMenuKcal: 220,
    typicalMenuProteinG: 4.0,
    alternativeMenuName: "ゆで卵",
    alternativeMenuKcal: 80,
    alternativeMenuProteinG: 7.0,
    mealType: "snack",
    ingredientTags: ["もち米", "卵"],
    category: "その他",
  },
  {
    // 出典(typical): 特定チェーンの実測値ではなく、コンビニで売られているプリン1個の
    // 一般的な目安（180kcal・たんぱく質5.0g）。
    // 出典(alternative): 特定チェーンの実測値ではなく、無糖ヨーグルト1カップの一般的な目安
    // （90kcal・たんぱく質8.0g、上記と同じ目安値）。
    typicalMenuName: "プリン",
    typicalMenuKcal: 180,
    typicalMenuProteinG: 5.0,
    alternativeMenuName: "無糖ヨーグルト",
    alternativeMenuKcal: 90,
    alternativeMenuProteinG: 8.0,
    mealType: "snack",
    ingredientTags: ["卵", "乳"],
    category: "その他",
  },
  {
    // 出典(typical): 特定チェーンの実測値ではなく、ポテトチップス1袋（60g程度）の
    // 一般的な目安（330kcal・たんぱく質3.0g）。
    // 出典(alternative): 特定チェーンの実測値ではなく、素焼きミックスナッツ小袋（25g程度）の
    // 一般的な目安（150kcal・たんぱく質5.0g）。
    typicalMenuName: "ポテトチップス（1袋）",
    typicalMenuKcal: 330,
    typicalMenuProteinG: 3.0,
    alternativeMenuName: "素焼きミックスナッツ（小袋）",
    alternativeMenuKcal: 150,
    alternativeMenuProteinG: 5.0,
    mealType: "snack",
    ingredientTags: ["じゃがいも", "ナッツ"],
    category: "その他",
  },
  {
    // 出典(typical): 特定チェーンの実測値ではなく、コンビニで売られている菓子パン
    // （メロンパン）の一般的な目安（420kcal・たんぱく質8.0g、上記の朝食エントリと同じ目安値。
    // 間食として食べるシーンを想定して別途エントリ化）。
    // 出典(alternative): セブンプレミアム「サラダチキン（プレーン）」113kcal・
    // たんぱく質24.9g（上記と同じ出典）。
    typicalMenuName: "メロンパン",
    typicalMenuKcal: 420,
    typicalMenuProteinG: 8.0,
    alternativeMenuName: "サラダチキン（プレーン）",
    alternativeMenuKcal: 113,
    alternativeMenuProteinG: 24.9,
    mealType: "snack",
    ingredientTags: ["小麦", "鶏肉"],
    category: "その他",
  },
  {
    // 出典(typical): ミスタードーナツ公式発表値「ポン・デ・リング」219kcal・たんぱく質1.2g
    // （上記と同じ出典）。
    // 出典(alternative): 特定チェーンの実測値ではなく、ゆで卵1個の一般的な目安
    // （80kcal・たんぱく質7.0g、上記と同じ目安値）。
    typicalMenuName: "ポン・デ・リング",
    typicalMenuKcal: 219,
    typicalMenuProteinG: 1.2,
    alternativeMenuName: "ゆで卵",
    alternativeMenuKcal: 80,
    alternativeMenuProteinG: 7.0,
    mealType: "snack",
    ingredientTags: ["小麦", "卵"],
    category: "その他",
  },
];
