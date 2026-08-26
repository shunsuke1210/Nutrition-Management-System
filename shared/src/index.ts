/**
 * `@nutrition/shared` エントリポイント（プレースホルダー）。
 *
 * 実際のZodスキーマ・型定義（ProfileInputSchema 等）は task 1.2 で追加される。
 * このファイルは task 1.1 の時点でモノレポのビルド/テストパイプラインおよび
 * ワークスペース間の依存解決（server / web からの import）が機能することを
 * 証明するための最小限のプレースホルダーである。
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
