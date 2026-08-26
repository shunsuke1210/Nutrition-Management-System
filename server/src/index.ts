/**
 * `@nutrition/server` エントリポイント（プレースホルダー）。
 *
 * 実際のFastifyアプリのブートストラップ（app.ts）は task 1.4 で追加される。
 * このファイルは task 1.1 の時点でサーバーワークスペースのビルド/開発/テスト
 * パイプラインと、`@nutrition/shared` への依存解決が機能することを証明する
 * ための最小限のプレースホルダーである。
 */
import { ping } from "@nutrition/shared";

/**
 * ヘルスチェック用のトリビアルな関数。
 * `@nutrition/shared` からの import が正しく解決されることを確認する目的のみに使用する。
 */
export function healthCheck(): string {
  return `server:ok+${ping()}`;
}
