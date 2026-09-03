/**
 * MenuPromptBuilder — プロフィール・栄養目標・他日コンテキスト・苦手サマリから
 * Claude向けプロンプト（system/userメッセージ）を構築する。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #MenuPromptBuilder、
 * Requirements 2, 7.2, 7.3, 9.4, 10.3）に定義された3メソッドを、外部依存を持たない
 * 純粋関数として実装する（design.md #MenuPromptBuilder Dependencies:
 * 「なし（外部依存を持たない純粋関数。入力はすべて呼び出し元から渡される）」）。
 * `claude-menu.client.ts`（task 6.1）のtool定義構築関数群が確立した
 * 「ファクトリでラップせず、トップレベル関数を直接exportする」規約に倣う
 * （design.md自身のService Interfaceブロックは `MenuPromptBuilder` という名前の
 * オブジェクト形状で書かれているが、Dependenciesが明示する「純粋関数」という性質は
 * `createXxx(deps)` ファクトリ規約とは相容れないため、3つのトップレベル関数として実装する）。
 *
 * ## DislikedItemSummary について
 * design.md #MenuPromptBuilder Service Interfaceが定義する型だが、これを実際に
 * **生成する** `FeedbackService`（task 7.2）はまだ実装されていない。`OtherDayContext`
 * （`menu-plan.repository.ts`）・`ClaudePromptPayload`（`claude-menu.client.ts`）・
 * `MenuProfileSnapshot`（`profile.gateway.ts`）等で既に確立された「型はそれを最初に
 * 消費/定義する場所に置き、後続タスクがそこからimportする」規約に倣い、本ファイルで
 * 定義・exportする。task 7.2 はこの型をここからimportすることになる。
 *
 * ## system / userMessage の分け方について
 * design.mdはsystem/userの分割方法自体を規定していない。本実装では、プロフィール由来の
 * 制約（NG食材・好み食材・食事制限・自由記述・苦手サマリ等）を「常に守るべきルール」として
 * `system` に、対象週/対象日固有の栄養目標値や他日コンテキスト等「今回のリクエスト固有の
 * データ」を `userMessage` に配置する。この分け方はテスト容易性のための実装判断であり、
 * design.mdの `restrictionNotes` 等の内容がどちらのフィールドに含まれるかという要件は
 * 課されていない（本ファイルのテストも `system`/`userMessage` を連結した全文に対して
 * 各文言の有無を検証し、フィールド分割の詳細には依存しない）。
 *
 * ## 決定論性について（design.md Postconditions）
 * 本ファイルの全関数は、Date.now()・Math.random()・オブジェクトキーの非決定的な列挙順序
 * （`Record<IsoDate, ...>` は日付文字列を明示的にソートしてから列挙する）に依存しない
 * 純粋な文字列構築のみを行う。同一内容の入力（参照は別でも深い等価であればよい）に対して
 * 常にバイト単位で同一の `ClaudePromptPayload` を返す。
 */
import type { MealSlot, IsoDate, RestrictionIntensity, RestrictionType } from "@nutrition/shared";
import type { ClaudePromptPayload } from "./claude-menu.client.js";
import type { NutritionTargetSnapshot } from "./nutrition.gateway.js";
import type { OtherDayContext } from "./menu-plan.repository.js";
import type { MenuProfileSnapshot } from "./profile.gateway.js";

/**
 * design.md #MenuPromptBuilder Service Interface。
 * `FeedbackService`（task 7.2、未実装）が生成する「直近の苦手フィードバックの要約」の形状。
 * 本ファイルで定義し、task 7.2 はここからimportする（ファイル冒頭コメント参照）。
 */
export interface DislikedItemSummary {
  dishName: string;
  foodIds: string[];
}

// --- ラベル（食事制限タイプ・強度の人間可読な日本語表記） ---
// enum値そのもの（例: "low_carb"）もプロンプト中に残す。これによりテスト・ログの双方から
// 実際のenum値を機械的に確認でき、日本語ラベルへの一方向変換によって実値が失われない。

const RESTRICTION_TYPE_LABELS: Record<Exclude<RestrictionType, "none">, string> = {
  low_carb: "低炭水化物",
  low_fat: "低脂質",
  high_protein: "高たんぱく質",
  calorie_only: "カロリーのみ制限",
};

const RESTRICTION_INTENSITY_LABELS: Record<RestrictionIntensity, string> = {
  light: "ゆるめ",
  standard: "標準",
  strict: "厳格",
};

// --- プロフィール由来の共通セクション（buildWeeklyPrompt / buildDailyPrompt / buildRecipeDetailPrompt で再利用） ---

/**
 * NG食材を「除外制約」として明示するセクション（Requirement 2.1）。
 * 「使用禁止」「除外」という、好み食材セクションとは明確に異なる文言を用いる
 * （NG/好みの取り違え・スワップをテストで検出可能にするため）。
 */
function buildNgIngredientsSection(ngIngredients: readonly string[]): string {
  if (ngIngredients.length === 0) {
    return "■ 除外食材（NG食材）\n除外すべき食材は登録されていません。";
  }
  return (
    "■ 除外食材（NG食材・除外制約）\n" +
    `次の食材は使用禁止です。生成する料理の食材として絶対に選択せず、必ず除外してください（除外制約）: ${ngIngredients.join("、")}`
  );
}

/**
 * 好み食材を「優先候補」として明示するセクション（Requirement 2.3）。
 * NG食材とは独立に扱い、「禁止ではなく優先」であることを明示する文言を用いる。
 */
function buildPreferredIngredientsSection(preferredIngredients: readonly string[]): string {
  if (preferredIngredients.length === 0) {
    return "■ 好み食材（優先候補）\n特に優先すべき食材の登録はありません。";
  }
  return (
    "■ 好み食材（優先候補）\n" +
    `次の食材は優先候補です。禁止ではなく、献立に積極的に登場しやすくなるよう優先的に検討してください: ${preferredIngredients.join("、")}`
  );
}

/**
 * 食事制限タイプ・強度を制約として明示するセクション（Requirement 2.2）。
 * タイプが "none"（制限なし）の場合は制限タイプに基づく文言を一切含めないため null を返す
 * （Requirement 2.5: NG食材の除外と好み食材の反映のみを行う）。
 * PFC比率そのものの数値は `NutritionTargetSnapshot.pfc`（呼び出し元が別途渡す）が担い、
 * 本セクションは「方向性」を制約条件として言語化するに留める。
 */
function buildRestrictionSection(
  restrictionType: RestrictionType,
  restrictionIntensity: RestrictionIntensity | null,
): string | null {
  if (restrictionType === "none") {
    return null;
  }
  const typeLabel = RESTRICTION_TYPE_LABELS[restrictionType];
  const intensityLabel =
    restrictionIntensity !== null ? RESTRICTION_INTENSITY_LABELS[restrictionIntensity] : "指定なし";
  return (
    "■ 食事制限タイプ・強度\n" +
    `食事制限タイプ: ${restrictionType}（${typeLabel}）、強度: ${restrictionIntensity ?? "指定なし"}（${intensityLabel}）。` +
    "このタイプ・強度に対応するPFC比率の方向性を、献立生成の制約条件として反映してください。"
  );
}

/**
 * その他の食事制限・自由記述（restrictionNotes）を原文のまま渡すセクション（Requirement 2.4）。
 * 食事制限に限定した解釈をせず、献立全般に関する一般的なガイダンスとして扱う旨を明示する。
 * restrictionType が "none" であっても restrictionNotes は独立した自由記述フィールドのため、
 * 非nullであれば常に含める（restrictionTypeによるゲーティングを行わない）。
 */
function buildRestrictionNotesSection(restrictionNotes: string | null): string | null {
  if (restrictionNotes === null) {
    return null;
  }
  return (
    "■ その他の食事制限・要望（自由記述）\n" +
    "以下はユーザーが自由記述した要望です。食事制限に関する内容に限定して解釈せず、" +
    "献立全体に関する一般的なガイダンスとして、原文のまま（要約・改変せずに）考慮してください:\n" +
    restrictionNotes
  );
}

/** 調理スキル・調理時間の希望・予算感を、料理の複雑さ・食材選定のコンテキストとして含める（Requirement 2.6）。 */
function buildCookingContextSection(profile: MenuProfileSnapshot): string {
  return (
    "■ 調理に関する希望\n" +
    `調理スキル: ${profile.cookingSkill ?? "指定なし"}\n` +
    `調理時間の希望: ${profile.cookingTimePreference ?? "指定なし"}\n` +
    `予算感: ${profile.budgetPreference ?? "指定なし"}\n` +
    "これらを料理の複雑さと食材選定に反映してください。"
  );
}

/**
 * buildWeeklyPrompt / buildDailyPrompt が共通で用いる、プロフィール由来の制約セクション群。
 * restrictionSection / notesSection はそれぞれ独立に null になり得るため、null の場合は
 * 配列に含めない（=文言を一切出力しない）。
 */
function buildProfileConstraintSections(profile: MenuProfileSnapshot): string[] {
  const sections: string[] = [
    buildNgIngredientsSection(profile.ngIngredients),
    buildPreferredIngredientsSection(profile.preferredIngredients),
  ];

  const restrictionSection = buildRestrictionSection(profile.restrictionType, profile.restrictionIntensity);
  if (restrictionSection !== null) {
    sections.push(restrictionSection);
  }

  const notesSection = buildRestrictionNotesSection(profile.restrictionNotes);
  if (notesSection !== null) {
    sections.push(notesSection);
  }

  sections.push(buildCookingContextSection(profile));
  return sections;
}

/**
 * 苦手サマリを「再提案を避ける」制約として明示するセクション（Requirement 10.3）。
 * 空配列の場合でも見出しの下に「該当なし」の一文を置き、末尾に何も続かない不完全な
 * 文言（例: ラベルのみで内容が空のセクション）にならないようにする。
 */
function buildDislikedSummarySection(dislikedSummary: readonly DislikedItemSummary[]): string {
  if (dislikedSummary.length === 0) {
    return "■ 苦手な料理・食材（直近のフィードバック）\n直近で「苦手」と記録された料理はありません。";
  }
  const lines = dislikedSummary.map(
    (item) => `- ${item.dishName}（使用食品ID: ${item.foodIds.join("、")}）`,
  );
  return (
    "■ 苦手な料理・食材（直近のフィードバック）\n" +
    "以下は直近に「苦手」と記録された料理・食材です。同じ料理や、同じ食材を中心とした料理を再提案しないでください:\n" +
    lines.join("\n")
  );
}

// --- 栄養目標のフォーマット ---

function formatNutritionTarget(target: NutritionTargetSnapshot): string {
  const warningsText =
    target.guardrailWarningTypes.length > 0
      ? `、ガードレール警告: ${target.guardrailWarningTypes.join("、")}`
      : "";
  return (
    `目標エネルギー: ${target.calorieTarget}kcal、` +
    `PFC目標: たんぱく質${target.pfc.proteinG}g / 脂質${target.pfc.fatG}g / 炭水化物${target.pfc.carbG}g、` +
    `活動レベル: ${target.activityLevelLabel}${warningsText}`
  );
}

/**
 * `targets`（日付→栄養目標のRecord）を日付の昇順にソートして列挙する。
 * `Object.keys()` の列挙順序（≒キー挿入順）に決定論性を依存させないため、明示的にソートする
 * （design.md Postconditions: 深い等価な入力に対して常に同一の出力を返す）。
 */
function buildWeeklyTargetsSection(targets: Record<IsoDate, NutritionTargetSnapshot>): string {
  const dates = Object.keys(targets).sort();
  const lines = dates.map((date) => {
    const target = targets[date];
    // `dates` は `targets` 自身の `Object.keys()` から得たキーであるため、
    // このルックアップが `undefined` になることはない（`noUncheckedIndexedAccess` 対応）。
    return `・${date}: ${formatNutritionTarget(target as NutritionTargetSnapshot)}`;
  });
  return "■ 週間の栄養目標（日別）\n" + lines.join("\n");
}

function buildDailyTargetSection(target: NutritionTargetSnapshot): string {
  return "■ 対象日の栄養目標\n" + formatNutritionTarget(target);
}

// --- 他日コンテキスト（日単位再生成、Requirement 7.2, 7.3） ---

/**
 * 残り6日分の料理名・食品IDを提示し、それらとの重複を避けるよう明示的に指示するセクション
 * （Requirement 7.2: コンテキストとして与える／7.3: 重複回避の明示的な指示）。
 * `dayIndex` 昇順にソートしてから列挙し、呼び出し元が渡す配列の順序に決定論性を依存させない。
 */
function buildOtherDaysSection(otherDays: readonly OtherDayContext[]): string {
  const sortedDays = [...otherDays].sort((a, b) => a.dayIndex - b.dayIndex);
  const lines = sortedDays.map((day) => {
    const mealsText = day.meals
      .map(
        (meal) =>
          `${meal.mealType}: ${meal.dishName}（食品ID: ${
            meal.foodIds.length > 0 ? meal.foodIds.join("、") : "なし"
          }）`,
      )
      .join("、");
    return `・Day${day.dayIndex}: ${mealsText}`;
  });
  return (
    "■ 残り6日分の献立（確定済み・重複回避のための参考情報）\n" +
    lines.join("\n") +
    "\n" +
    "上記の残り6日分で既に相当量使用されている食材と重複しないよう、食材選定において重複を避けてください。" +
    "同じ食品IDばかりが週を通して繰り返し使われることのないよう注意してください。"
  );
}

// --- 3つのビルダー関数 ---

/**
 * design.md #MenuPromptBuilder Service Interface `buildWeeklyPrompt`
 * （Requirements 1, 2, 10.3）。
 */
export function buildWeeklyPrompt(
  profile: MenuProfileSnapshot,
  targets: Record<IsoDate, NutritionTargetSnapshot>,
  dislikedSummary: DislikedItemSummary[],
): ClaudePromptPayload {
  const system = [
    "あなたは栄養管理アプリの献立生成アシスタントです。以下の制約をすべて厳密に守り、" +
      "1週間分（7日×4食枠=28食枠）の献立を生成してください。",
    ...buildProfileConstraintSections(profile),
    buildDislikedSummarySection(dislikedSummary),
  ].join("\n\n");

  const userMessage = [
    "以下の日別の栄養目標を制約条件として、1週間分の献立を生成してください。",
    buildWeeklyTargetsSection(targets),
  ].join("\n\n");

  return { system, userMessage };
}

/**
 * design.md #MenuPromptBuilder Service Interface `buildDailyPrompt`
 * （Requirements 2, 7.2, 7.3, 10.3）。
 */
export function buildDailyPrompt(
  profile: MenuProfileSnapshot,
  target: NutritionTargetSnapshot,
  otherDays: OtherDayContext[],
  dislikedSummary: DislikedItemSummary[],
): ClaudePromptPayload {
  const system = [
    "あなたは栄養管理アプリの献立生成アシスタントです。以下の制約をすべて厳密に守り、" +
      "対象の1日分（4食枠）の献立のみを再生成してください。残り6日分の献立は変更しません。",
    ...buildProfileConstraintSections(profile),
    buildDislikedSummarySection(dislikedSummary),
  ].join("\n\n");

  const userMessage = [
    "以下の対象日の栄養目標を制約条件として、対象日1日分の献立を生成してください。",
    buildDailyTargetSection(target),
    buildOtherDaysSection(otherDays),
  ].join("\n\n");

  return { system, userMessage };
}

/**
 * design.md #MenuPromptBuilder Service Interface `buildRecipeDetailPrompt`
 * （Requirements 8, 9.4）。
 *
 * `dislikedSummary` を引数に取らない（design.md Service Interfaceのシグネチャどおり）。
 * 好み食材・調理スキル/時間/予算感も引数に取らない（design.md Responsibilities & Constraints
 * が本メソッドについて明示するのは「確定済み食材・分量に基づく手順生成」と「NG食材・食事制限の
 * 制約を補助副菜提案にも適用する指示」のみであるため）。
 */
export function buildRecipeDetailPrompt(
  meal: MealSlot,
  profile: MenuProfileSnapshot,
): ClaudePromptPayload {
  const systemSections: string[] = [
    "あなたは栄養管理アプリのレシピ詳細生成アシスタントです。確定済みの食材・分量に基づいて" +
      "調理手順・分量（人前）・目安調理時間を生成し、もう一品追加する場合の補助副菜候補を1〜2件提案してください。",
    buildNgIngredientsSection(profile.ngIngredients),
  ];

  const restrictionSection = buildRestrictionSection(profile.restrictionType, profile.restrictionIntensity);
  if (restrictionSection !== null) {
    systemSections.push(restrictionSection);
  }

  const notesSection = buildRestrictionNotesSection(profile.restrictionNotes);
  if (notesSection !== null) {
    systemSections.push(notesSection);
  }

  // Requirement 9.4: 追加副菜候補を生成する場合も、献立生成と同様にNG食材・食事制限設定を尊重する。
  systemSections.push(
    "重要: 上記のNG食材の除外および食事制限の制約は、主菜のレシピ手順だけでなく、" +
      "追加で提案する補助副菜（もう一品）の食材選定にも同様に適用してください。" +
      "補助副菜の候補にNG食材を含めたり、食事制限に反する食材を選んだりしないでください。",
  );
  const system = systemSections.join("\n\n");

  const ingredientLines = meal.ingredients
    .map(
      (ingredient) =>
        `- foodId: ${ingredient.foodId}, quantity: ${ingredient.quantity}, unit: ${ingredient.unit}`,
    )
    .join("\n");

  const userMessage = [
    "■ 対象の食事枠",
    `食事種別: ${meal.mealType}`,
    `料理名: ${meal.dishName}`,
    "確定済みの食材・分量（変更しないこと）:",
    ingredientLines,
    "この食材・分量に基づいて調理手順・分量（人前）・目安調理時間を生成してください。" +
      "この食事枠の栄養価は既に確定済みの値であり、変更しないでください（Requirement 8.3）。" +
      "また、もう一品追加する場合の補助副菜候補を1〜2件提案してください。",
  ].join("\n");

  return { system, userMessage };
}
