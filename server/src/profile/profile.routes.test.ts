import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ProfileInput } from "@nutrition/shared";
import { buildApp } from "../app.js";
import { createConnection } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { createProfileRepository } from "./profile.repository.js";
import { createProfileService } from "./profile.service.js";
import { registerProfileRoutes } from "./profile.routes.js";

/**
 * `ProfileController`（`registerProfileRoutes`）の統合テスト
 * （design.md: System Flows > プロフィール保存フロー、API Contract > Profile）。
 *
 * `buildApp()` から得た実際のFastifyインスタンスに、実際の一時SQLiteファイルで
 * 裏付けされた `ProfileRepository` + `ProfileService` を渡して本ルートを登録し、
 * `app.inject()` でHTTP境界を実際に通過させることで検証する。
 *
 * 本テストファイル自身がこのタスク専用の登録用エントリポイントであり、
 * `server/src/app.ts` / `server/src/index.ts` 自体は変更しない（task 2.3 の境界）。
 */

function buildValidProfileInput(overrides: Partial<ProfileInput> = {}): ProfileInput {
  return {
    heightCm: 170,
    weightKg: 65,
    age: 30,
    gender: "male",
    bodyFatPct: 18,
    medicalNotes: null,
    pregnancyStatus: "none",
    sleepHours: 7,
    alcoholHabit: "occasional",
    smokingHabit: "non_smoker",
    cookingSkill: null,
    cookingTimePreference: null,
    budgetPreference: null,
    jobActivityLevel: "mixed",
    commuteMethod: "transit",
    averageDailySteps: 6000,
    exerciseRoutine: [
      {
        scene: "commute",
        content: "自転車通勤",
        frequencyPerWeek: 5,
        durationMinutes: 20,
        intensity: "light",
      },
    ],
    ngIngredients: ["パクチー"],
    preferredIngredients: ["鶏むね肉"],
    restrictionType: "none",
    restrictionIntensity: null,
    restrictionNotes: null,
    dietModeEnabled: false,
    goalWeightKg: null,
    goalPeriodWeeks: null,
    ...overrides,
  };
}

describe("ProfileController (profile.routes)", () => {
  let tmpDir: string;
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-profile-routes-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    db = createConnection(dbPath);
    runMigrations(db);

    const profileRepository = createProfileRepository(db);
    const profileService = createProfileService(profileRepository);

    app = buildApp({ logger: false });
    registerProfileRoutes(app, profileService);
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/profile returns 200 with null when no profile has been saved yet (Req 7.2)", async () => {
    const response = await app.inject({ method: "GET", url: "/api/profile" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toBeNull();
  });

  it("PUT /api/profile with a valid ProfileInput returns 200 with the persisted Profile (Req 1.5)", async () => {
    const input = buildValidProfileInput();

    const response = await app.inject({ method: "PUT", url: "/api/profile", payload: input });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.heightCm).toBe(input.heightCm);
    expect(body.weightKg).toBe(input.weightKg);
    expect(body.age).toBe(input.age);
    expect(body.gender).toBe(input.gender);
    expect(body.exerciseRoutine).toEqual(input.exerciseRoutine);
    expect(body.ngIngredients).toEqual(input.ngIngredients);
    expect(body.preferredIngredients).toEqual(input.preferredIngredients);
    expect(typeof body.createdAt).toBe("string");
    expect(typeof body.updatedAt).toBe("string");
  });

  it("GET /api/profile immediately after PUT returns the same profile content that was just saved (Req 1.5, 7.1 — task 2.3 observable completion condition)", async () => {
    const input = buildValidProfileInput({ heightCm: 182, weightKg: 77, gender: "female" });

    const putResponse = await app.inject({ method: "PUT", url: "/api/profile", payload: input });
    expect(putResponse.statusCode).toBe(200);
    const putBody = putResponse.json();

    const getResponse = await app.inject({ method: "GET", url: "/api/profile" });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual(putBody);
  });

  it(
    "GET /api/profile after PUT with a maximally-populated payload returns every field intact " +
      "against the original input — extended fields, multi-row exercise routine (order preserved), " +
      "multi-entry NG/preferred ingredient lists, and a non-'none' restriction type with its required " +
      "intensity (Req 7.1, 3.1, 3.2, 3.3, 3.4, 4.6, 4.7, 4.8, 4.9)",
    async () => {
      const input = buildValidProfileInput({
        bodyFatPct: 24.5,
        medicalNotes: "花粉症、乳製品アレルギー",
        pregnancyStatus: "pregnant",
        sleepHours: 6.5,
        alcoholHabit: "frequent",
        smokingHabit: "smoker",
        cookingSkill: "上級者",
        cookingTimePreference: "30分以内",
        budgetPreference: "800円前後",
        jobActivityLevel: "mostly_active",
        commuteMethod: "walk_or_bike",
        averageDailySteps: 9500,
        // 場面・内容・頻度・時間・強度の異なる複数行を、GET側で順序が保持されることまで
        // 検証できるよう意図的に非自明な順序で並べる（Req 4.6, 4.7）。
        exerciseRoutine: [
          {
            scene: "commute",
            content: "自転車通勤",
            frequencyPerWeek: 5,
            durationMinutes: 20,
            intensity: "light",
          },
          {
            scene: "work",
            content: "階段昇降",
            frequencyPerWeek: 3,
            durationMinutes: 15,
            intensity: "vigorous",
          },
          {
            scene: "holiday",
            content: "ジョギング",
            frequencyPerWeek: 1,
            durationMinutes: 40,
            intensity: "moderate",
          },
        ],
        ngIngredients: ["パクチー", "レバー", "ウニ"],
        preferredIngredients: ["鶏むね肉", "ブロッコリー", "オートミール"],
        restrictionType: "low_carb",
        restrictionIntensity: "strict",
        restrictionNotes: "16時以降の糖質を控えたい",
        dietModeEnabled: true,
        goalWeightKg: 62,
        goalPeriodWeeks: 16,
      });

      const putResponse = await app.inject({ method: "PUT", url: "/api/profile", payload: input });
      expect(putResponse.statusCode).toBe(200);

      const getResponse = await app.inject({ method: "GET", url: "/api/profile" });
      expect(getResponse.statusCode).toBe(200);

      // Profile は ProfileInput を createdAt/updatedAt で拡張した形状なので
      // （shared/src/profile.schema.ts: ProfileSchema = ProfileInputShape.extend(...)）、
      // その2項目を除いた残りが送信した input と厳密に一致することを1つのdeep-equalで
      // 検証する。これにより ProfileInput のフィールドが将来増えても、手動での列挙漏れなく
      // 「全項目が往復する」ことを機械的に保証できる。
      const { createdAt, updatedAt, ...persisted } = getResponse.json() as Record<string, unknown>;
      expect(typeof createdAt).toBe("string");
      expect(typeof updatedAt).toBe("string");
      expect(persisted).toEqual(input);
    }
  );

  it("PUT /api/profile with a missing required field (gender) returns 400 with field-level error details (Req 1.2)", async () => {
    const input = buildValidProfileInput();
    const invalidInput = { ...input } as Record<string, unknown>;
    delete invalidInput.gender;

    const response = await app.inject({
      method: "PUT",
      url: "/api/profile",
      payload: invalidInput,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { type: string; fieldErrors: Record<string, string[]> };
    expect(body.type).toBe("validation");
    expect(body.fieldErrors.gender?.length).toBeGreaterThan(0);
  });

  it("does not require any Authorization header or cookie for GET or PUT to succeed (Req 12.1, 12.2, 12.3)", async () => {
    // No auth header/cookie is ever set in any request across this file, and every request
    // above succeeds when the input itself is valid — this test makes that assertion explicit
    // for GET, which has no other precondition to fail on.
    const response = await app.inject({ method: "GET", url: "/api/profile" });

    expect(response.statusCode).toBe(200);
  });
});
