import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDbPath, resolvePort, resolveWebDistPath, startServer } from "./index.js";
import type { FastifyInstance } from "fastify";

/**
 * `checkAnthropicApiKeyConfigured`（`startServer` 内から呼び出される）が出力する警告文言。
 * テスト側で部分一致させる（`console.warn` が他の理由で呼ばれた場合との誤検知を避けるため、
 * 「呼ばれたかどうか」だけでなく本文言の有無を確認する）。
 */
const ANTHROPIC_API_KEY_WARNING_SUBSTRING = "ANTHROPIC_API_KEY";

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
    "registers the Nutrition controller so GET /api/nutrition/summary is reachable on the " +
      "same running instance that also answers /api/profile and /api/daily-logs/:date " +
      "(task 4.2 observable completion condition)",
    async () => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-server-test-"));
      const dbPath = path.join(tmpDir, "test.db");
      const noDistPath = path.join(tmpDir, "no-such-dist");

      app = await startServer({ PORT: "0", NUTRITION_DB_PATH: dbPath, NUTRITION_WEB_DIST_PATH: noDistPath });
      const address = app.server.address() as AddressInfo;
      const base = `http://127.0.0.1:${address.port}`;

      // 新規の一時DBにはプロフィールが未登録のため、`NutritionService.getSummary` は
      // `profile_missing` の `CalculationUnavailableError` を返し、
      // `NutritionController`（`nutrition.routes.ts`）はこれをHTTP 409に変換する。
      // これはバグではなく、配線がサービス層まで実際に到達していることを示す正当な応答である
      // （`nutrition.service.ts` の `getSummary` 冒頭のコメント参照）。
      const nutritionResponse = await fetch(`${base}/api/nutrition/summary`);
      expect(nutritionResponse.status).toBe(409);
      const nutritionBody = (await nutritionResponse.json()) as {
        type: string;
        reason: string;
      };
      expect(nutritionBody.type).toBe("calculation_unavailable");
      expect(nutritionBody.reason).toBe("profile_missing");

      // 同一の起動済みインスタンス上で、既存のProfile/DailyLogルートも引き続き到達可能である
      // ことを確認する（このタスクが既存ルーティングに変更を加えていないことの確認）。
      const profileResponse = await fetch(`${base}/api/profile`);
      expect(profileResponse.status).toBe(200);
      expect(await profileResponse.json()).toBeNull();

      const dailyLogResponse = await fetch(`${base}/api/daily-logs/2026-01-01`);
      expect(dailyLogResponse.status).toBe(200);
      expect(await dailyLogResponse.json()).toBeNull();
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

  // task 1.5: `checkAnthropicApiKeyConfigured` がstartup時に呼ばれ、ANTHROPIC_API_KEYの
  // 有無に応じて警告の要否を切り替えることを、実際に起動したサーバーインスタンス経由で確認する。
  // 未設定でもサーバー自体は正常に起動し、既存のAPI（/api/profile等）が引き続き応答することも
  // あわせて確認する（menu-generationの独自ルートはまだ配線されていないため、キー欠如を
  // 致命的エラーにしてはならない、というこのタスクの制約の観測可能な条件）。
  it(
    "warns that ANTHROPIC_API_KEY is not configured when it is absent from env, without " +
      "preventing the server from starting and serving existing routes",
    async () => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-server-test-"));
      const dbPath = path.join(tmpDir, "test.db");
      const noDistPath = path.join(tmpDir, "no-such-dist");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      try {
        // ANTHROPIC_API_KEYを含めない env を明示的に渡す（process.envを汚染しない）。
        app = await startServer({
          PORT: "0",
          NUTRITION_DB_PATH: dbPath,
          NUTRITION_WEB_DIST_PATH: noDistPath,
        });

        const warnedAboutApiKey = warnSpy.mock.calls.some((call) =>
          call.some(
            (arg) => typeof arg === "string" && arg.includes(ANTHROPIC_API_KEY_WARNING_SUBSTRING),
          ),
        );
        expect(warnedAboutApiKey).toBe(true);

        // キー欠如は起動を妨げない: 既存のルートは引き続き正常に応答する。
        const address = app.server.address() as AddressInfo;
        const profileResponse = await fetch(`http://127.0.0.1:${address.port}/api/profile`);
        expect(profileResponse.status).toBe(200);
      } finally {
        warnSpy.mockRestore();
      }
    },
  );

  it(
    "does not warn about ANTHROPIC_API_KEY when a (fake, non-functional) value is present in env",
    async () => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-server-test-"));
      const dbPath = path.join(tmpDir, "test.db");
      const noDistPath = path.join(tmpDir, "no-such-dist");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      try {
        // 実際のAnthropic APIへは一切アクセスしない、単なるプレースホルダー値。
        // このタスクは `new Anthropic(...)` を構築しないため、ネットワーク呼び出しは発生しない。
        app = await startServer({
          PORT: "0",
          NUTRITION_DB_PATH: dbPath,
          NUTRITION_WEB_DIST_PATH: noDistPath,
          ANTHROPIC_API_KEY: "test-key-not-real",
        });

        const warnedAboutApiKey = warnSpy.mock.calls.some((call) =>
          call.some(
            (arg) => typeof arg === "string" && arg.includes(ANTHROPIC_API_KEY_WARNING_SUBSTRING),
          ),
        );
        expect(warnedAboutApiKey).toBe(false);
      } finally {
        warnSpy.mockRestore();
      }
    },
  );
});
