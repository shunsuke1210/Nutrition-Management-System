/**
 * FeedbackRepository — `satisfaction_feedback`（満足度フィードバックのスナップショット）への
 * 永続化（upsert）とクエリを担うリポジトリ。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #FeedbackRepository、
 * Requirements 10.2, 10.5）に定義されたService Interfaceをそのまま実装する。
 *
 * ## upsertの実装方針: 単一のSQLite native upsert文
 * `(week_start_date, day_index, meal_type)` のUNIQUE制約（`009_create_satisfaction_feedback.sql`）
 * に対して `INSERT ... ON CONFLICT (...) DO UPDATE ...` の単一SQL文でupsertする
 * （`MenuPlanRepository.replaceWeek` のような `db.transaction(...)` でラップした複数文の
 * 「削除→再挿入」操作とは異なるアプローチ）。`ON CONFLICT` 句が `created_at` を更新対象に
 * 含めないため、既存行の `created_at` には一切触れずに保たれる（新規作成時のみ、渡した
 * `created_at` がそのままINSERTされる）。この1文自体が既にアトミックであるため、追加で
 * `db.transaction(...)` によるラップは不要と判断した。
 *
 * 呼び出し元に返す値は、書き込み内容をそのままechoするのではなく、書き込み直後に同じ主キー
 * （`(week_start_date, day_index, meal_type)`）で読み戻した実際のDB行から構築する
 * （シリアライズの不整合を静かに見逃さないため、`MenuPlanRepository.replaceWeek`/`replaceDay`
 * と同じ「読み戻して返す」規約に倣う）。このINSERT文とその直後のSELECT文は2つの別文だが、
 * better-sqlite3は同期実行であり、design.mdのConcurrency strategy（シングルユーザー・単一
 * プロセス前提のため排他制御は不要）により、その間に他の書き込みが割り込む余地はない。
 *
 * ## primary_food_idsのJSON列変換
 * `primary_food_ids` は `TEXT NOT NULL` 列であり、`SatisfactionFeedbackEntry.primaryFoodIds`
 * （`string[]`）をこのコードベースで初めてTEXT列へJSONシリアライズして永続化する
 * （既存の他Repositoryに配列をTEXT列へ格納する precedent はない）。書き込み時に
 * `JSON.stringify`、読み取り時に `JSON.parse` を用いる、最も単純な往復変換を採用する。
 *
 * ## likedのINTEGER変換
 * `liked` は `INTEGER NOT NULL CHECK (liked IN (0, 1))` 列であり、このコードベースの既存の
 * boolean-as-INTEGER規約（`ProfileRepository`の `dietModeEnabled: row.diet_mode_enabled === 1`
 * と同じ読み取り方針、書き込みは `entry.liked ? 1 : 0`）にそのまま倣う。
 *
 * `meal_slots` へのFKは持たない（design.md #FeedbackRepository: フィードバックは独立した
 * スナップショットとして永続化し、`meal_slots` が再生成で置き換えられてもフィードバック履歴は
 * 失われない）。本Repositoryは `week_menu_plans`/`day_menus`/`meal_slots` を一切参照・検証しない。
 */
import type Database from "better-sqlite3";
import type { IsoDate, MealType } from "@nutrition/shared";

/** design.md #FeedbackRepository Service Interface。 */
export interface SatisfactionFeedbackEntry {
  weekStartDate: IsoDate;
  dayIndex: number;
  mealType: MealType;
  dishName: string;
  primaryFoodIds: string[];
  liked: boolean;
  updatedAt: string;
}

/** design.md #FeedbackRepository Service Interface。 */
export interface FeedbackRepository {
  upsert(entry: Omit<SatisfactionFeedbackEntry, "updatedAt">): SatisfactionFeedbackEntry;
  findRecentDisliked(limit: number): SatisfactionFeedbackEntry[];
}

interface SatisfactionFeedbackRow {
  week_start_date: string;
  day_index: number;
  meal_type: string;
  dish_name: string;
  primary_food_ids: string;
  liked: number;
  updated_at: string;
}

/** `SatisfactionFeedbackRow`（`satisfaction_feedback` の生の読み取り列）を構築するために必要なSELECT句。 */
const SATISFACTION_FEEDBACK_COLUMNS =
  "week_start_date, day_index, meal_type, dish_name, primary_food_ids, liked, updated_at";

function mapRowToEntry(row: SatisfactionFeedbackRow): SatisfactionFeedbackEntry {
  return {
    weekStartDate: row.week_start_date,
    dayIndex: row.day_index,
    mealType: row.meal_type as MealType,
    dishName: row.dish_name,
    primaryFoodIds: JSON.parse(row.primary_food_ids) as string[],
    liked: row.liked === 1,
    updatedAt: row.updated_at,
  };
}

/**
 * `db`（マイグレーション適用済みの better-sqlite3 コネクション）に対する
 * `FeedbackRepository` を生成する。`createFoodCompositionRepository`
 * （`food-composition.repository.ts`）/ `createMenuPlanRepository`（`menu-plan.repository.ts`）と
 * 同じDIファクトリ関数パターンに揃えており、本Repositoryは自らDBコネクションを構築しない。
 */
export function createFeedbackRepository(db: Database.Database): FeedbackRepository {
  function upsert(
    entry: Omit<SatisfactionFeedbackEntry, "updatedAt">
  ): SatisfactionFeedbackEntry {
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO satisfaction_feedback (
         week_start_date, day_index, meal_type, dish_name, primary_food_ids, liked,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (week_start_date, day_index, meal_type) DO UPDATE SET
         dish_name = excluded.dish_name,
         primary_food_ids = excluded.primary_food_ids,
         liked = excluded.liked,
         updated_at = excluded.updated_at`
    ).run(
      entry.weekStartDate,
      entry.dayIndex,
      entry.mealType,
      entry.dishName,
      JSON.stringify(entry.primaryFoodIds),
      entry.liked ? 1 : 0,
      now,
      now
    );

    // 書き込み直後に実際のDB行を読み戻して返す（ファイル冒頭コメント参照）。
    const row = db
      .prepare(
        `SELECT ${SATISFACTION_FEEDBACK_COLUMNS}
           FROM satisfaction_feedback
          WHERE week_start_date = ? AND day_index = ? AND meal_type = ?`
      )
      .get(entry.weekStartDate, entry.dayIndex, entry.mealType) as
      | SatisfactionFeedbackRow
      | undefined;

    if (!row) {
      // UNIQUE制約に基づくupsert直後の自身の主キーによる読み戻しであり、通常到達不能。
      throw new Error(
        `FeedbackRepository.upsert: 永続化直後の行を読み戻せませんでした` +
          `（weekStartDate: ${entry.weekStartDate}, dayIndex: ${entry.dayIndex},` +
          ` mealType: ${entry.mealType}）`
      );
    }

    return mapRowToEntry(row);
  }

  function findRecentDisliked(limit: number): SatisfactionFeedbackEntry[] {
    // liked = 0（false）の行のみを対象とする（design.md Invariant: getDislikedSummary は
    // liked: false のフィードバックのみを対象とする）。limitが実件数を上回っても
    // liked: true の行で水増しすることはない。
    const rows = db
      .prepare(
        `SELECT ${SATISFACTION_FEEDBACK_COLUMNS}
           FROM satisfaction_feedback
          WHERE liked = 0
          ORDER BY updated_at DESC
          LIMIT ?`
      )
      .all(limit) as SatisfactionFeedbackRow[];

    return rows.map(mapRowToEntry);
  }

  return { upsert, findRecentDisliked };
}
