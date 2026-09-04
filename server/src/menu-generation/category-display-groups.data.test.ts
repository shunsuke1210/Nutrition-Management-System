import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import {
  ALL_DISPLAY_GROUPS,
  CATEGORY_DISPLAY_GROUPS,
  resolveDisplayGroup,
  type DisplayGroup,
} from "./category-display-groups.data.js";

/**
 * `category-display-groups.data.ts`（task 13.2）のテスト。
 *
 * 中心の検証は「食品カタログ（`010_seed_food_items.sql` が投入する361件）の全カテゴリが
 * 4表示グループのいずれかに解決されること」（タスク自身の完了条件、要件14.4/14.5）であり、
 * これは実際の一時SQLiteデータベース（`createConnection` + `runMigrations`）に対して
 * `SELECT DISTINCT category FROM food_items` を実行し、その実データで検証する
 * （`food-composition.repository.test.ts` の precedent に倣い、モック・フェイクは使用しない）。
 * これにより将来のシードデータ変更で新しいカテゴリが追加/変更されても、このテストが
 * 実際のDBに対して自動的に再検証する。
 */

interface CategoryRow {
  category: string;
}

describe("resolveDisplayGroup", () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-category-display-groups-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    db = createConnection(dbPath);
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("実際に食品カタログへ投入されている全カテゴリ（010_seed_food_items.sqlの実データ）が、4表示グループのいずれかに解決される（タスク13.2自身の完了条件、要件14.4/14.5）", () => {
    const rows = db
      .prepare("SELECT DISTINCT category FROM food_items ORDER BY category")
      .all() as CategoryRow[];

    // 実データが空にならないことも合わせて確認する（DB接続・マイグレーションが
    // 正しく機能していることの前提チェック）。
    expect(rows.length).toBeGreaterThan(0);

    for (const { category } of rows) {
      const resolved = resolveDisplayGroup(category);
      expect(ALL_DISPLAY_GROUPS).toContain(resolved);
    }
  });

  it("実際に食品カタログへ投入されている全カテゴリが、期待通り10種類（主食/肉類/魚介類/卵類/乳類/豆類/野菜類/果実類/調味料類/菓子類）であることを確認する（tasks.mdの2.1実装ノートが記録する分類ラベル集合が現在も正確であることの独立確認）", () => {
    const rows = db
      .prepare("SELECT DISTINCT category FROM food_items ORDER BY category")
      .all() as CategoryRow[];
    const categories = rows.map((r) => r.category).sort();

    expect(categories).toEqual(
      ["主食", "乳類", "卵類", "果実類", "菓子類", "調味料類", "野菜類", "豆類", "肉類", "魚介類"].sort(),
    );
  });

  describe("明確に一致するカテゴリ", () => {
    it.each([
      ["肉類", "肉・魚"],
      ["魚介類", "肉・魚"],
      ["卵類", "乳製品・卵・豆"],
      ["乳類", "乳製品・卵・豆"],
      ["豆類", "乳製品・卵・豆"],
      ["野菜類", "野菜・きのこ"],
    ] as const)("%s は %s に分類される", (category, expected) => {
      expect(resolveDisplayGroup(category)).toBe(expected);
    });
  });

  describe("判断を要したカテゴリ（買い物の実際のアイソール区分に基づく判断）", () => {
    it("果実類は、日本のスーパーの青果コーナー（野菜と果物が同一区画）に倣い、野菜・きのこに分類される", () => {
      expect(resolveDisplayGroup("果実類")).toBe("野菜・きのこ");
    });

    it("調味料類は、名称が直接一致するため調味料・その他に分類される", () => {
      expect(resolveDisplayGroup("調味料類")).toBe("調味料・その他");
    });

    it("主食（米・パン・麺・小麦粉等）は、4グループのいずれにも自然な対応先がないため、要件14.5のフォールバック先である調味料・その他に分類される", () => {
      expect(resolveDisplayGroup("主食")).toBe("調味料・その他");
    });

    it("菓子類（洋菓子・和菓子・スナック・ナッツ等）は、4グループのいずれにも自然な対応先がないため、要件14.5のフォールバック先である調味料・その他に分類される", () => {
      expect(resolveDisplayGroup("菓子類")).toBe("調味料・その他");
    });
  });

  describe("要件14.5: 分類先が定義されていない食品カテゴリのフォールバック", () => {
    it("マッピングに存在しない任意の未来カテゴリ文字列は調味料・その他に分類される", () => {
      expect(resolveDisplayGroup("未来の新カテゴリ")).toBe("調味料・その他");
    });

    it("空文字列も調味料・その他にフォールバックする", () => {
      expect(resolveDisplayGroup("")).toBe("調味料・その他");
    });
  });

  describe("CATEGORY_DISPLAY_GROUPS / ALL_DISPLAY_GROUPS の構造", () => {
    it("ALL_DISPLAY_GROUPSは4つの固定表示グループを、design.mdのShoppingListItem.categoryと同一の文字列で保持する", () => {
      expect(ALL_DISPLAY_GROUPS).toEqual(["野菜・きのこ", "肉・魚", "乳製品・卵・豆", "調味料・その他"]);
    });

    it("CATEGORY_DISPLAY_GROUPSに定義された全ての値がALL_DISPLAY_GROUPSのいずれかである", () => {
      const values = Object.values(CATEGORY_DISPLAY_GROUPS) as DisplayGroup[];
      for (const value of values) {
        expect(ALL_DISPLAY_GROUPS).toContain(value);
      }
    });
  });
});
