/**
 * プロフィール編集画面のページシェル。
 *
 * mockup.html の基本情報〜ダイエットモード各セクション（task 4.1-4.3）を1画面に組み立て、
 * `profileClient`（task 1.5）経由で `GET /api/profile` / `PUT /api/profile` とやり取りする
 * （design.md: Domain: UI (Presentation) Implementation Notes）。
 *
 * Requirements: 7.1（既存プロフィールがあれば全項目に初期表示）,
 * 7.2（プロフィール未保存時は各項目を未入力状態で表示）,
 * 7.5（キャンセル時は保存済みの内容を変更しない）
 */
import { useEffect, useState } from "react";
import type {
  CommuteMethod,
  Gender,
  JobActivityLevel,
  Profile,
  ProfileInput,
  RestrictionType,
} from "@nutrition/shared";
import { getProfile, saveProfile } from "../api/profileClient.js";
import {
  BasicInfoSection,
  validateBasicInfo,
  type BasicInfoSectionValue,
} from "../components/profile/BasicInfoSection.js";
import {
  BodyInfoSection,
  validateBodyInfo,
  type BodyInfoSectionValue,
} from "../components/profile/BodyInfoSection.js";
import {
  LifestyleSection,
  validateLifestyle,
  type LifestyleSectionValue,
} from "../components/profile/LifestyleSection.js";
import {
  ExerciseHabitSection,
  validateExerciseHabit,
  type ExerciseHabitSectionValue,
} from "../components/profile/ExerciseHabitSection.js";
import {
  ExerciseRoutineTable,
  validateExerciseRoutineTable,
  type ExerciseRoutineRowValue,
} from "../components/profile/ExerciseRoutineTable.js";
import {
  FoodPreferenceSection,
  type FoodPreferenceSectionValue,
} from "../components/profile/FoodPreferenceSection.js";
import {
  DietRestrictionSection,
  validateDietRestriction,
  type DietRestrictionSectionValue,
} from "../components/profile/DietRestrictionSection.js";
import {
  DietModeSection,
  validateDietMode,
  type DietModeSectionValue,
} from "../components/profile/DietModeSection.js";

/**
 * ページ全体のフォーム状態。各セクションコンポーネントの `*SectionValue` 型をすべて
 * 合成した形状で、編集中は必須項目（身長・体重・年齢・性別・お仕事中の活動度・通勤手段・
 * 食事制限タイプ）も未入力（`null`）を許容する（各セクション自身が「未入力状態で表示する」
 * ことを前提にしているため。Requirement 7.2）。
 */
interface ProfileFormState
  extends BasicInfoSectionValue,
    BodyInfoSectionValue,
    LifestyleSectionValue,
    ExerciseHabitSectionValue,
    DietRestrictionSectionValue,
    DietModeSectionValue {
  exerciseRoutine: ExerciseRoutineRowValue[];
  ngIngredients: string[];
  preferredIngredients: string[];
}

/** プロフィール未保存時の初期表示状態（Requirement 7.2）。 */
const EMPTY_FORM_STATE: ProfileFormState = {
  heightCm: null,
  weightKg: null,
  age: null,
  gender: null,
  bodyFatPct: null,
  medicalNotes: null,
  pregnancyStatus: "none",
  sleepHours: null,
  alcoholHabit: null,
  smokingHabit: null,
  cookingSkill: null,
  cookingTimePreference: null,
  budgetPreference: null,
  jobActivityLevel: null,
  commuteMethod: null,
  averageDailySteps: null,
  exerciseRoutine: [],
  ngIngredients: [],
  preferredIngredients: [],
  restrictionType: "none",
  restrictionIntensity: null,
  restrictionNotes: null,
  dietModeEnabled: false,
  goalWeightKg: null,
  goalPeriodWeeks: null,
};

/** 保存済みの `Profile`（またはプロフィール未保存を表す `null`）をフォーム状態に変換する（Requirements 7.1, 7.2）。 */
function toFormState(profile: Profile | null): ProfileFormState {
  if (profile === null) {
    return EMPTY_FORM_STATE;
  }
  return {
    heightCm: profile.heightCm,
    weightKg: profile.weightKg,
    age: profile.age,
    gender: profile.gender,
    bodyFatPct: profile.bodyFatPct,
    medicalNotes: profile.medicalNotes,
    pregnancyStatus: profile.pregnancyStatus,
    sleepHours: profile.sleepHours,
    alcoholHabit: profile.alcoholHabit,
    smokingHabit: profile.smokingHabit,
    cookingSkill: profile.cookingSkill,
    cookingTimePreference: profile.cookingTimePreference,
    budgetPreference: profile.budgetPreference,
    jobActivityLevel: profile.jobActivityLevel,
    commuteMethod: profile.commuteMethod,
    averageDailySteps: profile.averageDailySteps,
    exerciseRoutine: profile.exerciseRoutine.map((row) => ({ ...row })),
    ngIngredients: [...profile.ngIngredients],
    preferredIngredients: [...profile.preferredIngredients],
    restrictionType: profile.restrictionType,
    restrictionIntensity: profile.restrictionIntensity,
    restrictionNotes: profile.restrictionNotes,
    dietModeEnabled: profile.dietModeEnabled,
    goalWeightKg: profile.goalWeightKg,
    goalPeriodWeeks: profile.goalPeriodWeeks,
  };
}

/**
 * フォーム状態を `PUT /api/profile` へ送信するペイロードへ変換する。編集中は必須項目が
 * 未入力（`null`）の場合があるが、その場合もそのまま送信し、最終的な正としての検証は
 * サーバー側（Service層）に委ねる（design.md: Domain: UI Implementation Notes,
 * ProfileService Postconditions）。未入力のまま送信されたフィールドはサーバーから
 * `ValidationError` として返り、対応するセクションにフィールド別エラーとして反映される。
 */
function toProfileInputPayload(form: ProfileFormState): ProfileInput {
  return {
    heightCm: form.heightCm as number,
    weightKg: form.weightKg as number,
    age: form.age as number,
    gender: form.gender as Gender,
    bodyFatPct: form.bodyFatPct,
    medicalNotes: form.medicalNotes,
    pregnancyStatus: form.pregnancyStatus,
    sleepHours: form.sleepHours,
    alcoholHabit: form.alcoholHabit,
    smokingHabit: form.smokingHabit,
    cookingSkill: form.cookingSkill,
    cookingTimePreference: form.cookingTimePreference,
    budgetPreference: form.budgetPreference,
    jobActivityLevel: form.jobActivityLevel as JobActivityLevel,
    commuteMethod: form.commuteMethod as CommuteMethod,
    averageDailySteps: form.averageDailySteps,
    exerciseRoutine: form.exerciseRoutine.map((row) => ({
      scene: row.scene,
      content: row.content,
      frequencyPerWeek: row.frequencyPerWeek as number,
      durationMinutes: row.durationMinutes as number,
      intensity: row.intensity,
    })),
    ngIngredients: form.ngIngredients,
    preferredIngredients: form.preferredIngredients,
    restrictionType: form.restrictionType as RestrictionType,
    restrictionIntensity: form.restrictionIntensity,
    restrictionNotes: form.restrictionNotes,
    dietModeEnabled: form.dietModeEnabled,
    goalWeightKg: form.goalWeightKg,
    goalPeriodWeeks: form.goalPeriodWeeks,
  };
}

// --- セクションごとのフォーム状態スライス ---
// JSXの `value` props と、送信前クライアント側検証（下記 `validateFormLocally`）の両方から
// 参照する単一の切り出しロジック。表示に使う値と検証に使う値がずれないようにするため。

function selectBasicInfo(form: ProfileFormState): BasicInfoSectionValue {
  return { heightCm: form.heightCm, weightKg: form.weightKg, age: form.age, gender: form.gender };
}

function selectBodyInfo(form: ProfileFormState): BodyInfoSectionValue {
  return { bodyFatPct: form.bodyFatPct, pregnancyStatus: form.pregnancyStatus, medicalNotes: form.medicalNotes };
}

function selectLifestyle(form: ProfileFormState): LifestyleSectionValue {
  return {
    sleepHours: form.sleepHours,
    alcoholHabit: form.alcoholHabit,
    smokingHabit: form.smokingHabit,
    cookingSkill: form.cookingSkill,
    cookingTimePreference: form.cookingTimePreference,
    budgetPreference: form.budgetPreference,
  };
}

function selectExerciseHabit(form: ProfileFormState): ExerciseHabitSectionValue {
  return {
    jobActivityLevel: form.jobActivityLevel,
    commuteMethod: form.commuteMethod,
    averageDailySteps: form.averageDailySteps,
  };
}

function selectDietRestriction(form: ProfileFormState): DietRestrictionSectionValue {
  return {
    restrictionType: form.restrictionType,
    restrictionIntensity: form.restrictionIntensity,
    restrictionNotes: form.restrictionNotes,
  };
}

function selectDietMode(form: ProfileFormState): DietModeSectionValue {
  return {
    dietModeEnabled: form.dietModeEnabled,
    goalWeightKg: form.goalWeightKg,
    goalPeriodWeeks: form.goalPeriodWeeks,
  };
}

const EXERCISE_ROUTINE_ROW_ERROR_PATTERN = /^exerciseRoutine\.(\d+)\.(.+)$/;

/**
 * サーバーの `ValidationError.fieldErrors`（`server/src/profile/profile.service.ts` の
 * `toValidationError` が `issue.path.join(".")` をキーとして生成する形式。design.md:
 * Error Envelope）のうち、`exerciseRoutine.<index>.<field>` という行スコープのキーを
 * `ExerciseRoutineTable` の `errors` プロパティ（行インデックスに対応する配列）へ変換する。
 * それ以外のトップレベルフィールド（`heightCm` 等）は各セクションが `fieldErrors` を
 * そのまま受け取り、自身に関係するキーだけを参照する（`ProfilePage` 側で振り分ける必要がない）。
 */
function buildExerciseRoutineRowErrors(
  fieldErrors: Record<string, string[]>,
  rowCount: number,
): Array<Record<string, string[]> | undefined> {
  const rowErrors: Array<Record<string, string[]> | undefined> = new Array(rowCount).fill(undefined);
  for (const [key, messages] of Object.entries(fieldErrors)) {
    const match = EXERCISE_ROUTINE_ROW_ERROR_PATTERN.exec(key);
    if (match === null) {
      continue;
    }
    const index = Number(match[1]);
    const field = match[2]!;
    if (index < 0 || index >= rowCount) {
      continue;
    }
    const row = rowErrors[index] ?? (rowErrors[index] = {});
    row[field] = messages;
  }
  return rowErrors;
}

/** 複数の `Record<string, string[]>` を1つにマージする（同一キーが複数ソースにあればメッセージを連結する）。 */
function mergeFieldErrors(...sources: Array<Record<string, string[]>>): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const source of sources) {
    for (const [key, messages] of Object.entries(source)) {
      merged[key] = [...(merged[key] ?? []), ...messages];
    }
  }
  return merged;
}

interface LocalValidationResult {
  fieldErrors: Record<string, string[]>;
  exerciseRoutineRowErrors: Array<Record<string, string[]> | undefined>;
  hasErrors: boolean;
}

/**
 * 送信前のクライアント側検証（design.md: Domain: UI Implementation Notes ——
 * 「Zodスキーマをクライアント側でも再利用し...送信前に同一ルールで検証してユーザーへ
 * 即時フィードバックする」）。task 4.1-4.3 の各セクションが公開する `validate*` 関数
 * （`ProfileSchema.pick(...)` の再利用 + `.pick` で表現できない条件付き必須ルールの
 * ローカルチェック）をそのまま呼び出し、結果を `PUT /api/profile` のエラーレスポンスと
 * 同じ形（フラットな `Record<string, string[]>` + 行スコープ配列）にマージする。
 * 最終的な正としての検証はサーバー側（Service層）が行う（design.md）ため、ここでの
 * 検証はあくまで「即時フィードバック」目的であり、ここを通過した内容もサーバー側で
 * 改めて検証される。
 */
function validateFormLocally(form: ProfileFormState): LocalValidationResult {
  const fieldErrors = mergeFieldErrors(
    validateBasicInfo(selectBasicInfo(form)),
    validateBodyInfo(selectBodyInfo(form)),
    validateLifestyle(selectLifestyle(form)),
    validateExerciseHabit(selectExerciseHabit(form)),
    validateDietRestriction(selectDietRestriction(form)),
    validateDietMode(selectDietMode(form)),
  );

  const exerciseRoutineRowErrors = validateExerciseRoutineTable(form.exerciseRoutine);
  const hasRowErrors = exerciseRoutineRowErrors.some((rowErrors) => Object.keys(rowErrors).length > 0);

  return {
    fieldErrors,
    exerciseRoutineRowErrors,
    hasErrors: Object.keys(fieldErrors).length > 0 || hasRowErrors,
  };
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function ProfilePage() {
  const [form, setForm] = useState<ProfileFormState>(EMPTY_FORM_STATE);
  // 直近にサーバーへ永続化されている（= ロード時または保存成功時の）フォーム状態。
  // キャンセル操作はこの状態へ復元するだけで、APIを呼び出さない（Requirement 7.5）。
  const [savedForm, setSavedForm] = useState<ProfileFormState>(EMPTY_FORM_STATE);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [exerciseRoutineRowErrors, setExerciseRoutineRowErrors] = useState<
    Array<Record<string, string[]> | undefined>
  >([]);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    let cancelled = false;

    void getProfile().then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        const next = toFormState(result.value);
        setForm(next);
        setSavedForm(next);
      }
      // ネットワーク断・サーバーエラー時は初期表示を空のフォーム状態のまま保持する
      // （7.1/7.2 は「プロフィールの有無」に対する挙動のみを定義しており、取得失敗自体は
      // 本タスクの明示的な観測可能条件の対象外）。
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = () => {
    // 送信前クライアント側検証（design.md: 「送信前に同一ルールで検証してユーザーへ
    // 即時フィードバックする」）。ローカルに検証エラーがあれば `saveProfile` を呼び出さず、
    // 各セクションへエラーを反映するだけで終わる（サーバーへの往復を待たせない）。
    const localValidation = validateFormLocally(form);
    if (localValidation.hasErrors) {
      setFieldErrors(localValidation.fieldErrors);
      setExerciseRoutineRowErrors(localValidation.exerciseRoutineRowErrors);
      setGeneralError(null);
      setSaveStatus("error");
      return;
    }

    setSaveStatus("saving");
    setGeneralError(null);

    void saveProfile(toProfileInputPayload(form)).then((result) => {
      if (result.ok) {
        const next = toFormState(result.value);
        setForm(next);
        setSavedForm(next);
        setFieldErrors({});
        setExerciseRoutineRowErrors([]);
        setSaveStatus("saved");
        return;
      }

      // 最終的な正としての検証はサーバー側（Service層）が行う（design.md）。クライアント側
      // 検証をすり抜けた、またはクライアント側では表現できないルール違反（例:
      // `.pick` で切り出せない規則）はここでサーバーからのフィールド別エラーとして反映される。
      if (result.error.type === "validation") {
        setFieldErrors(result.error.fieldErrors);
        setExerciseRoutineRowErrors(
          buildExerciseRoutineRowErrors(result.error.fieldErrors, form.exerciseRoutine.length),
        );
      } else {
        setFieldErrors({});
        setExerciseRoutineRowErrors([]);
        setGeneralError(result.error.message);
      }
      setSaveStatus("error");
    });
  };

  const handleCancel = () => {
    // 保存済みの内容（直近のロード/保存結果）へ復元するのみで、APIは呼び出さない
    // （Requirement 7.5: 保存済みの内容を変更しない）。
    setForm(savedForm);
    setFieldErrors({});
    setExerciseRoutineRowErrors([]);
    setGeneralError(null);
    setSaveStatus("idle");
  };

  const isSaving = saveStatus === "saving";

  return (
    <main>
      <h1>プロフィール</h1>
      <p className="sec-sub">
        入力・保存した内容は、栄養計算・献立生成のたびに再入力せず利用されます。
      </p>

      <BasicInfoSection
        value={selectBasicInfo(form)}
        onChange={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
        errors={fieldErrors}
      />

      <BodyInfoSection
        value={selectBodyInfo(form)}
        onChange={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
        errors={fieldErrors}
      />

      <LifestyleSection
        value={selectLifestyle(form)}
        onChange={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
        errors={fieldErrors}
      />

      <ExerciseHabitSection
        value={selectExerciseHabit(form)}
        onChange={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
        errors={fieldErrors}
      />

      <ExerciseRoutineTable
        value={form.exerciseRoutine}
        onChange={(rows) => setForm((prev) => ({ ...prev, exerciseRoutine: rows }))}
        errors={exerciseRoutineRowErrors}
      />

      <FoodPreferenceSection
        value={{ ngIngredients: form.ngIngredients, preferredIngredients: form.preferredIngredients }}
        onChange={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
      />

      <DietRestrictionSection
        value={selectDietRestriction(form)}
        onChange={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
        errors={fieldErrors}
      />

      <DietModeSection
        value={selectDietMode(form)}
        onChange={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
        errors={fieldErrors}
      />

      {generalError !== null && (
        <p role="alert" className="field-error">
          {generalError}
        </p>
      )}
      {saveStatus === "saved" && <p role="status">保存しました</p>}

      <div className="actions" style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button type="button" className="btn-ghost" onClick={handleCancel} disabled={isSaving}>
          キャンセル
        </button>
        <button type="button" className="btn-primary" onClick={handleSave} disabled={isSaving}>
          プロフィールを保存
        </button>
      </div>
    </main>
  );
}
