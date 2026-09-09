/**
 * RecipeDetailService — 食事枠単位のレシピ詳細と補助副菜提案のオンデマンド生成オーケストレーション。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #RecipeDetailService、
 * Requirements 8, 9）に定義されたオーケストレーションを実装する。
 *
 * ## GenerationError / GenerationFailureReason の再利用について
 * `menu-plan.service.ts`（task 9.1）が定義・exportする `GenerationError` /
 * `GenerationFailureReason` は `@nutrition/shared` にもどのtaskの成果物にも存在しない、
 * `MenuPlanService` 固有の定義に見えるが、design.md #RecipeDetailService の
 * Service Interfaceも同じ2つの型を（再定義せず）そのまま参照する
 * （`generateForMealSlot(...): Promise<Result<RecipeDetail, GenerationError | NotFoundError>>`）。
 * したがって本ファイルはこれらを再定義せず、`menu-plan.service.ts` からimportして再利用する
 * （このコードベースの「型はそれを最初に定義した場所からimportし、再定義しない」規約）。
 *
 * `nutrition_unavailable` は本Serviceに`NutritionGateway`依存が無いため到達不能な
 * reasonである（design.mdのDependencies行が`NutritionGateway`を挙げていないことと整合する）。
 * これはこのコードベースで既に確立された「すべてのreasonがすべての生成元から到達可能である
 * 必要はない」というパターン（例: task 7.2の到達不能な`ValidationError`）と同種である。
 *
 * ## MenuGenerator（task 17.1）: ClaudeMenuClient・MenuPromptBuilderを直接依存させないことについて
 * task 17.1以前は本ファイルが`ClaudeMenuClient`に直接依存し、`menu-prompt.builder.ts`の
 * `buildRecipeDetailPrompt`を直接importして自ら呼び出し、その結果（`ClaudePromptPayload`）を
 * `ClaudeMenuClient.generateRecipe`へ渡していた。task 17.1はこの「プロンプト構築 → Claude呼び出し」
 * という2ステップを`MenuGenerator`（`menu-generator.ts`）という1つの抽象の背後へ移し、
 * 本Serviceの依存一覧（`RecipeDetailServiceDependencies`）には`ClaudeMenuClient`の代わりに
 * `MenuGenerator`のみを注入する（挙動は変更しない、純粋なリファクタリング。AIを使わない
 * 代替実装`RuleBasedMenuGenerator`——task 17.3以降——を将来この同じ抽象の背後に差し込むための
 * 土台）。`buildRecipeDetailPrompt`自体は外部依存を持たない純粋関数のままであり、
 * `MenuGenerator`実装（`ClaudeMenuGenerator`、`claude-menu.generator.ts`）内部でのみ
 * 直接importして呼び出す。
 *
 * ## profileGatewayをP1ではなく必須依存として扱うことについて
 * design.mdの依存関係表は`ProfileGateway`を優先度P1（`MenuPlanRepository`等のP0より低い）として
 * 挙げるが、`buildRecipeDetailPrompt(meal, profile)`はNG食材・食事制限設定（Requirement 9.4）を
 * 補助副菜の制約として組み込むために`profile`を必須の引数として要求する。プロフィールが
 * 未登録の状態で生成を進めると、この制約が一切適用されない不完全な生成要求になってしまうため、
 * `MenuPlanService`（task 9.1）が確立した`profile_missing`パターンに倣い、
 * `profileGateway.getCurrentProfile()`が`null`を返す場合は生成を行わず
 * `GenerationError(profile_missing)`として扱う（優先度ラベルはDI上の実装難易度を表すもので
 * あり、機能的な必須性を否定するものではないと解釈した）。
 *
 * ## オーケストレーション手順
 * 1. `menuPlanRepository.findMealSlot(weekStartDate, dayIndex, mealType)` → `null`なら
 *    `NotFoundError`（design.md「対象の食事枠が MenuPlanRepository に存在しない場合、生成を
 *    行わず NotFoundError を返す」）。
 * 2. `profileGateway.getCurrentProfile()` → `null`なら`GenerationError(profile_missing)`
 *    （上記コメント参照）。
 * 3〜4. `menuGenerator.generateRecipe(mealSlot, profile)`でレシピ詳細を生成する
 *    （`MenuGenerator`実装がプロンプト構築+Claude呼び出しを内部で行う）。失敗時は
 *    `ClaudeGenerationError.type`を
 *    `menu-plan.service.ts`の`mapClaudeErrorReason`と同一のマッピングで`GenerationFailureReason`
 *    へ変換する（`mapClaudeErrorReason`自体は非export・private関数のため、本ファイルの境界
 *    （`RecipeDetailService`のみを変更対象とするtask boundary）を守るため、
 *    `menu-plan.service.ts`を変更してexportさせるのではなく、同一のマッピング表をここに
 *    複製する）。
 * 5. 成功した`RecipeGenerationToolResult`の`supplementarySuggestions`（1〜2件、
 *    `claude-menu.client.ts`のZod再検証で既にこの件数に絞られている）それぞれについて
 *    `nutritionVerificationService.verifyDish(suggestion.ingredients)`を呼ぶ。いずれかが
 *    失敗した時点で即座に失敗を返し、それ以降の候補は処理しない（部分的な永続化を避ける。
 *    design.md #RecipeDetailService Postconditions「対象食事枠の栄養価は変更しない」、
 *    かつ本Service自身が失敗時に何も永続化しない、という既存の「全体が成功するまで
 *    Repositoryを呼ばない」規約に倣う）。
 * 6. 検証に成功した各候補について、`VerifiedNutritionValues`（13項目）を`NutritionValues`
 *    （4項目: energyKcal/proteinG/fatG/carbG）へ射影した`nutritionDelta`を持つ
 *    `PersistedSupplementarySuggestion`（食材名は未解決のまま）を組み立てる。
 * 7. `mealSlot.nutrition`（`VerifiedNutritionValues`、既に確定済み・検証済みの値）も同じ
 *    射影関数で4項目へ射影し、`recipeDetailRepository.upsert`へ渡す`detail.nutrition`とする
 *    （`RecipeDetailRepository`はこの値を実際には保存せず`meal_slots`から再導出するが、
 *    design.mdのPostconditions「対象食事枠の栄養価は変更しない」を裏付ける意味論的に正しい
 *    値を渡すことで、Repositoryの将来の実装変更に対しても堅牢にする）。
 * 8. `recipeDetailRepository.upsert(mealSlot.id, detail)`を呼び、`PersistedRecipeDetail`
 *    （食材名は未解決）を受け取る。
 * 9. （task 16.1、Requirement 4.8）`composeRecipeDetail`で、`persisted`（ステップ8の戻り値）と
 *    `mealSlot.ingredients`（対象食事枠自身の、未解決の食材一覧）から、公開型`RecipeDetail`を
 *    組み立てて`Result.ok(...)`として返す。`mealSlotId`/`servings`/`cookingTimeMinutes`/
 *    `steps`/`nutrition`は`persisted`の値をそのまま引き継ぎ（design.md
 *    #RecipeDetailRepository Responsibilities「upsertは永続化した内容をそのまま読み戻して
 *    返す」を尊重）、新設の`ingredients`（主菜スロット自身の食材名解決）と
 *    `supplementarySuggestions[].ingredients`（各補助副菜の食材名解決）のみを
 *    `foodCompositionRepository.findById`で都度解決する（`resolveIngredientNames`参照。
 *    永続化はしない）。
 */
import type {
  IngredientSelection,
  NutritionValues,
  RecipeDetail,
  ResolvedIngredient,
  SupplementarySuggestion,
} from "@nutrition/shared";
import type { IsoDate, MealType, VerifiedNutritionValues } from "@nutrition/shared";
import type { NotFoundError, Result } from "../shared/result.js";
import type { ClaudeGenerationErrorType } from "./claude-menu.client.js";
import type { FoodCompositionRepository } from "./food-composition.repository.js";
import type { MenuGenerator } from "./menu-generator.js";
import type { MenuPlanRepository } from "./menu-plan.repository.js";
import type { NutritionVerificationService } from "./nutrition-verification.service.js";
import type { ProfileGateway } from "./profile.gateway.js";
import type {
  PersistedRecipeDetail,
  PersistedSupplementarySuggestion,
  RecipeDetailRepository,
} from "./recipe-detail.repository.js";
import type { GenerationError, GenerationFailureReason } from "./menu-plan.service.js";

/** design.md #RecipeDetailService Service Interface。 */
export interface RecipeDetailService {
  generateForMealSlot(
    weekStartDate: IsoDate,
    dayIndex: number,
    mealType: MealType
  ): Promise<Result<RecipeDetail, GenerationError | NotFoundError>>;
}

/**
 * `createRecipeDetailService`が受け取る依存の集合。
 * `ClaudeMenuClient`/`MenuPromptBuilder`（`buildRecipeDetailPrompt`）は含めず、
 * `MenuGenerator`（task 17.1）のみを注入する（ファイル冒頭コメント参照）。
 */
export interface RecipeDetailServiceDependencies {
  menuPlanRepository: MenuPlanRepository;
  profileGateway: ProfileGateway;
  menuGenerator: MenuGenerator;
  nutritionVerificationService: NutritionVerificationService;
  recipeDetailRepository: RecipeDetailRepository;
  /** 食材名解決に使う（task 16.1、Requirement 4.8）。`resolveIngredientNames`参照。 */
  foodCompositionRepository: FoodCompositionRepository;
}

// --- GenerationError構築ヘルパー（`menu-plan.service.ts`と同じ形状） ---

function generationErrResult<T>(
  reason: GenerationFailureReason,
  message: string
): Result<T, GenerationError> {
  return { ok: false, error: { type: "generation_failed", reason, message } };
}

/**
 * `ClaudeGenerationError.type` → `GenerationFailureReason`のマッピング。
 * `menu-plan.service.ts`の`mapClaudeErrorReason`と同一の対応表だが、本ファイルの
 * task boundary（`RecipeDetailService`のみ変更可）を守るため、非exportのprivate関数である
 * それをimportせず、同一のマッピングをここに複製する（ファイル冒頭コメント参照）。
 */
function mapClaudeErrorReason(type: ClaudeGenerationErrorType): GenerationFailureReason {
  switch (type) {
    case "refusal":
      return "claude_refusal";
    case "request_failed":
      return "claude_request_failed";
    case "schema_validation_failed":
      return "schema_validation_failed";
  }
}

/**
 * `VerifiedNutritionValues`（13項目: エネルギー・PFC・微量栄養素9項目）を`NutritionValues`
 * （4項目: エネルギー・PFCのみ）へ射影する。`SupplementarySuggestion.nutritionDelta` /
 * `RecipeDetail.nutrition`はいずれもRequirement 9.3が明示する「エネルギー量・PFC量」の
 * 4項目のみを持つ形状であり、TypeScriptの構造的部分型（`VerifiedNutritionValues`は
 * `NutritionValues`のスーパーセット）に依存して13項目のオブジェクトをそのまま渡すと、
 * 実行時に微量栄養素9項目が意図せず含まれてしまう（オブジェクトの実際のキー集合は代入時に
 * 絞り込まれない）。したがって明示的な最小の射影関数を用意し、両方の呼び出し箇所
 * （補助副菜の栄養増分・主菜スロット自身の栄養価）で共通して使う。
 */
function projectToNutritionValues(value: VerifiedNutritionValues): NutritionValues {
  return {
    energyKcal: value.energyKcal,
    proteinG: value.proteinG,
    fatG: value.fatG,
    carbG: value.carbG,
  };
}

/**
 * `ingredients`の各`foodId`を`foodCompositionRepository.findById`で解決し、食材名（`name`）を
 * 付与した`ResolvedIngredient[]`を返す（design.md #RecipeDetailService、Requirement 4.8）。
 *
 * ## `findById`が`null`を返すことはないという不変条件について
 * この関数に渡される`ingredients`は、呼び出し時点で必ず次のいずれかの経路で既に
 * `FoodCompositionRepository`に対して存在確認済みである:
 * - 主菜スロット自身の`mealSlot.ingredients`: 元の週間/日単位献立生成時点で、存在しない食品IDは
 *   決して永続化されない（Requirement 4.6、`MenuPlanRepository`/`NutritionVerificationService`の
 *   既存の検証）。
 * - 各補助副菜提案の`ingredients`: この関数を呼ぶ直前に
 *   `nutritionVerificationService.verifyDish(suggestion.ingredients)`（内部で全食材について
 *   `FoodCompositionRepository.findById`を呼ぶ）が既に成功していなければ、そもそもこの関数へは
 *   到達しない（失敗時は`generateForMealSlot`が即座にエラーを返す。上のオーケストレーション手順
 *   5〜6参照）。
 *
 * したがって`findById`が`null`を返すのは通常起こり得ない不変条件違反であり、
 * `shopping-list.service.ts`の`buildItem`・`recipe-detail.repository.ts`の`toGramsOrThrow`と
 * 同じ規約により、`Result`で包まず例外を投げる（非null表明`!`で無言に信頼しない）。
 */
function resolveIngredientNames(
  foodCompositionRepository: FoodCompositionRepository,
  ingredients: IngredientSelection[]
): ResolvedIngredient[] {
  return ingredients.map((ingredient) => {
    const food = foodCompositionRepository.findById(ingredient.foodId);
    if (!food) {
      throw new Error(
        `RecipeDetailService: 食材名解決に失敗しました。foodId "${ingredient.foodId}" が` +
          `食品成分参照データに見つかりません。この関数に渡されるfoodIdは、呼び出し時点で` +
          `既に検証済み（主菜スロットは元の献立生成時点、補助副菜はverifyDish呼び出し）の` +
          `はずです（ファイル冒頭のこの関数のコメント参照）`
      );
    }
    return { ...ingredient, name: food.name };
  });
}

/**
 * `PersistedSupplementarySuggestion`（未解決の`ingredients`）を、食材名解決済みの公開型
 * `SupplementarySuggestion`（`ingredients: ResolvedIngredient[]`）へ変換する（Requirement 4.8）。
 */
function resolveSuggestion(
  foodCompositionRepository: FoodCompositionRepository,
  suggestion: PersistedSupplementarySuggestion
): SupplementarySuggestion {
  return {
    dishName: suggestion.dishName,
    ingredients: resolveIngredientNames(foodCompositionRepository, suggestion.ingredients),
    nutritionDelta: suggestion.nutritionDelta,
  };
}

/**
 * `RecipeDetailRepository.upsert`が返した永続化済みの内部表現（`PersistedRecipeDetail`）と、
 * 元の`mealSlot`（食材名解決前の`ingredients`を持つ）から、返却用の公開型`RecipeDetail`を
 * 組み立てる（Requirement 4.8）。`mealSlotId`/`servings`/`cookingTimeMinutes`/`steps`/`nutrition`は
 * `persisted`の値をそのまま引き継ぎ、`ingredients`（主菜スロット自身の食材、新設）と
 * `supplementarySuggestions`（各要素の`ingredients`）のみを食材名解決する。
 */
function composeRecipeDetail(
  foodCompositionRepository: FoodCompositionRepository,
  persisted: PersistedRecipeDetail,
  mealSlotIngredients: IngredientSelection[]
): RecipeDetail {
  return {
    mealSlotId: persisted.mealSlotId,
    servings: persisted.servings,
    cookingTimeMinutes: persisted.cookingTimeMinutes,
    steps: persisted.steps,
    ingredients: resolveIngredientNames(foodCompositionRepository, mealSlotIngredients),
    nutrition: persisted.nutrition,
    supplementarySuggestions: persisted.supplementarySuggestions.map((suggestion) =>
      resolveSuggestion(foodCompositionRepository, suggestion)
    ),
  };
}

/**
 * `deps`（6つの依存: `MenuPlanRepository` / `ProfileGateway` / `MenuGenerator` /
 * `NutritionVerificationService` / `RecipeDetailRepository` / `FoodCompositionRepository`
 * （task 16.1で追加、食材名解決用））に対する`RecipeDetailService`を生成する。
 * `createMenuPlanService`（`menu-plan.service.ts`）と同じDIファクトリ関数パターンに揃えている。
 */
export function createRecipeDetailService(
  deps: RecipeDetailServiceDependencies
): RecipeDetailService {
  async function generateForMealSlot(
    weekStartDate: IsoDate,
    dayIndex: number,
    mealType: MealType
  ): Promise<Result<RecipeDetail, GenerationError | NotFoundError>> {
    // ステップ1: 対象食事枠の存在確認（design.md「対象の食事枠が MenuPlanRepository に
    // 存在しない場合、生成を行わず NotFoundError を返す」、Requirement 8.1）。
    const mealSlot = deps.menuPlanRepository.findMealSlot(weekStartDate, dayIndex, mealType);
    if (!mealSlot) {
      const notFound: NotFoundError = {
        type: "not_found",
        message:
          `指定された食事枠が有効な献立プラン内に見つかりません` +
          `（weekStartDate: ${weekStartDate}, dayIndex: ${dayIndex}, mealType: ${mealType}）`,
      };
      return { ok: false, error: notFound };
    }

    // ステップ2: プロフィール取得（ファイル冒頭コメント「profileGatewayをP1ではなく
    // 必須依存として扱うことについて」参照）。
    const profile = deps.profileGateway.getCurrentProfile();
    if (profile === null) {
      return generationErrResult(
        "profile_missing",
        "プロフィールが登録されていません。レシピ詳細を生成するには、先にプロフィールを登録してください。"
      );
    }

    // ステップ3〜4: レシピ詳細生成（`MenuGenerator`がプロンプト構築+Claude呼び出しを内部で行う。
    // Requirement 8.1, 9.1, 9.2, 12.3, 12.4相当）。
    const claudeResult = await deps.menuGenerator.generateRecipe(mealSlot, profile);
    if (!claudeResult.ok) {
      return generationErrResult(
        mapClaudeErrorReason(claudeResult.error.type),
        claudeResult.error.message
      );
    }
    const recipeResult = claudeResult.value;

    // ステップ5〜6: 補助副菜1〜2件それぞれの栄養増分を検証・射影する（Requirement 9.1, 9.3）。
    // いずれかが失敗した時点で即座に返し、それ以降の候補は処理しない（部分永続化しない）。
    // `ingredients`はこの時点ではまだ未解決のまま保持する（`PersistedSupplementarySuggestion`、
    // `RecipeDetailRepository.upsert`が期待する形状。食材名解決はupsert後に行う、下記参照）。
    const supplementarySuggestions: PersistedSupplementarySuggestion[] = [];
    for (const suggestion of recipeResult.supplementarySuggestions) {
      const verifyResult = deps.nutritionVerificationService.verifyDish(suggestion.ingredients);
      if (!verifyResult.ok) {
        return generationErrResult(
          verifyResult.error.type,
          `補助副菜「${suggestion.dishName}」の栄養価検証に失敗しました: ${verifyResult.error.message}`
        );
      }
      supplementarySuggestions.push({
        dishName: suggestion.dishName,
        ingredients: suggestion.ingredients,
        nutritionDelta: projectToNutritionValues(verifyResult.value),
      });
    }

    // ステップ7〜8: 永続化（Requirement 8.2, 8.3）。
    // `mealSlot.nutrition`（既に確定済み・検証済みの値）を4項目へ射影して渡す。
    // `meal_slots`/`meal_ingredients`の値そのものは一切変更しない（この関数はそれらへの
    // 書き込みを一度も行わない）。
    const persisted = deps.recipeDetailRepository.upsert(mealSlot.id, {
      servings: recipeResult.servings,
      cookingTimeMinutes: recipeResult.cookingTimeMinutes,
      steps: recipeResult.steps,
      nutrition: projectToNutritionValues(mealSlot.nutrition),
      supplementarySuggestions,
    });

    // ステップ9（task 16.1、Requirement 4.8）: Repositoryの戻り値（`PersistedRecipeDetail`、
    // 食材名は未解決）と、対象食事枠自身の`mealSlot.ingredients`（同じく未解決）から、
    // 食材名解決済みの公開型`RecipeDetail`を組み立てて返す。`persisted`をそのまま返さない
    // （公開型`RecipeDetail`は`persisted`にはない`ingredients`フィールドを新たに持つため）。
    return {
      ok: true,
      value: composeRecipeDetail(deps.foodCompositionRepository, persisted, mealSlot.ingredients),
    };
  }

  return { generateForMealSlot };
}
