import { describe, expect, it, vi } from "vitest";
import type { IngredientSelection, VerifiedNutritionValues } from "@nutrition/shared";
import type {
  FoodCompositionRepository,
  FoodItemNutrition,
  UnitConversionEntry,
} from "./food-composition.repository.js";
import type { UnitConversionService, VerificationError } from "./unit-conversion.service.js";
import { createUnitConversionService } from "./unit-conversion.service.js";
import { createNutritionVerificationService } from "./nutrition-verification.service.js";

/**
 * `NutritionVerificationService`（task 3.3）のテスト。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #NutritionVerificationService、
 * Requirements 4.3, 4.4, 4.5, 4.6, 4.7）に定義された挙動を、`FoodCompositionRepository` /
 * `UnitConversionService`（いずれも実装済み・テスト済み）を実DB越しに使わず、挙動を固定した
 * フェイクに差し替えて検証する。`unit-conversion.service.test.ts` の
 * `createFakeFoodCompositionRepository`（フェイク依存＋設定可能な振る舞い、未使用メソッドは
 * 呼ばれたら例外を投げる）と同じスタイルに倣う。
 *
 * `FoodCompositionRepository` / `UnitConversionService` 自体の正しさはそれぞれの専用テストで
 * 既に検証済みのため、本テストは `NutritionVerificationService` 自身のロジック
 * （食品ID実在確認 → 単位換算呼び出しの順序、13項目の合算、null微量栄養素の0扱い、
 * 部分失敗時の全体失敗）のみを検証する。
 */

/** `NutritionVerificationService` が呼び出す唯一のメソッドは `findById` のみ。他は未使用。 */
function createFakeFoodCompositionRepository(
  overrides: {
    findById?: (foodId: string) => FoodItemNutrition | null;
  } = {}
): FoodCompositionRepository {
  return {
    findById:
      overrides.findById ??
      (() => {
        throw new Error(
          "createFakeFoodCompositionRepository: findById was not expected to be called in this test"
        );
      }),
    listAllIds: () => {
      throw new Error(
        "createFakeFoodCompositionRepository: listAllIds is not used by NutritionVerificationService"
      );
    },
    findUnitConversion: () => {
      throw new Error(
        "createFakeFoodCompositionRepository: findUnitConversion is not used by NutritionVerificationService " +
          "(unit resolution is delegated entirely to the injected UnitConversionService)"
      );
    },
    findGenericUnitConversion: () => {
      throw new Error(
        "createFakeFoodCompositionRepository: findGenericUnitConversion is not used by NutritionVerificationService " +
          "(unit resolution is delegated entirely to the injected UnitConversionService)"
      );
    },
  };
}

/** `NutritionVerificationService` が呼び出す唯一のメソッドは `toGrams` のみ。 */
function createFakeUnitConversionService(
  toGrams?: UnitConversionService["toGrams"]
): UnitConversionService {
  return {
    toGrams:
      toGrams ??
      (() => {
        throw new Error(
          "createFakeUnitConversionService: toGrams was not expected to be called in this test"
        );
      }),
  };
}

// --- 手計算済みフィクスチャ ---
// 白米(g直接指定): energyKcal=168, proteinG=2.5, fatG=0.3, carbG=37.1,
//   fiberG=1.5, calciumMg=3, ironMg=0.1, vitaminAUg=0, vitaminDUg=0,
//   vitaminB1Mg=0.02, vitaminB2Mg=0.01, vitaminCMg=0, saltEquivalentG=0 (per100g)
const RICE: FoodItemNutrition = {
  foodId: "10001",
  name: "精白米",
  category: "穀類",
  per100g: {
    energyKcal: 168,
    proteinG: 2.5,
    fatG: 0.3,
    carbG: 37.1,
    fiberG: 1.5,
    calciumMg: 3,
    ironMg: 0.1,
    vitaminAUg: 0,
    vitaminDUg: 0,
    vitaminB1Mg: 0.02,
    vitaminB2Mg: 0.01,
    vitaminCMg: 0,
    saltEquivalentG: 0,
  },
  sourceCitation: "日本食品標準成分表（八訂）増補2023年から引用",
};

// 鶏むね肉(g直接指定): energyKcal=200, proteinG=20, fatG=12, carbG=0,
//   fiberG=0, calciumMg=5, ironMg=0.5, vitaminAUg=10, vitaminDUg=0.2,
//   vitaminB1Mg=0.1, vitaminB2Mg=0.15, vitaminCMg=2, saltEquivalentG=0.1 (per100g)
const CHICKEN: FoodItemNutrition = {
  foodId: "11001",
  name: "鶏むね肉",
  category: "肉類",
  per100g: {
    energyKcal: 200,
    proteinG: 20,
    fatG: 12,
    carbG: 0,
    fiberG: 0,
    calciumMg: 5,
    ironMg: 0.5,
    vitaminAUg: 10,
    vitaminDUg: 0.2,
    vitaminB1Mg: 0.1,
    vitaminB2Mg: 0.15,
    vitaminCMg: 2,
    saltEquivalentG: 0.1,
  },
  sourceCitation: "日本食品標準成分表（八訂）増補2023年から引用",
};

// ほうれん草(単位換算あり・微量栄養素の一部がnull=未収載):
//   energyKcal=20, proteinG=2, fatG=0.2, carbG=3,
//   fiberG=null, calciumMg=50, ironMg=null, vitaminAUg=350, vitaminDUg=null,
//   vitaminB1Mg=0.05, vitaminB2Mg=0.08, vitaminCMg=15, saltEquivalentG=0 (per100g)
const SPINACH_WITH_NULLS: FoodItemNutrition = {
  foodId: "12001",
  name: "ほうれん草",
  category: "野菜類",
  per100g: {
    energyKcal: 20,
    proteinG: 2,
    fatG: 0.2,
    carbG: 3,
    fiberG: null,
    calciumMg: 50,
    ironMg: null,
    vitaminAUg: 350,
    vitaminDUg: null,
    vitaminB1Mg: 0.05,
    vitaminB2Mg: 0.08,
    vitaminCMg: 15,
    saltEquivalentG: 0,
  },
  sourceCitation: "日本食品標準成分表（八訂）増補2023年から引用",
};

// 卵(単位換算は食材固有エントリで解決される想定。task 11.2で追加):
//   energyKcal=142, proteinG=12.2, fatG=10.2, carbG=0.4, fiberG=0, calciumMg=46,
//   ironMg=1.5, vitaminAUg=140, vitaminDUg=3.8, vitaminB1Mg=0.06, vitaminB2Mg=0.37,
//   vitaminCMg=0, saltEquivalentG=0.3 (per100g)
const EGG: FoodItemNutrition = {
  foodId: "12002",
  name: "卵",
  category: "卵類",
  per100g: {
    energyKcal: 142,
    proteinG: 12.2,
    fatG: 10.2,
    carbG: 0.4,
    fiberG: 0,
    calciumMg: 46,
    ironMg: 1.5,
    vitaminAUg: 140,
    vitaminDUg: 3.8,
    vitaminB1Mg: 0.06,
    vitaminB2Mg: 0.37,
    vitaminCMg: 0,
    saltEquivalentG: 0.3,
  },
  sourceCitation: "日本食品標準成分表（八訂）増補2023年から引用",
};

// しょうゆ(単位換算は食材固有エントリが存在せず、汎用エントリで解決される想定。task 11.2で追加):
//   energyKcal=70, proteinG=8, fatG=0, carbG=8, fiberG=0, calciumMg=30,
//   ironMg=2, vitaminAUg=0, vitaminDUg=0, vitaminB1Mg=0.05, vitaminB2Mg=0.2,
//   vitaminCMg=0, saltEquivalentG=15 (per100g)
const SOY_SAUCE: FoodItemNutrition = {
  foodId: "17007",
  name: "しょうゆ",
  category: "調味料類",
  per100g: {
    energyKcal: 70,
    proteinG: 8,
    fatG: 0,
    carbG: 8,
    fiberG: 0,
    calciumMg: 30,
    ironMg: 2,
    vitaminAUg: 0,
    vitaminDUg: 0,
    vitaminB1Mg: 0.05,
    vitaminB2Mg: 0.2,
    vitaminCMg: 0,
    saltEquivalentG: 15,
  },
  sourceCitation: "日本食品標準成分表（八訂）増補2023年から引用",
};

describe("createNutritionVerificationService", () => {
  describe("verifyDish — 複数食材のPFC・微量栄養素9項目の合算（Req 4.3, 4.7）", () => {
    it("白米150g(unit=g) + 鶏むね肉100g(unit=g) + ほうれん草(unit=束, 2束→200g, null項目あり)を手計算通りに合算する", () => {
          // 白米: quantity=150, unit="g" → grams=150 → factor=1.5
          //   energyKcal=168*1.5=252, proteinG=2.5*1.5=3.75, fatG=0.3*1.5=0.45,
          //   carbG=37.1*1.5=55.65, fiberG=1.5*1.5=2.25, calciumMg=3*1.5=4.5,
          //   ironMg=0.1*1.5=0.15, vitaminAUg=0, vitaminDUg=0,
          //   vitaminB1Mg=0.02*1.5=0.03, vitaminB2Mg=0.01*1.5=0.015, vitaminCMg=0,
          //   saltEquivalentG=0
          // 鶏むね肉: quantity=100, unit="g" → grams=100 → factor=1.0 (値そのまま)
          // ほうれん草: quantity=2, unit="束" → toGramsが200を返す → factor=2.0
          //   energyKcal=20*2=40, proteinG=2*2=4, fatG=0.2*2=0.4, carbG=3*2=6,
          //   fiberG=null→0, calciumMg=50*2=100, ironMg=null→0,
          //   vitaminAUg=350*2=700, vitaminDUg=null→0,
          //   vitaminB1Mg=0.05*2=0.1, vitaminB2Mg=0.08*2=0.16, vitaminCMg=15*2=30,
          //   saltEquivalentG=0
          //
          // 合計:
          //   energyKcal=252+200+40=492
          //   proteinG=3.75+20+4=27.75
          //   fatG=0.45+12+0.4=12.85
          //   carbG=55.65+0+6=61.65
          //   fiberG=2.25+0+0=2.25
          //   calciumMg=4.5+5+100=109.5
          //   ironMg=0.15+0.5+0=0.65
          //   vitaminAUg=0+10+700=710
          //   vitaminDUg=0+0.2+0=0.2
          //   vitaminB1Mg=0.03+0.1+0.1=0.23
          //   vitaminB2Mg=0.015+0.15+0.16=0.325
          //   vitaminCMg=0+2+30=32
          //   saltEquivalentG=0+0.1+0=0.1
      const repository = createFakeFoodCompositionRepository({
        findById: (foodId) => {
          if (foodId === "10001") return RICE;
          if (foodId === "11001") return CHICKEN;
          if (foodId === "12001") return SPINACH_WITH_NULLS;
          return null;
        },
      });
      const toGrams = vi.fn((foodId: string, quantity: number, unit: string) => {
        if (foodId === "10001" && unit === "g") return { ok: true as const, value: quantity };
        if (foodId === "11001" && unit === "g") return { ok: true as const, value: quantity };
        if (foodId === "12001" && unit === "束") return { ok: true as const, value: quantity * 100 };
        throw new Error(`unexpected toGrams call: ${foodId}, ${quantity}, ${unit}`);
      });
      const unitConversionService = createFakeUnitConversionService(toGrams);
      const service = createNutritionVerificationService(repository, unitConversionService);

      const ingredients: IngredientSelection[] = [
        { foodId: "10001", quantity: 150, unit: "g" },
        { foodId: "11001", quantity: 100, unit: "g" },
        { foodId: "12001", quantity: 2, unit: "束" },
      ];

      const result = service.verifyDish(ingredients);

      // 浮動小数点演算の誤差（例: 0.3*1.5*... の丸め誤差）を吸収するため、
      // 手計算値との比較には expect.closeTo を用いる（値そのものは上記コメントの通り手計算済み）。
      expect(result).toEqual({
        ok: true,
        value: {
          energyKcal: expect.closeTo(492, 9),
          proteinG: expect.closeTo(27.75, 9),
          fatG: expect.closeTo(12.85, 9),
          carbG: expect.closeTo(61.65, 9),
          fiberG: expect.closeTo(2.25, 9),
          calciumMg: expect.closeTo(109.5, 9),
          ironMg: expect.closeTo(0.65, 9),
          vitaminAUg: expect.closeTo(710, 9),
          vitaminDUg: expect.closeTo(0.2, 9),
          vitaminB1Mg: expect.closeTo(0.23, 9),
          vitaminB2Mg: expect.closeTo(0.325, 9),
          vitaminCMg: expect.closeTo(32, 9),
          saltEquivalentG: expect.closeTo(0.1, 9),
        },
      });
      expect(toGrams).toHaveBeenCalledTimes(3);
      expect(toGrams).toHaveBeenNthCalledWith(1, "10001", 150, "g");
      expect(toGrams).toHaveBeenNthCalledWith(2, "11001", 100, "g");
      expect(toGrams).toHaveBeenNthCalledWith(3, "12001", 2, "束");
    });
  });

  describe(
    "verifyDish — g直接指定・食材固有換算・汎用換算の3経路が単一呼び出し内で共存する場合" +
      "（Req 4.3, 5.2, 5.3: 複数食材・複数単位[g/個/大さじ混在]の合算と優先順位の同時証明）",
    () => {
      it(
        "白米150g(unit=g、単位ルックアップなし) + 卵2個(unit=個、食材固有エントリで解決) + " +
          "しょうゆ2大さじ(unit=大さじ、食材固有エントリなし・汎用エントリで解決)を、" +
          "UnitConversionServiceの実実装（フェイクrepositoryに接続）を通して手計算通りに合算する。" +
          "汎用エントリには「個」に対しても値の異なるエントリを用意し、卵の食材固有エントリが" +
          "（存在するにもかかわらず参照される汎用エントリではなく）優先されることを、" +
          "食材固有/汎用フェイクメソッドの呼び出し回数・引数の検証によって二重に証明する",
        () => {
          // --- 単位換算エントリのフェイク ---
          // 卵(12002)の「個」にのみ食材固有エントリが存在する（1個=50g）。
          const eggUnitEntry: UnitConversionEntry = {
            foodId: EGG.foodId,
            unitCode: "個",
            gramsPerUnit: 50,
          };
          // 汎用エントリ: 「個」にも（卵の食材固有エントリと衝突する値=999で）存在するが、
          // 卵は食材固有エントリが優先されるため参照されないはず（真の優先順位の証明）。
          // 「大さじ」の汎用エントリ(1大さじ=15g)は、しょうゆの食材固有エントリが
          // 存在しないため実際に使用される。
          const genericUnitEntries: Record<string, UnitConversionEntry> = {
            個: { foodId: null, unitCode: "個", gramsPerUnit: 999 },
            大さじ: { foodId: null, unitCode: "大さじ", gramsPerUnit: 15 },
          };

          const findUnitConversion = vi.fn((foodId: string, unitCode: string) => {
            if (foodId === EGG.foodId && unitCode === "個") return eggUnitEntry;
            return null; // しょうゆ(17007)の「大さじ」を含め、他の組み合わせに食材固有エントリはない
          });
          const findGenericUnitConversion = vi.fn(
            (unitCode: string) => genericUnitEntries[unitCode] ?? null
          );

          // NutritionVerificationServiceのfindByIdと、UnitConversionServiceの2つの単位
          // ルックアップメソッドを同一のfakeリポジトリ上に共存させる（実際の本番構成
          // — 両Serviceが同じFoodCompositionRepositoryを共有する — を再現するため）。
          const repository: FoodCompositionRepository = {
            findById: (foodId) => {
              if (foodId === RICE.foodId) return RICE;
              if (foodId === EGG.foodId) return EGG;
              if (foodId === SOY_SAUCE.foodId) return SOY_SAUCE;
              return null;
            },
            listAllIds: () => {
              throw new Error("listAllIds is not used by this test");
            },
            findUnitConversion,
            findGenericUnitConversion,
          };
          // フェイクではなく実実装のUnitConversionServiceを使うことで、"g"高速パス・
          // 食材固有エントリ優先・汎用エントリへのフォールバックという3つの解決経路が
          // 単一のverifyDish呼び出し内で正しく合成されることを検証する
          // （unit-conversion.service.test.tsは各経路を単独でのみ検証しているため）。
          const unitConversionService = createUnitConversionService(repository);
          const service = createNutritionVerificationService(repository, unitConversionService);

          // 白米: quantity=150, unit="g" → grams=150（"g"高速パス、単位ルックアップ一切なし）→ factor=1.5
          //   energyKcal=168*1.5=252, proteinG=2.5*1.5=3.75, fatG=0.3*1.5=0.45,
          //   carbG=37.1*1.5=55.65, fiberG=1.5*1.5=2.25, calciumMg=3*1.5=4.5,
          //   ironMg=0.1*1.5=0.15, vitaminAUg=0, vitaminDUg=0,
          //   vitaminB1Mg=0.02*1.5=0.03, vitaminB2Mg=0.01*1.5=0.015, vitaminCMg=0,
          //   saltEquivalentG=0
          // 卵: quantity=2, unit="個" → 食材固有エントリ(50g/個)により grams=2*50=100 → factor=1.0
          //   （factor=1.0のためper100gの値がそのまま合計に加算される）
          //   energyKcal=142, proteinG=12.2, fatG=10.2, carbG=0.4, fiberG=0, calciumMg=46,
          //   ironMg=1.5, vitaminAUg=140, vitaminDUg=3.8, vitaminB1Mg=0.06, vitaminB2Mg=0.37,
          //   vitaminCMg=0, saltEquivalentG=0.3
          // しょうゆ: quantity=2, unit="大さじ" → 食材固有エントリなし、汎用エントリ(15g/大さじ)
          //   により grams=2*15=30 → factor=0.3
          //   energyKcal=70*0.3=21, proteinG=8*0.3=2.4, fatG=0*0.3=0, carbG=8*0.3=2.4,
          //   fiberG=0, calciumMg=30*0.3=9, ironMg=2*0.3=0.6, vitaminAUg=0, vitaminDUg=0,
          //   vitaminB1Mg=0.05*0.3=0.015, vitaminB2Mg=0.2*0.3=0.06, vitaminCMg=0,
          //   saltEquivalentG=15*0.3=4.5
          //
          // 合計:
          //   energyKcal=252+142+21=415
          //   proteinG=3.75+12.2+2.4=18.35
          //   fatG=0.45+10.2+0=10.65
          //   carbG=55.65+0.4+2.4=58.45
          //   fiberG=2.25+0+0=2.25
          //   calciumMg=4.5+46+9=59.5
          //   ironMg=0.15+1.5+0.6=2.25
          //   vitaminAUg=0+140+0=140
          //   vitaminDUg=0+3.8+0=3.8
          //   vitaminB1Mg=0.03+0.06+0.015=0.105
          //   vitaminB2Mg=0.015+0.37+0.06=0.445
          //   vitaminCMg=0+0+0=0
          //   saltEquivalentG=0+0.3+4.5=4.8
          const ingredients: IngredientSelection[] = [
            { foodId: RICE.foodId, quantity: 150, unit: "g" },
            { foodId: EGG.foodId, quantity: 2, unit: "個" },
            { foodId: SOY_SAUCE.foodId, quantity: 2, unit: "大さじ" },
          ];

          const result = service.verifyDish(ingredients);

          // 浮動小数点演算の誤差を吸収するため、手計算値との比較にはexpect.closeToを用いる
          // （値そのものは上記コメントの通り手計算済み。line ~151の既存テストと同じ方針）。
          expect(result).toEqual({
            ok: true,
            value: {
              energyKcal: expect.closeTo(415, 9),
              proteinG: expect.closeTo(18.35, 9),
              fatG: expect.closeTo(10.65, 9),
              carbG: expect.closeTo(58.45, 9),
              fiberG: expect.closeTo(2.25, 9),
              calciumMg: expect.closeTo(59.5, 9),
              ironMg: expect.closeTo(2.25, 9),
              vitaminAUg: expect.closeTo(140, 9),
              vitaminDUg: expect.closeTo(3.8, 9),
              vitaminB1Mg: expect.closeTo(0.105, 9),
              vitaminB2Mg: expect.closeTo(0.445, 9),
              vitaminCMg: expect.closeTo(0, 9),
              saltEquivalentG: expect.closeTo(4.8, 9),
            },
          });

          // --- 3経路が実際にすべて別々に踏まれたことの証明 ---
          // 白米("g")は食材固有・汎用いずれのルックアップも一切トリガーしない。
          // 卵("個")・しょうゆ("大さじ")の2件についてのみ findUnitConversion が呼ばれる。
          expect(findUnitConversion).toHaveBeenCalledTimes(2);
          expect(findUnitConversion).toHaveBeenCalledWith(EGG.foodId, "個");
          expect(findUnitConversion).toHaveBeenCalledWith(SOY_SAUCE.foodId, "大さじ");
          // 卵は食材固有エントリで即座に解決されるため、findGenericUnitConversionは
          // 「個」に対しては一切呼ばれない（真の優先順位＝短絡評価の証明）。
          // 呼ばれるのは、しょうゆの「大さじ」（食材固有エントリが見つからずフォールバックした
          // 場合）のみである。
          expect(findGenericUnitConversion).toHaveBeenCalledTimes(1);
          expect(findGenericUnitConversion).toHaveBeenCalledWith("大さじ");
        }
      );
    }
  );

  describe("verifyDish — nullの微量栄養素は0扱いで計算全体は失敗しない（Req 4.7、design.mdの過小評価側フォールバック）", () => {
    it("fiberG/ironMg/vitaminDUgがnullの食材のみを含む料理でも成功し、null項目は0として合算される", () => {
      const repository = createFakeFoodCompositionRepository({
        findById: (foodId) => (foodId === "12001" ? SPINACH_WITH_NULLS : null),
      });
      const toGrams = vi.fn(() => ({ ok: true as const, value: 100 })); // factor = 1.0
      const unitConversionService = createFakeUnitConversionService(toGrams);
      const service = createNutritionVerificationService(repository, unitConversionService);

      const result = service.verifyDish([{ foodId: "12001", quantity: 1, unit: "束" }]);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected a success result");
      }
      // factor=1.0のため、per100gの値がそのまま合計値になる。null項目は0。
      expect(result.value.fiberG).toBe(0);
      expect(result.value.ironMg).toBe(0);
      expect(result.value.vitaminDUg).toBe(0);
      // null以外の項目は通常通り合算される（計算全体が壊れていないことの確認）。
      expect(result.value.energyKcal).toBe(20);
      expect(result.value.calciumMg).toBe(50);
      expect(result.value.vitaminAUg).toBe(350);
    });
  });

  describe("verifyDish — 食品ID不存在（Req 4.6）", () => {
    it('存在しない食品IDを参照する食材が含まれる場合、VerificationError(type: "food_id_not_found") を返す', () => {
      const repository = createFakeFoodCompositionRepository({
        findById: () => null,
      });
      const unitConversionService = createFakeUnitConversionService(); // 呼ばれてはならない
      const service = createNutritionVerificationService(repository, unitConversionService);

      const result = service.verifyDish([{ foodId: "99999", quantity: 100, unit: "g" }]);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected a failure result");
      }
      expect(result.error.type).toBe("food_id_not_found");
      expect(result.error.foodId).toBe("99999");
      expect(typeof result.error.message).toBe("string");
      expect(result.error.message.length).toBeGreaterThan(0);
    });

    it('チェック順序の検証: 存在しない食品ID + unit="g" の組み合わせでも、"g"の高速パスに紛れて成功せず、正しく food_id_not_found を返す（食品ID実在確認がtoGramsより先に行われることの証明）', () => {
      const repository = createFakeFoodCompositionRepository({
        findById: () => null, // 常に不存在
      });
      const toGrams = vi.fn(() => {
        throw new Error(
          "食品IDの実在確認より前にtoGramsが呼ばれてはならない（チェック順序違反）"
        );
      });
      const unitConversionService = createFakeUnitConversionService(toGrams);
      const service = createNutritionVerificationService(repository, unitConversionService);

      const result = service.verifyDish([
        { foodId: "no-such-food", quantity: 100, unit: "g" },
      ]);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected a failure result — 'g' の高速パスにより誤って成功してはならない");
      }
      expect(result.error.type).toBe("food_id_not_found");
      expect(result.error.foodId).toBe("no-such-food");
      expect(toGrams).not.toHaveBeenCalled();
    });
  });

  describe("verifyDish — 単位換算エラーの伝播（Req 5.4、UnitConversionServiceのエラーをそのまま返す）", () => {
    it('UnitConversionServiceがVerificationError(type: "unit_not_found")を返す場合、そのエラーオブジェクトをそのまま（再ラップせず）返す', () => {
      const repository = createFakeFoodCompositionRepository({
        findById: (foodId) => (foodId === "10001" ? RICE : null),
      });
      const unitNotFoundError: VerificationError = {
        type: "unit_not_found",
        message: '単位 "カップ" に対する換算エントリが見つかりません（食品ID: 10001）',
        foodId: "10001",
        unit: "カップ",
      };
      const toGrams = vi.fn(() => ({ ok: false as const, error: unitNotFoundError }));
      const unitConversionService = createFakeUnitConversionService(toGrams);
      const service = createNutritionVerificationService(repository, unitConversionService);

      const result = service.verifyDish([{ foodId: "10001", quantity: 2, unit: "カップ" }]);

      expect(result).toEqual({ ok: false, error: unitNotFoundError });
      if (!result.ok) {
        // 再ラップされていない（同一の参照であること）ことを確認する
        expect(result.error).toBe(unitNotFoundError);
      }
    });
  });

  describe("verifyDish — 複数食材のうち一部が失敗した場合、部分的な計算結果を返さない（design.md Postconditions）", () => {
    it("1件目は有効、2件目が存在しない食品IDの場合、部分的な合算値を含まないクリーンな{ok:false}を返す", () => {
      const repository = createFakeFoodCompositionRepository({
        findById: (foodId) => {
          if (foodId === "10001") return RICE;
          return null; // 2件目は不存在
        },
      });
      const toGrams = vi.fn(() => ({ ok: true as const, value: 100 }));
      const unitConversionService = createFakeUnitConversionService(toGrams);
      const service = createNutritionVerificationService(repository, unitConversionService);

      const result = service.verifyDish([
        { foodId: "10001", quantity: 100, unit: "g" },
        { foodId: "no-such-food", quantity: 100, unit: "g" },
      ]);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected a failure result");
      }
      expect(result.error.type).toBe("food_id_not_found");
      expect(result.error.foodId).toBe("no-such-food");
      // 失敗結果には合算値（value）が一切含まれていないこと（部分結果の型上の不在）を確認する
      expect(Object.prototype.hasOwnProperty.call(result, "value")).toBe(false);
    });
  });

  describe("verifyDish — 決定論性（design.md #NutritionVerificationService の Invariants）", () => {
    it("同一のingredientsを同一のfake設定に対して2回呼び出しても、常に同一の結果を返す", () => {
      const repository = createFakeFoodCompositionRepository({
        findById: (foodId) => (foodId === "10001" ? RICE : foodId === "11001" ? CHICKEN : null),
      });
      const toGrams = vi.fn((_foodId: string, quantity: number) => ({
        ok: true as const,
        value: quantity,
      }));
      const unitConversionService = createFakeUnitConversionService(toGrams);
      const service = createNutritionVerificationService(repository, unitConversionService);

      const ingredients: IngredientSelection[] = [
        { foodId: "10001", quantity: 150, unit: "g" },
        { foodId: "11001", quantity: 100, unit: "g" },
      ];

      const result1 = service.verifyDish(ingredients);
      const result2 = service.verifyDish(ingredients);

      expect(result1).toEqual(result2);
    });
  });

  describe("verifyDay — 4食枠分のVerifiedNutritionValuesの合算（Req 4.4）", () => {
    const meal = (energyKcal: number): VerifiedNutritionValues => ({
      energyKcal,
      proteinG: 10,
      fatG: 5,
      carbG: 20,
      fiberG: 1,
      calciumMg: 2,
      ironMg: 0.1,
      vitaminAUg: 3,
      vitaminDUg: 0.5,
      vitaminB1Mg: 0.1,
      vitaminB2Mg: 0.1,
      vitaminCMg: 5,
      saltEquivalentG: 0.5,
    });

    it("4件（朝食・昼食・夕食・間食）の配列を渡した場合、各フィールドを単純合算する", () => {
      const repository = createFakeFoodCompositionRepository();
      const unitConversionService = createFakeUnitConversionService();
      const service = createNutritionVerificationService(repository, unitConversionService);

      const meals = [meal(400), meal(600), meal(700), meal(200)]; // energyKcal合計=1900

      const result = service.verifyDay(meals);

      expect(result).toEqual({
        energyKcal: 1900,
        proteinG: 40,
        fatG: 20,
        carbG: 80,
        fiberG: 4,
        calciumMg: 8,
        ironMg: 0.4,
        vitaminAUg: 12,
        vitaminDUg: 2,
        vitaminB1Mg: 0.4,
        vitaminB2Mg: 0.4,
        vitaminCMg: 20,
        saltEquivalentG: 2,
      });
    });

    it("要素数が4以外（2件・1件）でも、配列長を仮定せず正しく合算する", () => {
      const repository = createFakeFoodCompositionRepository();
      const unitConversionService = createFakeUnitConversionService();
      const service = createNutritionVerificationService(repository, unitConversionService);

      const twoMealsResult = service.verifyDay([meal(400), meal(600)]);
      expect(twoMealsResult.energyKcal).toBe(1000);
      expect(twoMealsResult.proteinG).toBe(20);

      const oneMealResult = service.verifyDay([meal(500)]);
      expect(oneMealResult).toEqual(meal(500));
    });

    it("空配列（0件）の場合、13項目すべてが0のVerifiedNutritionValuesを返す（合算の起点の境界値）", () => {
      const repository = createFakeFoodCompositionRepository();
      const unitConversionService = createFakeUnitConversionService();
      const service = createNutritionVerificationService(repository, unitConversionService);

      const result = service.verifyDay([]);

      expect(result).toEqual({
        energyKcal: 0,
        proteinG: 0,
        fatG: 0,
        carbG: 0,
        fiberG: 0,
        calciumMg: 0,
        ironMg: 0,
        vitaminAUg: 0,
        vitaminDUg: 0,
        vitaminB1Mg: 0,
        vitaminB2Mg: 0,
        vitaminCMg: 0,
        saltEquivalentG: 0,
      });
    });
  });

  describe("computeVarianceKcal — 目標値との差分（Req 4.5、符号規約: actual - target）", () => {
    it("実績が目標を上回る場合は正の値（超過分）を返す", () => {
      const repository = createFakeFoodCompositionRepository();
      const unitConversionService = createFakeUnitConversionService();
      const service = createNutritionVerificationService(repository, unitConversionService);

      expect(service.computeVarianceKcal(2200, 2000)).toBe(200);
    });

    it("実績が目標を下回る場合は負の値（不足分）を返す", () => {
      const repository = createFakeFoodCompositionRepository();
      const unitConversionService = createFakeUnitConversionService();
      const service = createNutritionVerificationService(repository, unitConversionService);

      expect(service.computeVarianceKcal(1800, 2000)).toBe(-200);
    });

    it("実績と目標が一致する場合は0を返す", () => {
      const repository = createFakeFoodCompositionRepository();
      const unitConversionService = createFakeUnitConversionService();
      const service = createNutritionVerificationService(repository, unitConversionService);

      expect(service.computeVarianceKcal(2000, 2000)).toBe(0);
    });
  });
});
