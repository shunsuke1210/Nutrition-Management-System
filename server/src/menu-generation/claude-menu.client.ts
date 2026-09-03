/**
 * ClaudeMenuClient — Anthropic Claude Messages API向けtool定義の構築ロジック。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #ClaudeMenuClient）が求める
 * 週間生成・日単位生成・レシピ詳細生成の3つのtoolについて、`strict: true` かつ
 * `additionalProperties: false` のJSON Schemaを構築する（Requirement 3.1, 3.2, 3.4）。
 *
 * ## 本モジュールのスコープ（task 6.1 / task 6.2）
 * 前半のセクション（tool定義の構築）は **tool定義（プレーンなデータ）の構築のみ** を担う
 * 純粋関数群であり、`@anthropic-ai/sdk` のランタイムコードに依存しない（task 6.1）。
 * ファイル後半の `createClaudeMenuClient` セクションが、`generateWeek` / `generateDay` /
 * `generateRecipe` による実際のAPI呼び出し、`tool_choice` の固定、`cache_control` の適用、
 * モデル・thinking・effortの適用、`stop_reason` の分岐、`tool_use.input` の実行時Zod再検証を
 * 担う（task 6.2）。`@anthropic-ai/sdk` のimportはそのセクションでのみ行う。
 *
 * ## 純粋関数であることについて
 * JSON Schemaの構築は「食品ID一覧」と「単位コード一覧」という2つのプレーンな配列のみに
 * 依存し、注入すべき外部依存を持たない。したがって `nutrition-engine` の各calculator
 * （`server/src/nutrition/pfc.calculator.ts` 等）が確立した「副作用のない純粋関数を
 * モジュールから直接exportし、ファクトリ/DIラッパーを設けない」規約に倣う。
 *
 * 食品ID一覧は `FoodCompositionRepository.listAllIds()`（`food-composition.repository.ts`）
 * から取得されるが、本モジュールはリポジトリのインスタンスを受け取らず `readonly string[]`
 * を受け取る。`listAllIds()` を実際に呼び出して結果を渡すのは呼び出し元（task 6.2 の
 * `ClaudeMenuClient` 本体）の責務である。これにより本モジュールはDB・SDKのいずれにも依存せず、
 * 任意の食品ID一覧に対して単体でテスト可能になる。
 *
 * ## プロパティ命名について（snake_case と camelCase の混在）
 * 食材選択ノードのプロパティのみ `food_id` / `quantity` / `unit` というsnake_caseを用いる。
 * これは design.md #ClaudeMenuClient が「食材選択プロパティ（`food_id`）」と明示し、
 * Requirement 3.1・3.2 も同じ名前を用いているためである。一方それ以外のプロパティ
 * （`dayIndex` / `mealType` / `dishName` / `ingredients` / `servings` /
 * `cookingTimeMinutes` / `steps` / `supplementarySuggestions`）は design.md の
 * `WeeklyGenerationToolResult` / `DailyGenerationToolResult` / `RecipeGenerationToolResult`
 * の宣言どおりcamelCaseである。
 *
 * **task 6.2 への注意**: `tool_use.input` を `@nutrition/shared` の
 * `IngredientSelectionSchema`（`{foodId, quantity, unit}`）へ変換する際、
 * `food_id` → `foodId` のキー変換が必要である（他のプロパティは変換不要）。
 *
 * ## strict tool useがサポートするJSON Schemaサブセットについて
 * Anthropicのstrict tool useは、宣言したJSON Schemaを文法（grammar）へコンパイルして
 * サンプリングを制約する方式であり、サポートするキーワードが標準JSON Schemaの一部に
 * 限られる。サポート外のキーワードを含めるとリクエストは **400エラーで失敗する**。
 * 本モジュールの設計に影響する制限は以下のとおり（Anthropic公式ドキュメント
 * "Structured outputs — JSON Schema limitations" の記載に基づく）:
 *
 * - 数値制約（`minimum` / `maximum` / `multipleOf`、および `exclusiveMinimum` /
 *   `exclusiveMaximum`）は **サポートされない**
 * - 配列制約は `minItems` の値 0 または 1 のみサポートされ、それ以外の `minItems` および
 *   `maxItems` は **サポートされない**
 * - 文字列制約（`minLength` / `maxLength`）も **サポートされない**
 * - `additionalProperties` は `false` 以外を設定できない
 * - `enum` / `required` / `additionalProperties: false` / 文字列 `format` はサポートされる
 *
 * この制限のため、以下のように制約を表現する:
 *
 * 1. **閉じた有限の値域はサポートされる `enum` で厳密に強制する。**
 *    `dayIndex`（0〜6）は `enum: [0,1,2,3,4,5,6]` として宣言し、文法レベルで強制する
 *    （Anthropic公式ドキュメントが `minimum`/`maximum` の代替として示している方式）。
 *    `food_id` / `unit` / `mealType` も同様に `enum` で強制される。
 * 2. **上限のない正値制約・配列件数は `description` で伝え、実行時に再検証する。**
 *    `quantity > 0`（Requirement 3.2）、`servings >= 1`、`cookingTimeMinutes >= 1`、
 *    `days` 7件・`meals` 4件（design.md Invariants）、`supplementarySuggestions` の上限2件は
 *    スキーマキーワードとして宣言できないため、各 `description` に明記してモデルへ伝える
 *    （これはAnthropicの各SDKがサポート外制約をdescriptionへ移送する挙動と同じ方針である）。
 *    権威ある強制点は design.md Implementation Notes が定める **task 6.2 の実行時Zod再検証**
 *    （`@nutrition/shared` の `IngredientSelectionSchema` / `RecipeDetailSchema` 等）であり、
 *    要求どおりでない場合は `schema_validation_failed` として扱われる。
 *
 * ⚠️ **将来の変更時の注意**: 本ファイルのスキーマへ `minimum` / `maximum` /
 * `exclusiveMinimum` / `maxItems` / `minLength` / `pattern` 等を「制約を強めるつもりで」
 * 追加してはならない。追加すると生成リクエスト全体が400で失敗する。
 * `ClaudeToolArraySchema.minItems` の型が `0 | 1` に絞られているのはこの事故を
 * コンパイル時に防ぐためであり、テスト（`claude-menu.client.test.ts`）も
 * サポート外キーワードの混入をスキーマツリー全体に対して機械的に検証している。
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  IngredientSelectionSchema,
  MealTypeSchema,
  type IngredientSelection,
  type MealType,
} from "@nutrition/shared";
import type { Result } from "../shared/result.js";
import {
  DEFAULT_MODEL_ID,
  KNOWN_UNIT_CODES,
  RECIPE_GENERATION_EFFORT,
  RECIPE_GENERATION_THINKING,
  WEEKLY_DAILY_GENERATION_EFFORT,
  WEEKLY_DAILY_GENERATION_THINKING,
} from "./constants.js";
import type { FoodCompositionRepository } from "./food-composition.repository.js";

// --- tool定義の型 ---

/**
 * strict tool useのJSON Schemaにおける object ノード。
 *
 * `required` と `additionalProperties: false` を **省略不可** としているのは、
 * strict tool useがすべてのネストレベルの object に両者を要求するためである
 * （片方でも欠けると `strict: true` は意図どおり機能しない）。型レベルで省略を禁止する
 * ことで、ネストの一階層だけ付け忘れるという典型的な事故を防ぐ。
 */
export interface ClaudeToolObjectSchema {
  type: "object";
  description?: string;
  properties: Record<string, ClaudeToolSchemaNode>;
  required: string[];
  additionalProperties: false;
}

/**
 * strict tool useのJSON Schemaにおける array ノード。
 *
 * `minItems` の型を `0 | 1` に絞っているのは、strict tool useが `minItems` の値 0 と 1
 * のみをサポートし、それ以外の値および `maxItems` を400エラーとして拒否するためである。
 * `maxItems` はそもそもフィールドとして定義しない。
 */
export interface ClaudeToolArraySchema {
  type: "array";
  description?: string;
  items: ClaudeToolSchemaNode;
  minItems?: 0 | 1;
}

/**
 * strict tool useのJSON Schemaにおけるスカラーノード。
 *
 * 数値制約・文字列制約のキーワードはサポート外のため、意図的にフィールドを定義しない
 * （値域の制約は `enum` か `description` のいずれかで表現する）。
 */
export interface ClaudeToolScalarSchema {
  type: "string" | "number" | "integer" | "boolean";
  description?: string;
  enum?: readonly string[] | readonly number[];
}

export type ClaudeToolSchemaNode =
  | ClaudeToolObjectSchema
  | ClaudeToolArraySchema
  | ClaudeToolScalarSchema;

/**
 * Anthropic Messages APIのtool定義（`tools` 配列の1要素）。
 *
 * `strict` は `name` / `description` / `input_schema` と **同じトップレベルの兄弟フィールド**
 * であり、`input_schema` の内部にネストするものではない（Anthropic公式ドキュメント
 * "Strict tool use": 「Set `"strict": true` as a top-level property in your tool definition,
 * alongside `name`, `description`, and `input_schema`.」）。
 *
 * `@anthropic-ai/sdk` の `Anthropic.Tool` 型を用いず手書きのローカル型としているのは、
 * 本モジュールがSDKのランタイムから完全に独立していることを保ちつつ、必要な形状のみを
 * 過不足なく表現するためである。本型は形状としては SDK の `Tool.input_schema` と等価だが、
 * `Tool.input_schema` が持つ `[k: string]: unknown` インデックスシグネチャを本型（`interface`）
 * は持たないため、TypeScriptの構造的部分型判定上は直接代入できない。そのため task 6.2 は
 * `client.messages.create({tools: [...]})` へ渡す際に `as unknown as Anthropic.Tool` の
 * 明示キャストを1箇所のみ用いている（詳細は `claude-menu.client.ts` の該当呼び出し箇所を参照）。
 */
export interface ClaudeToolDefinition {
  name: string;
  description: string;
  input_schema: ClaudeToolObjectSchema;
  strict: true;
}

// --- tool名（task 6.2 が `tool_choice: {type: "tool", name: ...}` で参照する） ---

/** 週間献立生成toolの名前。 */
export const WEEKLY_GENERATION_TOOL_NAME = "generate_weekly_menu";

/** 日単位献立生成toolの名前。 */
export const DAILY_GENERATION_TOOL_NAME = "generate_daily_menu";

/** レシピ詳細生成（および同一要求内の補助副菜提案）toolの名前。 */
export const RECIPE_GENERATION_TOOL_NAME = "generate_recipe_detail";

// --- 件数に関する定数（design.md Invariants / Requirement 1.1） ---

/** 1週間の日数（design.md: `WeeklyGenerationToolResult.days` は常に7件）。 */
const DAYS_PER_WEEK = 7;

/** 1日の食枠数（design.md: 各 `meals` は常に4件 = 朝食・昼食・夕食・間食）。 */
const MEALS_PER_DAY = 4;

/** 補助副菜提案の件数（design.md `RecipeGenerationToolResult`: 「1〜2件」）。 */
const MIN_SUPPLEMENTARY_SUGGESTIONS = 1;
const MAX_SUPPLEMENTARY_SUGGESTIONS = 2;

/**
 * `dayIndex` に許される値（0〜6）。design.md の `DayMenuSchema.dayIndex`
 * （`z.number().int().min(0).max(6)`）に対応する。`minimum`/`maximum` はstrict tool useで
 * サポートされないため、閉じた有限集合として `enum` で宣言し文法レベルで強制する。
 */
const DAY_INDEX_VALUES: number[] = Array.from({ length: DAYS_PER_WEEK }, (_, index) => index);

// --- 入力の事前条件 ---

/**
 * `enum` の値集合が空でないことを確認する。
 *
 * 空配列の `enum` は不正なJSON Schemaであり、そのままAPIへ送ると原因の分かりにくい400
 * エラーになる。食品ID一覧が空であることは「食品成分DBが未投入」という上流の契約違反を
 * 意味するため、静かに壊れたスキーマを返すのではなく即座に例外を投げて問題を顕在化させる
 * （`nutrition-engine` の `BmrCalculator.assertPositiveBmr` / `PfcCalculator` が確立した方針）。
 */
function assertNonEmptyEnumValues(values: readonly string[], label: string): void {
  if (values.length === 0) {
    throw new Error(
      `ClaudeMenuClient: ${label}の一覧が空です。` +
        `空の enum は不正なJSON Schemaであり、strict: true のtool定義として送信できません。` +
        `食品ID一覧は FoodCompositionRepository.listAllIds() から取得した非空の一覧を、` +
        `単位コード一覧は constants.ts の KNOWN_UNIT_CODES を渡してください。`,
    );
  }
}

// --- 共有サブスキーマ ---

/**
 * 食材選択ノードのスキーマ（Requirement 3.1, 3.2）。
 *
 * 週間生成・日単位生成の `meals[].ingredients`、レシピ生成の
 * `supplementarySuggestions[].ingredients` のすべてでこの1つの構築関数を再利用する。
 *
 * `enum` には渡された配列のコピーを埋め込む（呼び出し元が後から入力配列を変更しても
 * 構築済みのtool定義が影響を受けないようにするため）。並び順・件数は入力のまま保持し、
 * 重複排除やソートは行わない（`listAllIds()` は既に `ORDER BY food_id ASC` で
 * 決定論的な順序を返すため、ここでの再加工は不要かつ差分の原因になりうる）。
 */
function buildIngredientSchema(
  foodIds: readonly string[],
  unitCodes: readonly string[],
): ClaudeToolObjectSchema {
  return {
    type: "object",
    description: "料理に用いる食材1件の選択。食品IDと分量と単位の3点をすべて指定する。",
    properties: {
      food_id: {
        type: "string",
        description:
          "食材の食品ID。列挙された食品成分データベース収載の食品IDのいずれかでなければならず、" +
          "列挙外の食品IDや自由記述の食材名を用いてはならない。",
        enum: [...foodIds],
      },
      quantity: {
        type: "number",
        description:
          "分量の数値。0より大きい正の数値でなければならない（0や負の値は不可）。" +
          "単位は unit で指定したものとして解釈される。",
      },
      unit: {
        type: "string",
        description:
          "分量の単位コード。列挙された既知の単位コードのいずれかでなければならない。",
        enum: [...unitCodes],
      },
    },
    required: ["food_id", "quantity", "unit"],
    additionalProperties: false,
  };
}

/**
 * 1食枠（`{mealType, dishName, ingredients}`）のスキーマ。
 * design.md の `WeeklyGenerationToolResult` / `DailyGenerationToolResult` に共通する形状であり、
 * 週間生成toolと日単位生成toolの双方で同一の構築関数を再利用する。
 *
 * `mealType` の `enum` は `@nutrition/shared` の `MealTypeSchema` の値
 * （`["breakfast", "lunch", "dinner", "snack"]`）から実行時に取得する。JSON Schemaは
 * プレーンなデータであるためTypeScriptの型をそのまま使うことはできないが、Zodスキーマは
 * 列挙値を実行時データとして保持しているため、値を書き写す代わりにそれを参照することで
 * 共有スキーマとの乖離を構造的に防げる（`KNOWN_UNIT_CODES` を書き写さず参照するのと同じ方針）。
 */
function buildMealSchema(ingredientSchema: ClaudeToolObjectSchema): ClaudeToolObjectSchema {
  return {
    type: "object",
    description: "1つの食事枠に対する料理1件。",
    properties: {
      mealType: {
        type: "string",
        description: "食事種別。朝食・昼食・夕食・間食のいずれかに対応する。",
        enum: [...MealTypeSchema.options],
      },
      dishName: {
        type: "string",
        description: "料理名。日本語の具体的な料理名を1件記述する。",
      },
      ingredients: {
        type: "array",
        description: "この料理に用いる食材の一覧。各食材は食品ID・分量・単位を指定する。",
        items: ingredientSchema,
      },
    },
    required: ["mealType", "dishName", "ingredients"],
    additionalProperties: false,
  };
}

// --- 3つのtool定義の構築 ---

/**
 * 週間献立生成toolの定義を構築する（design.md `WeeklyGenerationToolResult`）。
 *
 * 形状: `{days: {dayIndex, meals: {mealType, dishName, ingredients}[]}[]}`
 *
 * @param foodIds `FoodCompositionRepository.listAllIds()` から取得した食品ID一覧。
 * @param unitCodes `unit` の `enum` に用いる単位コード一覧（既定: `KNOWN_UNIT_CODES`）。
 */
export function buildWeeklyGenerationTool(
  foodIds: readonly string[],
  unitCodes: readonly string[] = KNOWN_UNIT_CODES,
): ClaudeToolDefinition {
  assertNonEmptyEnumValues(foodIds, "食品ID");
  assertNonEmptyEnumValues(unitCodes, "単位コード");

  const mealSchema = buildMealSchema(buildIngredientSchema(foodIds, unitCodes));

  return {
    name: WEEKLY_GENERATION_TOOL_NAME,
    description:
      `1週間分（${DAYS_PER_WEEK}日 × ${MEALS_PER_DAY}食枠 = ` +
      `${DAYS_PER_WEEK * MEALS_PER_DAY}食枠）の献立を登録する。` +
      "各料理の食材は列挙された食品IDからのみ選択し、分量と単位を必ず指定する。",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        days: {
          type: "array",
          description:
            `1週間分の日別献立。必ず${DAYS_PER_WEEK}件（dayIndex 0〜${DAYS_PER_WEEK - 1}を` +
            `それぞれ1回ずつ）を含めること。${DAYS_PER_WEEK}件でない場合は生成失敗として扱われる。`,
          items: {
            type: "object",
            description: "1日分の献立。",
            properties: {
              dayIndex: {
                type: "integer",
                description: `週の開始日を0とした日インデックス（0〜${DAYS_PER_WEEK - 1}）。`,
                enum: DAY_INDEX_VALUES,
              },
              meals: {
                type: "array",
                description:
                  `その日の食事枠。必ず${MEALS_PER_DAY}件（朝食breakfast・昼食lunch・` +
                  `夕食dinner・間食snackをそれぞれ1回ずつ）を含めること。` +
                  `${MEALS_PER_DAY}件でない場合は生成失敗として扱われる。`,
                items: mealSchema,
              },
            },
            required: ["dayIndex", "meals"],
            additionalProperties: false,
          },
        },
      },
      required: ["days"],
      additionalProperties: false,
    },
  };
}

/**
 * 日単位献立生成toolの定義を構築する（design.md `DailyGenerationToolResult`）。
 *
 * 形状: `{meals: {mealType, dishName, ingredients}[]}`
 * 週間生成toolと異なり `days` / `dayIndex` のラッパーを持たない（対象日は呼び出し側が
 * プロンプトのコンテキストとして与えるため、Claudeに選択させる必要がない）。
 *
 * @param foodIds `FoodCompositionRepository.listAllIds()` から取得した食品ID一覧。
 * @param unitCodes `unit` の `enum` に用いる単位コード一覧（既定: `KNOWN_UNIT_CODES`）。
 */
export function buildDailyGenerationTool(
  foodIds: readonly string[],
  unitCodes: readonly string[] = KNOWN_UNIT_CODES,
): ClaudeToolDefinition {
  assertNonEmptyEnumValues(foodIds, "食品ID");
  assertNonEmptyEnumValues(unitCodes, "単位コード");

  const mealSchema = buildMealSchema(buildIngredientSchema(foodIds, unitCodes));

  return {
    name: DAILY_GENERATION_TOOL_NAME,
    description:
      `対象1日分（${MEALS_PER_DAY}食枠）の献立を登録する。` +
      "各料理の食材は列挙された食品IDからのみ選択し、分量と単位を必ず指定する。",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        meals: {
          type: "array",
          description:
            `対象日の食事枠。必ず${MEALS_PER_DAY}件（朝食breakfast・昼食lunch・` +
            `夕食dinner・間食snackをそれぞれ1回ずつ）を含めること。` +
            `${MEALS_PER_DAY}件でない場合は生成失敗として扱われる。`,
          items: mealSchema,
        },
      },
      required: ["meals"],
      additionalProperties: false,
    },
  };
}

/**
 * レシピ詳細生成toolの定義を構築する（design.md `RecipeGenerationToolResult`）。
 *
 * 形状: `{servings, cookingTimeMinutes, steps, supplementarySuggestions: {dishName, ingredients}[]}`
 *
 * 主菜そのものの食材はトップレベルに **含めない**。レシピ詳細は週間/日単位生成で既に確定した
 * 食材・分量に対して生成されるものであり（Requirement 8.1, 8.3: 当該食事枠の栄養価を変更しない）、
 * 確定済みの食材は呼び出し側がプロンプトのコンテキストとして与える。Claudeに新たな食材選択を
 * 求めるのは新規の補助副菜提案（Requirement 9.1, 9.2）に対してのみである。
 *
 * @param foodIds `FoodCompositionRepository.listAllIds()` から取得した食品ID一覧。
 * @param unitCodes `unit` の `enum` に用いる単位コード一覧（既定: `KNOWN_UNIT_CODES`）。
 */
export function buildRecipeGenerationTool(
  foodIds: readonly string[],
  unitCodes: readonly string[] = KNOWN_UNIT_CODES,
): ClaudeToolDefinition {
  assertNonEmptyEnumValues(foodIds, "食品ID");
  assertNonEmptyEnumValues(unitCodes, "単位コード");

  const ingredientSchema = buildIngredientSchema(foodIds, unitCodes);

  return {
    name: RECIPE_GENERATION_TOOL_NAME,
    description:
      "確定済みの料理1件に対するレシピ詳細（分量・目安調理時間・調理手順）と、" +
      `もう一品追加する場合の補助副菜提案${MIN_SUPPLEMENTARY_SUGGESTIONS}〜` +
      `${MAX_SUPPLEMENTARY_SUGGESTIONS}件を登録する。` +
      "補助副菜の食材は列挙された食品IDからのみ選択し、分量と単位を必ず指定する。",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        servings: {
          type: "integer",
          description: "何人前のレシピかを表す整数。1以上でなければならない。",
        },
        cookingTimeMinutes: {
          type: "integer",
          description: "目安の調理時間（分）を表す整数。1以上でなければならない。",
        },
        steps: {
          type: "array",
          description: "調理手順。1手順を1要素として順序どおりに並べる。",
          items: {
            type: "string",
            description: "1つの調理手順の説明。",
          },
        },
        supplementarySuggestions: {
          type: "array",
          description:
            `もう一品追加する場合の補助副菜提案。${MIN_SUPPLEMENTARY_SUGGESTIONS}件以上` +
            `${MAX_SUPPLEMENTARY_SUGGESTIONS}件以下（すなわち` +
            `${MIN_SUPPLEMENTARY_SUGGESTIONS}〜${MAX_SUPPLEMENTARY_SUGGESTIONS}件）を含めること。`,
          minItems: MIN_SUPPLEMENTARY_SUGGESTIONS,
          items: {
            type: "object",
            description: "補助副菜の提案1件。",
            properties: {
              dishName: {
                type: "string",
                description: "補助副菜の料理名。日本語の具体的な料理名を1件記述する。",
              },
              ingredients: {
                type: "array",
                description:
                  "この補助副菜に用いる食材の一覧。各食材は食品ID・分量・単位を指定する。",
                items: ingredientSchema,
              },
            },
            required: ["dishName", "ingredients"],
            additionalProperties: false,
          },
        },
      },
      required: ["servings", "cookingTimeMinutes", "steps", "supplementarySuggestions"],
      additionalProperties: false,
    },
  };
}

// =============================================================================
// ClaudeMenuClient — Anthropic Messages APIの実際の呼び出し（task 6.2）
// =============================================================================
//
// design.md #ClaudeMenuClient の Service Interface・Responsibilities & Constraints・
// Implementation Notesをそのまま実装する。上記の3つのtool定義構築関数（task 6.1）を
// 利用し、`tool_choice` で対象toolを固定して呼び出し、レスポンスを検証する。
//
// ## エラー方針（design.md 12.3, 12.4 / Requirement 1.4）
// - `client.messages.create` 自体が例外を投げた場合（ネットワーク断・4xx/5xx等）は
//   `ClaudeGenerationError(type: "request_failed")` を返す
// - 例外を投げずに応答した場合、`stop_reason === "refusal"` なら
//   `ClaudeGenerationError(type: "refusal")` を返す
// - それ以外の場合、対象toolの `tool_use` ブロックを探し、見つからない場合、または
//   見つかった `input` がZodスキーマ（件数・必須項目を含む）を満たさない場合は
//   `ClaudeGenerationError(type: "schema_validation_failed")` を返す
//
// ## `tool_use.input` の権威ある再検証について（design.md Implementation Notes）
// strict tool useは `days` が7件・各 `meals` が4件・`supplementarySuggestions` が1〜2件
// といった配列件数、および `quantity > 0` といった数値制約をJSON Schemaレベルでは
// 強制できない（本ファイル冒頭のコメント「strict tool useがサポートするJSON Schemaサブ
// セットについて」を参照）。そのため以下のZodスキーマが、design.mdが定めるこれらの
// 不変条件を実行時に権威をもって強制する唯一の場所となる。食材ノードの `food_id` /
// `quantity` / `unit` （snake_case）から `IngredientSelection`（camelCase）への変換も
// ここで行い、`quantity > 0` 等の制約は変換後に `@nutrition/shared` の
// `IngredientSelectionSchema` へ `.pipe()` して強制する（`quantity` の正の数値制約の
// 権威ある強制点は本スキーマである、という本ファイル冒頭近くのテストコメントの通り）。

/** `ClaudePromptPayload`（design.md #MenuPromptBuilder Service Interface）。 */
export interface ClaudePromptPayload {
  system: string;
  userMessage: string;
}

/** design.md #ClaudeMenuClient Service Interface。 */
export interface WeeklyGenerationToolResult {
  days: {
    dayIndex: number;
    meals: { mealType: MealType; dishName: string; ingredients: IngredientSelection[] }[];
  }[];
}

/** design.md #ClaudeMenuClient Service Interface。 */
export interface DailyGenerationToolResult {
  meals: { mealType: MealType; dishName: string; ingredients: IngredientSelection[] }[];
}

/** design.md #ClaudeMenuClient Service Interface。 */
export interface RecipeGenerationToolResult {
  servings: number;
  cookingTimeMinutes: number;
  steps: string[];
  supplementarySuggestions: { dishName: string; ingredients: IngredientSelection[] }[]; // 1〜2件
}

/** design.md #ClaudeMenuClient Service Interface。 */
export type ClaudeGenerationErrorType = "schema_validation_failed" | "refusal" | "request_failed";

/** design.md #ClaudeMenuClient Service Interface。 */
export interface ClaudeGenerationError {
  type: ClaudeGenerationErrorType;
  message: string;
}

/** design.md #ClaudeMenuClient Service Interface。 */
export interface ClaudeMenuClient {
  generateWeek(
    payload: ClaudePromptPayload
  ): Promise<Result<WeeklyGenerationToolResult, ClaudeGenerationError>>;
  generateDay(
    payload: ClaudePromptPayload
  ): Promise<Result<DailyGenerationToolResult, ClaudeGenerationError>>;
  generateRecipe(
    payload: ClaudePromptPayload
  ): Promise<Result<RecipeGenerationToolResult, ClaudeGenerationError>>;
}

/**
 * `createClaudeMenuClient` が実際に呼び出す最小のメソッド契約。
 *
 * `@anthropic-ai/sdk` の `Anthropic` クライアントは `messages.create` 以外にも
 * `models` / `files` / `skills` / `beta` 等多数のリソースを持つが、本モジュールが必要とする
 * のは `messages.create` のみである。DIの注入点をこの最小契約として定義することで、
 * テストは `new Anthropic()` を一切構築せず、`messages.create` のみを実装したフェイクに
 * 差し替えられる（`nutrition-verification.service.ts` の `UnitConversionService` 等、
 * このコードベースが必要最小限のインターフェースに対してコーディングする規約に倣う）。
 * `Anthropic` クライアントの実インスタンスは構造的にこの契約を満たす
 * （`messages.create(params, options?)` は本契約の `create(params)` として呼び出せる）。
 */
export interface AnthropicMessagesClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

// --- max_tokens（非streaming呼び出しのHTTPタイムアウトを避けつつ切り詰めを避ける値） ---
// 週間生成は28食枠（7日×4食）分のtool_use JSONを生成するため最も大きく、
// レシピ詳細生成は手順+補助副菜1〜2件のみのため最も小さい。

const WEEKLY_MAX_TOKENS = 16000;
const DAILY_MAX_TOKENS = 8000;
const RECIPE_MAX_TOKENS = 4000;

// --- tool_use.input の実行時Zod再検証スキーマ ---
// 出力の型（`z.infer`）はそのまま `WeeklyGenerationToolResult` 等（camelCase）と構造的に
// 一致する。`food_id` → `foodId` の変換は `IngredientWireSchema` の `.transform()` で行う。

const IngredientWireSchema = z
  .object({
    food_id: z.string(),
    quantity: z.number(),
    unit: z.string(),
  })
  .transform((raw) => ({ foodId: raw.food_id, quantity: raw.quantity, unit: raw.unit }))
  .pipe(IngredientSelectionSchema);

const MealWireSchema = z.object({
  mealType: MealTypeSchema,
  dishName: z.string().min(1),
  ingredients: z.array(IngredientWireSchema),
});

const DayWireSchema = z.object({
  dayIndex: z.number().int().min(0).max(DAYS_PER_WEEK - 1),
  // design.md Invariants: 各 meals は常に4件。
  meals: z.array(MealWireSchema).length(MEALS_PER_DAY),
});

const WeeklyToolInputSchema = z.object({
  // design.md Invariants: days は常に7件。
  days: z.array(DayWireSchema).length(DAYS_PER_WEEK),
});

const DailyToolInputSchema = z.object({
  meals: z.array(MealWireSchema).length(MEALS_PER_DAY),
});

const SupplementarySuggestionWireSchema = z.object({
  dishName: z.string().min(1),
  ingredients: z.array(IngredientWireSchema),
});

const RecipeToolInputSchema = z.object({
  servings: z.number().int().positive(),
  cookingTimeMinutes: z.number().int().positive(),
  steps: z.array(z.string()),
  // design.md RecipeGenerationToolResult: supplementarySuggestionsは「1〜2件」。
  supplementarySuggestions: z
    .array(SupplementarySuggestionWireSchema)
    .min(MIN_SUPPLEMENTARY_SUGGESTIONS)
    .max(MAX_SUPPLEMENTARY_SUGGESTIONS),
});

/** `error` がAnthropicのネットワーク/サーバーエラーかどうかを問わず、人が読めるメッセージへ変換する。 */
function describeRequestFailure(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    return `Claude Messages APIへのリクエストが失敗しました（status: ${String(error.status)}）: ${error.message}`;
  }
  if (error instanceof Error) {
    return `Claude Messages APIへのリクエストが失敗しました: ${error.message}`;
  }
  return `Claude Messages APIへのリクエストが失敗しました: ${String(error)}`;
}

/** `response.stop_details`（refusal時のみ非null）を人が読めるメッセージへ変換する。 */
function describeRefusal(response: Anthropic.Message): string {
  const details = response.stop_details;
  if (details && details.type === "refusal") {
    return (
      `Claudeが生成要求を拒否しました（category: ${String(details.category)}）: ` +
      `${details.explanation ?? "説明なし"}`
    );
  }
  return "Claudeが生成要求を拒否しました（stop_reason: refusal）";
}

interface InvokeGenerationToolOptions<TResult> {
  anthropicClient: AnthropicMessagesClient;
  tool: ClaudeToolDefinition;
  toolName: string;
  payload: ClaudePromptPayload;
  thinking: Anthropic.ThinkingConfigParam;
  effort: NonNullable<Anthropic.OutputConfig["effort"]>;
  maxTokens: number;
  resultSchema: z.ZodType<TResult>;
}

/**
 * `generateWeek` / `generateDay` / `generateRecipe` に共通する呼び出しロジック。
 *
 * design.md Implementation Notesの3ステップ（tool呼び出し → `stop_reason`確認 →
 * `tool_use.input`のZod再検証）を1箇所に集約し、3メソッド間の重複を避ける。
 * `tools` 配列は常に対象tool1件のみであり（`tool_choice`で固定するため他のtoolを
 * 渡す意味がない）、design.mdが求めるプロンプトキャッシュ（`cache_control`）はその
 * 1件に適用する。
 */
async function invokeGenerationTool<TResult>(
  options: InvokeGenerationToolOptions<TResult>
): Promise<Result<TResult, ClaudeGenerationError>> {
  const { anthropicClient, tool, toolName, payload, thinking, effort, maxTokens, resultSchema } = options;

  let response: Anthropic.Message;
  try {
    response = await anthropicClient.messages.create({
      model: DEFAULT_MODEL_ID,
      max_tokens: maxTokens,
      system: payload.system,
      messages: [{ role: "user", content: payload.userMessage }],
      thinking,
      output_config: { effort },
      // `ClaudeToolObjectSchema`（`ClaudeToolDefinition.input_schema` の型、task 6.1）は
      // SDKランタイムに依存しない独自の閉じた型であり、SDKの `Tool.InputSchema`
      // （`[k: string]: unknown` インデックスシグネチャ付き）へは構造的に代入できない
      // （TSは、宣言された型の値をインデックスシグネチャ付きの型へ代入する際、ソース側にも
      // 適合するインデックスシグネチャが必要という制約を課すため）。フィールド形状自体は
      // 6.1のテストが検証済みで実際にはSDKが期待する形と一致しているため、ここでのみ
      // 型アサーションで橋渡しする。
      tools: [
        { ...(tool as unknown as Anthropic.Tool), cache_control: { type: "ephemeral" } },
      ],
      tool_choice: { type: "tool", name: toolName },
    });
  } catch (error) {
    return { ok: false, error: { type: "request_failed", message: describeRequestFailure(error) } };
  }

  if (response.stop_reason === "refusal") {
    return { ok: false, error: { type: "refusal", message: describeRefusal(response) } };
  }

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === toolName
  );

  if (!toolUseBlock) {
    return {
      ok: false,
      error: {
        type: "schema_validation_failed",
        message:
          `Claudeのレスポンスにtool "${toolName}" のtool_use呼び出しが含まれていません` +
          `（stop_reason: ${String(response.stop_reason)}）`,
      },
    };
  }

  const parsed = resultSchema.safeParse(toolUseBlock.input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        type: "schema_validation_failed",
        message: `tool "${toolName}" のinputが期待するスキーマ形状を満たしません: ${parsed.error.message}`,
      },
    };
  }

  return { ok: true, value: parsed.data };
}

/**
 * `repository`（tool schema用の食品ID一覧取得）・`anthropicClient`（既に構築済みのAnthropic
 * Messages APIクライアント、またはテスト用フェイク）に対する `ClaudeMenuClient` を生成する。
 * `createNutritionVerificationService` 等、このコードベースが確立したDIファクトリ関数
 * パターンに揃えている。`anthropicClient` を省略した場合のみ `new Anthropic()`
 * （環境変数 `ANTHROPIC_API_KEY` 等から認証情報を解決する既定クライアント）を構築する。
 */
export function createClaudeMenuClient(
  repository: FoodCompositionRepository,
  anthropicClient: AnthropicMessagesClient = new Anthropic()
): ClaudeMenuClient {
  async function generateWeek(
    payload: ClaudePromptPayload
  ): Promise<Result<WeeklyGenerationToolResult, ClaudeGenerationError>> {
    const tool = buildWeeklyGenerationTool(repository.listAllIds());
    return invokeGenerationTool({
      anthropicClient,
      tool,
      toolName: WEEKLY_GENERATION_TOOL_NAME,
      payload,
      thinking: WEEKLY_DAILY_GENERATION_THINKING,
      effort: WEEKLY_DAILY_GENERATION_EFFORT,
      maxTokens: WEEKLY_MAX_TOKENS,
      resultSchema: WeeklyToolInputSchema,
    });
  }

  async function generateDay(
    payload: ClaudePromptPayload
  ): Promise<Result<DailyGenerationToolResult, ClaudeGenerationError>> {
    const tool = buildDailyGenerationTool(repository.listAllIds());
    return invokeGenerationTool({
      anthropicClient,
      tool,
      toolName: DAILY_GENERATION_TOOL_NAME,
      payload,
      thinking: WEEKLY_DAILY_GENERATION_THINKING,
      effort: WEEKLY_DAILY_GENERATION_EFFORT,
      maxTokens: DAILY_MAX_TOKENS,
      resultSchema: DailyToolInputSchema,
    });
  }

  async function generateRecipe(
    payload: ClaudePromptPayload
  ): Promise<Result<RecipeGenerationToolResult, ClaudeGenerationError>> {
    const tool = buildRecipeGenerationTool(repository.listAllIds());
    return invokeGenerationTool({
      anthropicClient,
      tool,
      toolName: RECIPE_GENERATION_TOOL_NAME,
      payload,
      thinking: RECIPE_GENERATION_THINKING,
      effort: RECIPE_GENERATION_EFFORT,
      maxTokens: RECIPE_MAX_TOKENS,
      resultSchema: RecipeToolInputSchema,
    });
  }

  return { generateWeek, generateDay, generateRecipe };
}
