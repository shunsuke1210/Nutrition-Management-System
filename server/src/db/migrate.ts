import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = path.join(CURRENT_DIR, "migrations");

interface AppliedMigrationRow {
  name: string;
}

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`
  );
}

function getAppliedMigrationNames(db: Database.Database): Set<string> {
  const rows = db
    .prepare("SELECT name FROM schema_migrations")
    .all() as AppliedMigrationRow[];
  return new Set(rows.map((row) => row.name));
}

function listMigrationFiles(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * `migrationsDir`（デフォルトは同階層の `migrations/`）内の番号付きSQLファイルを
 * ファイル名の昇順（数値プレフィックスによる適用順）で読み込み、未適用のものだけを
 * トランザクション内で順次適用する起動時マイグレーションランナー。
 *
 * 適用済みのファイル名は `schema_migrations` テーブルに記録するため、
 * 同一DBに対して複数回呼び出しても冪等に動作する（再実行しても再適用・エラーにならない）。
 *
 * `migrationsDir` はこのモジュールファイルの実際の配置場所（`import.meta.url` 由来）を
 * 起点に解決するため、開発時（`server/src/db/migrations`）・ビルド後
 * （`server/dist/db/migrations`、ビルド時に `scripts/copy-migrations.mjs` でコピーされる）の
 * どちらでも、OSのパス区切りに依存せず正しく動作する。
 */
export function runMigrations(
  db: Database.Database,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR
): void {
  ensureMigrationsTable(db);
  const applied = getAppliedMigrationNames(db);
  const pendingFiles = listMigrationFiles(migrationsDir).filter(
    (fileName) => !applied.has(fileName)
  );

  for (const fileName of pendingFiles) {
    const sql = readFileSync(path.join(migrationsDir, fileName), "utf8");
    const applyMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
        fileName,
        new Date().toISOString()
      );
    });
    applyMigration();
  }
}
