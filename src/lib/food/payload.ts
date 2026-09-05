import "server-only";

/**
 * The shape the browser may send back for a food it chose.
 *
 * Validated rather than trusted: it arrives from the client, so it is
 * re-parsed here before anything is written. The nutrient values it carries
 * are used only to *populate the cache* on first sight — every entry's macros
 * are then computed from what the database holds, so a tampered payload
 * cannot inflate a diary entry beyond what it also wrote into the shared
 * cache.
 *
 * Shared by the manual path and the AI path, which send the same thing: the
 * AI path's proposals are ordinary `Food` records that came from our own
 * providers, not from the model.
 */

import { z } from "zod";

export const foodPayloadSchema = z.object({
  sourceId: z.string().min(1).max(200),
  source: z.enum(["usda", "off", "custom"]),
  name: z.string().trim().min(1).max(300),
  brand: z.string().trim().max(200).nullable(),
  description: z.string().trim().max(500).nullable(),
  barcode: z
    .string()
    .regex(/^[0-9]{6,14}$/)
    .nullable(),
  isVerified: z.boolean(),
  nutrients: z.object({
    kcal: z.number().min(0).max(1000),
    protein_g: z.number().min(0).max(100),
    carbs_g: z.number().min(0).max(100),
    fat_g: z.number().min(0).max(100),
    fiber_g: z.number().min(0).max(100).nullable().optional(),
    sugar_g: z.number().min(0).max(100).nullable().optional(),
    sat_fat_g: z.number().min(0).max(100).nullable().optional(),
    sodium_mg: z.number().min(0).nullable().optional(),
  }),
  servings: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(120),
        grams: z.number().positive().max(100000),
        isDefault: z.boolean(),
      }),
    )
    .max(25),
  dataUpdatedAt: z.string().nullable(),
});
