import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDbPath, resolvePort, startServer } from "./index.js";
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

describe("startServer", () => {
  let tmpDir: string | undefined;
  let app: FastifyInstance | undefined;

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

    app = await startServer({ PORT: "0", NUTRITION_DB_PATH: dbPath });

    const address = app.server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/no-such-path`);

    expect(response.status).toBe(404);
  });
});
