import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import {
  createFeedbackRepository,
  type FeedbackRepository,
  type SatisfactionFeedbackEntry,
} from "./feedback.repository.js";

/**
 * FeedbackRepository（task 7.1）のテスト。
 *
 * `009_create_satisfaction_feedback.sql` が定義する `satisfaction_feedback` テーブルに対して、
 * 実際の一時SQLiteデータベース（`createConnection` + `runMigrations`）を用いて検証する。
 * モック・フェイクは使用しない（`food-composition.repository.test.ts` / `profile.repository.test.ts`
 * の precedent に倣う）。
 *
 * `satisfaction_feedback` は `meal_slots` へのFKを持たない独立テーブルであるため（design.md
 * #FeedbackRepository）、テストは `week_menu_plans` / `meal_slots` 等の親データを一切用意せず、
 * `(weekStartDate, dayIndex, mealType)` の組のみを直接 upsert する。
 */

type FeedbackEntryInput = Omit<SatisfactionFeedbackEntry, "updatedAt">;

function buildEntry(overrides: Partial<FeedbackEntryInput> = {}): FeedbackEntryInput {
  return {
    weekStartDate: "2026-09-07",
    dayIndex: 0,
    mealType: "breakfast",
    dishName: "鶏むね肉の照り焼き",
    primaryFoodIds: ["11221", "06061"],
    liked: true,
    ...overrides,
  };
}

/** `profile.repository.test.ts` の precedent と同じ、実時間差でタイムスタンプ順序を証明するヘルパー。 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `liked`/`primary_food_ids` の生のDB値をリポジトリの読み取り経路を経由せず直接確認するための行型。 */
interface RawSatisfactionFeedbackRow {
  created_at: string;
  updated_at: string;
  liked: number;
  primary_food_ids: string;
  dish_name: string;
}

describe("FeedbackRepository", () => {
  let tmpDir: string;
  let db: Database.Database;
  let repository: FeedbackRepository;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-feedback-repo-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    db = createConnection(dbPath);
    runMigrations(db);
    repository = createFeedbackRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function readRawRow(
    weekStartDate: string,
    dayIndex: number,
    mealType: string
  ): RawSatisfactionFeedbackRow | undefined {
    return db
      .prepare(
        `SELECT created_at, updated_at, liked, primary_food_ids, dish_name
           FROM satisfaction_feedback
          WHERE week_start_date = ? AND day_index = ? AND meal_type = ?`
      )
      .get(weekStartDate, dayIndex, mealType) as RawSatisfactionFeedbackRow | undefined;
  }

  describe("upsert()", () => {
    it("creates a new row on a brand-new (weekStartDate, dayIndex, mealType) triple, with created_at === updated_at (Req 10.2)", () => {
      const result = repository.upsert(buildEntry());

      expect(result.weekStartDate).toBe("2026-09-07");
      expect(result.dayIndex).toBe(0);
      expect(result.mealType).toBe("breakfast");
      expect(result.dishName).toBe("鶏むね肉の照り焼き");
      expect(result.primaryFoodIds).toEqual(["11221", "06061"]);
      expect(result.liked).toBe(true);
      expect(typeof result.updatedAt).toBe("string");
      expect(result.updatedAt.length).toBeGreaterThan(0);

      const raw = readRawRow("2026-09-07", 0, "breakfast");
      expect(raw).toBeDefined();
      expect(raw?.created_at.length).toBeGreaterThan(0);
      expect(raw?.updated_at).toBe(result.updatedAt);
      // 初回作成時は created_at === updated_at（同一書き込みで両方セットされる）
      expect(raw?.created_at).toBe(raw?.updated_at);
    });

    it("updates dishName/primaryFoodIds/liked to the NEW values on a second upsert to the same triple (Req 10.5)", () => {
      repository.upsert(
        buildEntry({
          dishName: "旧: 豚の生姜焼き",
          primaryFoodIds: ["11163"],
          liked: false,
        })
      );

      const updated = repository.upsert(
        buildEntry({
          dishName: "新: 鮭の塩焼き",
          primaryFoodIds: ["10134", "06215"],
          liked: true,
        })
      );

      expect(updated.dishName).toBe("新: 鮭の塩焼き");
      expect(updated.primaryFoodIds).toEqual(["10134", "06215"]);
      expect(updated.liked).toBe(true);

      const raw = readRawRow("2026-09-07", 0, "breakfast");
      expect(raw?.dish_name).toBe("新: 鮭の塩焼き");
      expect(JSON.parse(raw?.primary_food_ids ?? "[]")).toEqual(["10134", "06215"]);
      expect(raw?.liked).toBe(1);
    });

    it("advances updated_at while leaving created_at UNCHANGED across a second upsert (Req 10.5)", async () => {
      const first = repository.upsert(buildEntry());

      await wait(20);

      const second = repository.upsert(buildEntry({ dishName: "更新後の料理", liked: false }));

      expect(second.updatedAt).not.toBe(first.updatedAt);

      const raw = readRawRow("2026-09-07", 0, "breakfast");
      // 初回作成時は created_at === updated_at だったので、firstのupdatedAtがcreated_atの初期値
      expect(raw?.created_at).toBe(first.updatedAt);
      expect(raw?.updated_at).toBe(second.updatedAt);
      expect(raw?.created_at).not.toBe(raw?.updated_at);
    });

    it("never lets a duplicate row exist for the same (weekStartDate, dayIndex, mealType) triple across two upsert calls (Req 10.5, DB UNIQUE constraint)", () => {
      repository.upsert(buildEntry());
      repository.upsert(buildEntry({ dishName: "別の料理" }));

      const countRow = db
        .prepare(
          `SELECT COUNT(*) as count FROM satisfaction_feedback
            WHERE week_start_date = ? AND day_index = ? AND meal_type = ?`
        )
        .get("2026-09-07", 0, "breakfast") as { count: number };

      expect(countRow.count).toBe(1);
    });

    it("round-trips primaryFoodIds through JSON serialization for an empty array", () => {
      const result = repository.upsert(buildEntry({ primaryFoodIds: [] }));
      expect(result.primaryFoodIds).toEqual([]);

      const raw = readRawRow("2026-09-07", 0, "breakfast");
      expect(JSON.parse(raw?.primary_food_ids ?? "null")).toEqual([]);
    });

    it("round-trips primaryFoodIds through JSON serialization for a multi-element array", () => {
      const ids = ["11221", "06061", "01088", "04032"];
      const result = repository.upsert(buildEntry({ primaryFoodIds: ids }));
      expect(result.primaryFoodIds).toEqual(ids);

      const raw = readRawRow("2026-09-07", 0, "breakfast");
      expect(JSON.parse(raw?.primary_food_ids ?? "null")).toEqual(ids);
    });

    it("persists liked:true as raw INTEGER 1 and reads it back as boolean true", () => {
      const result = repository.upsert(buildEntry({ liked: true }));
      expect(result.liked).toBe(true);

      const raw = readRawRow("2026-09-07", 0, "breakfast");
      expect(raw?.liked).toBe(1);
    });

    it("persists liked:false as raw INTEGER 0 and reads it back as boolean false", () => {
      const result = repository.upsert(buildEntry({ liked: false }));
      expect(result.liked).toBe(false);

      const raw = readRawRow("2026-09-07", 0, "breakfast");
      expect(raw?.liked).toBe(0);
    });

    it("treats two triples differing only in dayIndex as independent rows (upsert on one never affects the other)", () => {
      repository.upsert(buildEntry({ dayIndex: 0, dishName: "day0の料理", liked: true }));
      repository.upsert(buildEntry({ dayIndex: 1, dishName: "day1の料理", liked: false }));

      repository.upsert(buildEntry({ dayIndex: 0, dishName: "day0の更新後", liked: false }));

      const day0 = readRawRow("2026-09-07", 0, "breakfast");
      const day1 = readRawRow("2026-09-07", 1, "breakfast");

      expect(day0?.dish_name).toBe("day0の更新後");
      expect(day0?.liked).toBe(0);
      expect(day1?.dish_name).toBe("day1の料理");
      expect(day1?.liked).toBe(0);

      const countRow = db.prepare(`SELECT COUNT(*) as count FROM satisfaction_feedback`).get() as {
        count: number;
      };
      expect(countRow.count).toBe(2);
    });

    it("treats two triples differing only in mealType as independent rows (upsert on one never affects the other)", () => {
      repository.upsert(buildEntry({ mealType: "breakfast", dishName: "朝食", liked: true }));
      repository.upsert(buildEntry({ mealType: "lunch", dishName: "昼食", liked: true }));

      repository.upsert(
        buildEntry({ mealType: "breakfast", dishName: "朝食の更新後", liked: false })
      );

      const breakfast = readRawRow("2026-09-07", 0, "breakfast");
      const lunch = readRawRow("2026-09-07", 0, "lunch");

      expect(breakfast?.dish_name).toBe("朝食の更新後");
      expect(breakfast?.liked).toBe(0);
      expect(lunch?.dish_name).toBe("昼食");
      expect(lunch?.liked).toBe(1);
    });
  });

  describe("findRecentDisliked()", () => {
    it("returns only liked:false rows, ordered by updated_at DESC, honoring the limit both above and below the disliked count (design.md Invariant: getDislikedSummary source)", async () => {
      // A(disliked, oldest) -> B(liked) -> C(disliked) -> D(disliked, newest) -> E(liked)
      const a = repository.upsert(
        buildEntry({ dayIndex: 0, dishName: "A: 苦手1(最古)", liked: false })
      );
      await wait(15);
      repository.upsert(buildEntry({ dayIndex: 1, dishName: "B: 好き", liked: true }));
      await wait(15);
      const c = repository.upsert(
        buildEntry({ dayIndex: 2, dishName: "C: 苦手2", liked: false })
      );
      await wait(15);
      const d = repository.upsert(
        buildEntry({ dayIndex: 3, dishName: "D: 苦手3(最新)", liked: false })
      );
      await wait(15);
      repository.upsert(buildEntry({ dayIndex: 4, dishName: "E: 好き", liked: true }));

      // limitが実際の苦手件数(3件)より少ない場合: 最新のlimit件のみ、順序は新しい順
      const top2 = repository.findRecentDisliked(2);
      expect(top2).toHaveLength(2);
      expect(top2.map((entry) => entry.dishName)).toEqual([d.dishName, c.dishName]);
      expect(top2.every((entry) => entry.liked === false)).toBe(true);

      // limitが実際の苦手件数(3件)より多い場合: liked:trueで水増しせず3件のみ返す
      const allDisliked = repository.findRecentDisliked(10);
      expect(allDisliked).toHaveLength(3);
      expect(allDisliked.map((entry) => entry.dishName)).toEqual([
        d.dishName,
        c.dishName,
        a.dishName,
      ]);
      expect(allDisliked.some((entry) => entry.liked === true)).toBe(false);
    });

    it("returns an empty array when there are no disliked rows at all", () => {
      repository.upsert(buildEntry({ liked: true }));
      expect(repository.findRecentDisliked(5)).toEqual([]);
    });
  });
});
