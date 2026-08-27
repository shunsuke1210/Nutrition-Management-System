import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/**
 * ビルド済みフロントエンド（`web`の成果物、`web/dist`）をFastifyから静的配信する
 * （task 6.1: 「ビルド済みフロントエンド（`web`の成果物）をFastifyから静的配信する設定」、
 * design.md: Technology Stack「Vite 6」「Fastify 5」）。
 *
 * - 新規の Fastify プラグイン依存（例: `@fastify/static`）は追加しない。この機能は
 *   「distディレクトリ配下のファイルをそのまま返す」「ルート `/` は `index.html` を返す」
 *   という最小限の要件しか持たないため、`node:fs` による手書きの実装で十分と判断した
 *   （プラグイン追加によるpackage.jsonの変更・追加npm installを避けるための判断。
 *   CONCERNSに詳細を記載）。
 * - design.md（Domain: UI (Presentation)）はルーティングライブラリを持たない単一ページの
 *   SPAを前提としているため、「どのパスでも常に index.html にフォールバックする」汎用的な
 *   SPAフォールバック（wildcard fallback）は実装しない。実際に `distDir` 配下に存在する
 *   ファイルへのリクエストのみを配信し、それ以外は 404（Fastifyの標準not-foundハンドラ）に
 *   委ねる。これにより、`web/dist` がビルド成果物として存在する場合でも、`/no-such-path`
 *   のような未登録パスへのリクエストは常に404のままになる
 *   （`server/src/index.test.ts` の既存テスト「answers an unregistered path with a
 *   reasonable status」の前提を壊さない）。
 * - `distDir` が存在しない場合（ローカル開発でまだ `npm run build -w web` を実行していない、
 *   または `npm run dev:web` のVite開発サーバーがフロントエンドを別途配信する開発フロー）は
 *   ルートを一切登録せず静かに何もしない。これにより `startServer` がクラッシュせず、
 *   API専用サーバーとして起動できる。
 */

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function contentTypeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * リクエストパスを `distDir` 内の候補ファイルパスへ解決する。ルート `/` は `index.html` に
 * マップする。`..` を含むパス等でdistDir外に脱出しようとするリクエストはガードし、
 * 見つからない扱いとする（パストラバーサル対策）。
 */
function resolveCandidatePath(distDir: string, requestUrl: string): string | null {
  const pathname = decodeURIComponent(requestUrl.split("?")[0] ?? "/");
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolvedDist = path.resolve(distDir);
  const candidate = path.resolve(resolvedDist, relativePath);

  const isWithinDist =
    candidate === resolvedDist || candidate.startsWith(resolvedDist + path.sep);
  if (!isWithinDist) {
    return null;
  }
  return candidate;
}

function serveIfPresent(distDir: string) {
  return (request: FastifyRequest, reply: FastifyReply): void => {
    const candidate = resolveCandidatePath(distDir, request.raw.url ?? request.url);

    if (candidate !== null && existsSync(candidate) && statSync(candidate).isFile()) {
      reply.type(contentTypeFor(candidate)).send(readFileSync(candidate));
      return;
    }

    reply.callNotFound();
  };
}

/**
 * `distDir`（既定は `web/dist`）配下の静的ファイルを配信するルートを `app` に登録する。
 * `distDir` が存在しない場合は何も登録しない（上記ファイルコメント参照）。
 */
export function registerStaticFrontend(app: FastifyInstance, distDir: string): void {
  if (!existsSync(distDir)) {
    return;
  }

  const handler = serveIfPresent(distDir);

  // `/` は find-my-way のワイルドカード（`/*`）が必ずしも空セグメントにマッチするとは限らない
  // ため、ルートパスを明示的に別ルートとして登録する。
  app.get("/", handler);
  app.get("/*", handler);
}
