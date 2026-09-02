/**
 * NutritionGateway（`nutrition-engine` の `NutritionService.getSummary(date)` への狭いアクセスポート）。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #NutritionGateway セクション、
 * Requirements 1.5, 4.5, 12.2）に定義された通り、`nutrition-engine` の
 * `NutritionService.getSummary(date)` をプロセス内で呼び出し（HTTP経由の自己呼び出しは行わない）、
 * `dietMode` が非nullの場合はその値を、nullの場合は `normalMode` の値を採用して
 * `NutritionTargetSnapshot` に射影する薄いアダプタである。
 *
 * - `nutrition-engine` が `CalculationUnavailableError` を返す場合、そのままエラーとして
 *   呼び出し元に伝播する（変換・ラップを一切行わない、Requirement 12.2）。
 * - `CalculationUnavailableError` / `CalculationUnavailableReason` は
 *   `shared/src/nutrition.schema.ts` が既にexportしている実際の型（4値:
 *   "profile_missing" | "incomplete_exercise_data" | "incomplete_diet_mode_data" |
 *   "diet_mode_disabled"）をそのまま再利用し、本ファイルでは再定義しない。
 *   design.md #NutritionGateway Service Interfaceブロック自身はこの型を3値
 *   （"diet_mode_disabled" を含まない）でローカル再定義しているが、これは design.md
 *   執筆時点（`nutrition-engine` 側の実型確定前）のドキュメント上のシンプル化・ドリフトであり、
 *   本specが独自に別の（より狭い）型を新設すべき、という指示ではないと判断した。実際に
 *   `nutrition-engine` が返し得る4番目の理由（"diet_mode_disabled"）を本Gatewayが誤って
 *   拒否・後段で型不一致を起こすことを避けるため、実型をそのまま使う。
 *
 * `PfcTargets`（`NutritionTargetSnapshot.pfc` の型）は上記とは異なり、本当に本spec固有の
 * ローカルな射影型である。`nutrition-engine` の実際の `PfcTargets`（`@nutrition/shared`、
 * 6フィールド: proteinG/fatG/carbG/proteinKcal/fatKcal/carbKcal）から3フィールド
 * （proteinG/fatG/carbG）のみを射影するため、本ファイルでは意図的に `MenuPfcTargets` という
 * 別名でローカル定義する。design.md自身は同じ場面（#NutritionGateway と #MenuPromptBuilder の
 * 両方のService Interfaceブロック）で `PfcTargets` という同名を用いているが、同一ファイル内で
 * `@nutrition/shared` の実 `PfcTargets`（6フィールド）とこの3フィールドのローカル型の両方を
 * importする可能性のある将来のファイル（例: task 6.3 `MenuPromptBuilder`）での名前衝突・
 * 取り違えを避けるため、あえて別名にした（詳細はTASK_BRIEF/CONCERNS参照）。
 */
import type { CalculationUnavailableError, IsoDate, NutritionSummary } from "@nutrition/shared";
import type { Result } from "../shared/result.js";
import type { NutritionService } from "../nutrition/nutrition.service.js";

/**
 * `NutritionTargetSnapshot.pfc` の型（design.md #NutritionGateway Service Interfaceの
 * ローカル `PfcTargets` 定義に対応、ファイル冒頭コメント「命名の判断」参照）。
 * `nutrition-engine` の実 `PfcTargets`（6フィールド）から proteinG/fatG/carbG の
 * 3フィールドのみを射影した、本spec専用の狭い形状。
 */
export interface MenuPfcTargets {
  proteinG: number;
  fatG: number;
  carbG: number;
}

/** design.md #NutritionGateway Service Interface。 */
export interface NutritionTargetSnapshot {
  calorieTarget: number;
  pfc: MenuPfcTargets;
  activityLevelLabel: string;
  guardrailWarningTypes: string[];
}

/** design.md #NutritionGateway Service Interface。 */
export interface NutritionGateway {
  getTargetsForDate(date: IsoDate): Result<NutritionTargetSnapshot, CalculationUnavailableError>;
}

/**
 * `nutrition-engine` の実 `PfcTargets`（6フィールド）から、本specが必要とする3フィールドのみを
 * 値の変換を行わずに picking する。
 */
function projectPfc(pfc: NutritionSummary["normalMode"]["pfc"]): MenuPfcTargets {
  return {
    proteinG: pfc.proteinG,
    fatG: pfc.fatG,
    carbG: pfc.carbG,
  };
}

/**
 * `nutritionService`（`nutrition-engine` が構築・注入する `NutritionService` インスタンス）に
 * 依存する `NutritionGateway` を生成する。
 *
 * `createProfileGateway`（`profile.gateway.ts`）と同じDIファクトリ関数パターンに揃えている。
 * 本Gatewayは `NutritionService` の構築（依存Gatewayの配線・DB接続等）を一切行わない。
 */
export function createNutritionGateway(nutritionService: NutritionService): NutritionGateway {
  function getTargetsForDate(
    date: IsoDate
  ): Result<NutritionTargetSnapshot, CalculationUnavailableError> {
    const summaryResult = nutritionService.getSummary(date);
    if (!summaryResult.ok) {
      // Requirement 12.2: CalculationUnavailableErrorをそのまま（変換・再ラップせず）伝播する。
      return summaryResult;
    }

    const summary = summaryResult.value;
    // dietModeが非nullの場合はそちらを、nullの場合はnormalModeを採用する
    // （design.md #NutritionGateway Responsibilities & Constraints）。
    const mode = summary.dietMode ?? summary.normalMode;

    return {
      ok: true,
      value: {
        calorieTarget: mode.calorieTarget,
        pfc: projectPfc(mode.pfc),
        // activityLevelLabelはnormalMode/dietModeの内側ではなく、NutritionSummaryの
        // トップレベルフィールドから取得する。
        activityLevelLabel: summary.activityLevelLabel,
        // dietMode未使用時は空配列（design.md #NutritionGateway コメント参照）。
        guardrailWarningTypes: summary.dietMode?.guardrails.warnings.map((w) => w.type) ?? [],
      },
    };
  }

  return { getTargetsForDate };
}
