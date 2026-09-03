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
 * ## MenuPromptBuilder を依存として注入しないことについて
 * design.mdの依存関係表は本Serviceの依存として `MenuPromptBuilder` を挙げるが、
 * `menu-prompt.builder.ts` 自身のファイル冒頭コメントのとおり、
 * `buildWeeklyPrompt`/`buildDailyPrompt`/`buildRecipeDetailPrompt` は「外部依存を持たない純粋
 * 関数として3つのトップレベル関数」であり、`createXxx(deps)` ファクトリ規約に従わない。
 * `menu-plan.service.ts`（task 9.1）が確立したprecedent（`MenuPlanServiceDependencies`に
 * `MenuPromptBuilder`を含めず、`buildWeeklyPrompt`を直接importして呼び出す）に倣い、
 * 本Serviceの依存一覧にも`MenuPromptBuilder`を含めず、`buildRecipeDetailPrompt`を直接importする。
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
 * 3. `buildRecipeDetailPrompt(mealSlot, profile)`でプロンプトを構築する。
 * 4. `claudeMenuClient.generateRecipe(payload)` → 失敗時は`ClaudeGenerationError.type`を
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
 *    `SupplementarySuggestion`を組み立てる。
 * 7. `mealSlot.nutrition`（`VerifiedNutritionValues`、既に確定済み・検証済みの値）も同じ
 *    射影関数で4項目へ射影し、`recipeDetailRepository.upsert`へ渡す`detail.nutrition`とする
 *    （`RecipeDetailRepository`はこの値を実際には保存せず`meal_slots`から再導出するが、
 *    design.mdのPostconditions「対象食事枠の栄養価は変更しない」を裏付ける意味論的に正しい
 *    値を渡すことで、Repositoryの将来の実装変更に対しても堅牢にする）。
 * 8. `recipeDetailRepository.upsert(mealSlot.id, detail)`を呼び、その戻り値を
 *    `Result.ok(...)`としてそのまま返す（再構築しない。design.md #RecipeDetailRepository
 *    Responsibilities「upsertは永続化した内容をそのまま読み戻して返す」ため、Repositoryの
 *    戻り値こそが最終的な正しい答えである）。
 */
import type { NutritionValues, RecipeDetail, SupplementarySuggestion } from "@nutrition/shared";
import type { IsoDate, MealType, VerifiedNutritionValues } from "@nutrition/shared";
import type { NotFoundError, Result } from "../shared/result.js";
import type { ClaudeGenerationErrorType, ClaudeMenuClient } from "./claude-menu.client.js";
import type { MenuPlanRepository } from "./menu-plan.repository.js";
import { buildRecipeDetailPrompt } from "./menu-prompt.builder.js";
import type { NutritionVerificationService } from "./nutrition-verification.service.js";
import type { ProfileGateway } from "./profile.gateway.js";
import type { RecipeDetailRepository } from "./recipe-detail.repository.js";
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
 * `MenuPromptBuilder`（`buildRecipeDetailPrompt`）は含めない（ファイル冒頭コメント参照）。
 */
export interface RecipeDetailServiceDependencies {
  menuPlanRepository: MenuPlanRepository;
  profileGateway: ProfileGateway;
  claudeMenuClient: ClaudeMenuClient;
  nutritionVerificationService: NutritionVerificationService;
  recipeDetailRepository: RecipeDetailRepository;
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
 * `deps`（5つの依存: `MenuPlanRepository` / `ProfileGateway` / `ClaudeMenuClient` /
 * `NutritionVerificationService` / `RecipeDetailRepository`）に対する`RecipeDetailService`を
 * 生成する。`createMenuPlanService`（`menu-plan.service.ts`）と同じDIファクトリ関数パターンに
 * 揃えている。
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

    // ステップ3: プロンプト構築（`MenuPromptBuilder`は実関数を直接呼び出す）。
    const payload = buildRecipeDetailPrompt(mealSlot, profile);

    // ステップ4: Claudeへのレシピ詳細生成要求（Requirement 8.1, 9.1, 9.2, 12.3, 12.4相当）。
    const claudeResult = await deps.claudeMenuClient.generateRecipe(payload);
    if (!claudeResult.ok) {
      return generationErrResult(
        mapClaudeErrorReason(claudeResult.error.type),
        claudeResult.error.message
      );
    }
    const recipeResult = claudeResult.value;

    // ステップ5〜6: 補助副菜1〜2件それぞれの栄養増分を検証・射影する（Requirement 9.1, 9.3）。
    // いずれかが失敗した時点で即座に返し、それ以降の候補は処理しない（部分永続化しない）。
    const supplementarySuggestions: SupplementarySuggestion[] = [];
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

    // Repositoryの戻り値をそのまま返す（再構築しない、ファイル冒頭コメント参照）。
    return { ok: true, value: persisted };
  }

  return { generateForMealSlot };
}
