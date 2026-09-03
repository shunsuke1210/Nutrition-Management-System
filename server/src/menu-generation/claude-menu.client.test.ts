import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { IngredientSelectionSchema, MealTypeSchema, type MealType } from "@nutrition/shared";
import {
  DEFAULT_MODEL_ID,
  KNOWN_UNIT_CODES,
  RECIPE_GENERATION_EFFORT,
  RECIPE_GENERATION_THINKING,
  WEEKLY_DAILY_GENERATION_EFFORT,
  WEEKLY_DAILY_GENERATION_THINKING,
} from "./constants.js";
import type { FoodCompositionRepository, FoodItemNutrition, UnitConversionEntry } from "./food-composition.repository.js";
import {
  buildDailyGenerationTool,
  buildRecipeGenerationTool,
  buildWeeklyGenerationTool,
  createClaudeMenuClient,
  DAILY_GENERATION_TOOL_NAME,
  RECIPE_GENERATION_TOOL_NAME,
  WEEKLY_GENERATION_TOOL_NAME,
  type AnthropicMessagesClient,
  type ClaudeGenerationError,
  type ClaudePromptPayload,
  type ClaudeToolDefinition,
  type ClaudeToolObjectSchema,
  type ClaudeToolSchemaNode,
  type DailyGenerationToolResult,
  type RecipeGenerationToolResult,
  type WeeklyGenerationToolResult,
} from "./claude-menu.client.js";
import type { Result } from "../shared/result.js";

/**
 * 実在するMEXT八訂の食品ID（`constants.ts` のコメントおよび `010_seed_food_items.sql` が
 * 扱う5桁コード）に倣った、意図的に複数件（14件）のサンプル。1〜2件のダミーでは
 * 切り詰め（truncate）や重複排除（dedup）のバグを検出できないため、現実的な件数を用いる。
 */
const SAMPLE_FOOD_IDS = [
  "01083",
  "01088",
  "02017",
  "04032",
  "04033",
  "06061",
  "06212",
  "06233",
  "06312",
  "07148",
  "11221",
  "12004",
  "13003",
  "17012",
];

/** strict tool useが「サポートしない」と明示しているJSON Schemaキーワード。 */
const UNSUPPORTED_SCHEMA_KEYWORDS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "maxItems",
];

interface VisitedNode {
  path: string;
  node: ClaudeToolSchemaNode;
}

/** スキーマツリーを再帰的に走査し、全ノードを `path` 付きで収集する。 */
function walkSchema(node: ClaudeToolSchemaNode, path: string, visited: VisitedNode[]): void {
  visited.push({ path, node });

  if (node.type === "object") {
    for (const [key, child] of Object.entries(node.properties)) {
      walkSchema(child, `${path}.properties.${key}`, visited);
    }
    return;
  }

  if (node.type === "array") {
    walkSchema(node.items, `${path}.items`, visited);
  }
}

function collectAllNodes(tool: ClaudeToolDefinition): VisitedNode[] {
  const visited: VisitedNode[] = [];
  walkSchema(tool.input_schema, "input_schema", visited);
  return visited;
}

function collectObjectNodes(
  tool: ClaudeToolDefinition,
): { path: string; node: ClaudeToolObjectSchema }[] {
  const result: { path: string; node: ClaudeToolObjectSchema }[] = [];
  for (const entry of collectAllNodes(tool)) {
    if (entry.node.type === "object") {
      result.push({ path: entry.path, node: entry.node });
    }
  }
  return result;
}

function nodeAt(tool: ClaudeToolDefinition, path: string): ClaudeToolSchemaNode {
  const found = collectAllNodes(tool).find((entry) => entry.path === path);
  if (!found) {
    throw new Error(
      `テストヘルパー: パス ${path} のスキーマノードが見つかりません（スキーマ構造が変更された可能性があります）`,
    );
  }
  return found.node;
}

function objectNodeAt(tool: ClaudeToolDefinition, path: string): ClaudeToolObjectSchema {
  const node = nodeAt(tool, path);
  if (node.type !== "object") {
    throw new Error(`テストヘルパー: パス ${path} は object ノードではありません（type=${node.type}）`);
  }
  return node;
}

/** ノードを任意キーで検査するための素のレコードとして見る。 */
function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

const WEEKLY_INGREDIENT_PATH =
  "input_schema.properties.days.items.properties.meals.items.properties.ingredients.items";
const DAILY_INGREDIENT_PATH = "input_schema.properties.meals.items.properties.ingredients.items";
const RECIPE_INGREDIENT_PATH =
  "input_schema.properties.supplementarySuggestions.items.properties.ingredients.items";

const ALL_TOOLS: {
  label: string;
  expectedName: string;
  ingredientPath: string;
  build: () => ClaudeToolDefinition;
}[] = [
  {
    label: "週間生成tool",
    expectedName: WEEKLY_GENERATION_TOOL_NAME,
    ingredientPath: WEEKLY_INGREDIENT_PATH,
    build: () => buildWeeklyGenerationTool(SAMPLE_FOOD_IDS),
  },
  {
    label: "日単位生成tool",
    expectedName: DAILY_GENERATION_TOOL_NAME,
    ingredientPath: DAILY_INGREDIENT_PATH,
    build: () => buildDailyGenerationTool(SAMPLE_FOOD_IDS),
  },
  {
    label: "レシピ生成tool",
    expectedName: RECIPE_GENERATION_TOOL_NAME,
    ingredientPath: RECIPE_INGREDIENT_PATH,
    build: () => buildRecipeGenerationTool(SAMPLE_FOOD_IDS),
  },
];

// ---------------------------------------------------------------------------
// 3つのtool定義に共通の strict: true 適合性（Requirement 3.1, 3.2, 3.4）
// ---------------------------------------------------------------------------

describe.each(ALL_TOOLS)("$label のstrict tool use適合性", ({ expectedName, ingredientPath, build }) => {
  // Requirement 3.4 / design.md #ClaudeMenuClient
  it("strict: true をtool定義のトップレベル（input_schemaの兄弟）に持つ", () => {
    const tool = build();

    expect(tool.strict).toBe(true);
    expect(Object.keys(tool)).toEqual(expect.arrayContaining(["name", "input_schema", "strict"]));
  });

  it("strict を input_schema の内部にネストしていない", () => {
    const tool = build();

    expect(asRecord(tool.input_schema)["strict"]).toBeUndefined();
  });

  it("想定したtool名と非空のdescriptionを持つ", () => {
    const tool = build();

    expect(tool.name).toBe(expectedName);
    expect(tool.description.length).toBeGreaterThan(0);
  });

  it("input_schema のトップレベルが type: object である", () => {
    const tool = build();

    expect(tool.input_schema.type).toBe("object");
  });

  // Requirement 3.4: 宣言されたJSON Schemaとの厳密一致
  it("すべてのネストレベルの object ノードが additionalProperties: false を持つ", () => {
    const tool = build();
    const objectNodes = collectObjectNodes(tool);

    expect(objectNodes.length).toBeGreaterThan(1); // ネストが実際に走査されていることの担保

    for (const { path, node } of objectNodes) {
      expect(node.additionalProperties, `${path} の additionalProperties`).toBe(false);
    }
  });

  it("すべてのネストレベルの object ノードの required が自身の全プロパティを網羅する", () => {
    const tool = build();

    for (const { path, node } of collectObjectNodes(tool)) {
      const propertyNames = Object.keys(node.properties);

      expect(propertyNames.length, `${path} のプロパティ件数`).toBeGreaterThan(0);
      expect([...node.required].sort(), `${path} の required`).toEqual([...propertyNames].sort());
      expect(new Set(node.required).size, `${path} の required に重複がない`).toBe(
        node.required.length,
      );
    }
  });

  // strict tool useがサポートしないキーワードを使うとAPIは400を返すため、
  // スキーマツリー全体にそれらが混入していないことを機械的に検証する。
  it("strict tool useがサポートしないJSON Schemaキーワードをどのノードにも含まない", () => {
    const tool = build();

    for (const { path, node } of collectAllNodes(tool)) {
      const record = asRecord(node);
      for (const keyword of UNSUPPORTED_SCHEMA_KEYWORDS) {
        expect(record[keyword], `${path} の ${keyword}`).toBeUndefined();
      }
    }
  });

  it("minItems を用いる場合はstrict tool useがサポートする 0 または 1 のみである", () => {
    const tool = build();

    for (const { path, node } of collectAllNodes(tool)) {
      const minItems = asRecord(node)["minItems"];
      if (minItems !== undefined) {
        expect([0, 1], `${path} の minItems`).toContain(minItems);
      }
    }
  });

  // Requirement 3.1: 選択可能な値を食品成分DBに存在する食品IDのenumに制約する
  it("food_id の enum が渡された食品ID一覧と完全に一致する", () => {
    const tool = build();
    const ingredient = objectNodeAt(tool, ingredientPath);
    const foodId = ingredient.properties["food_id"];

    expect(foodId).toBeDefined();
    expect(asRecord(foodId)["type"]).toBe("string");
    expect(asRecord(foodId)["enum"]).toEqual(SAMPLE_FOOD_IDS);
    expect((asRecord(foodId)["enum"] as string[]).length).toBe(SAMPLE_FOOD_IDS.length);
  });

  // Requirement 3.2: 既知の単位一覧から選ばれた単位の指定
  it("unit の enum が constants.ts の KNOWN_UNIT_CODES と完全に一致する", () => {
    const tool = build();
    const ingredient = objectNodeAt(tool, ingredientPath);
    const unit = ingredient.properties["unit"];

    expect(asRecord(unit)["type"]).toBe("string");
    expect(asRecord(unit)["enum"]).toEqual([...KNOWN_UNIT_CODES]);
  });

  // Requirement 3.2: 分量の数値の指定を必須とする
  it("食材ノードが food_id / quantity / unit の3つを必須プロパティとする", () => {
    const tool = build();
    const ingredient = objectNodeAt(tool, ingredientPath);

    expect(Object.keys(ingredient.properties).sort()).toEqual(["food_id", "quantity", "unit"]);
    expect([...ingredient.required].sort()).toEqual(["food_id", "quantity", "unit"]);
  });

  it("quantity が type: number であり、正の数値であるという制約をdescriptionで伝える", () => {
    const tool = build();
    const ingredient = objectNodeAt(tool, ingredientPath);
    const quantity = asRecord(ingredient.properties["quantity"]);

    expect(quantity["type"]).toBe("number");
    // 数値制約キーワード（minimum/exclusiveMinimum等）はstrict tool useでサポートされず
    // 400になるため、正の数値であることはdescriptionで伝える。
    expect(quantity["exclusiveMinimum"]).toBeUndefined();
    expect(quantity["minimum"]).toBeUndefined();
    expect(String(quantity["description"])).toContain("0");
    expect(String(quantity["description"])).toContain("正の数値");
  });
});

// ---------------------------------------------------------------------------
// 共有された食材サブスキーマの再利用
// ---------------------------------------------------------------------------

describe("食材サブスキーマの共有", () => {
  it("週間・日単位・レシピの3つのtoolが同一形状の食材サブスキーマを用いる", () => {
    const weeklyIngredient = objectNodeAt(
      buildWeeklyGenerationTool(SAMPLE_FOOD_IDS),
      WEEKLY_INGREDIENT_PATH,
    );
    const dailyIngredient = objectNodeAt(
      buildDailyGenerationTool(SAMPLE_FOOD_IDS),
      DAILY_INGREDIENT_PATH,
    );
    const recipeIngredient = objectNodeAt(
      buildRecipeGenerationTool(SAMPLE_FOOD_IDS),
      RECIPE_INGREDIENT_PATH,
    );

    expect(dailyIngredient).toEqual(weeklyIngredient);
    expect(recipeIngredient).toEqual(weeklyIngredient);
  });

  it("quantityの正の数値制約は@nutrition/sharedのIngredientSelectionSchemaが実行時に強制する", () => {
    // tool schemaでは表現できない `> 0` の権威ある強制点が実在することのクロスチェック
    // （task 6.2が `tool_use.input` をこのスキーマで再検証する）。
    expect(IngredientSelectionSchema.safeParse({ foodId: "01083", quantity: 0, unit: "g" }).success).toBe(
      false,
    );
    expect(
      IngredientSelectionSchema.safeParse({ foodId: "01083", quantity: -1, unit: "g" }).success,
    ).toBe(false);
    expect(
      IngredientSelectionSchema.safeParse({ foodId: "01083", quantity: 0.5, unit: "g" }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 週間生成tool（design.md WeeklyGenerationToolResult）
// ---------------------------------------------------------------------------

describe("buildWeeklyGenerationTool", () => {
  it("トップレベルのプロパティが days のみである", () => {
    const tool = buildWeeklyGenerationTool(SAMPLE_FOOD_IDS);

    expect(Object.keys(tool.input_schema.properties)).toEqual(["days"]);
  });

  it("object ノードがトップレベル・日・食事・食材の4階層のみである", () => {
    const tool = buildWeeklyGenerationTool(SAMPLE_FOOD_IDS);

    expect(collectObjectNodes(tool).map((entry) => entry.path)).toEqual([
      "input_schema",
      "input_schema.properties.days.items",
      "input_schema.properties.days.items.properties.meals.items",
      WEEKLY_INGREDIENT_PATH,
    ]);
  });

  it("日ノードが dayIndex と meals を必須プロパティとする", () => {
    const tool = buildWeeklyGenerationTool(SAMPLE_FOOD_IDS);
    const day = objectNodeAt(tool, "input_schema.properties.days.items");

    expect(Object.keys(day.properties).sort()).toEqual(["dayIndex", "meals"]);
    expect([...day.required].sort()).toEqual(["dayIndex", "meals"]);
  });

  // design.md DayMenuSchema: dayIndex は 0-6 の整数
  it("dayIndex を 0〜6 の7値のenumとして制約する", () => {
    const tool = buildWeeklyGenerationTool(SAMPLE_FOOD_IDS);
    const day = objectNodeAt(tool, "input_schema.properties.days.items");
    const dayIndex = asRecord(day.properties["dayIndex"]);

    expect(dayIndex["type"]).toBe("integer");
    expect(dayIndex["enum"]).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("食事ノードが mealType / dishName / ingredients を必須プロパティとする", () => {
    const tool = buildWeeklyGenerationTool(SAMPLE_FOOD_IDS);
    const meal = objectNodeAt(tool, "input_schema.properties.days.items.properties.meals.items");

    expect(Object.keys(meal.properties).sort()).toEqual(["dishName", "ingredients", "mealType"]);
    expect([...meal.required].sort()).toEqual(["dishName", "ingredients", "mealType"]);
  });

  it("mealType の enum が breakfast / lunch / dinner / snack の4値である", () => {
    const tool = buildWeeklyGenerationTool(SAMPLE_FOOD_IDS);
    const meal = objectNodeAt(tool, "input_schema.properties.days.items.properties.meals.items");
    const mealType = asRecord(meal.properties["mealType"]);

    expect(mealType["type"]).toBe("string");
    expect(mealType["enum"]).toEqual(["breakfast", "lunch", "dinner", "snack"]);
  });

  it("mealType の enum が @nutrition/shared の MealTypeSchema と一致する", () => {
    const tool = buildWeeklyGenerationTool(SAMPLE_FOOD_IDS);
    const meal = objectNodeAt(tool, "input_schema.properties.days.items.properties.meals.items");
    const mealType = asRecord(meal.properties["mealType"]);

    expect(mealType["enum"]).toEqual([...MealTypeSchema.options]);
  });

  // design.md Invariants: days は常に7件・各 meals は常に4件
  // （strict tool useは maxItems / 2以上の minItems をサポートしないため件数はdescriptionで伝え、
  //   権威ある強制は task 6.2 の実行時Zod再検証が行う）
  it("days / meals のdescriptionが7件・4件という件数要求を伝える", () => {
    const tool = buildWeeklyGenerationTool(SAMPLE_FOOD_IDS);
    const days = asRecord(nodeAt(tool, "input_schema.properties.days"));
    const meals = asRecord(nodeAt(tool, "input_schema.properties.days.items.properties.meals"));

    expect(days["type"]).toBe("array");
    expect(String(days["description"])).toContain("7");
    expect(meals["type"]).toBe("array");
    expect(String(meals["description"])).toContain("4");
  });
});

// ---------------------------------------------------------------------------
// 日単位生成tool（design.md DailyGenerationToolResult）
// ---------------------------------------------------------------------------

describe("buildDailyGenerationTool", () => {
  it("トップレベルのプロパティが meals のみであり days ラッパーを持たない", () => {
    const tool = buildDailyGenerationTool(SAMPLE_FOOD_IDS);

    expect(Object.keys(tool.input_schema.properties)).toEqual(["meals"]);
    expect(tool.input_schema.properties["days"]).toBeUndefined();
  });

  it("スキーマツリーのどこにも days / dayIndex プロパティを持たない", () => {
    const tool = buildDailyGenerationTool(SAMPLE_FOOD_IDS);

    for (const { path, node } of collectObjectNodes(tool)) {
      expect(Object.keys(node.properties), `${path} のプロパティ`).not.toContain("days");
      expect(Object.keys(node.properties), `${path} のプロパティ`).not.toContain("dayIndex");
    }
  });

  it("object ノードがトップレベル・食事・食材の3階層のみである", () => {
    const tool = buildDailyGenerationTool(SAMPLE_FOOD_IDS);

    expect(collectObjectNodes(tool).map((entry) => entry.path)).toEqual([
      "input_schema",
      "input_schema.properties.meals.items",
      DAILY_INGREDIENT_PATH,
    ]);
  });

  it("食事ノードの形状が週間生成toolの食事ノードと同一である", () => {
    const daily = objectNodeAt(
      buildDailyGenerationTool(SAMPLE_FOOD_IDS),
      "input_schema.properties.meals.items",
    );
    const weekly = objectNodeAt(
      buildWeeklyGenerationTool(SAMPLE_FOOD_IDS),
      "input_schema.properties.days.items.properties.meals.items",
    );

    expect(daily).toEqual(weekly);
  });

  it("meals のdescriptionが4件という件数要求を伝える", () => {
    const tool = buildDailyGenerationTool(SAMPLE_FOOD_IDS);
    const meals = asRecord(nodeAt(tool, "input_schema.properties.meals"));

    expect(meals["type"]).toBe("array");
    expect(String(meals["description"])).toContain("4");
  });
});

// ---------------------------------------------------------------------------
// レシピ生成tool（design.md RecipeGenerationToolResult）
// ---------------------------------------------------------------------------

describe("buildRecipeGenerationTool", () => {
  it("トップレベルのプロパティが servings / cookingTimeMinutes / steps / supplementarySuggestions の4つである", () => {
    const tool = buildRecipeGenerationTool(SAMPLE_FOOD_IDS);

    expect(Object.keys(tool.input_schema.properties).sort()).toEqual([
      "cookingTimeMinutes",
      "servings",
      "steps",
      "supplementarySuggestions",
    ]);
  });

  // 主菜の食材は週間/日単位生成で既に確定しており、再選択させない
  it("トップレベルに ingredients プロパティを持たない", () => {
    const tool = buildRecipeGenerationTool(SAMPLE_FOOD_IDS);

    expect(tool.input_schema.properties["ingredients"]).toBeUndefined();
    expect(Object.keys(tool.input_schema.properties)).not.toContain("ingredients");
    expect(tool.input_schema.required).not.toContain("ingredients");
  });

  it("ingredients は supplementarySuggestions の配下にのみ存在する", () => {
    const tool = buildRecipeGenerationTool(SAMPLE_FOOD_IDS);
    const pathsWithIngredients = collectObjectNodes(tool)
      .filter((entry) => Object.keys(entry.node.properties).includes("ingredients"))
      .map((entry) => entry.path);

    expect(pathsWithIngredients).toEqual([
      "input_schema.properties.supplementarySuggestions.items",
    ]);
  });

  // レシピ詳細は既に確定した食事枠に対して生成されるため mealType を選択させない
  it("スキーマツリーのどこにも mealType プロパティを持たない", () => {
    const tool = buildRecipeGenerationTool(SAMPLE_FOOD_IDS);

    for (const { path, node } of collectObjectNodes(tool)) {
      expect(Object.keys(node.properties), `${path} のプロパティ`).not.toContain("mealType");
    }
  });

  it("servings / cookingTimeMinutes が正の整数であることを type と description で伝える", () => {
    const tool = buildRecipeGenerationTool(SAMPLE_FOOD_IDS);
    const servings = asRecord(tool.input_schema.properties["servings"]);
    const cookingTime = asRecord(tool.input_schema.properties["cookingTimeMinutes"]);

    expect(servings["type"]).toBe("integer");
    expect(String(servings["description"])).toContain("1以上");
    expect(cookingTime["type"]).toBe("integer");
    expect(String(cookingTime["description"])).toContain("1以上");
  });

  it("steps が文字列の配列である", () => {
    const tool = buildRecipeGenerationTool(SAMPLE_FOOD_IDS);
    const steps = asRecord(tool.input_schema.properties["steps"]);

    expect(steps["type"]).toBe("array");
    expect(asRecord(steps["items"])["type"]).toBe("string");
  });

  // design.md RecipeGenerationToolResult: supplementarySuggestions は「1〜2件」
  it("supplementarySuggestions が minItems: 1 を持ち、上限2件をdescriptionで伝える", () => {
    const tool = buildRecipeGenerationTool(SAMPLE_FOOD_IDS);
    const suggestions = asRecord(nodeAt(tool, "input_schema.properties.supplementarySuggestions"));

    expect(suggestions["type"]).toBe("array");
    expect(suggestions["minItems"]).toBe(1);
    expect(suggestions["maxItems"]).toBeUndefined(); // strict tool useは maxItems をサポートしない
    expect(String(suggestions["description"])).toContain("1");
    expect(String(suggestions["description"])).toContain("2");
  });

  it("補助副菜ノードが dishName / ingredients を必須プロパティとする", () => {
    const tool = buildRecipeGenerationTool(SAMPLE_FOOD_IDS);
    const suggestion = objectNodeAt(tool, "input_schema.properties.supplementarySuggestions.items");

    expect(Object.keys(suggestion.properties).sort()).toEqual(["dishName", "ingredients"]);
    expect([...suggestion.required].sort()).toEqual(["dishName", "ingredients"]);
  });

  it("object ノードがトップレベル・補助副菜・食材の3階層のみである", () => {
    const tool = buildRecipeGenerationTool(SAMPLE_FOOD_IDS);

    expect(collectObjectNodes(tool).map((entry) => entry.path)).toEqual([
      "input_schema",
      "input_schema.properties.supplementarySuggestions.items",
      RECIPE_INGREDIENT_PATH,
    ]);
  });
});

// ---------------------------------------------------------------------------
// 入力の扱い（食品ID一覧の完全性・単位一覧の差し替え・純粋性）
// ---------------------------------------------------------------------------

describe("食品ID一覧・単位一覧の扱い", () => {
  it("数百件規模の食品ID一覧を切り詰めずすべて enum に埋め込む", () => {
    const manyIds = Array.from({ length: 500 }, (_, index) => `F${String(index).padStart(5, "0")}`);
    const tool = buildWeeklyGenerationTool(manyIds);
    const ingredient = objectNodeAt(tool, WEEKLY_INGREDIENT_PATH);
    const enumValues = asRecord(ingredient.properties["food_id"])["enum"] as string[];

    expect(enumValues.length).toBe(500);
    expect(enumValues).toEqual(manyIds);
  });

  it("重複を含む食品ID一覧を重複排除せずそのまま enum に反映する", () => {
    // `listAllIds()` は TEXT PRIMARY KEY 由来で重複しないが、
    // 静かな dedup が入っていないこと（=入力をそのまま反映すること）を確認する。
    const withDuplicate = ["01083", "01088", "01083"];
    const tool = buildDailyGenerationTool(withDuplicate);
    const ingredient = objectNodeAt(tool, DAILY_INGREDIENT_PATH);

    expect(asRecord(ingredient.properties["food_id"])["enum"]).toEqual(withDuplicate);
  });

  it("入力配列を後から変更してもすでに構築されたtool定義は影響を受けない", () => {
    const mutableIds = ["01083", "01088"];
    const tool = buildDailyGenerationTool(mutableIds);
    mutableIds.push("99999");

    const ingredient = objectNodeAt(tool, DAILY_INGREDIENT_PATH);
    expect(asRecord(ingredient.properties["food_id"])["enum"]).toEqual(["01083", "01088"]);
  });

  it("unitCodes を明示的に渡した場合は既定の KNOWN_UNIT_CODES ではなくその一覧を用いる", () => {
    const customUnits = ["g", "本"];
    const tool = buildRecipeGenerationTool(SAMPLE_FOOD_IDS, customUnits);
    const ingredient = objectNodeAt(tool, RECIPE_INGREDIENT_PATH);

    expect(asRecord(ingredient.properties["unit"])["enum"]).toEqual(customUnits);
  });

  it("食品ID一覧が空の場合は例外を投げる（enum: [] は不正なJSON Schemaのため）", () => {
    expect(() => buildWeeklyGenerationTool([])).toThrow(/食品ID/);
    expect(() => buildDailyGenerationTool([])).toThrow(/食品ID/);
    expect(() => buildRecipeGenerationTool([])).toThrow(/食品ID/);
  });

  it("単位コード一覧が空の場合は例外を投げる", () => {
    expect(() => buildWeeklyGenerationTool(SAMPLE_FOOD_IDS, [])).toThrow(/単位コード/);
    expect(() => buildDailyGenerationTool(SAMPLE_FOOD_IDS, [])).toThrow(/単位コード/);
    expect(() => buildRecipeGenerationTool(SAMPLE_FOOD_IDS, [])).toThrow(/単位コード/);
  });
});

describe("tool定義構築の決定論性", () => {
  // design.md: tool定義にはプロンプトキャッシュ（cache_control）を適用するため、
  // 同一入力から常にバイト等価なtool定義が得られる必要がある。
  it.each(ALL_TOOLS)("$label は同一入力に対して常に等価なtool定義を返す", ({ build }) => {
    const first = build();
    const second = build();

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second).not.toBe(first);
  });
});

describe("tool名", () => {
  it("3つのtool名が互いに異なる", () => {
    const names = [
      WEEKLY_GENERATION_TOOL_NAME,
      DAILY_GENERATION_TOOL_NAME,
      RECIPE_GENERATION_TOOL_NAME,
    ];

    expect(new Set(names).size).toBe(3);
  });

  it("tool名がAnthropic APIのtool名として妥当な文字種のみを用いる", () => {
    for (const name of [
      WEEKLY_GENERATION_TOOL_NAME,
      DAILY_GENERATION_TOOL_NAME,
      RECIPE_GENERATION_TOOL_NAME,
    ]) {
      expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// generateWeek / generateDay / generateRecipe（task 6.2）
// ---------------------------------------------------------------------------
//
// design.md #ClaudeMenuClient の Responsibilities & Constraints・Implementation Notes が
// 求める、実際のAnthropic Messages API呼び出しロジックのテスト。`@anthropic-ai/sdk` の
// `Anthropic` クライアントは一切構築しない（`new Anthropic()` を呼ばない）。代わりに
// `AnthropicMessagesClient`（`messages.create` のみを持つ最小の依存契約）のフェイクに
// 差し替える。これは `nutrition-verification.service.test.ts` の
// `createFakeFoodCompositionRepository` / `createFakeUnitConversionService`
// （未使用メソッドは呼ばれたら例外を投げるフェイク、コンストラクタインジェクション）と
// 同じスタイルに倣う。

const SAMPLE_FOOD_IDS_FOR_GENERATION = ["G001", "G002", "G003"];

/**
 * `ClaudeMenuClient` の生成メソッドが呼び出す唯一のメソッドは `listAllIds` のみ
 * （design.md「食品ID・単位の実在性チェック自体は行わない」ため `findById` 等は使われない）。
 */
function createFakeFoodCompositionRepositoryForGeneration(
  listAllIds: () => string[] = () => SAMPLE_FOOD_IDS_FOR_GENERATION,
): FoodCompositionRepository {
  return {
    listAllIds,
    findById: (): FoodItemNutrition | null => {
      throw new Error(
        "createFakeFoodCompositionRepositoryForGeneration: findById is not used by ClaudeMenuClient generation methods",
      );
    },
    findUnitConversion: (): UnitConversionEntry | null => {
      throw new Error(
        "createFakeFoodCompositionRepositoryForGeneration: findUnitConversion is not used by ClaudeMenuClient generation methods",
      );
    },
    findGenericUnitConversion: (): UnitConversionEntry | null => {
      throw new Error(
        "createFakeFoodCompositionRepositoryForGeneration: findGenericUnitConversion is not used by ClaudeMenuClient generation methods",
      );
    },
  };
}

/** `messages.create` のみを持つ最小のフェイク。実際に `new Anthropic()` を構築しない。 */
function createFakeAnthropicClient(
  create: AnthropicMessagesClient["messages"]["create"],
): AnthropicMessagesClient {
  return { messages: { create } };
}

const SAMPLE_PAYLOAD: ClaudePromptPayload = {
  system: "あなたは栄養士アシスタントです。",
  userMessage: "1週間分の献立を作成してください。",
};

/**
 * テスト用の `tool_use` コンテントブロックのフィクスチャ。
 * 実際のAnthropic SDKの型（`caller`必須フィールド等）は本テストの関心事ではないため、
 * 必要最小限のフィールドのみを持つプレーンオブジェクトとして構築する。
 */
function toolUseBlock(name: string, input: unknown) {
  return { type: "tool_use" as const, id: "toolu_test", name, input };
}

function textBlock(text: string) {
  return { type: "text" as const, text, citations: null };
}

/** テスト用の最小限の `Anthropic.Message` フィクスチャ。 */
function buildFakeMessage(overrides: {
  content: unknown[];
  stop_reason?: string;
  stop_details?: unknown;
}): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: DEFAULT_MODEL_ID,
    stop_reason: "tool_use",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 100,
      output_tokens: 100,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
    ...overrides,
  } as unknown as Anthropic.Message;
}

function buildIngredientInput(
  overrides: Partial<{ food_id: string; quantity: number; unit: string }> = {},
) {
  return { food_id: "01083", quantity: 100, unit: "g", ...overrides };
}

function buildMealInput(mealType: MealType, overrides: Record<string, unknown> = {}) {
  return {
    mealType,
    dishName: `${mealType}のテスト料理`,
    ingredients: [buildIngredientInput()],
    ...overrides,
  };
}

const FOUR_MEALS_INPUT = [
  buildMealInput("breakfast"),
  buildMealInput("lunch"),
  buildMealInput("dinner"),
  buildMealInput("snack"),
];

function buildSevenDaysInput() {
  return Array.from({ length: 7 }, (_, dayIndex) => ({
    dayIndex,
    meals: FOUR_MEALS_INPUT,
  }));
}

describe("createClaudeMenuClient", () => {
  describe("tool呼び出しの構築（tool_choice・model・thinking・effort・cache_control）", () => {
    it("generateWeekはWEEKLY_GENERATION_TOOL_NAMEをtool_choiceで固定し、週間/日単位用のthinking・effortとcache_controlを適用する", async () => {
      let capturedParams: Anthropic.MessageCreateParamsNonStreaming | undefined;
      const repository = createFakeFoodCompositionRepositoryForGeneration();
      const anthropicClient = createFakeAnthropicClient(async (params) => {
        capturedParams = params;
        return buildFakeMessage({
          content: [toolUseBlock(WEEKLY_GENERATION_TOOL_NAME, { days: buildSevenDaysInput() })],
        });
      });
      const client = createClaudeMenuClient(repository, anthropicClient);

      const result = await client.generateWeek(SAMPLE_PAYLOAD);

      expect(result.ok).toBe(true);
      expect(capturedParams).toBeDefined();
      const params = capturedParams!;

      expect(params.model).toBe(DEFAULT_MODEL_ID);
      expect(params.thinking).toEqual(WEEKLY_DAILY_GENERATION_THINKING);
      expect(params.output_config).toEqual({ effort: WEEKLY_DAILY_GENERATION_EFFORT });
      expect(params.tool_choice).toEqual({ type: "tool", name: WEEKLY_GENERATION_TOOL_NAME });
      expect(params.system).toBe(SAMPLE_PAYLOAD.system);
      expect(params.messages).toEqual([{ role: "user", content: SAMPLE_PAYLOAD.userMessage }]);

      expect(params.tools).toHaveLength(1);
      const sentTool = params.tools![0] as ClaudeToolDefinition & { cache_control?: unknown };
      const { cache_control, ...toolWithoutCache } = sentTool;
      expect(cache_control).toEqual({ type: "ephemeral" });
      expect(toolWithoutCache).toEqual(buildWeeklyGenerationTool(SAMPLE_FOOD_IDS_FOR_GENERATION));
    });

    it("generateDayはDAILY_GENERATION_TOOL_NAMEをtool_choiceで固定し、週間/日単位用のthinking・effortを適用する", async () => {
      let capturedParams: Anthropic.MessageCreateParamsNonStreaming | undefined;
      const repository = createFakeFoodCompositionRepositoryForGeneration();
      const anthropicClient = createFakeAnthropicClient(async (params) => {
        capturedParams = params;
        return buildFakeMessage({
          content: [toolUseBlock(DAILY_GENERATION_TOOL_NAME, { meals: FOUR_MEALS_INPUT })],
        });
      });
      const client = createClaudeMenuClient(repository, anthropicClient);

      const result = await client.generateDay(SAMPLE_PAYLOAD);

      expect(result.ok).toBe(true);
      const params = capturedParams!;
      expect(params.thinking).toEqual(WEEKLY_DAILY_GENERATION_THINKING);
      expect(params.output_config).toEqual({ effort: WEEKLY_DAILY_GENERATION_EFFORT });
      expect(params.tool_choice).toEqual({ type: "tool", name: DAILY_GENERATION_TOOL_NAME });

      expect(params.tools).toHaveLength(1);
      const sentTool = params.tools![0] as ClaudeToolDefinition & { cache_control?: unknown };
      const { cache_control, ...toolWithoutCache } = sentTool;
      expect(cache_control).toEqual({ type: "ephemeral" });
      expect(toolWithoutCache).toEqual(buildDailyGenerationTool(SAMPLE_FOOD_IDS_FOR_GENERATION));
    });

    it("generateRecipeはRECIPE_GENERATION_TOOL_NAMEをtool_choiceで固定し、レシピ用のthinking（disabled）・effort（low）を適用する", async () => {
      let capturedParams: Anthropic.MessageCreateParamsNonStreaming | undefined;
      const repository = createFakeFoodCompositionRepositoryForGeneration();
      const anthropicClient = createFakeAnthropicClient(async (params) => {
        capturedParams = params;
        return buildFakeMessage({
          content: [
            toolUseBlock(RECIPE_GENERATION_TOOL_NAME, {
              servings: 2,
              cookingTimeMinutes: 20,
              steps: ["切る", "焼く"],
              supplementarySuggestions: [{ dishName: "副菜A", ingredients: [buildIngredientInput()] }],
            }),
          ],
        });
      });
      const client = createClaudeMenuClient(repository, anthropicClient);

      const result = await client.generateRecipe(SAMPLE_PAYLOAD);

      expect(result.ok).toBe(true);
      const params = capturedParams!;
      expect(params.thinking).toEqual(RECIPE_GENERATION_THINKING);
      expect(params.output_config).toEqual({ effort: RECIPE_GENERATION_EFFORT });
      expect(params.tool_choice).toEqual({ type: "tool", name: RECIPE_GENERATION_TOOL_NAME });

      expect(params.tools).toHaveLength(1);
      const sentTool = params.tools![0] as ClaudeToolDefinition & { cache_control?: unknown };
      const { cache_control, ...toolWithoutCache } = sentTool;
      expect(cache_control).toEqual({ type: "ephemeral" });
      expect(toolWithoutCache).toEqual(buildRecipeGenerationTool(SAMPLE_FOOD_IDS_FOR_GENERATION));
    });

    it("listAllIds()を実際に呼び出し、その結果でtoolのfood_id enumを構築する", async () => {
      const customIds = ["X9", "X8", "X7", "X6"];
      const listAllIds = vi.fn(() => customIds);
      const repository = createFakeFoodCompositionRepositoryForGeneration(listAllIds);
      let capturedParams: Anthropic.MessageCreateParamsNonStreaming | undefined;
      const anthropicClient = createFakeAnthropicClient(async (params) => {
        capturedParams = params;
        return buildFakeMessage({
          content: [toolUseBlock(WEEKLY_GENERATION_TOOL_NAME, { days: buildSevenDaysInput() })],
        });
      });
      const client = createClaudeMenuClient(repository, anthropicClient);

      await client.generateWeek(SAMPLE_PAYLOAD);

      expect(listAllIds).toHaveBeenCalledTimes(1);
      const sentTool = capturedParams!.tools![0] as ClaudeToolDefinition & { cache_control?: unknown };
      const { cache_control, ...toolWithoutCache } = sentTool;
      expect(toolWithoutCache).toEqual(buildWeeklyGenerationTool(customIds));
    });
  });

  describe("stop_reason: refusal の扱い", () => {
    it("generateWeekはstop_reasonがrefusalの場合、type: refusalのResult失敗を返す", async () => {
      const repository = createFakeFoodCompositionRepositoryForGeneration();
      const anthropicClient = createFakeAnthropicClient(async () =>
        buildFakeMessage({
          content: [],
          stop_reason: "refusal",
          stop_details: { type: "refusal", category: "cyber", explanation: "説明" },
        }),
      );
      const client = createClaudeMenuClient(repository, anthropicClient);

      const result = await client.generateWeek(SAMPLE_PAYLOAD);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("refusal");
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });

    it("generateRecipeもstop_reasonがrefusalの場合、type: refusalのResult失敗を返す", async () => {
      const repository = createFakeFoodCompositionRepositoryForGeneration();
      const anthropicClient = createFakeAnthropicClient(async () =>
        buildFakeMessage({ content: [], stop_reason: "refusal", stop_details: null }),
      );
      const client = createClaudeMenuClient(repository, anthropicClient);

      const result = await client.generateRecipe(SAMPLE_PAYLOAD);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("refusal");
      }
    });
  });

  describe("ネットワーク/サーバーエラーの扱い", () => {
    it("generateDayはclient.messages.createが例外を投げた場合、type: request_failedのResult失敗を返す", async () => {
      const repository = createFakeFoodCompositionRepositoryForGeneration();
      const thrown = new Error("ECONNRESET: simulated network failure");
      const anthropicClient = createFakeAnthropicClient(async () => {
        throw thrown;
      });
      const client = createClaudeMenuClient(repository, anthropicClient);

      const result = await client.generateDay(SAMPLE_PAYLOAD);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("request_failed");
        expect(result.error.message).toContain("simulated network failure");
      }
    });

    it("generateWeekはAPIError形状のエラーが投げられた場合もtype: request_failedのResult失敗を返す", async () => {
      const repository = createFakeFoodCompositionRepositoryForGeneration();
      class FakeAPIError extends Error {
        status = 500;
        constructor() {
          super("internal server error");
          this.name = "InternalServerError";
        }
      }
      const anthropicClient = createFakeAnthropicClient(async () => {
        throw new FakeAPIError();
      });
      const client = createClaudeMenuClient(repository, anthropicClient);

      const result = await client.generateWeek(SAMPLE_PAYLOAD);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("request_failed");
        expect(result.error.message).toContain("internal server error");
      }
    });
  });

  describe("tool_use.inputのスキーマ形状不一致（schema_validation_failed）", () => {
    it("generateWeekはdaysが6件（7件要求）の場合にtype: schema_validation_failedを返す", async () => {
      const repository = createFakeFoodCompositionRepositoryForGeneration();
      const sixDays = buildSevenDaysInput().slice(0, 6);
      const anthropicClient = createFakeAnthropicClient(async () =>
        buildFakeMessage({ content: [toolUseBlock(WEEKLY_GENERATION_TOOL_NAME, { days: sixDays })] }),
      );
      const client = createClaudeMenuClient(repository, anthropicClient);

      const result = await client.generateWeek(SAMPLE_PAYLOAD);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("schema_validation_failed");
      }
    });

    it("generateWeekはある日のmealsが3件（4件要求）の場合にtype: schema_validation_failedを返す", async () => {
      const repository = createFakeFoodCompositionRepositoryForGeneration();
      const days = buildSevenDaysInput();
      days[0] = { dayIndex: 0, meals: FOUR_MEALS_INPUT.slice(0, 3) };
      const anthropicClient = createFakeAnthropicClient(async () =>
        buildFakeMessage({ content: [toolUseBlock(WEEKLY_GENERATION_TOOL_NAME, { days })] }),
      );
      const client = createClaudeMenuClient(repository, anthropicClient);

      const result = await client.generateWeek(SAMPLE_PAYLOAD);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("schema_validation_failed");
      }
    });

    it("generateDayはmealsが3件（4件要求）の場合にtype: schema_validation_failedを返す", async () => {
      const repository = createFakeFoodCompositionRepositoryForGeneration();
      const threeMeals = FOUR_MEALS_INPUT.slice(0, 3);
      const anthropicClient = createFakeAnthropicClient(async () =>
        buildFakeMessage({ content: [toolUseBlock(DAILY_GENERATION_TOOL_NAME, { meals: threeMeals })] }),
      );
      const client = createClaudeMenuClient(repository, anthropicClient);

      const result = await client.generateDay(SAMPLE_PAYLOAD);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("schema_validation_failed");
      }
    });

    it("generateDayはmealsが5件（4件要求）の場合にtype: schema_validation_failedを返す", async () => {
      const repository = createFakeFoodCompositionRepositoryForGeneration();
      const fiveMeals = [...FOUR_MEALS_INPUT, buildMealInput("snack")];
      const anthropicClient = createFakeAnthropicClient(async () =>
        buildFakeMessage({ content: [toolUseBlock(DAILY_GENERATION_TOOL_NAME, { meals: fiveMeals })] }),
      );
      const client = createClaudeMenuClient(repository, anthropicClient);

      const result = await client.generateDay(SAMPLE_PAYLOAD);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("schema_validation_failed");
      }
    });

    it("generateRecipeはsupplementarySuggestionsが0件（1〜2件要求）の場合にtype: schema_validation_failedを返す", async () => {
      const repository = createFakeFoodCompositionRepositoryForGeneration();
      const anthropicClient = createFakeAnthropicClient(async () =>
        buildFakeMessage({
          content: [
            toolUseBlock(RECIPE_GENERATION_TOOL_NAME, {
              servings: 2,
              cookingTimeMinutes: 20,
              steps: ["切る"],
              supplementarySuggestions: [],
            }),
          ],
        }),
      );
      const client = createClaudeMenuClient(repository, anthropicClient);

      const result = await client.generateRecipe(SAMPLE_PAYLOAD);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("schema_validation_failed");
      }
    });

    it("generateRecipeはsupplementarySuggestionsが3件（1〜2件要求）の場合にtype: schema_validation_failedを返す", async () => {
      const repository = createFakeFoodCompositionRepositoryForGeneration();
      const suggestion = { dishName: "副菜", ingredients: [buildIngredientInput()] };
      const anthropicClient = createFakeAnthropicClient(async () =>
        buildFakeMessage({
          content: [
            toolUseBlock(RECIPE_GENERATION_TOOL_NAME, {
              servings: 2,
              cookingTimeMinutes: 20,
              steps: ["切る"],
              supplementarySuggestions: [suggestion, suggestion, suggestion],
            }),
          ],
        }),
      );
      const client = createClaudeMenuClient(repository, anthropicClient);

      const result = await client.generateRecipe(SAMPLE_PAYLOAD);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("schema_validation_failed");
      }
    });

    it("必須toolが呼ばれていない（tool_useブロックが存在しない）場合はtype: schema_validation_failedを返す", async () => {
      const repository = createFakeFoodCompositionRepositoryForGeneration();
      const anthropicClient = createFakeAnthropicClient(async () =>
        buildFakeMessage({
          content: [textBlock("すみません、tool呼び出しを行いませんでした。")],
          stop_reason: "end_turn",
        }),
      );
      const client = createClaudeMenuClient(repository, anthropicClient);

      const result = await client.generateWeek(SAMPLE_PAYLOAD);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("schema_validation_failed");
      }
    });
  });

  describe("成功時のcamelCaseマッピング", () => {
    it("generateWeekは成功時、7日×4食のWeeklyGenerationToolResultをcamelCaseで正しく返す", async () => {
      const repository = createFakeFoodCompositionRepositoryForGeneration();
      const days = buildSevenDaysInput();
      const anthropicClient = createFakeAnthropicClient(async () =>
        buildFakeMessage({ content: [toolUseBlock(WEEKLY_GENERATION_TOOL_NAME, { days })] }),
      );
      const client = createClaudeMenuClient(repository, anthropicClient);

      const result: Result<WeeklyGenerationToolResult, ClaudeGenerationError> =
        await client.generateWeek(SAMPLE_PAYLOAD);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.days).toHaveLength(7);
        expect(result.value.days[0]!.dayIndex).toBe(0);
        expect(result.value.days[0]!.meals).toHaveLength(4);
        const firstMeal = result.value.days[0]!.meals[0]!;
        expect(firstMeal.mealType).toBe("breakfast");
        expect(firstMeal.dishName).toBe("breakfastのテスト料理");
        expect(firstMeal.ingredients).toEqual([{ foodId: "01083", quantity: 100, unit: "g" }]);
        // 生のwireキー（snake_case）が漏れていないこと
        expect(Object.keys(firstMeal.ingredients[0]!).sort()).toEqual(["foodId", "quantity", "unit"]);
        expect((firstMeal.ingredients[0] as Record<string, unknown>)["food_id"]).toBeUndefined();
      }
    });

    it("generateDayは成功時、4食のDailyGenerationToolResultをcamelCaseで正しく返す", async () => {
      const repository = createFakeFoodCompositionRepositoryForGeneration();
      const anthropicClient = createFakeAnthropicClient(async () =>
        buildFakeMessage({ content: [toolUseBlock(DAILY_GENERATION_TOOL_NAME, { meals: FOUR_MEALS_INPUT })] }),
      );
      const client = createClaudeMenuClient(repository, anthropicClient);

      const result: Result<DailyGenerationToolResult, ClaudeGenerationError> =
        await client.generateDay(SAMPLE_PAYLOAD);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.meals).toHaveLength(4);
        expect(result.value.meals.map((meal) => meal.mealType)).toEqual([
          "breakfast",
          "lunch",
          "dinner",
          "snack",
        ]);
        expect(result.value.meals[2]!.ingredients).toEqual([{ foodId: "01083", quantity: 100, unit: "g" }]);
        expect((result.value as unknown as Record<string, unknown>)["days"]).toBeUndefined();
      }
    });

    it("generateRecipeは成功時、servings/cookingTimeMinutes/steps/supplementarySuggestionsをcamelCaseで正しく返す", async () => {
      const repository = createFakeFoodCompositionRepositoryForGeneration();
      const anthropicClient = createFakeAnthropicClient(async () =>
        buildFakeMessage({
          content: [
            toolUseBlock(RECIPE_GENERATION_TOOL_NAME, {
              servings: 3,
              cookingTimeMinutes: 25,
              steps: ["野菜を切る", "炒める", "盛り付ける"],
              supplementarySuggestions: [
                {
                  dishName: "副菜A",
                  ingredients: [buildIngredientInput({ food_id: "02017", quantity: 50, unit: "g" })],
                },
                {
                  dishName: "副菜B",
                  ingredients: [buildIngredientInput({ food_id: "04032", quantity: 1, unit: "丁" })],
                },
              ],
            }),
          ],
        }),
      );
      const client = createClaudeMenuClient(repository, anthropicClient);

      const result: Result<RecipeGenerationToolResult, ClaudeGenerationError> =
        await client.generateRecipe(SAMPLE_PAYLOAD);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.servings).toBe(3);
        expect(result.value.cookingTimeMinutes).toBe(25);
        expect(result.value.steps).toEqual(["野菜を切る", "炒める", "盛り付ける"]);
        expect(result.value.supplementarySuggestions).toHaveLength(2);
        expect(result.value.supplementarySuggestions[0]).toEqual({
          dishName: "副菜A",
          ingredients: [{ foodId: "02017", quantity: 50, unit: "g" }],
        });
        expect(result.value.supplementarySuggestions[1]).toEqual({
          dishName: "副菜B",
          ingredients: [{ foodId: "04032", quantity: 1, unit: "丁" }],
        });
      }
    });
  });
});
