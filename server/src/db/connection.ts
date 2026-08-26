import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DEFAULT_DB_PATH =
  process.env.NUTRITION_DB_PATH ?? path.join(process.cwd(), "data", "nutrition.db");

let singleton: Database.Database | null = null;

/**
 * 指定したファイルパスに対する新しいbetter-sqlite3コネクションを作成する。
 *
 * `exercise_routine_entries` / `ng_ingredients` / `preferred_ingredients` /
 * `exercise_log_entries` の `ON DELETE CASCADE` 制約を機能させるため、
 * better-sqlite3ではデフォルト無効な外部キー制約を `PRAGMA foreign_keys = ON` で有効化する。
 */
export function createConnection(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (dir && dir !== ".") {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  return db;
}

/**
 * アプリケーション全体で共有する単一のコネクションインスタンスを返す。
 * 未生成の場合は `dbPath`（省略時は `NUTRITION_DB_PATH` 環境変数、
 * さらに未設定なら `<cwd>/data/nutrition.db`）で新規作成する。
 */
export function getConnection(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  if (!singleton) {
    singleton = createConnection(dbPath);
  }
  return singleton;
}

/** 共有インスタンスを閉じてリセットする（テスト・シャットダウン用）。 */
export function closeConnection(): void {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}
