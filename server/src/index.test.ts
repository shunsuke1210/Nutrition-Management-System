import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDbPath, resolvePort, resolveWebDistPath, startServer } from "./index.js";
import type { FastifyInstance } from "fastify";

describe("resolvePort", () => {
  it("defaults to 3000 when PORT is unset", () => {
    expect(resolvePort({})).toBe(3000);
  });

  it("uses the PORT environment variable when it is a valid port number", () => {
    expect(resolvePort({ PORT: "4100" })).toBe(4100);
  });

  it("accepts 0 to let the OS assign an ephemeral port", () => {
    expect(resolvePort({ PORT: "0" })).toBe(0);
  });

  it("falls back to the default for a non-numeric PORT value", () => {
    expect(resolvePort({ PORT: "not-a-port" })).toBe(3000);
  });

  it("falls back to the default for a negative PORT value", () => {
    expect(resolvePort({ PORT: "-1" })).toBe(3000);
  });
});

describe("resolveDbPath", () => {
  it("uses NUTRITION_DB_PATH when set", () => {
    expect(resolveDbPath({ NUTRITION_DB_PATH: "/tmp/custom.db" })).toBe("/tmp/custom.db");
  });

  it("defaults to <cwd>/data/nutrition.db when unset", () => {
    expect(resolveDbPath({})).toBe(path.join(process.cwd(), "data", "nutrition.db"));
  });
});

describe("resolveWebDistPath", () => {
  it("uses NUTRITION_WEB_DIST_PATH when set", () => {
    expect(resolveWebDistPath({ NUTRITION_WEB_DIST_PATH: "/tmp/custom-dist" })).toBe(
      "/tmp/custom-dist",
    );
  });

  it("defaults to the repo's web/dist directory when unset", () => {
    const resolved = resolveWebDistPath({});
    expect(resolved.endsWith(path.join("web", "dist"))).toBe(true);
  });
});

describe("startServer", () => {
  let tmpDir: string | undefined;
  let app: FastifyInstance | undefined;

  // 各テストで `NUTRITION_WEB_DIST_PATH` を明示的に存在しない一時パスへ向け、リポジトリの
  // 実際の `web/dist`（ローカルで `npm run build -w web` 済みだと存在しうる）に依存しない
  // ようにする。Implementation Notes (1.4) の警告どおり、`getConnection` はプロセス内で
  // シングルトンのため、`afterEach` で必ず `app.close()`（→ `onClose` フックで
  // `closeConnection()`）してから次のテストに進む。
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("runs migrations against a real SQLite file, starts listening, and answers an unregistered path with a reasonable status", async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-server-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    const noDistPath = path.join(tmpDir, "no-such-dist");

    app = await startServer({ PORT: "0", NUTRITION_DB_PATH: dbPath, NUTRITION_WEB_DIST_PATH: noDistPath });

    const address = app.server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/no-such-path`);

    expect(response.status).toBe(404);
  });

  it(
    "registers the Profile and Daily Log controllers so both /api/profile and " +
      "/api/daily-logs/:date are reachable on the same running instance " +
      "(task 6.1 observable completion condition)",
    async () => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-server-test-"));
      const dbPath = path.join(tmpDir, "test.db");
      const noDistPath = path.join(tmpDir, "no-such-dist");

      app = await startServer({ PORT: "0", NUTRITION_DB_PATH: dbPath, NUTRITION_WEB_DIST_PATH: noDistPath });
      const address = app.server.address() as AddressInfo;
      const base = `http://127.0.0.1:${address.port}`;

      const profileResponse = await fetch(`${base}/api/profile`);
      expect(profileResponse.status).toBe(200);
      expect(await profileResponse.json()).toBeNull();

      const dailyLogResponse = await fetch(`${base}/api/daily-logs/2026-01-01`);
      expect(dailyLogResponse.status).toBe(200);
      expect(await dailyLogResponse.json()).toBeNull();

      // 保存→取得の往復も実サーバーインスタンス上で確認する（配線ミスにより
      // Serviceが未初期化のままDBに書き込めない、といった問題を検出するため）。
      const putResponse = await fetch(`${base}/api/daily-logs/2026-01-01`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weightKg: 65.5 }),
      });
      expect(putResponse.status).toBe(200);
      const putBody = (await putResponse.json()) as { weightKg: number };
      expect(putBody.weightKg).toBe(65.5);
    },
  );

  it(
    "serves the built frontend's index.html for GET / (browser can reach ProfilePage) from the " +
      "same running instance that also answers /api/profile (task 6.1 observable completion condition)",
    async () => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-server-test-"));
      const dbPath = path.join(tmpDir, "test.db");

      // 実際に `vite build` を実行して `web/dist` を生成するテストは、テスト実行の重さ・
      // フロントエンドのビルド設定への結合度の高さに対して得られる保証の増分が小さいと判断し、
      // ここでは行わない（CONCERNS参照）。代わりに、`web/dist` と同じ構造（`index.html` +
      // `assets/*.js`）を持つ最小限の一時ディレクトリを用意し、`registerStaticFrontend`
      // （`static-frontend.test.ts` で単体検証済み）が実際の `startServer` 経由の配線の中でも
      // 同じ実ファイルを配信することを確認する。「本物のReactビルド成果物を配信できるか」は
      // `static-frontend.test.ts` のMIMEタイプ検証が既にカバーしており、ここでの目的は
      // 「`startServer` がそれを正しい `distDir` で呼び出しているか」の配線確認である。
      const distDir = path.join(tmpDir, "web-dist");
      mkdirSync(distDir, { recursive: true });
      writeFileSync(
        path.join(distDir, "index.html"),
        '<!doctype html><html><body><div id="root">task-6-1-e2e-marker</div></body></html>',
      );

      app = await startServer({
        PORT: "0",
        NUTRITION_DB_PATH: dbPath,
        NUTRITION_WEB_DIST_PATH: distDir,
      });
      const address = app.server.address() as AddressInfo;
      const base = `http://127.0.0.1:${address.port}`;

      const pageResponse = await fetch(`${base}/`);
      expect(pageResponse.status).toBe(200);
      expect(pageResponse.headers.get("content-type")).toContain("text/html");
      const pageBody = await pageResponse.text();
      expect(pageBody).toContain("task-6-1-e2e-marker");

      const apiResponse = await fetch(`${base}/api/profile`);
      expect(apiResponse.status).toBe(200);
    },
  );
});
