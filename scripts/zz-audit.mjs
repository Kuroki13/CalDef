/** TEMPORARY full-project acceptance audit. Not committed. */
import { readFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";

const BASE = "http://localhost:3100";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l)).filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));

let pass = 0, fail = 0; const failures = [];
const check = (n, ok, d = "") => {
  ok ? pass++ : (fail++, failures.push(n));
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`);
};

const jar = new Map();
const sb = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
             setAll: (l) => l.forEach((c) => jar.set(c.name, c.value)) } });

const EMAIL = `caldef.audit.${Date.now()}@gmail.com`;
const PASSWORD = "Caldef-audit-passw0rd!";

// ---------- signup / login ----------
const { data: su, error: suErr } = await sb.auth.signUp({ email: EMAIL, password: PASSWORD });
check("Signup returns a session immediately", !suErr && !!su.session, suErr?.message);
const userId = su.user.id;

const prof = await sb.from("profiles").select("id").eq("id", userId).maybeSingle();
check("handle_new_user created the profile row", !!prof.data);

// ---------- seed a realistic 56-day history ----------
const TODAY = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const dayOffset = (n) => { const d = new Date(TODAY); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const START = dayOffset(-55);

await sb.from("profiles").update({ display_name: "Audit", sex: "male", birth_date: "1995-01-01",
  height_cm: 180, unit_system: "metric", timezone: "UTC", ai_enabled: true }).eq("id", userId);
await sb.from("goals").insert({ user_id: userId, goal_type: "lose", activity_level: "moderate",
  final_goal_weight_kg: 90 });

// 56 daily weigh-ins: 111.8 kg falling ~0.9 kg/week with noise.
const weights = [];
for (let i = 0; i < 56; i++) {
  const trend = 111.8 - (0.9 / 7) * i;
  const noise = Math.sin(i * 1.7) * 0.35;
  weights.push({ user_id: userId, entry_date: dayOffset(i - 55), weight_kg: Number((trend + noise).toFixed(2)) });
}
await sb.from("weight_entries").upsert(weights, { onConflict: "user_id,entry_date" });

const mealTypes = (await sb.from("meal_types").select("id, slug").order("id")).data;
const breakfast = mealTypes[0].id;

// A cached food to log against.
const foodIns = await sb.from("foods").insert({ source: "usda", source_id: "AUDIT-1",
  name: "Audit chicken breast", is_verified: true }).select("id").single();
const foodId = foodIns.data.id;
await sb.from("food_nutrients").insert({ food_id: foodId, kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 });
const servIns = await sb.from("food_servings").insert([
  { food_id: foodId, label: "100 g", grams: 100, is_default: true },
  { food_id: foodId, label: "1 fillet (172 g)", grams: 172, is_default: false },
]).select("id, label");
const servingId = servIns.data.find((s) => s.label === "100 g").id;

// 56 days of logs at ~2100 kcal so the expenditure model has intake.
const logs = [];
for (let i = 0; i < 56; i++) {
  logs.push({ user_id: userId, log_date: dayOffset(i - 55), meal_type_id: breakfast,
    food_id: foodId, serving_id: servingId, amount: 1273, unit: "g", grams: 1273,
    kcal: 2100, protein_g: 160, carbs_g: 200, fat_g: 60, source: "manual" });
}
await sb.from("food_logs").insert(logs);

const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const get = async (p, opts = {}) => {
  const r = await fetch(BASE + p, { headers: { cookie }, redirect: "manual", ...opts });
  return { status: r.status, body: await r.text(), headers: r.headers };
};
const postJson = async (p, b) => {
  const r = await fetch(BASE + p, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(b) });
  let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
};

// ---------- authorization ----------
const anonPage = await fetch(`${BASE}/diary`, { redirect: "manual" });
check("Signed-out page request redirects to login", anonPage.status === 307 &&
  (anonPage.headers.get("location") ?? "").includes("/login"), `status ${anonPage.status}`);
for (const api of ["/api/foods/search?q=rice", "/api/foods/barcode?code=3017624010701"]) {
  const r = await fetch(BASE + api, { redirect: "manual" });
  check(`Signed-out ${api.split("?")[0]} is 401 JSON`, r.status === 401, `status ${r.status}`);
}
const notFound = await get("/no-such-page");
check("Signed-in unknown path renders the 404 page", notFound.status === 404 &&
  notFound.body.includes("Page not found"), `status ${notFound.status}`);

// ---------- pages render ----------
for (const p of ["/dashboard", "/diary", "/weight", "/phase", "/recipes", "/assistant", "/settings"]) {
  const r = await get(p);
  check(`${p} renders`, r.status === 200, `status ${r.status}`);
}

// ---------- diary, totals, macros ----------
const diary = await get("/diary");
check("Diary shows the logged entry", diary.body.includes("Audit chicken breast"));
check("Diary shows a calorie total", /\d+\s*of\s*\d+\s*kcal/.test(diary.body) || /kcal (left|over)/.test(diary.body));

// ---------- daily target: floor and provenance ----------
const target = (await sb.from("daily_targets").select("*").eq("target_date", iso(TODAY)).maybeSingle()).data;
check("A daily target was created for today", !!target, JSON.stringify(target && { c: target.calories, s: target.source }));
if (target) {
  check("Target is above the 1200 kcal absolute floor", target.calories >= 1200, `${target.calories} kcal`);
  check("Target macros are non-negative", Number(target.protein_g) >= 0 && Number(target.carbs_g) >= 0 && Number(target.fat_g) >= 0);
  const macroKcal = Number(target.protein_g) * 4 + Number(target.carbs_g) * 4 + Number(target.fat_g) * 9;
  check("Target macros do not exceed the calorie target", macroKcal <= target.calories + 2,
    `macros ${Math.round(macroKcal)} vs ${target.calories}`);
}

// ---------- weight trend + adaptive TDEE ----------
const weightPage = await get("/weight");
check("Weight page shows a trend figure", /trend/i.test(weightPage.body));
const tdee = (await sb.from("tdee_estimates").select("*").order("computed_for", { ascending: false }).limit(1).maybeSingle()).data;
check("An adaptive TDEE estimate was recorded", !!tdee,
  tdee && `${tdee.estimated_tdee_kcal} kcal, method ${tdee.method}, confidence ${tdee.confidence}`);
if (tdee) check("Adaptive estimate is within the sane band", Number(tdee.estimated_tdee_kcal) > 800 && Number(tdee.estimated_tdee_kcal) < 10000);

// ---------- dashboard: goal projection ----------
const dash = await get("/dashboard");
check("Dashboard names the final goal", dash.body.includes("90"));

// ---------- food search / providers / caching ----------
const search = await get("/api/foods/search?q=chicken%20breast");
const sj = JSON.parse(search.body);
check("Food search returns results", sj.foods?.length > 0, `${sj.foods?.length} foods`);
check("Search includes a USDA result", sj.foods?.some((f) => f.source === "usda"));
check("Search includes an Open Food Facts result", sj.foods?.some((f) => f.source === "off"),
  sj.notice ?? "");
check("Cached food is returned first for a query that names it",
  (await (await fetch(`${BASE}/api/foods/search?q=Audit%20chicken%20breast`, { headers: { cookie } })).json())
    .foods?.[0]?.name === "Audit chicken breast");
check("Every result carries servings and per-100g nutrients",
  sj.foods.every((f) => f.servings?.length > 0 && typeof f.nutrients?.kcal === "number"));
check("Open Food Facts results are never marked verified",
  sj.foods.filter((f) => f.source === "off").every((f) => f.isVerified === false));

// ---------- barcode ----------
const bc = await get("/api/foods/barcode?code=3017624010701");
const bj = JSON.parse(bc.body);
check("Barcode lookup resolves a real product", bc.status === 200 && !!bj.food, bj.food?.name);
const bcMissing = await get("/api/foods/barcode?code=0000000000017");
check("Unknown barcode is 404 with a body, not an error", bcMissing.status === 404 && !!JSON.parse(bcMissing.body).error);
const bcBad = await get("/api/foods/barcode?code=nope");
check("Malformed barcode is rejected with 400", bcBad.status === 400);

// ---------- AI ----------
const parse = await postJson("/api/ai/parse", { text: "I ate 200g chicken, 150g rice and one tablespoon olive oil" });
check("AI parse returns proposals", parse.status === 200 && parse.json.proposals?.length === 3,
  `status ${parse.status} ${parse.json?.error ?? ""}`);
if (parse.json?.proposals) {
  check("AI proposals carry no nutrition on the intent",
    parse.json.proposals.every((p) => Object.keys(p.intent).sort().join() === "amount,query,unit"));
  check("AI macros equal the matched food's own numbers",
    parse.json.proposals.every((p) => !p.match || Math.abs(p.macros.kcal - p.match.nutrients.kcal * p.grams / 100) < 1e-6));
}
const boundary = await postJson("/api/ai/parse", { text: `log rice for ${EMAIL}` });
check("AI refuses text carrying an email", boundary.status === 400 && boundary.json.reason === "email");
const boundary2 = await postJson("/api/ai/chat", { message: `my id is ${userId}` });
check("AI refuses text carrying a user id", boundary2.status === 400 && boundary2.json.reason === "identifier");

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) console.log("FAILED:\n  " + failures.join("\n  "));
console.log("AUDIT_USER=" + userId);
console.log("AUDIT_FOOD=" + foodId);
