import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection } from "./connection.js";
import { runMigrations } from "./migrate.js";

/**
 * `011_seed_unit_conversions.sql`（分量単位正規化テーブルのシードデータ）の投入結果を、
 * `UnitConversionService` / `FoodCompositionRepository` 相当の直接クエリで検証する。
 *
 * 両者の実装は後続タスク（3.1 / 3.2）のため、ここでは better-sqlite3 の生SQLで
 * design.md #UnitConversionService が定義する解決順序を再現して検証する。
 * テストファイルの構成はtask 2.1の `food-items-seed.test.ts` の先例に倣う。
 */

/**
 * `FoodCompositionRepository.findUnitConversion`（design.md 参照）相当。
 * `(food_id, unit_code)` に一致する食材固有エントリを返す。
 */
function findUnitConversion(
  db: Database.Database,
  foodId: string,
  unitCode: string
): number | null {
  const row = db
    .prepare(
      "SELECT grams_per_unit FROM unit_conversions WHERE food_id = ? AND unit_code = ?"
    )
    .get(foodId, unitCode) as { grams_per_unit: number } | undefined;
  return row?.grams_per_unit ?? null;
}

/**
 * `FoodCompositionRepository.findGenericUnitConversion`（design.md 参照）相当。
 * `(null, unit_code)` の汎用エントリを返す。
 */
function findGenericUnitConversion(db: Database.Database, unitCode: string): number | null {
  const row = db
    .prepare(
      "SELECT grams_per_unit FROM unit_conversions WHERE food_id IS NULL AND unit_code = ?"
    )
    .get(unitCode) as { grams_per_unit: number } | undefined;
  return row?.grams_per_unit ?? null;
}

/**
 * `UnitConversionService.toGrams`（design.md #UnitConversionService）の解決順序そのもの。
 * 1. `g` は恒等変換（本テーブルを参照しない）
 * 2. 食材固有エントリ（5.2）
 * 3. 汎用エントリへのフォールバック（5.3）
 * 4. どちらも無ければ null（= Requirement 5.4 の `unit_not_found`）
 */
function resolveGramsPerUnit(
  db: Database.Database,
  foodId: string,
  unitCode: string
): number | null {
  if (unitCode === "g") return 1;
  return findUnitConversion(db, foodId, unitCode) ?? findGenericUnitConversion(db, unitCode);
}

function countOf(db: Database.Database, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { count: number }).count;
}

describe("011_seed_unit_conversions.sql (分量単位正規化テーブル)", () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nutrition-unit-conv-test-"));
    db = createConnection(path.join(tmpDir, "test.db"));
    runMigrations(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // already closed within a test body
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- 汎用エントリ（Requirement 5.1 / 5.3） ---
  //
  // 期待値は日本の標準計量器の容量定義（計量カップ200mL・大さじ15mL・小さじ5mL、
  // 香川栄養学園「味のものさし」）と水の密度1g/mLに基づく。
  // 松本市「計量スプーン・カップ計量表」（女子栄養大学出版部『調理のためのベーシック
  // データ第5版』より）およびEatreat「食材の目安量一覧」の「水」行と一致する。

  it("seeds the standard 計量スプーン・カップ generic conversions (大さじ15g / 小さじ5g / カップ200g)", () => {
    expect(findGenericUnitConversion(db, "大さじ")).toBe(15);
    expect(findGenericUnitConversion(db, "小さじ")).toBe(5);
    expect(findGenericUnitConversion(db, "カップ")).toBe(200);
  });

  it("seeds ml/cc generic conversions at the water density of 1 g/mL (1cc = 1ml)", () => {
    expect(findGenericUnitConversion(db, "ml")).toBe(1);
    expect(findGenericUnitConversion(db, "cc")).toBe(1);
  });

  it("seeds generic entries ONLY for volume-defined measuring units, never for count-based units", () => {
    const genericUnits = (
      db
        .prepare("SELECT unit_code FROM unit_conversions WHERE food_id IS NULL ORDER BY unit_code")
        .all() as { unit_code: string }[]
    ).map((r) => r.unit_code);

    expect([...genericUnits].sort()).toEqual(["cc", "ml", "カップ", "大さじ", "小さじ"].sort());

    // 個・本・枚・玉・丁・束・パック・缶 のような計数単位は1単位あたり重量が
    // 食材ごとに固有であり、妥当な汎用既定値が存在しないため投入しない。
    for (const countUnit of ["個", "本", "枚", "玉", "丁", "束", "パック", "缶"]) {
      expect(findGenericUnitConversion(db, countUnit), `${countUnit} must have no generic entry`).toBeNull();
    }
  });

  // --- `g` は本テーブルに投入しない（design.md #UnitConversionService） ---

  it("seeds no ('g', ...) row at all, since g→gram is special-cased in code", () => {
    // design.md #UnitConversionService「単位コードが `g` の場合、分量をそのまま
    // グラムとして扱う」— テーブルを引かないため、g行は死んだデータになる。
    expect(countOf(db, "SELECT COUNT(*) as count FROM unit_conversions WHERE unit_code = 'g'")).toBe(0);
  });

  // --- 食材固有エントリが汎用エントリより優先されること（Requirement 5.2 > 5.3） ---
  //
  // 実データによる証明: 大さじ には汎用エントリ（水基準 15g）と、
  // 調味料ごとの食材固有エントリ（しょうゆ18g・上白糖9g・サラダ油12g）の
  // 両方が存在する。同一 unit_code について両者が競合する唯一かつ実在のケース。

  it("prioritizes the food-specific 大さじ entry over the generic 大さじ entry (5.2 before 5.3)", () => {
    // 汎用エントリは水基準の15g
    expect(findGenericUnitConversion(db, "大さじ")).toBe(15);

    // こいくちしょうゆ（17007）は食材固有エントリ18gを持つ
    expect(findUnitConversion(db, "17007", "大さじ")).toBe(18);
    // 解決結果は汎用の15gではなく食材固有の18g
    expect(resolveGramsPerUnit(db, "17007", "大さじ")).toBe(18);
    expect(resolveGramsPerUnit(db, "17007", "大さじ")).not.toBe(
      findGenericUnitConversion(db, "大さじ")
    );

    // 上白糖（03003）は9g、調合油（サラダ油・14006）は12g
    expect(resolveGramsPerUnit(db, "03003", "大さじ")).toBe(9);
    expect(resolveGramsPerUnit(db, "14006", "大さじ")).toBe(12);
  });

  it("falls back to the generic entry for a food that has no food-specific entry (5.3)", () => {
    // 鶏むね肉（11220）には大さじの食材固有エントリが無い
    expect(findUnitConversion(db, "11220", "大さじ")).toBeNull();
    // よって汎用エントリ（15g）にフォールバックする
    expect(resolveGramsPerUnit(db, "11220", "大さじ")).toBe(15);
  });

  it("returns null (= unit_not_found, 5.4) when neither a food-specific nor a generic entry exists", () => {
    // 鶏むね肉（11220）は重量売り食品であり display_unit_code を持たず、
    // 「個」の食材固有エントリも汎用エントリも存在しない
    expect(resolveGramsPerUnit(db, "11220", "個")).toBeNull();
  });

  it("prioritizes food-specific over generic for every unit_code where both exist", () => {
    // 汎用エントリを持つ unit_code について、食材固有エントリが1件以上存在し、
    // かつ汎用値と異なる値を持つ（= 優先解決が実際に意味を持つ）ことを確認する。
    const rows = db
      .prepare(
        `SELECT g.unit_code AS unit_code,
                g.grams_per_unit AS generic_grams,
                COUNT(s.id) AS overrides,
                SUM(CASE WHEN s.grams_per_unit <> g.grams_per_unit THEN 1 ELSE 0 END) AS differing
           FROM unit_conversions g
           LEFT JOIN unit_conversions s
                  ON s.unit_code = g.unit_code AND s.food_id IS NOT NULL
          WHERE g.food_id IS NULL
          GROUP BY g.unit_code, g.grams_per_unit`
      )
      .all() as {
      unit_code: string;
      generic_grams: number;
      overrides: number;
      differing: number;
    }[];

    const byUnit = new Map(rows.map((r) => [r.unit_code, r]));
    for (const unit of ["大さじ", "小さじ", "カップ"]) {
      const row = byUnit.get(unit);
      expect(row, `${unit} must have a generic entry`).toBeDefined();
      expect(row?.overrides, `${unit} must have food-specific overrides`).toBeGreaterThan(0);
      expect(
        row?.differing,
        `${unit} overrides must actually differ from the generic value`
      ).toBeGreaterThan(0);
    }
  });

  // --- タスク2.2が名指しする3食材（卵・バナナ・玉ねぎ） ---
  //
  // いずれもEatreat「食材の目安量一覧 栄養価計算に役立つ早見表」の正味量
  // （廃棄分を除いた部分）。`food_items` の成分値が可食部100gあたりであるため、
  // 換算値も可食部基準でなければならない。

  it("resolves 卵 (鶏卵・全卵・生 = 12004) 1個 to the real 可食部 weight of 50g", () => {
    // Eatreat 肉類・魚介類・卵類・大豆製品類・乳製品類編「卵 1個 50g」。
    // 松本市の見当量（廃棄部分含む）60g × (1 − 廃棄率14%) = 51.6g とも整合する。
    expect(findUnitConversion(db, "12004", "個")).toBe(50);
    expect(resolveGramsPerUnit(db, "12004", "個")).toBe(50);
    // ゆで卵（12005）・うずら卵（12002）も同一出典から投入済み
    expect(resolveGramsPerUnit(db, "12005", "個")).toBe(50);
    expect(resolveGramsPerUnit(db, "12002", "個")).toBe(10);
  });

  it("resolves バナナ (07107) 1本 to the real 可食部 weight of 100g", () => {
    // Eatreat 果物類・いも類・きのこ類編「バナナ 1本 100g」。
    // 成分表の廃棄率40%（皮）から購入時重量は約167gに相当する。
    // バナナは日本語では「個」ではなく「本」で数えるため、display_unit_code も '本'。
    expect(findUnitConversion(db, "07107", "本")).toBe(100);
    expect(resolveGramsPerUnit(db, "07107", "本")).toBe(100);
  });

  it("resolves 玉ねぎ (たまねぎ = 06153) 1個 to the real 可食部 weight of 200g", () => {
    // Eatreat 野菜編「たまねぎ 1個 200g」。味の素パーク・松本市の見当量も200g。
    expect(findUnitConversion(db, "06153", "個")).toBe(200);
    expect(resolveGramsPerUnit(db, "06153", "個")).toBe(200);
  });

  it("gives 卵1個 and 玉ねぎ1個 genuinely different gram weights for the same unit_code 個", () => {
    // Requirement 5.2 が例示するとおり「卵の1個」と「玉ねぎの1個」は換算が異なる。
    const egg = resolveGramsPerUnit(db, "12004", "個");
    const onion = resolveGramsPerUnit(db, "06153", "個");

    expect(egg).toBe(50);
    expect(onion).toBe(200);
    expect(egg).not.toBe(onion);
  });

  // --- display_unit_code（task 2.1が設定した152件）のカバレッジ ---

  it("covers a documented subset of task 2.1's 152 (food_id, display_unit_code) pairs", () => {
    const total = countOf(
      db,
      "SELECT COUNT(*) as count FROM food_items WHERE display_unit_code IS NOT NULL"
    );
    const covered = countOf(
      db,
      `SELECT COUNT(*) as count FROM food_items f
         JOIN unit_conversions u
           ON u.food_id = f.food_id AND u.unit_code = f.display_unit_code
        WHERE f.display_unit_code IS NOT NULL`
    );

    expect(total).toBe(152);
    // 実在の出典値を確認できた組み合わせのみを投入しているため100%にはならない。
    // 未投入の組み合わせと理由は `011_seed_unit_conversions.sql` の
    // 【意図的に投入を見送った組み合わせ】に列挙している。
    expect(covered).toBe(79);
  });

  it("keeps 卵黄 + 卵白 consistent with the 全卵 conversion (internal cross-check)", () => {
    // 出典(D)「Mサイズ：卵黄約20g、卵白約30g合わせて約50g」— 別出典から投入した
    // 全卵1個50g（出典(B)）と算術的に整合していることを確認する。
    const yolk = resolveGramsPerUnit(db, "12010", "個");
    const white = resolveGramsPerUnit(db, "12014", "個");
    const whole = resolveGramsPerUnit(db, "12004", "個");

    expect(yolk).toBe(20);
    expect(white).toBe(30);
    expect((yolk as number) + (white as number)).toBe(whole);
  });

  // --- 計量単位における「黙って汎用値にフォールバックする」リスクの固定 ---
  //
  // 計数単位（個・本・…）と違い、計量単位（大さじ・小さじ・カップ・ml・cc）には汎用エントリが
  // あるため、食材固有エントリを持たない食品は `unit_not_found` にならず、水基準の汎用値へ
  // **黙って** フォールバックする（Requirement 5.3）。水と密度が違う調味料ではこれが
  // 誤ったグラム量になり、しかもエラーにならないので気づけない。
  //
  // display_unit_code を持つ食品のカバレッジテストではこの種の欠落は検出できない
  // （調味料類はいずれも display_unit_code を持たないため）。そこで該当食品IDを明示的に
  // 列挙して固定し、この集合が無自覚に増えることを防ぐ。

  /**
   * `調味料類` カテゴリのうち、`大さじ`/`小さじ` の食材固有エントリを持たず、
   * 水基準の汎用値（大さじ15g・小さじ5g）へ黙ってフォールバックする食品ID。
   *
   * 実在の出典値を確認できなかったため投入を見送ったものであり、
   * 値を推定して埋めることはしない（`011_seed_unit_conversions.sql` の
   * 【重要: 未投入時の挙動は単位の種類によって非対称である】参照）。
   *
   * このリストを **減らす** のは歓迎される改善（実在の出典値を見つけて食材固有エントリを
   * 追加する）。逆にこのリストが増える場合は、新しい調味料を `food_items` に追加した際に
   * 換算エントリを付け忘れているサインなので、テストが落ちて気づけるようにしてある。
   */
  const SEASONINGS_FALLING_BACK_TO_GENERIC_SPOON = [
    "03001", // 黒砂糖（汎用15g/大さじ。上白糖9g・グラニュー糖12gと密度が異なり流用不可）
    "05037", // ピーナッツバター
    "17006", // ラー油（汎用15g/大さじ。油は12gのため約+25%）
    "17019", // かつおだし（荒節）※ほぼ水と同密度のため汎用値へのフォールバックは実質正しい
    "17021", // かつお・昆布だし ※同上
    "17027", // 固形ブイヨン（そもそも大さじで計る食品ではない）
    "17034", // トマトピューレー
    "17037", // トマトソース
    "17051", // カレールウ
    "17052", // ハヤシルウ
    "17054", // みりん風調味料（本みりん18gの流用は不可と判断）
    "17059", // 練りマスタード（出典の「チューブからし」と同一視できないと判断）
    "17063", // こしょう（黒・粉）
    "17065", // こしょう（混合・粉）
    "17075", // ガーリックパウダー（食塩無添加）
    "17083", // ドライイースト（パン酵母・乾燥）
    "17086", // こいくちしょうゆ（減塩）（汎用15g/大さじ。しょうゆは18gのため約-17%、食塩相当量を過小評価）
  ] as const;

  it("pins the 調味料類 foods that silently fall back to the generic water-basis 大さじ/小さじ", () => {
    const fallingBack = (
      db
        .prepare(
          `SELECT f.food_id AS food_id
             FROM food_items f
            WHERE f.category = '調味料類'
              AND NOT EXISTS (
                    SELECT 1 FROM unit_conversions u
                     WHERE u.food_id = f.food_id AND u.unit_code IN ('大さじ', '小さじ')
                  )
            ORDER BY f.food_id`
        )
        .all() as { food_id: string }[]
    ).map((r) => r.food_id);

    expect(fallingBack).toEqual([...SEASONINGS_FALLING_BACK_TO_GENERIC_SPOON]);

    // これらは失敗せず、水基準の汎用値を黙って返す（= 検出されない誤差になりうる）。
    // その挙動自体をここで明示しておく。
    for (const foodId of fallingBack) {
      expect(findUnitConversion(db, foodId, "大さじ"), `${foodId} has no override`).toBeNull();
      expect(resolveGramsPerUnit(db, foodId, "大さじ"), `${foodId} falls back silently`).toBe(15);
    }
  });

  it("does give the majority of 調味料類 foods a real food-specific 大さじ override", () => {
    // 上記フォールバック集合が「例外」であって「大多数」ではないことを担保する。
    const total = countOf(
      db,
      "SELECT COUNT(*) as count FROM food_items WHERE category = '調味料類'"
    );
    const withOverride = total - SEASONINGS_FALLING_BACK_TO_GENERIC_SPOON.length;

    expect(total).toBe(58);
    expect(withOverride).toBe(41);
    expect(withOverride).toBeGreaterThan(SEASONINGS_FALLING_BACK_TO_GENERIC_SPOON.length);
  });

  it("uses the real published グラニュー糖 spoon weights instead of 上白糖's or the generic", () => {
    // 出典(A)の香川栄養学園「味のものさし」PDFは「上白糖 ３ ９」と並んで
    // 「グラニュー糖 ４ 12」という独立した行を持つ。上白糖の9gを流用してはならず、
    // 汎用の15gへのフォールバック（約+25%の誤り）も避けなければならない。
    expect(resolveGramsPerUnit(db, "03005", "小さじ")).toBe(4);
    expect(resolveGramsPerUnit(db, "03005", "大さじ")).toBe(12);

    // 上白糖（03003）とは別の値であること
    expect(resolveGramsPerUnit(db, "03005", "大さじ")).not.toBe(
      resolveGramsPerUnit(db, "03003", "大さじ")
    );
    // 汎用値（15g）でもないこと
    expect(resolveGramsPerUnit(db, "03005", "大さじ")).not.toBe(
      findGenericUnitConversion(db, "大さじ")
    );
    // 同表にカップ欄が無いためカップは投入していない
    expect(findUnitConversion(db, "03005", "カップ")).toBeNull();
  });

  it("resolves 缶 for 農産物缶詰 using the label 固形量 (not 内容総量)", () => {
    // 成分表の缶詰の成分値は備考欄に「液汁を除いたもの」と明記されているため、
    // 換算値は内容総量ではなく固形量でなければならない。農産物缶詰は
    // 食品表示基準 別表第4により固形量の表示が義務付けられている。
    expect(resolveGramsPerUnit(db, "04028", "缶")).toBe(180); // 大豆水煮缶（内容総量290g / 固形量180g）
    expect(resolveGramsPerUnit(db, "06180", "缶")).toBe(125); // コーン缶（内容総量180g / 固形量125g）
    expect(resolveGramsPerUnit(db, "06184", "缶")).toBe(240); // トマト缶（内容総量400g / 固形量240g）

    // 魚類の水煮缶詰は固形量表示が法令上免除されており、固形量を確認できないため未投入。
    // 汎用エントリも無いのでRequirement 5.4の `unit_not_found` として安全に失敗する。
    expect(resolveGramsPerUnit(db, "10164", "缶")).toBeNull(); // さば水煮缶
    expect(resolveGramsPerUnit(db, "12003", "缶")).toBeNull(); // うずら卵水煮缶
  });

  it("resolves the other real, individually-sourced conversions", () => {
    expect(resolveGramsPerUnit(db, "04032", "丁")).toBe(300);      // 木綿豆腐 1丁
    expect(resolveGramsPerUnit(db, "04046", "パック")).toBe(50);   // 糸引き納豆 1パック
    expect(resolveGramsPerUnit(db, "04042", "個")).toBe(16.5);     // 凍り豆腐（高野豆腐）1個
    expect(resolveGramsPerUnit(db, "09004", "枚")).toBe(3);        // 焼きのり 全形1枚
    expect(resolveGramsPerUnit(db, "01026", "枚")).toBe(60);       // 角形食パン 6枚切1枚
    expect(resolveGramsPerUnit(db, "01039", "玉")).toBe(200);      // うどん（ゆで）1玉
    expect(resolveGramsPerUnit(db, "06061", "玉")).toBe(1000);     // キャベツ 1玉
    expect(resolveGramsPerUnit(db, "06207", "束")).toBe(100);      // にら 1束
  });

  // --- テーブル全体の整合性 ---

  it("enforces grams_per_unit > 0 on every seeded row and rejects violations", () => {
    expect(
      countOf(db, "SELECT COUNT(*) as count FROM unit_conversions WHERE grams_per_unit <= 0")
    ).toBe(0);

    // スキーマのCHECK制約（006_create_unit_conversions.sql）が実際に効いている
    expect(() =>
      db
        .prepare("INSERT INTO unit_conversions (food_id, unit_code, grams_per_unit) VALUES (?, ?, ?)")
        .run(null, "__zero__", 0)
    ).toThrow();
    expect(() =>
      db
        .prepare("INSERT INTO unit_conversions (food_id, unit_code, grams_per_unit) VALUES (?, ?, ?)")
        .run(null, "__negative__", -1)
    ).toThrow();
  });

  it("references only real seeded food_items rows (no orphan food_id)", () => {
    const orphans = countOf(
      db,
      `SELECT COUNT(*) as count FROM unit_conversions u
        LEFT JOIN food_items f ON f.food_id = u.food_id
        WHERE u.food_id IS NOT NULL AND f.food_id IS NULL`
    );

    expect(orphans).toBe(0);
  });

  it("keeps (food_id, unit_code) unique so resolution is deterministic", () => {
    const duplicates = countOf(
      db,
      `SELECT COUNT(*) as count FROM (
         SELECT food_id, unit_code FROM unit_conversions
          GROUP BY food_id, unit_code HAVING COUNT(*) > 1
       )`
    );

    expect(duplicates).toBe(0);
  });

  // --- KNOWN_UNIT_CODES（task 1.5 / constants.ts）との対応関係 ---
  //
  // constants.ts の `KNOWN_UNIT_CODES` はtool定義の `unit` enum（task 6.1）に使われる。
  // そこで宣言された単位コードに換算経路が無いと、Claudeが選択できるのに実行時に
  // `unit_not_found` で生成全体が失敗する（Requirement 5.4）という不整合になるため、
  // 「宣言されているが解決できないコード」を明示的に固定して回帰を検出する。

  it("provides a resolution path for every KNOWN_UNIT_CODE except the explicitly documented gaps", async () => {
    const { KNOWN_UNIT_CODES } = await import("../menu-generation/constants.js");

    const unresolvable = KNOWN_UNIT_CODES.filter((unit) => {
      // `g` はコード側で恒等変換されるためテーブル参照が不要（design.md #UnitConversionService）
      if (unit === "g") return false;
      if (findGenericUnitConversion(db, unit) !== null) return false;
      const specific = countOf(
        db,
        "SELECT COUNT(*) as count FROM unit_conversions WHERE food_id IS NOT NULL AND unit_code = ?",
        unit
      );
      return specific === 0;
    });

    // 現時点でまったく換算経路を持たない既知単位コードは `袋` のみ。
    // task 2.1が投入した361件の `food_items` に `display_unit_code = '袋'` の食品は無く、
    // 「1袋」の重量も商品ごとに大きく異なるため、実在の出典値を確認できなかった。
    //
    // ⚠️ これは「単位コード単位」の粗い判定であり、カバレッジの指標ではない。
    // ある単位コードについて1件でも食材固有エントリがあれば「解決経路あり」と数えるため、
    // 例えば `束` は12食品中1食品（にら）しか投入されていなくてもここには現れない。
    // 食品×単位の組み合わせ単位での実際のカバレッジは 79/152 であり、
    // それは "covers a documented subset of task 2.1's 152 ..." のテストで固定している。
    // 本テストの目的はカバレッジ計測ではなく、KNOWN_UNIT_CODESに単位コードを追加したのに
    // 対応する換算データを1件も入れ忘れる回帰（tool enumは選択を許すのにDB側に換算が
    // 存在せず、Requirement 5.4で生成全体が失敗する）の検出である。
    expect(unresolvable).toEqual(["袋"]);
  });

  it("seeds カップ conversions even though カップ is absent from KNOWN_UNIT_CODES", async () => {
    const { KNOWN_UNIT_CODES } = await import("../menu-generation/constants.js");

    // タスク2.2の指示は汎用エントリとして「g・大さじ・小さじ・カップ等」を投入することを
    // 明示しているため `カップ` を投入している。一方 `KNOWN_UNIT_CODES`（task 1.5の暫定値）
    // には `カップ` が含まれていない。これが本テストが固定したい不一致そのものである。
    expect(KNOWN_UNIT_CODES).not.toContain("カップ");

    // それでもDB側には汎用エントリと食材固有エントリの双方が存在する。
    expect(findGenericUnitConversion(db, "カップ")).toBe(200);
    expect(
      countOf(
        db,
        "SELECT COUNT(*) as count FROM unit_conversions WHERE food_id IS NOT NULL AND unit_code = 'カップ'"
      )
    ).toBeGreaterThan(0);

    // この向きの不一致は無害である（tool enumに無い単位はClaudeが選択できないため、
    // 実行時に `unit_not_found` を引き起こさない）。逆向き（enumにあるのにDBに無い）が
    // 危険であり、それは "provides a resolution path for every KNOWN_UNIT_CODE ..." で
    // 検出している。task 6.1でenumを構築する際に `カップ` を追加するか判断すること。
  });

  // --- マイグレーションとしての振る舞い ---

  it("is applied exactly once and is idempotent across repeated runMigrations() calls", () => {
    const applied = countOf(
      db,
      "SELECT COUNT(*) as count FROM schema_migrations WHERE name = '011_seed_unit_conversions.sql'"
    );
    expect(applied).toBe(1);

    const totalBefore = countOf(db, "SELECT COUNT(*) as count FROM unit_conversions");

    runMigrations(db);
    runMigrations(db);

    expect(countOf(db, "SELECT COUNT(*) as count FROM unit_conversions")).toBe(totalBefore);
    expect(
      countOf(
        db,
        "SELECT COUNT(*) as count FROM schema_migrations WHERE name = '011_seed_unit_conversions.sql'"
      )
    ).toBe(1);
  });
});
