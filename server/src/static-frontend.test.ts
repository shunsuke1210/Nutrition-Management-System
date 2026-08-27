import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { registerStaticFrontend } from "./static-frontend.js";

/**
 * `registerStaticFrontend`（task 6.1: 「ビルド済みフロントエンドをFastifyから静的配信する」）
 * のユニットテスト。`web/dist` を模した一時ディレクトリを実際に作成し、`buildApp()` から
 * 得た実際のFastifyインスタンスに登録して `app.inject()` でHTTP境界を通過させることで検証する
 * （`profile.routes.test.ts` / `daily-log.routes.test.ts` と同じ規約）。
 */
describe("registerStaticFrontend", () => {
  let distDir: string;
  let app: FastifyInstance;

  beforeEach(() => {
    distDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-static-frontend-test-"));
  });

  afterEach(async () => {
    await app.close();
    rmSync(distDir, { recursive: true, force: true });
  });

  it("does not register any route when distDir does not exist (dev context before `npm run build -w web`)", async () => {
    rmSync(distDir, { recursive: true, force: true });
    app = buildApp({ logger: false });

    registerStaticFrontend(app, distDir);

    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(404);
  });

  it("serves index.html with text/html content-type for GET / (browser can reach the SPA entry point)", async () => {
    writeFileSync(path.join(distDir, "index.html"), "<!doctype html><title>t</title><div id=\"root\"></div>");
    app = buildApp({ logger: false });

    registerStaticFrontend(app, distDir);

    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("<div id=\"root\"></div>");
  });

  it("serves a real built asset file (e.g. web/dist/assets/index-*.js) with a JS content-type", async () => {
    writeFileSync(path.join(distDir, "index.html"), "<!doctype html>");
    mkdirSync(path.join(distDir, "assets"));
    writeFileSync(path.join(distDir, "assets", "index-ABC123.js"), "console.log('hi');");
    app = buildApp({ logger: false });

    registerStaticFrontend(app, distDir);

    const response = await app.inject({ method: "GET", url: "/assets/index-ABC123.js" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/javascript");
    expect(response.body).toBe("console.log('hi');");
  });

  it("returns 404 (not the SPA index.html) for a path that matches no real file under distDir", async () => {
    writeFileSync(path.join(distDir, "index.html"), "<!doctype html>");
    app = buildApp({ logger: false });

    registerStaticFrontend(app, distDir);

    const response = await app.inject({ method: "GET", url: "/no-such-path" });

    expect(response.statusCode).toBe(404);
  });

  it("does not serve a file outside distDir via a path-traversal request", async () => {
    writeFileSync(path.join(distDir, "index.html"), "<!doctype html>");
    const secretPath = path.join(distDir, "..", "secret.txt");
    writeFileSync(secretPath, "top secret");

    try {
      app = buildApp({ logger: false });
      registerStaticFrontend(app, distDir);

      const response = await app.inject({ method: "GET", url: "/%2e%2e/secret.txt" });

      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain("top secret");
    } finally {
      rmSync(secretPath, { force: true });
    }
  });

  it("does not shadow an already-registered /api route with the static wildcard fallback", async () => {
    writeFileSync(path.join(distDir, "index.html"), "<!doctype html>");
    app = buildApp({ logger: false });
    app.get("/api/profile", () => ({ marker: "api-route-still-wins" }));

    registerStaticFrontend(app, distDir);

    const response = await app.inject({ method: "GET", url: "/api/profile" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ marker: "api-route-still-wins" });
  });
});
