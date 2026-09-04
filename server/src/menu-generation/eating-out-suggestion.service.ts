/**
 * EatingOutSuggestionService — 食事枠単位の外食代替提案の決定論的選定（task 13.5）。
 *
 * design.md（`.kiro/specs/menu-generation/design.md`、Requirements 15.1-15.7）に定義された
 * オーケストレーションを実装する。
 *
 * ## design.mdにResponsibilities/Service Interfaceの独立節が存在しないことについて
 * design.mdは他の全Domain Service（`RecipeDetailService`/`MenuPlanService`等）と異なり、
 * 本コンポーネントについて独立した「Responsibilities」「Service Interface」の記述を持たない
 * （task 13.1のレビューで既に指摘されたdesign.mdのギャップ）。Componentsテーブルの1行サマリ
 * （`Dependencies: MenuPlanRepository (P0), ProfileGateway (P1), 静的参照データ (P0)`）と、
 * 「外食代替提案生成フロー」シーケンス図、および`EatingOutSuggestion`/
 * `EatingOutSuggestionResult`の結果型ブロックのみが存在する。
 *
 * 本ファイルはこれらとtasks.mdのtask 13.5本文・Requirement 15.1-15.6から、以下のとおり
 * `suggestForMealSlot(weekStartDate, dayIndex, mealType): Result<EatingOutSuggestionResult,
 * NotFoundError>`という同期関数のインターフェースを推論する:
 *   - シーケンス図の`Svc->>Repo: findMealSlot(week, day, meal)`＋`alt 食事枠が存在しない`分岐から、
 *     引数は`MenuPlanRepository.findMealSlot`と同じ`(weekStartDate, dayIndex, mealType)`。
 *   - シーケンス図の`Svc-->>Ctrl: EatingOutSuggestionResult（suggestion: 選定結果 または null）`
 *     という成功時の戻り値と、`NotFoundError`のみを分岐先として明示する失敗系から、
 *     戻り値は`Result<EatingOutSuggestionResult, NotFoundError>`（`RecipeDetailService`等と
 *     異なり`GenerationError`は一切登場しない。Claude APIを呼ばないため生成失敗という概念が
 *     存在しない）。
 *   - 要件15.7「Claude APIによる生成ではなく...静的な参照データ」より、この関数は非同期処理を
 *     一切含まない同期関数（`Promise`を返さない）。
 *
 * ## null-profileをエラーにしないことについて（`RecipeDetailService`との対比、重要な判断）
 * `ProfileGateway`はdesign.mdのComponentsテーブルで本コンポーネントについても優先度P1として
 * 挙げられており、これは`RecipeDetailService`（task 10.1）における`ProfileGateway`の優先度と
 * 同じ表記である。しかし`RecipeDetailService`が`getCurrentProfile() === null`を
 * `GenerationError(profile_missing)`という**ハードな失敗**として扱った判断（同ファイルの
 * 冒頭コメント「profileGatewayをP1ではなく必須依存として扱うことについて」参照）を、本Serviceに
 * そのまま機械的に適用してはならない。理由:
 *
 *   1. `RecipeDetailService`ではプロフィールが`buildRecipeDetailPrompt(meal, profile)`の
 *      **必須引数**であり、プロフィールなしにはプロンプト自体を構築できなかった（本質的な
 *      入力の欠落）。
 *   2. 本Serviceではプロフィールの唯一の用途は`ngIngredients: string[]`によるNG食材除外という
 *      **任意の絞り込み**（要件15.4）にすぎない。コア選定ロジック（mealType一致＋
 *      カロリー以下で最も近いもの）はNG食材情報が一切なくても完全に成立する。
 *   3. task 13.5が引用するRequirement 15.1-15.6には`RecipeDetailService`が参照する
 *      Requirement 12.1（`profile_missing`）が含まれておらず、シーケンス図にも
 *      「プロフィールがnull→エラー」という分岐が一切描かれていない（週間生成フローの
 *      シーケンス図が`profile_missing`分岐を明示的に描くのとは対照的）。
 *
 * したがって本Serviceは`profileGateway.getCurrentProfile()`が`null`を返す場合、これを
 * エラーとせず`ngIngredients = []`（NG食材制約なし）として扱い、絞り込みなしのフル候補集合で
 * 選定処理を継続する。優先度ラベル（P1）はDI配線上の実装難易度を表すに過ぎず、両Serviceで
 * 依存の「機能的な必須性」が同一であることを意味しない。
 *
 * ## NG食材の除外判定に完全一致（exact string equality）を用いることについて
 * 要件15.4の「NG食材一覧に含まれる食材を主要な食材とする参照データの候補を除外する」の
 * 判定方法（完全一致か部分一致か）はdesign.mdでは明記されておらず、
 * `eating-out-reference.data.ts`自身のファイル冒頭コメントも「具体的なアルゴリズムは
 * task 13.5の責務」と明言している。このコードベースの他の箇所（`MenuPromptBuilder`）における
 * NG食材の考慮はClaude自身のプロンプトベースの推論に委ねられており、文字列マッチングの
 * precedentが一切存在しない。したがって本Serviceは`entry.ingredientTags`と
 * `profile.ngIngredients`のどちらも「平易な日本語の食材名の単純な単語」
 * （`eating-out-reference.data.ts`コメント参照）である前提のもと、単純かつ予測可能な
 * **完全一致**（`Array.prototype.includes`）を採用する。あいまい一致（部分文字列・表記ゆれ
 * 吸収等）は将来の要件次第で追加検討され得るが、本タスクの範囲外である。
 *
 * ## 選定ロジックの手順（Requirement 15.1-15.5）
 * 1. `menuPlanRepository.findMealSlot(weekStartDate, dayIndex, mealType)` → `null`なら
 *    `NotFoundError`（要件15.6）。
 * 2. `profileGateway.getCurrentProfile()` → `null`なら`ngIngredients = []`（上記コメント参照）。
 * 3. `EATING_OUT_REFERENCE_DATA`を対象`mealType`に一致する候補のみへ絞り込む（要件15.5）。
 * 4. さらに`entry.ingredientTags`が`ngIngredients`のいずれとも重複しない候補のみへ絞り込む
 *    （要件15.4）。
 * 5. さらに`entry.alternativeMenuKcal <= mealSlot.nutrition.energyKcal`の候補のみへ絞り込む
 *    （要件15.2の「以下」）。
 * 6. 手順3〜5の結果が0件なら、生成失敗ではなく`Result.ok({suggestion: null})`を返す
 *    （要件15.5）。
 * 7. 残った候補から`alternativeMenuKcal`が最大のものを選定する（要件15.2の
 *    「それに最も近いもの」＝カロリー以下という制約の下で最大＝最も近い）。
 *
 * ### タイブレークについて
 * 手順7で複数の候補が同一の最大`alternativeMenuKcal`を持つ場合のタイブレーク規則は
 * design.mdに明記がない。本Serviceは`EATING_OUT_REFERENCE_DATA`配列内で先に出現する
 * （インデックスが小さい）候補を優先する、という最も単純で決定論的な規則を採用する
 * （`Array.prototype.reduce`で厳密な`>`比較を用いることで自然に実現される。同点の場合は
 * 直前までの最良候補＝より早く出現した候補が保持される）。
 */
import type {
  EatingOutSuggestion,
  EatingOutSuggestionResult,
  IsoDate,
  MealType,
} from "@nutrition/shared";
import type { NotFoundError, Result } from "../shared/result.js";
import { EATING_OUT_REFERENCE_DATA, type EatingOutReferenceEntry } from "./eating-out-reference.data.js";
import type { MenuPlanRepository } from "./menu-plan.repository.js";
import type { ProfileGateway } from "./profile.gateway.js";

/**
 * 本ファイル冒頭コメントで推論したService Interface。design.mdに独立した
 * Service Interface節が存在しないため、シーケンス図＋task 13.5本文＋Requirement 15.1-15.6から
 * 導出した（ファイル冒頭コメント参照）。
 */
export interface EatingOutSuggestionService {
  suggestForMealSlot(
    weekStartDate: IsoDate,
    dayIndex: number,
    mealType: MealType
  ): Result<EatingOutSuggestionResult, NotFoundError>;
}

/**
 * 対象`mealType`・`ngIngredients`・`energyKcal`（カロリー基準値）に基づき、
 * `EATING_OUT_REFERENCE_DATA`から選定ロジックの手順3〜5（mealType一致→NG食材除外→
 * カロリー以下）を適用した適格候補一覧を返す。配列の相対順序は`EATING_OUT_REFERENCE_DATA`の
 * 元の順序を保つ（`Array.prototype.filter`はいずれも順序を保存するため、タイブレークの
 * 「先に出現する候補を優先する」規則が成立する前提となる）。
 */
function filterEligibleCandidates(
  mealType: MealType,
  ngIngredients: readonly string[],
  energyKcal: number
): EatingOutReferenceEntry[] {
  return EATING_OUT_REFERENCE_DATA.filter((entry) => entry.mealType === mealType)
    .filter((entry) => !entry.ingredientTags.some((tag) => ngIngredients.includes(tag)))
    .filter((entry) => entry.alternativeMenuKcal <= energyKcal);
}

/**
 * 適格候補（1件以上、呼び出し元が保証する）から`alternativeMenuKcal`が最大のものを選定する
 * （手順7）。タイブレークは配列内で先に出現する候補を優先する（ファイル冒頭コメント参照）。
 */
function selectClosestCandidate(
  candidates: readonly EatingOutReferenceEntry[]
): EatingOutReferenceEntry {
  return candidates.reduce((best, current) =>
    current.alternativeMenuKcal > best.alternativeMenuKcal ? current : best
  );
}

/** 選定した参照データエントリを`EatingOutSuggestion`（`@nutrition/shared`）へ射影する（手順7）。 */
function toSuggestion(entry: EatingOutReferenceEntry): EatingOutSuggestion {
  return {
    typicalMenuName: entry.typicalMenuName,
    typicalMenuKcal: entry.typicalMenuKcal,
    alternativeMenuName: entry.alternativeMenuName,
    alternativeMenuKcal: entry.alternativeMenuKcal,
    proteinDeltaG: entry.alternativeMenuProteinG - entry.typicalMenuProteinG,
  };
}

/**
 * `menuPlanRepository` / `profileGateway`（いずれも既に構築済みの依存）に対する
 * `EatingOutSuggestionService`を生成する。`createShoppingListService`
 * （`shopping-list.service.ts`）と同じ位置引数のDIファクトリ関数パターンに揃えている。
 */
export function createEatingOutSuggestionService(
  menuPlanRepository: MenuPlanRepository,
  profileGateway: ProfileGateway
): EatingOutSuggestionService {
  function suggestForMealSlot(
    weekStartDate: IsoDate,
    dayIndex: number,
    mealType: MealType
  ): Result<EatingOutSuggestionResult, NotFoundError> {
    // 手順1: 対象食事枠の存在確認（要件15.6）。
    const mealSlot = menuPlanRepository.findMealSlot(weekStartDate, dayIndex, mealType);
    if (!mealSlot) {
      const notFound: NotFoundError = {
        type: "not_found",
        message:
          `指定された食事枠が有効な献立プラン内に見つかりません` +
          `（weekStartDate: ${weekStartDate}, dayIndex: ${dayIndex}, mealType: ${mealType}）`,
      };
      return { ok: false, error: notFound };
    }

    // 手順2: プロフィール取得。null-profileはエラーにしない（ファイル冒頭コメント
    // 「null-profileをエラーにしないことについて」参照）。
    const profile = profileGateway.getCurrentProfile();
    const ngIngredients = profile?.ngIngredients ?? [];

    // 手順3〜5: mealType一致→NG食材除外→カロリー以下の絞り込み。
    const candidates = filterEligibleCandidates(
      mealType,
      ngIngredients,
      mealSlot.nutrition.energyKcal
    );

    // 手順6: 適格候補が0件の場合は生成失敗ではなく「該当なし」（要件15.5）。
    if (candidates.length === 0) {
      return { ok: true, value: { suggestion: null } };
    }

    // 手順7: カロリー以下で最も近い（=最大の）候補を選定する。
    const selected = selectClosestCandidate(candidates);

    return { ok: true, value: { suggestion: toSuggestion(selected) } };
  }

  return { suggestForMealSlot };
}
