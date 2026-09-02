/**
 * menu-generation の Claude API連携基盤設定モジュール。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #ClaudeMenuClient「Responsibilities &
 * Constraints」）に記載された既定モデルID・週間/日単位生成およびレシピ詳細生成それぞれの
 * thinking/effort設定を名前付き定数として集約する。`ClaudeMenuClient`（task 6.1/6.2で実装予定）は
 * このモジュールが定義する定数のみを参照し、`client.messages.create` 呼び出しにマジックバリューを
 * 直接埋め込まない。
 *
 * 命名方針: `thinking`（`Anthropic.MessageCreateParams["thinking"]` に渡す形状）と
 * `effort`（`output_config.effort` に渡す値）を用途別（週間/日単位生成・レシピ詳細生成）に
 * 個別の定数として分離する。1つの `messages.create` 呼び出しは常にどちらか一方の用途に属し、
 * 呼び出し側は該当する2定数を組み合わせて渡す（例:
 * `client.messages.create({ model: DEFAULT_MODEL_ID, thinking: WEEKLY_DAILY_GENERATION_THINKING,
 * output_config: { effort: WEEKLY_DAILY_GENERATION_EFFORT }, ... })`）。
 */

/**
 * Claude Messages APIの既定モデルID。設定値として外部化されており、将来のモデル移行時は
 * この1箇所のみを変更すればよい（design.md #ClaudeMenuClient）。
 */
export const DEFAULT_MODEL_ID = "claude-sonnet-5" as const;

/**
 * 週間献立生成・日単位献立生成のthinking設定。
 * Claude Sonnet 5では `{type: "adaptive"}` がthinkingを有効化する唯一のモードである。
 */
export const WEEKLY_DAILY_GENERATION_THINKING = { type: "adaptive" } as const;

/** 週間献立生成・日単位献立生成の `output_config.effort` 設定。 */
export const WEEKLY_DAILY_GENERATION_EFFORT = "medium" as const;

/**
 * レシピ詳細生成（および同一生成要求内の補助的な副菜提案）のthinking設定。
 * `{type: "disabled"}` はClaude Sonnet 5では明示的に許容される（モデルによってはeffortとの
 * 組み合わせで拒否されるが、Sonnet 5はeffortの値によらず受理する）。
 */
export const RECIPE_GENERATION_THINKING = { type: "disabled" } as const;

/** レシピ詳細生成の `output_config.effort` 設定。 */
export const RECIPE_GENERATION_EFFORT = "low" as const;

/**
 * 分量単位正規化テーブル（`UnitConversionService`、design.md参照）が対象とする既知の単位コード
 * 一覧。献立生成・レシピ生成のtool定義における `unit` プロパティの `enum` 制約（Requirement 3.2,
 * 3.4）に用いる。
 *
 * ⚠️ 暫定値（PROVISIONAL LIST）⚠️
 * design.md・research.mdのいずれも単位コードの網羅的な一覧を定義していない。ここではRequirement
 * 5.1が明示する最低限のセット（`g`・`個`・`大さじ`・`小さじ`）に加え、一般的な日本の調理・買い物の
 * 現場でよく使われる単位（`ml`・`cc`・`枚`・`本`・`缶`・`袋`・`束`・`パック`）を実装者の判断で追加した
 * 妥当なセットを暫定的に採用する。
 *
 * **task 2.2（分量単位単位正規化テーブルへのデータ投入、未着手）はこの一覧と完全に一致する単位コード
 * について `unit_conversions` テーブルへ食品固有および/または汎用の換算エントリを投入しなければ
 * ならない。** ここで宣言した単位コードのいずれかについてDB側に対応する換算エントリが存在しない場合、
 * tool schema（task 6.1で構築予定）の `enum` はClaudeに当該単位の選択を許可するにもかかわらず、
 * 実行時の `UnitConversionService.toGrams` が食材固有・汎用いずれの換算エントリも見つけられず
 * Requirement 5.4により生成全体が失敗する、という潜在的な不整合を生む。両者（このリストとtask 2.2の
 * 投入データ）は同一の単位コード集合を指すべきであり、どちらかを変更する際はもう一方への影響を
 * 必ず確認すること。
 */
export const KNOWN_UNIT_CODES = [
  "g",
  "個",
  "大さじ",
  "小さじ",
  "ml",
  "cc",
  "枚",
  "本",
  "缶",
  "袋",
  "束",
  "パック",
  // task 2.1（`010_seed_food_items.sql`）が実データとして `food_items.display_unit_code` に
  // 割り当てた単位コードのうち、上記の暫定リストに含まれていなかった2件を追加する。
  // `玉`: キャベツ(06061)・はくさい(06233)・レタス(06312)・うどん(01038/01039)・
  //       中華めん(01047/01048/01049)・そば(01127/01128) 等12品目
  // `丁`: 木綿豆腐(04032)・絹ごし豆腐(04033)・焼き豆腐(04038) の3品目
  // いずれも実在の食品に紐づく解決可能な単位であり、task 2.2（`011_seed_unit_conversions.sql`）
  // で両単位コードについて食材固有エントリを投入済みのため、既知の単位コード一覧に含める。
  // （個々の食品ごとの投入状況は同マイグレーションの
  //   【意図的に投入を見送った組み合わせ】を参照）
  "玉",
  "丁",
] as const;
