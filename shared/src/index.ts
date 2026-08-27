/**
 * `@nutrition/shared` エントリポイント。
 *
 * プロフィール集約・日次ログ集約の Zod スキーマおよび推論型を re-export する。
 * `server` / `web` はこのパッケージを通じて同一のバリデーションルールと型を共有する。
 */

export * from "./profile.schema.js";
export * from "./daily-log.schema.js";
export * from "./nutrition.schema.js";

/**
 * `SHARED_PACKAGE_NAME` / `ping()` は task 1.1 で導入されたビルドパイプライン疎通確認用の
 * プレースホルダーであり、`server`（`server/src/index.ts`）と `web`（`web/src/greeting.ts`,
 * `web/src/App.tsx`）が現時点でも参照しているため、本タスク（1.2, shared schemas 境界）では
 * 削除せず維持する。
 */

/** shared パッケージが疎通していることを示す固定文字列 */
export const SHARED_PACKAGE_NAME = "@nutrition/shared" as const;

/**
 * ヘルスチェック用のトリビアルな関数。
 * server / web から import できることを確認する目的のみに使用する。
 */
export function ping(): string {
  return "shared:ok";
}
