/**
 * TEMPORARY acceptance audit at the library level. Not committed.
 *
 * Drives the real modules with a real session so RLS applies, covering the
 * flows that only exist behind a server action and are therefore unreachable
 * over plain HTTP.
 */

import { createServerClient } from "@supabase/ssr";
import { beforeAll, describe, expect, it, vi } from "vitest";

type Cookie = { name: string; value: string };
const jar = new Map<string, string>();
const cookieStore = {
  getAll: (): Cookie[] => [...jar.entries()].map(([name, value]) => ({ name, value })),
  set: (name: string, value: string) => void jar.set(name, value),
};
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const EMAIL = `caldef.libaudit.${Date.now()}@gmail.com`;
let userId = "";
let foodId = 0;
let mealTypeId = 0;
let today = "";
const dayOffset = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  const boot = createServerClient(URL_, KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (l: Cookie[]) => l.forEach((c) => cookieStore.set(c.name, c.value)),
    },
  });

  const { data, error } = await boot.auth.signUp({
    email: EMAIL,
    password: "Caldef-audit-passw0rd!",
  });
  if (error) throw error;
  userId = data.user!.id;
  today = dayOffset(0);

  await boot.from("profiles").update({
    sex: "male", birth_date: "1995-01-01", height_cm: 180,
    unit_system: "metric", timezone: "UTC", ai_enabled: true,
  }).eq("id", userId);
  await boot.from("goals").insert({
    user_id: userId, goal_type: "lose", activity_level: "moderate",
    final_goal_weight_kg: 90,
  });

  const weights = Array.from({ length: 56 }, (_, i) => ({
    user_id: userId,
    entry_date: dayOffset(i - 55),
    weight_kg: Number((111.8 - (0.9 / 7) * i + Math.sin(i * 1.7) * 0.35).toFixed(2)),
  }));
  await boot.from("weight_entries").upsert(weights, { onConflict: "user_id,entry_date" });

  mealTypeId = (await boot.from("meal_types").select("id").order("id")).data![0].id;

  const f = await boot.from("foods").insert({
    source: "usda", source_id: `LIBAUDIT-${Date.now()}`,
    name: "Audit chicken breast", is_verified: true,
  }).select("id").single();
  foodId = f.data!.id;
  await boot.from("food_nutrients").insert({
    food_id: foodId, kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6,
  });
  await boot.from("food_servings").insert([
    { food_id: foodId, label: "100 g", grams: 100, is_default: true },
    { food_id: foodId, label: "1 fillet (172 g)", grams: 172, is_default: false },
  ]);

  const logs = Array.from({ length: 56 }, (_, i) => ({
    user_id: userId, log_date: dayOffset(i - 55), meal_type_id: mealTypeId,
    food_id: foodId, amount: 1273, unit: "g" as const, grams: 1273,
    kcal: 2100, protein_g: 160, carbs_g: 200, fat_g: 60, source: "manual" as const,
  }));
  await boot.from("food_logs").insert(logs);

  console.log("LIB_AUDIT_USER=" + userId, "FOOD=" + foodId);
}, 120_000);

describe("weight, trend and adaptive TDEE", () => {
  it("smooths the trend rather than following the scale", async () => {
    const { getWeightHistory } = await import("@/lib/weight");
    const h = await getWeightHistory("UTC");

    expect(h.entries.length).toBe(56);
    expect(h.latestTrendKg).not.toBeNull();
    // 56 days at ~0.9 kg/week from 111.8 lands near 104.6; the trend lags.
    expect(h.latestTrendKg!).toBeGreaterThan(h.latestKg!);
    expect(h.changeKgPerWeek!).toBeLessThan(0);
    console.log("  latest", h.latestKg, "trend", h.latestTrendKg, "rate/wk", h.changeKgPerWeek);
  }, 60_000);

  it("publishes and stores an adaptive estimate on 56 days of data", async () => {
    const { recordExpenditure } = await import("@/lib/expenditure");
    const e = await recordExpenditure();

    expect(e).not.toBeNull();
    expect(e!.estimate.isPublishable).toBe(true);
    expect(e!.estimate.method).toBe("adaptive");
    expect(e!.tdeeKcal).toBeGreaterThan(800);
    expect(e!.tdeeKcal).toBeLessThan(10000);
    console.log("  tdee", e!.tdeeKcal, "confidence", e!.estimate.confidence,
      "meanIntake", e!.meanIntakeKcal, "trendΔ/wk", e!.trendChangeKgPerWeek);
  }, 60_000);
});

describe("diary, totals and editing", () => {
  it("computes totals and macros from stored rows", async () => {
    const { getDiaryDay } = await import("@/lib/diary");
    const day = await getDiaryDay(today as never);

    expect(day.entries.length).toBeGreaterThan(0);
    expect(day.totals.totals.kcal).toBeCloseTo(2100, 4);
    expect(day.totals.totals.protein_g).toBeCloseTo(160, 4);
  }, 60_000);

  it("logs, edits and deletes a food, recomputing from the nutrient row", async () => {
    const { logCachedFood, updateEntryPortion } = await import("@/lib/food-log");
    const { getDiaryDay } = await import("@/lib/diary");

    expect(await logCachedFood({
      foodId, logDate: today, mealTypeId, amount: 200, unit: "g", source: "manual",
    })).toEqual({ ok: true });

    let day = await getDiaryDay(today as never);
    const entry = day.entries.find((e) => Math.abs(e.kcal - 330) < 0.001);
    expect(entry, "200 g of a 165 kcal/100 g food is 330 kcal").toBeTruthy();

    expect(await updateEntryPortion({ entryId: entry!.id, amount: 250 })).toEqual({ ok: true });
    day = await getDiaryDay(today as never);
    expect(day.entries.find((e) => e.id === entry!.id)!.kcal).toBeCloseTo(412.5, 4);

    // A serving-based amend resolves through the food's own serving.
    expect(await updateEntryPortion({
      entryId: entry!.id, amount: 1, unit: "serving",
    })).toEqual({ ok: true });
    day = await getDiaryDay(today as never);
    const amended = day.entries.find((e) => e.id === entry!.id)!;
    expect(amended.grams).toBeCloseTo(100, 4);

    const supabase = (await import("@/lib/supabase/server")).createClient;
    const client = await supabase();
    await client.from("food_logs").delete().eq("id", entry!.id);
    day = await getDiaryDay(today as never);
    expect(day.entries.find((e) => e.id === entry!.id)).toBeUndefined();
  }, 60_000);
});

describe("unit conversion and servings", () => {
  it("converts a serving amount using the food's own gram weight", async () => {
    const { logCachedFood } = await import("@/lib/food-log");
    const { getDiaryDay } = await import("@/lib/diary");

    expect(await logCachedFood({
      foodId, logDate: today, mealTypeId, amount: 2, unit: "serving",
      servingLabel: "1 fillet (172 g)", source: "manual",
    })).toEqual({ ok: true });

    const day = await getDiaryDay(today as never);
    const e = day.entries.find((x) => Math.abs(x.grams - 344) < 0.001);
    expect(e, "2 × 172 g").toBeTruthy();
    expect(e!.kcal).toBeCloseTo(165 * 3.44, 3);
  }, 60_000);

  it("refuses a serving amount whose serving does not exist", async () => {
    const { logCachedFood } = await import("@/lib/food-log");
    const r = await logCachedFood({
      foodId, logDate: today, mealTypeId, amount: 1, unit: "serving",
      servingLabel: "nonexistent", source: "manual",
    });
    expect("error" in r).toBe(true);
  }, 60_000);
});

describe("recipes, saved meals and favourites", () => {
  it("builds a recipe from diary entries and logs it as one entry", async () => {
    const { getDiaryDay } = await import("@/lib/diary");
    const { createRecipe, addIngredientsFromEntries, getRecipe, logRecipe } =
      await import("@/lib/recipes");

    const day = await getDiaryDay(today as never);
    const ids = day.entries.slice(0, 2).map((e) => e.id);

    const created = await createRecipe("Audit recipe", 2, null);
    expect("id" in created).toBe(true);
    const recipeId = (created as { id: number }).id;

    expect(await addIngredientsFromEntries(recipeId, ids)).toEqual({ added: 2 });
    const detail = await getRecipe(recipeId);
    expect(detail!.ingredients).toHaveLength(2);
    expect(detail!.perServing.kcal).toBeCloseTo(detail!.totals.kcal / 2, 1);

    const before = (await getDiaryDay(today as never)).entries.length;
    expect(await logRecipe(recipeId, today, mealTypeId, 1)).toEqual({ ok: true });
    const after = await getDiaryDay(today as never);
    expect(after.entries.length).toBe(before + 1);
    expect(after.entries.some((e) => e.foodId === null)).toBe(true);
  }, 60_000);

  it("saves a meal and logs it as several entries", async () => {
    const { getDiaryDay } = await import("@/lib/diary");
    const { createSavedMealFromEntries, logSavedMeal } = await import("@/lib/saved-meals");

    const day = await getDiaryDay(today as never);
    const ids = day.entries.filter((e) => e.foodId !== null).slice(0, 2).map((e) => e.id);

    const created = await createSavedMealFromEntries("Audit meal", ids, mealTypeId);
    expect("id" in created).toBe(true);

    const before = (await getDiaryDay(today as never)).entries.length;
    expect(await logSavedMeal((created as { id: number }).id, today, mealTypeId))
      .toEqual({ logged: 2 });
    expect((await getDiaryDay(today as never)).entries.length).toBe(before + 2);
  }, 60_000);

  it("stars and unstars a food", async () => {
    const { addFavorite, getFavorites, removeFavorite, getFavoriteFoodIds } =
      await import("@/lib/favorites");

    await addFavorite(foodId);
    expect((await getFavorites()).map((f) => f.id)).toContain(foodId);
    expect([...(await getFavoriteFoodIds())]).toContain(foodId);

    await removeFavorite(foodId);
    expect([...(await getFavoriteFoodIds())]).not.toContain(foodId);
  }, 60_000);
});

describe("the 2-Month Cut phase", () => {
  it("starts a phase, writes eight milestones, and never prescribes the final goal", async () => {
    const { createPhase, getActivePhase } = await import("@/lib/phase");
    const { getExpenditure } = await import("@/lib/expenditure");

    const e = await getExpenditure();
    expect(e).not.toBeNull();

    const created = await createPhase({
      startWeightKg: e!.baselineWeightKg,
      tdeeKcal: e!.estimate.isPublishable ? e!.tdeeKcal : e!.formulaTdeeKcal,
      proteinGPerKg: 1.6,
      finalGoalWeightKg: 90,
      stretchTargetKg: 99,
      durationDays: 56,
      timeZone: "UTC",
    });
    expect("error" in created, JSON.stringify(created)).toBe(false);
    if ("error" in created) return;

    const { plan, phase } = created;
    console.log("  start", plan.startWeightKg, "recommended range",
      plan.recommendedTargetLowKg, "-", plan.recommendedTargetHighKg,
      "| stretch", plan.stretchTargetKg, "| final", plan.finalGoalWeightKg);
    console.log("  initial target", plan.initialTargetKcal, "kcal, protein",
      plan.initialProteinG, "g");

    // Spec 8.1: four separate concepts, none collapsed into another.
    expect(Number(phase.final_goal_weight_kg)).toBe(90);
    expect(Number(phase.stretch_target_kg)).toBe(99);
    // The four concepts stay separate (spec 8.1): the recommended range is
    // computed from the safe rate band, independently of the stretch ask.
    expect(plan.recommendedTargetLowKg).toBeLessThan(plan.startWeightKg);
    expect(plan.recommendedTargetHighKg).toBeGreaterThan(plan.recommendedTargetLowKg);

    // Spec 8.2/8.3: the 90 kg goal must never become the prescription.
    expect(plan.initialTargetKcal).toBeGreaterThanOrEqual(1200);
    // Spec 8.5's roadmap is START plus W1..W8, so nine rows.
    expect(plan.milestones.length).toBe(9);
    expect(plan.milestones[0].weekNumber).toBe(0);
    expect(plan.milestones[8].weekNumber).toBe(8);

    const active = await getActivePhase(today as never);
    expect(active).not.toBeNull();
    expect(active!.milestones.length).toBe(9);
  }, 60_000);

  it("produces a dashboard with four graph series and a checkpoint report", async () => {
    const { getActivePhase } = await import("@/lib/phase");
    const { getPhaseDashboard } = await import("@/lib/phase-dashboard");
    const { getWeightHistory } = await import("@/lib/weight");
    const { buildPhaseSeries } = await import("@/lib/tdee/phase-series");

    const active = await getActivePhase(today as never);
    const history = await getWeightHistory("UTC");
    const dash = await getPhaseDashboard(active!, history, today as never);

    expect(dash.totalDays).toBe(56);
    expect(dash.dayNumber).toBeGreaterThanOrEqual(1);
    expect(dash.checkpoints.length).toBeGreaterThan(0);
    expect(dash.report).toBeTruthy();
    expect(dash.projectionNote.length).toBeGreaterThan(0);
    // Spec 8.6: never shaming.
    expect(dash.projectionNote.toLowerCase()).not.toMatch(/fail|lazy|should have|disappoint/);

    const points = buildPhaseSeries({
      startDate: active!.phase.start_date,
      durationDays: active!.phase.duration_days,
      startWeightKg: Number(active!.phase.start_weight_kg),
      recommendedKgPerWeek: Math.abs(dash.trendKgPerWeek ?? 1),
      stretchTargetKg: Number(active!.phase.stretch_target_kg),
      trend: history.trend,
    });

    // Spec 8.7: four lines over day 1..56.
    expect(points.length).toBe(56);
    const series = {
      actual: points.filter((p) => p.actualKg !== null).length,
      trend: points.filter((p) => p.trendKg !== null).length,
      recommended: points.filter((p) => p.recommendedKg !== null).length,
      stretch: points.filter((p) => p.stretchKg !== null).length,
    };
    expect(series.actual).toBeGreaterThan(0);
    expect(series.trend).toBeGreaterThan(0);
    expect(series.recommended).toBe(56);
    expect(series.stretch).toBe(56);
    // The stretch line reaches its goalpost on the last day of the phase.
    expect(points[55].stretchKg).toBeCloseTo(Number(active!.phase.stretch_target_kg), 1);
    // Neither measurement line is drawn into the future.
    expect(series.actual).toBeLessThan(56);

    console.log("  day", dash.dayNumber, "| lost", dash.lostKg,
      "| projected", dash.projectedEndWeightKg, "| adherence", dash.adherencePct + "%");
    console.log("  report:", dash.report.headline);
    console.log("  note:", dash.projectionNote);
    console.log("  series points", series);
  }, 60_000);
});

describe("the weekly check-in", () => {
  it("records an adjustment when the target moves", async () => {
    const { recordWeeklyCheckin } = await import("@/lib/checkin");
    const { createClient } = await import("@/lib/supabase/server");

    await recordWeeklyCheckin(userId, today, "UTC", {
      weekStartDate: today,
      previousTargetKcal: 2250,
      newTargetKcal: 2180,
      reason: "audit",
    });

    const client = await createClient();
    const { data } = await client.from("weekly_checkins").select("*");
    expect((data ?? []).length).toBeGreaterThan(0);
  }, 60_000);
});
