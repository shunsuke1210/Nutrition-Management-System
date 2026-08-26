/**
 * `@nutrition/server` エントリポイント。
 *
 * SQLiteコネクションの確立・起動時マイグレーションの適用・Fastifyアプリの起動を行う。
 * `resolvePort` / `resolveDbPath` / `startServer` は環境変数マップを明示的な引数として
 * 受け取れるようにしており、テストが `process.env` を汚染せずに検証できるようにしている
 * （本番実行時はデフォルト引数 `process.env` が使われる）。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { closeConnection, getConnection } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";

const DEFAULT_PORT = 3000;

/**
 * `PORT` 環境変数からリッスンポートを解決する。
 * 未設定・空文字・整数として解釈できない値・範囲外（0-65535外）の場合は既定値3000を使う。
 * `0` は有効な指定として扱う（OSに空きポートを割り当てさせる用途）。
 */
export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PORT;
  if (raw === undefined || raw === "") {
    return DEFAULT_PORT;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : DEFAULT_PORT;
}

/**
 * `NUTRITION_DB_PATH` 環境変数からSQLiteファイルのパスを解決する。
 * 未設定の場合は `<cwd>/data/nutrition.db` を使う。
 */
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.NUTRITION_DB_PATH ?? path.join(process.cwd(), "data", "nutrition.db");
}

/**
 * 共有SQLiteコネクション（`db/connection.ts` の `getConnection` シングルトン）を確立して
 * マイグレーションを適用し、共通エラーハンドラ設定済みのFastifyアプリを起動する。
 *
 * アプリが `close()` されたとき（テストの後片付け・プロセス終了時のグレースフルシャットダウン）に
 * 共有コネクションも確実に閉じるよう、`onClose` フックで `closeConnection()` を呼び出す。
 * これによりファイルハンドルが残留せず、後続の `startServer` 呼び出しが別のDBパスで
 * 新しいコネクションを確立できる。
 *
 * 呼び出し元（テスト含む）が起動後のアプリを `close()` できるよう、
 * リッスン中の `FastifyInstance` を返す。
 */
export async function startServer(env: NodeJS.ProcessEnv = process.env): Promise<FastifyInstance> {
  const db = getConnection(resolveDbPath(env));
  runMigrations(db);

  const app = buildApp();
  app.addHook("onClose", async () => {
    closeConnection();
  });

  await app.listen({ port: resolvePort(env), host: "0.0.0.0" });
  return app;
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  startServer().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
