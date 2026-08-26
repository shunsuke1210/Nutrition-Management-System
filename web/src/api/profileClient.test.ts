import { afterEach, describe, expect, it, vi } from "vitest";
import type { Profile, ProfileInput } from "@nutrition/shared";
import { getProfile, saveProfile } from "./profileClient.js";

function stubFetchResolved(status: number, json: unknown): void {
  const ok = status >= 200 && status < 300;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status,
      ok,
      json: vi.fn().mockResolvedValue(json),
    } as unknown as Response),
  );
}

const sampleProfileInput: ProfileInput = {
  heightCm: 170,
  weightKg: 60,
  age: 30,
  gender: "undisclosed",
  bodyFatPct: null,
  medicalNotes: null,
  pregnancyStatus: "none",
  sleepHours: null,
  alcoholHabit: null,
  smokingHabit: null,
  cookingSkill: null,
  cookingTimePreference: null,
  budgetPreference: null,
  jobActivityLevel: "mixed",
  commuteMethod: "walk_or_bike",
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

const sampleProfile: Profile = {
  ...sampleProfileInput,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("profileClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getProfile() issues a GET request to /api/profile and resolves to the stored profile", async () => {
    stubFetchResolved(200, sampleProfile);

    const result = await getProfile();

    expect(fetch).toHaveBeenCalledWith("/api/profile", expect.objectContaining({ method: "GET" }));
    expect(result).toEqual({ ok: true, value: sampleProfile });
  });

  it("getProfile() resolves to ok:true with null when no profile has been saved yet", async () => {
    stubFetchResolved(200, null);

    const result = await getProfile();

    expect(result).toEqual({ ok: true, value: null });
  });

  it("saveProfile() issues a PUT request with the profile input as the JSON body", async () => {
    stubFetchResolved(200, sampleProfile);

    const result = await saveProfile(sampleProfileInput);

    expect(fetch).toHaveBeenCalledWith(
      "/api/profile",
      expect.objectContaining({ method: "PUT", body: JSON.stringify(sampleProfileInput) }),
    );
    expect(result).toEqual({ ok: true, value: sampleProfile });
  });

  it("saveProfile() resolves to a validation error result when the server rejects the input", async () => {
    stubFetchResolved(400, {
      type: "validation",
      fieldErrors: { heightCm: ["must be positive"] },
    });

    const result = await saveProfile({ ...sampleProfileInput, heightCm: -1 });

    expect(result).toEqual({
      ok: false,
      error: { type: "validation", fieldErrors: { heightCm: ["must be positive"] } },
    });
  });
});
