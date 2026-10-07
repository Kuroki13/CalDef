/**
 * Reading a food off its packaging.
 *
 * A label states its figures either per 100 g or per portion, and which one
 * it uses is not the user's choice — it is whatever the manufacturer
 * printed. Asking someone to divide a "per 45 g serving" panel by 0.45 in
 * their head before typing it is how wrong numbers get into a database, so
 * the conversion happens here instead.
 *
 * The database stores per 100 g and nothing else (`food_nutrients`), which
 * is what every calculation in the app assumes. This module is the one
 * place that turns what a label says into that.
 *
 * Deliberately free of `server-only` and of any database import: it is pure
 * arithmetic and validation, so it can be tested on its own and reused by
 * whichever action needs it.
 */

import { z } from "zod";

/**
 * The caps `food_nutrients` enforces, restated so the user is told which
 * figure is impossible rather than being shown a constraint violation.
 *
 * They are per 100 g, and they are not arbitrary: nothing edible exceeds
 * 100 g of a macronutrient per 100 g, and pure fat — the most energy-dense
 * food there is — is about 900 kcal.
 */
export const PER_100G_LIMITS = {
  kcal: 1000,
  protein_g: 100,
  carbs_g: 100,
  fat_g: 100,
  fiber_g: 100,
  sugar_g: 100,
  sat_fat_g: 100,
} as const;

/** A blank optional number field means "not on the label", not zero. */
const optionalNumber = z.preprocess(
  (value) =>
    value === "" || value === null || value === undefined ? null : value,
  z.coerce.number().min(0).nullable(),
);

const requiredNumber = z.coerce.number().min(0);

/** Enough for "1 pot", "1 spoon", "1 bowl" and a couple more; not a table. */
export const MAX_EXTRA_SERVINGS = 4;

export const customFoodInputSchema = z
  .object({
    name: z.string().trim().min(1).max(300),
    brand: z
      .preprocess(
        (v) => (v === "" || v === undefined ? null : v),
        z.string().trim().max(200).nullable(),
      )
      .optional()
      .default(null),
    barcode: z
      .preprocess(
        (v) => (v === "" || v === undefined ? null : v),
        z
          .string()
          .trim()
          .regex(/^[0-9]{6,14}$/, "A barcode is 6 to 14 digits.")
          .nullable(),
      )
      .optional()
      .default(null),

    /**
     * The owner's own note — where it is bought, which variety. Shown to
     * nobody else and never sent to the model.
     */
    notes: z
      .preprocess(
        (v) => (v === "" || v === undefined ? null : v),
        z.string().trim().max(500).nullable(),
      )
      .optional()
      .default(null),

    /**
     * Which panel the figures were copied from. Drinks print theirs per
     * 100 ml, and asking someone to pretend that is per 100 g is asking them
     * to be wrong in a way they cannot see.
     */
    basis: z.enum(["per_100g", "per_100ml", "per_serving"]),
    /**
     * Whether a serving is weighed or poured: "1 can (330 ml)" against
     * "1 bar (45 g)". Only consulted with `per_serving`; the per-100 panels
     * already say which they are.
     */
    servingUnit: z
      .preprocess(
        (v) => (v === "" || v === undefined || v === null ? "g" : v),
        z.enum(["g", "ml"]),
      )
      .optional()
      .default("g"),
    /**
     * What one portion weighs. Required with `per_serving`, because that is
     * the number the conversion divides by; optional otherwise, where it
     * only adds a way to log the food by portions.
     */
    servingGrams: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? null : v),
      z.coerce.number().positive().max(100000).nullable(),
    ),
    servingLabel: z
      .preprocess(
        (v) => (v === "" || v === undefined ? null : v),
        z.string().trim().max(120).nullable(),
      )
      .optional()
      .default(null),

    kcal: requiredNumber,
    protein_g: requiredNumber,
    carbs_g: requiredNumber,
    fat_g: requiredNumber,
    fiber_g: optionalNumber.optional().default(null),
    sugar_g: optionalNumber.optional().default(null),
    sat_fat_g: optionalNumber.optional().default(null),
    sodium_mg: optionalNumber.optional().default(null),

    /**
     * Further named portions beyond the main one — "1 pot", "1 tbsp" — so
     * the food can be logged the way it is actually eaten. Each is an amount
     * in the food's own unit (g, or ml for a drink), never a nutrition
     * figure: the panel above is the only source of those.
     */
    extraServings: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(120),
          amount: z.coerce.number().positive().max(100000),
        }),
      )
      .max(MAX_EXTRA_SERVINGS)
      .optional()
      .default([]),
  })
  .refine(
    (input) => input.basis !== "per_serving" || input.servingGrams !== null,
    {
      path: ["servingGrams"],
      message: "Say what one serving weighs, so the figures can be scaled.",
    },
  );

/**
 * A validated label. The §12A fields are optional here, not only in the
 * form: the restaurant importer builds one in code and has no notes, no
 * extra portions and no millilitres, and should not have to say so.
 */
export type CustomFoodInput = Omit<
  z.infer<typeof customFoodInputSchema>,
  "notes" | "servingUnit" | "extraServings"
> &
  Partial<
    Pick<
      z.infer<typeof customFoodInputSchema>,
      "notes" | "servingUnit" | "extraServings"
    >
  >;

/** What a food's label is per 100 of. Stored on `foods.basis_unit`. */
export type BasisUnit = "g" | "ml";

/**
 * The unit a food is measured in, from what its label said.
 *
 * A per-serving label carries no unit of its own, so its serving's unit
 * decides: a 330 ml can is a drink whichever panel the can printed.
 */
export function basisUnitOf(input: Pick<CustomFoodInput, "basis" | "servingUnit">): BasisUnit {
  if (input.basis === "per_100ml") return "ml";
  if (input.basis === "per_100g") return "g";
  return input.servingUnit ?? "g";
}

export type NormalisedCustomFood = {
  name: string;
  brand: string | null;
  barcode: string | null;
  notes: string | null;
  basisUnit: BasisUnit;
  nutrients: {
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number | null;
    sugar_g: number | null;
    sat_fat_g: number | null;
    sodium_mg: number | null;
  };
  servings: { label: string; grams: number; isDefault: boolean }[];
};

/** `numeric(8, 2)` is what the column holds; rounding here, not there. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const FIELD_NAMES: Record<string, string> = {
  kcal: "Calories",
  protein_g: "Protein",
  carbs_g: "Carbohydrate",
  fat_g: "Fat",
  fiber_g: "Fibre",
  sugar_g: "Sugar",
  sat_fat_g: "Saturated fat",
};

/**
 * Turns a validated label into what the database stores.
 *
 * Returns an error rather than throwing, because every caller of this is a
 * form handler whose job is to say what is wrong with what was typed. The
 * caps are checked *after* the conversion: "20 g of protein per 45 g
 * serving" is perfectly ordinary on a label and becomes 44.4 g per 100 g,
 * whereas the same figure entered against a 5 g serving would be 400 g of
 * protein in 100 g of food, which is not a food.
 */
export function normaliseCustomFood(
  input: CustomFoodInput,
): NormalisedCustomFood | { error: string } {
  // Per 100 ml stores as it reads: ml resolves at 1 g/ml everywhere in the
  // app (`nutrition/units.ts`), so the factor in and the factor out cancel
  // and 250 ml logs as exactly 2.5 × the panel, whatever the density.
  const factor =
    input.basis === "per_serving" ? 100 / (input.servingGrams as number) : 1;
  const basisUnit = basisUnitOf(input);

  const scale = (value: number | null): number | null =>
    value === null ? null : round2(value * factor);

  const nutrients = {
    kcal: scale(input.kcal) as number,
    protein_g: scale(input.protein_g) as number,
    carbs_g: scale(input.carbs_g) as number,
    fat_g: scale(input.fat_g) as number,
    fiber_g: scale(input.fiber_g),
    sugar_g: scale(input.sugar_g),
    sat_fat_g: scale(input.sat_fat_g),
    sodium_mg: scale(input.sodium_mg),
  };

  for (const [field, limit] of Object.entries(PER_100G_LIMITS)) {
    const value = nutrients[field as keyof typeof PER_100G_LIMITS];
    if (value !== null && value > limit) {
      const per100 =
        input.basis === "per_serving"
          ? ` — what you entered works out at ${value} per 100 g`
          : "";
      return {
        error: `${FIELD_NAMES[field]} cannot exceed ${limit} per 100 g${per100}. Check the panel you copied.`,
      };
    }
  }

  // A serving weight is worth keeping whichever panel it came from: it is
  // what lets the food be logged as "1 × bar" instead of "45 g".
  const servings: NormalisedCustomFood["servings"] =
    input.servingGrams === null
      ? []
      : [
          {
            label: input.servingLabel?.trim()
              ? input.servingLabel.trim()
              : `1 serving (${round2(input.servingGrams)} ${basisUnit})`,
            grams: round2(input.servingGrams),
            isDefault: true,
          },
        ];

  for (const extra of input.extraServings ?? []) {
    servings.push({
      label: extra.label,
      grams: round2(extra.amount),
      isDefault: servings.length === 0,
    });
  }

  // `food_servings` is unique on (food, label), and a duplicate would make
  // the save function overwrite one portion with the other in silence.
  const seen = new Set<string>();
  for (const serving of servings) {
    const key = serving.label.toLowerCase();
    if (seen.has(key)) {
      return { error: `Two servings are both called "${serving.label}". Give each a different name.` };
    }
    seen.add(key);
  }

  return {
    name: input.name,
    brand: input.brand,
    barcode: input.barcode,
    notes: input.notes ?? null,
    basisUnit,
    nutrients,
    servings,
  };
}

/**
 * The extra named portions, read off a form as pairs.
 *
 * The form posts `extraServingLabel` and `extraServingAmount` once per row,
 * in order, so the nth of each belong together. A row left entirely blank is
 * one the user added and did not fill — skipped, not an error. A row with
 * only one half filled is passed on, so validation names it rather than
 * quietly dropping what was typed.
 */
export function extraServingsFromForm(
  formData: FormData,
): { label: string; amount: string }[] {
  const labels = formData.getAll("extraServingLabel").map(String);
  const amounts = formData.getAll("extraServingAmount").map(String);
  const rows: { label: string; amount: string }[] = [];
  for (let i = 0; i < Math.max(labels.length, amounts.length); i++) {
    const label = (labels[i] ?? "").trim();
    const amount = (amounts[i] ?? "").trim();
    if (label === "" && amount === "") continue;
    rows.push({ label, amount });
  }
  return rows;
}
