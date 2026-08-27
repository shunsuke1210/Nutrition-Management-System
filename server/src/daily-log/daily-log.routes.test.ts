import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DailyLogInput, ExerciseEntryInput } from "@nutrition/shared";
import { buildApp } from "../app.js";
import { createConnection } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { createDailyLogRepository } from "./daily-log.repository.js";
import { createDailyLogService } from "./daily-log.service.js";
import { registerDailyLogRoutes } from "./daily-log.routes.js";

/**
 * `DailyLogController`（`registerDailyLogRoutes`）の統合テスト
 * （design.md: Domain: UI (Presentation) > API Contract > Daily Log）。
 *
 * `buildApp()` から得た実際のFastifyインスタンスに、実際の一時SQLiteファイルで
 * 裏付けされた `DailyLogRepository` + `DailyLogService` を渡して本ルートを登録し、
 * `app.inject()` でHTTP境界を実際に通過させることで検証する
 * （task 2.3 の `profile.routes.test.ts` と同じ規約）。
 *
 * 本テストファイル自身がこのタスク専用の登録用エントリポイントであり、
 * `server/src/app.ts` / `server/src/index.ts` 自体は変更しない（task 3.3 の境界）。
 */

describe("DailyLogController (daily-log.routes)", () => {
  let tmpDir: string;
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-daily-log-routes-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    db = createConnection(dbPath);
    runMigrations(db);

    const dailyLogRepository = createDailyLogRepository(db);
    const dailyLogService = createDailyLogService(dailyLogRepository);

    app = buildApp({ logger: false });
    registerDailyLogRoutes(app, dailyLogService);
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("GET /api/daily-logs/:date", () => {
    it("returns 200 with null when no record exists yet for the date (Req 11.1)", async () => {
      const response = await app.inject({ method: "GET", url: "/api/daily-logs/2026-08-01" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toBeNull();
    });
  });

  describe("PUT /api/daily-logs/:date -> GET /api/daily-logs?from=&to= (task 3.3 observable completion condition, Req 11.1, 11.4)", () => {
    it("returns saved dates within the range in ascending date order, regardless of write order", async () => {
      const laterDate = "2026-08-03";
      const earlierDate = "2026-08-01";

      const putLater = await app.inject({
        method: "PUT",
        url: `/api/daily-logs/${laterDate}`,
        payload: { weightKg: 63 } satisfies DailyLogInput,
      });
      expect(putLater.statusCode).toBe(200);

      const putEarlier = await app.inject({
        method: "PUT",
        url: `/api/daily-logs/${earlierDate}`,
        payload: { weightKg: 65 } satisfies DailyLogInput,
      });
      expect(putEarlier.statusCode).toBe(200);

      const rangeResponse = await app.inject({
        method: "GET",
        url: "/api/daily-logs?from=2026-08-01&to=2026-08-05",
      });

      expect(rangeResponse.statusCode).toBe(200);
      const body = rangeResponse.json() as Array<{ date: string; weightKg: number | null }>;
      expect(body.map((entry) => entry.date)).toEqual([earlierDate, laterDate]);
      expect(body[0]?.weightKg).toBe(65);
      expect(body[1]?.weightKg).toBe(63);
    });
  });

  describe("PUT /api/daily-logs/:date validation (Req 8.5)", () => {
    it("returns 400 with field errors when weightKg is <= 0", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/api/daily-logs/2026-08-01",
        payload: { weightKg: 0 } satisfies DailyLogInput,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
      expect(body.type).toBe("validation");
      expect(body.fieldErrors.weightKg?.length).toBeGreaterThan(0);
    });
  });

  describe("PUT /api/daily-logs/:date/planned-calories (Req 9.1, 9.3)", () => {
    it("sets plannedKcal and is reflected by a subsequent GET", async () => {
      const putResponse = await app.inject({
        method: "PUT",
        url: "/api/daily-logs/2026-08-01/planned-calories",
        payload: { plannedKcal: 2000 },
      });

      expect(putResponse.statusCode).toBe(200);
      const putBody = putResponse.json();
      expect(putBody.plannedKcal).toBe(2000);
      expect(putBody.calorieIntakeActual).toBe(2000);
      expect(putBody.calorieIntakeSource).toBe("planned");

      const getResponse = await app.inject({ method: "GET", url: "/api/daily-logs/2026-08-01" });
      expect(getResponse.statusCode).toBe(200);
      const getBody = getResponse.json();
      expect(getBody.plannedKcal).toBe(2000);
    });

    it("does not overwrite a manual override set beforehand via PUT /api/daily-logs/:date (Req 9.1, 9.2, 9.3 end-to-end)", async () => {
      const overridePut = await app.inject({
        method: "PUT",
        url: "/api/daily-logs/2026-08-01",
        payload: { manualOverrideKcal: 1800 } satisfies DailyLogInput,
      });
      expect(overridePut.statusCode).toBe(200);

      const plannedPut = await app.inject({
        method: "PUT",
        url: "/api/daily-logs/2026-08-01/planned-calories",
        payload: { plannedKcal: 2200 },
      });
      expect(plannedPut.statusCode).toBe(200);

      const getResponse = await app.inject({ method: "GET", url: "/api/daily-logs/2026-08-01" });
      expect(getResponse.statusCode).toBe(200);
      const body = getResponse.json();
      expect(body.manualOverrideKcal).toBe(1800);
      expect(body.plannedKcal).toBe(2200);
      expect(body.calorieIntakeActual).toBe(1800);
      expect(body.calorieIntakeSource).toBe("manual");
    });
  });

  describe("POST /api/daily-logs/:date/exercise-entries (Req 10.1, 10.2, 10.3, 10.5)", () => {
    it("creates an entry with an id, and a subsequent GET for that date includes it", async () => {
      const input: ExerciseEntryInput = {
        activityName: "ジョギング",
        durationMinutes: 30,
        estimatedCaloriesBurned: 250,
      };

      const postResponse = await app.inject({
        method: "POST",
        url: "/api/daily-logs/2026-08-01/exercise-entries",
        payload: input,
      });

      expect(postResponse.statusCode).toBe(200);
      const postBody = postResponse.json();
      expect(postBody.activityName).toBe(input.activityName);
      expect(typeof postBody.id).toBe("number");

      const getResponse = await app.inject({ method: "GET", url: "/api/daily-logs/2026-08-01" });
      expect(getResponse.statusCode).toBe(200);
      const getBody = getResponse.json();
      expect(getBody.exerciseEntries).toHaveLength(1);
      expect(getBody.exerciseEntries[0].id).toBe(postBody.id);
    });

    it("returns 400 when durationMinutes <= 0", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/daily-logs/2026-08-01/exercise-entries",
        payload: {
          activityName: "ジョギング",
          durationMinutes: 0,
          estimatedCaloriesBurned: 250,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
      expect(body.type).toBe("validation");
      expect(body.fieldErrors.durationMinutes?.length).toBeGreaterThan(0);
    });
  });

  describe("DELETE /api/daily-logs/:date/exercise-entries/:entryId (Req 10.4)", () => {
    it("returns 204 and removes an existing entry, confirmed by a subsequent GET", async () => {
      const postResponse = await app.inject({
        method: "POST",
        url: "/api/daily-logs/2026-08-01/exercise-entries",
        payload: {
          activityName: "ジョギング",
          durationMinutes: 30,
          estimatedCaloriesBurned: 250,
        } satisfies ExerciseEntryInput,
      });
      const entryId = postResponse.json().id as number;

      const deleteResponse = await app.inject({
        method: "DELETE",
        url: `/api/daily-logs/2026-08-01/exercise-entries/${entryId}`,
      });

      expect(deleteResponse.statusCode).toBe(204);
      expect(deleteResponse.body).toBe("");

      const getResponse = await app.inject({ method: "GET", url: "/api/daily-logs/2026-08-01" });
      expect(getResponse.json().exerciseEntries).toHaveLength(0);
    });

    it("returns 404 for a non-existent entryId", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/daily-logs/2026-08-01/exercise-entries/999999",
      });

      expect(response.statusCode).toBe(404);
      const body = response.json() as { type: string; message: string };
      expect(body.type).toBe("not_found");
    });

    it("removes only the targeted entry, leaving another entry's original field values intact (Req 10.3, 10.4 isolation)", async () => {
      const date = "2026-08-01";
      const firstInput: ExerciseEntryInput = {
        activityName: "ジョギング",
        durationMinutes: 30,
        estimatedCaloriesBurned: 250,
      };
      const secondInput: ExerciseEntryInput = {
        activityName: "水泳",
        durationMinutes: 45,
        estimatedCaloriesBurned: 400,
      };

      const firstPost = await app.inject({
        method: "POST",
        url: `/api/daily-logs/${date}/exercise-entries`,
        payload: firstInput,
      });
      expect(firstPost.statusCode).toBe(200);
      const firstId = firstPost.json().id as number;

      const secondPost = await app.inject({
        method: "POST",
        url: `/api/daily-logs/${date}/exercise-entries`,
        payload: secondInput,
      });
      expect(secondPost.statusCode).toBe(200);
      const secondId = secondPost.json().id as number;

      type EntryView = {
        id: number;
        activityName: string;
        durationMinutes: number;
        estimatedCaloriesBurned: number;
      };

      const afterBothPosts = await app.inject({ method: "GET", url: `/api/daily-logs/${date}` });
      const entriesAfterBothPosts = afterBothPosts.json().exerciseEntries as EntryView[];
      expect(entriesAfterBothPosts).toHaveLength(2);
      // Compare against the ORIGINAL SENT PAYLOADS (not merely the POST response's echoed
      // id), so this is a genuine round-trip proof rather than a circular self-consistency
      // check (per Implementation Notes (7.3)'s distinction).
      expect(entriesAfterBothPosts.find((entry) => entry.id === firstId)).toMatchObject(
        firstInput
      );
      expect(entriesAfterBothPosts.find((entry) => entry.id === secondId)).toMatchObject(
        secondInput
      );

      const deleteResponse = await app.inject({
        method: "DELETE",
        url: `/api/daily-logs/${date}/exercise-entries/${firstId}`,
      });
      expect(deleteResponse.statusCode).toBe(204);

      const afterDelete = await app.inject({ method: "GET", url: `/api/daily-logs/${date}` });
      const entriesAfterDelete = afterDelete.json().exerciseEntries as EntryView[];

      // Isolation: deleting the first entry removes ONLY that entry -- the second entry
      // survives with its original field values untouched (Req 10.3, 10.4).
      expect(entriesAfterDelete).toHaveLength(1);
      expect(entriesAfterDelete.some((entry) => entry.id === firstId)).toBe(false);
      expect(entriesAfterDelete.find((entry) => entry.id === secondId)).toMatchObject(
        secondInput
      );
    });
  });

  describe("GET /api/daily-logs range query validation (Req 11.1)", () => {
    it("returns 400 when both from and to are missing", async () => {
      const response = await app.inject({ method: "GET", url: "/api/daily-logs" });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
      expect(body.type).toBe("validation");
    });

    it("returns 400 when from is malformed", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/daily-logs?from=not-a-date&to=2026-08-31",
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
      expect(body.type).toBe("validation");
      expect(body.fieldErrors.from?.length).toBeGreaterThan(0);
    });

    it("returns an empty array when the range contains no records (Req 11.2)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/daily-logs?from=2026-01-01&to=2026-01-31",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });
  });

  it("does not require any Authorization header or cookie for any endpoint to succeed (Req 12.1, 12.2, 12.3)", async () => {
    // No auth header/cookie is ever set in any request across this file, and every request
    // above succeeds when the input itself is valid — this test makes that assertion explicit.
    const response = await app.inject({ method: "GET", url: "/api/daily-logs/2026-08-01" });

    expect(response.statusCode).toBe(200);
  });
});
