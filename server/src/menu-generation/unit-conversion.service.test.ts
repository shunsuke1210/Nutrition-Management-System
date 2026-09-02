import { describe, expect, it, vi } from "vitest";
import type { FoodCompositionRepository, UnitConversionEntry } from "./food-composition.repository.js";
import { createUnitConversionService } from "./unit-conversion.service.js";

/**
 * `UnitConversionService`（task 3.2）のテスト。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #UnitConversionService、
 * Requirements 5.2, 5.3, 5.4）に定義された解決順序（g直接返却 → 食材固有エントリ優先 →
 * 汎用エントリへのフォールバック → いずれも存在しない場合はVerificationError）を、
 * `FoodCompositionRepository`（task 3.1、実装済み）を実DB越しに使わず、挙動を固定した
 * フェイクに差し替えて検証する。`daily-log.gateway.test.ts` の
 * `createFakeDailyLogService`（フェイク依存＋設定可能な振る舞い）と同じスタイルに倣う。
 *
 * `FoodCompositionRepository` の実装自体の正しさは
 * `food-composition.repository.test.ts` で既に検証済みのため、本テストは
 * `UnitConversionService` 自身のロジック（分岐・優先順位・引数の受け渡し）のみを検証する。
 */

/**
 * `UnitConversionService` の唯一の依存を差し替えるための、挙動を固定したフェイク。
 * `findById` / `listAllIds` はこのServiceからは一切呼び出されないため、呼ばれたら
 * 即座に失敗させる（本Serviceのスコープ外の呼び出しが紛れ込んでいないことの検証を兼ねる）。
 */
function createFakeFoodCompositionRepository(
  overrides: {
    findUnitConversion?: (foodId: string, unitCode: string) => UnitConversionEntry | null;
    findGenericUnitConversion?: (unitCode: string) => UnitConversionEntry | null;
  } = {}
): FoodCompositionRepository {
  return {
    findById: () => {
      throw new Error(
        "createFakeFoodCompositionRepository: findById is not used by UnitConversionService"
      );
    },
    listAllIds: () => {
      throw new Error(
        "createFakeFoodCompositionRepository: listAllIds is not used by UnitConversionService"
      );
    },
    findUnitConversion:
      overrides.findUnitConversion ??
      (() => {
        throw new Error(
          "createFakeFoodCompositionRepository: findUnitConversion was not expected to be called in this test (pass findUnitConversion to createFakeFoodCompositionRepository if needed)"
        );
      }),
    findGenericUnitConversion:
      overrides.findGenericUnitConversion ??
      (() => {
        throw new Error(
          "createFakeFoodCompositionRepository: findGenericUnitConversion was not expected to be called in this test (pass findGenericUnitConversion to createFakeFoodCompositionRepository if needed)"
        );
      }),
  };
}

describe("createUnitConversionService", () => {
  describe('unitCode === "g" の場合（design.mdの解決順序 1番目、"gram以外の単位について" という限定表現の裏付け）', () => {
    it("quantityをそのままグラムとして返し、食材固有・汎用いずれの単位ルックアップも一切呼び出さない", () => {
      const findUnitConversion = vi.fn(() => {
        throw new Error('"g" のとき findUnitConversion が呼ばれてはならない');
      });
      const findGenericUnitConversion = vi.fn(() => {
        throw new Error('"g" のとき findGenericUnitConversion が呼ばれてはならない');
      });
      const repository = createFakeFoodCompositionRepository({
        findUnitConversion,
        findGenericUnitConversion,
      });
      const service = createUnitConversionService(repository);

      const result = service.toGrams("12004", 150, "g");

      expect(result).toEqual({ ok: true, value: 150 });
      expect(findUnitConversion).not.toHaveBeenCalled();
      expect(findGenericUnitConversion).not.toHaveBeenCalled();
    });
  });

  describe("食材固有の換算エントリが存在する場合（Req 5.2: 食材ごとに異なる単位換算の優先）", () => {
    it("食材固有のgramsPerUnitで quantity * gramsPerUnit を返し、汎用エントリの参照は不要（短絡すること）を検証する", () => {
      const foodSpecificEntry: UnitConversionEntry = {
        foodId: "12004",
        unitCode: "個",
        gramsPerUnit: 50,
      };
      const findUnitConversion = vi.fn((foodId: string, unitCode: string) => {
        expect(foodId).toBe("12004");
        expect(unitCode).toBe("個");
        return foodSpecificEntry;
      });
      const findGenericUnitConversion = vi.fn(() => {
        throw new Error("食材固有エントリが見つかった場合、汎用エントリの参照は行われないはず");
      });
      const repository = createFakeFoodCompositionRepository({
        findUnitConversion,
        findGenericUnitConversion,
      });
      const service = createUnitConversionService(repository);

      const result = service.toGrams("12004", 2, "個");

      expect(result).toEqual({ ok: true, value: 100 });
      expect(findUnitConversion).toHaveBeenCalledWith("12004", "個");
      expect(findGenericUnitConversion).not.toHaveBeenCalled();
    });

    it("食材固有エントリの値が、たとえ汎用エントリが別の値を持っていても優先されることを確認する（真の優先順位の検証）", () => {
      const foodSpecificEntry: UnitConversionEntry = {
        foodId: "12004",
        unitCode: "個",
        gramsPerUnit: 50,
      };
      const genericEntryThatShouldBeIgnored: UnitConversionEntry = {
        foodId: null,
        unitCode: "個",
        gramsPerUnit: 999,
      };
      const repository = createFakeFoodCompositionRepository({
        findUnitConversion: () => foodSpecificEntry,
        findGenericUnitConversion: () => genericEntryThatShouldBeIgnored,
      });
      const service = createUnitConversionService(repository);

      const result = service.toGrams("12004", 2, "個");

      expect(result).toEqual({ ok: true, value: 100 });
    });
  });

  describe("食材固有の換算エントリが存在せず、汎用エントリが存在する場合（Req 5.3: 汎用エントリへのフォールバック）", () => {
    it("汎用エントリのgramsPerUnitで quantity * gramsPerUnit を返す", () => {
      const genericEntry: UnitConversionEntry = {
        foodId: null,
        unitCode: "大さじ",
        gramsPerUnit: 15,
      };
      const findUnitConversion = vi.fn(() => null);
      const findGenericUnitConversion = vi.fn((unitCode: string) => {
        expect(unitCode).toBe("大さじ");
        return genericEntry;
      });
      const repository = createFakeFoodCompositionRepository({
        findUnitConversion,
        findGenericUnitConversion,
      });
      const service = createUnitConversionService(repository);

      const result = service.toGrams("17012", 3, "大さじ");

      expect(result).toEqual({ ok: true, value: 45 });
      expect(findUnitConversion).toHaveBeenCalledWith("17012", "大さじ");
      expect(findGenericUnitConversion).toHaveBeenCalledWith("大さじ");
    });
  });

  describe("食材固有・汎用いずれの換算エントリも存在しない場合（Req 5.4: 生成の失敗として扱われるべきエラー）", () => {
    it('VerificationError(type: "unit_not_found") を、foodId/unitのコンテキスト付きで返す', () => {
      const repository = createFakeFoodCompositionRepository({
        findUnitConversion: () => null,
        findGenericUnitConversion: () => null,
      });
      const service = createUnitConversionService(repository);

      const result = service.toGrams("99999", 2, "カップ");

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected a failure result");
      }
      expect(result.error.type).toBe("unit_not_found");
      expect(result.error.foodId).toBe("99999");
      expect(result.error.unit).toBe("カップ");
      expect(typeof result.error.message).toBe("string");
      expect(result.error.message.length).toBeGreaterThan(0);
    });
  });

  describe("決定論性（design.md #UnitConversionService の Invariants）", () => {
    it("同一の (foodId, quantity, unitCode) を同一のrepository設定に対して2回呼び出しても、常に同一の結果を返す", () => {
      const entry: UnitConversionEntry = { foodId: "12004", unitCode: "個", gramsPerUnit: 50 };
      const repository = createFakeFoodCompositionRepository({
        findUnitConversion: () => entry,
        findGenericUnitConversion: () => {
          throw new Error("この経路では呼ばれないはず");
        },
      });
      const service = createUnitConversionService(repository);

      const result1 = service.toGrams("12004", 2, "個");
      const result2 = service.toGrams("12004", 2, "個");

      expect(result1).toEqual(result2);
      expect(result1).toEqual({ ok: true, value: 100 });
    });

    it("失敗結果についても、同一引数に対して常に同一のエラー内容を返す", () => {
      const repository = createFakeFoodCompositionRepository({
        findUnitConversion: () => null,
        findGenericUnitConversion: () => null,
      });
      const service = createUnitConversionService(repository);

      const result1 = service.toGrams("99999", 2, "カップ");
      const result2 = service.toGrams("99999", 2, "カップ");

      expect(result1).toEqual(result2);
    });
  });
});
