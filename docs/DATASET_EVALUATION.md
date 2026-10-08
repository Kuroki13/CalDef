# Evaluation — ANSES Ciqual and the Canadian Nutrient File (spec §13J, §13K)

Carried out 2026-10-08. The spec allows either dataset **only if** its
current terms, access and licensing fit the zero-cost constraint, and forbids
integrating one merely because it exists. This records what was checked, what
was found, and a recommendation. **Nothing has been integrated**; that waits on
the owner's decision.

Method: both datasets were downloaded from their official publishers and read
locally (outside the app). Each was searched for the foods §13J names, a set of
Canadian staples, and the §13C Arabic dishes, and the same foods were looked up
in USDA FoodData Central (Foundation + SR Legacy), exactly as CalDef queries it
today.

## 1. Terms, access, cost

| | Ciqual 2025 (ANSES, France) | Canadian Nutrient File 2026 (Health Canada) |
|---|---|---|
| Version | 2025, published 2025-11-19 | 2026, released 2026-05-14, updated 2026-10-04 |
| Publisher / location | Recherche Data Gouv, DOI 10.57745/RDMHWY (supersedes the 2020 data.gouv.fr release) | open.canada.ca, dataset 1b6139bd-ed7e-4043-bc28-ff00e10f3109 |
| Licence | **Etalab Open Licence 2.0** — reuse, including commercial and in software, allowed; attribution required (source and date of the data) | **Open Government Licence – Canada** — use, reproduce, adapt allowed; attribution to Health Canada required |
| Cost / key | Free, no account, no key | Free, no account, no key |
| Format | XML (UTF-8) and XLS/XLSX; one 69 MB composition file | CSV (zip, 27 MB) + bilingual PDF guides |
| API | None public; bulk file only | Bulk CSV (an API exists, not needed) |
| Size | 3,484 foods, 74 components | 5,993 foods |
| Languages | French and English names on every food | English and French names on every food |

**Both fit the zero-cost constraint.** Neither needs an account, a key, a
paid tier or a service to call at run time, and both licences permit an app to
reuse the data with attribution.

## 2. Coverage compared with what CalDef already has

Matches containing every word of the food's name (rough, but the same test
for all three):

| Food | USDA today | Ciqual | CNF |
|---|---|---|---|
| **§13J French list** (18 foods) | 2 of 18 (croissant, 5 % minced beef) | **17 of 18** — pain au chocolat-type viennoiserie, baguette, jambon-beurre, croque-monsieur, quiche lorraine, tarte flambée, gratin dauphinois, tartiflette, raclette, cordon bleu, steak haché 5 %, merguez, couscous royal, fromage blanc, petit suisse, lardons, galette complète | 2 of 18 |
| **Canadian staples** (poutine, tourtière, butter tart, cretons, pâté chinois, peameal bacon, smoked meat, bannock, tarte au sucre, pea soup, maple syrup) | maple syrup, pea soup only | maple syrup, pea soup, tarte au sucre | **all but Nanaimo bar and Saskatoon berries** |
| **§13C Arabic dishes** | hummus, falafel, couscous, pita, tahini, fava beans | adds taboulé, meloukhia, caviar d'aubergine, kebab sandwich, merguez | adds homemade hummus/falafel, grape leaves (raw) |
| Not in any of the three | labneh, baba ghanoush, fattoush, shawarma, kibbeh, stuffed grape leaves, za'atar, Nanaimo bar, Saskatoon berries | | |

So:

- **Ciqual fills the French gap almost completely** — the gap §13J exists for.
- **CNF fills the Canadian gap** — but **80 % of CNF (4,798 of 5,993 foods)
  is copied from USDA** (source code 0, "Food based on data from USDA: No
  changes", is 3,529 foods alone). Importing CNF whole would duplicate what
  CalDef already has under a second name, which §13K forbids. The valuable
  part is the **1,195 foods with no USDA code**: Canadian analyses
  (SNAP-CAN), traditional foods, and recipe compilations.
- **Neither solves Arabic coverage.** That remains the job of the cultural
  dictionary, family recipes and personal vocabulary already built, and of
  restaurants (§13L).

## 3. Data quality — what an import must handle

**Ciqual**
- Energy: use constituent **328, "Energy, Regulation EU No 1169/2011
  (kcal/100g)"** — the figure on French packaging. Macros: 25000 protein,
  31000 carbohydrate, 40000 fat; 34100 fibre, 32000 sugars, 10110 sodium.
- Values use **decimal commas** ("6,56").
- Not every value is a number. Among the energy and macro values:
  22,509 numbers, **957 "-"** (not measured), **409 "traces"**, **513 "<x"**
  (below detection). The import must treat "-" as *unknown* (a food missing
  energy is dropped, as the USDA importer already does), "traces" as 0, and
  "<x" as 0 rather than x — the conservative reading, documented.
- Sample, for sanity: "Croissant, sans précision" 417 kcal, 6.56 g protein,
  46.2 g carbohydrate, 22.1 g fat per 100 g.
- **No portion sizes.** "Un pot", "une tranche" stay unconverted unless the
  user's own serving or a reliable source supplies a weight (§13J).

**CNF**
- Nutrient codes 208 kcal, 203 protein, 204 fat, 205 carbohydrate, per 100 g.
- **29,868 household-measure conversions** covering every food, in grams:
  "1 pie (20 cm dia)" = 450 g of tourtière, "250 ml" of poutine = 165 g,
  "15 ml" of cretons = 16.7 g. These are *real* volume-to-weight
  conversions — better than the 1 g/ml fallback CalDef uses today — and
  would become ordinary servings.
- Each food records its provenance (`Food_Source_Code`), so USDA-derived rows
  can be excluded by rule, not by guesswork.

## 4. How it would be built (if approved)

The smallest robust shape, consistent with ARCHITECTURE:

- **Two more providers behind the existing `FoodProvider` port**, searching a
  compact file built from the official download and shipped with the server
  code — no bulk import into Postgres, no runtime API call, no new running
  cost, nothing near the 500 MB database limit. A food enters the database
  only when someone logs it, exactly as USDA and Open Food Facts foods do today.
- **One additive migration**: `ciqual` and `cnf` added to the `food_source`
  enum, so a logged food remembers where it came from.
- **CNF limited to its 1,195 non-USDA foods**, with their household measures
  as servings. Ciqual whole (3,484 foods).
- **Provenance visible**: source badges "Ciqual (ANSES)" and "Health Canada",
  bilingual names searchable in both languages, and the attribution both
  licences require ("Source : Anses, Table Ciqual 2025"; "Contains
  information licensed under the Open Government Licence – Canada") on an
  About-the-data line.
- **Confidence**: both are national, laboratory-based tables — **Strong**,
  like USDA. CNF recipe compilations would be **Estimated**.
- **A rebuild script** to regenerate the compact files when a new edition
  appears (Ciqual is roughly yearly; CNF was updated this month).

Estimated effort: one session each, Ciqual first.

## 5. Recommendation

1. **Ciqual — adopt.** Free, licence fits, no running cost, and it covers 17 of
   the 18 French foods the spec names, where CalDef finds 2 today.
2. **CNF — adopt in part.** Only its 1,195 Canadian-original foods and their
   measures; the USDA-derived 80 % would only duplicate what CalDef has.
3. **Neither for Arabic coverage** — that stays with the work already done
   in §13A–13I and restaurants in §13L.

Sources: [Ciqual 2025 on Recherche Data Gouv](https://entrepot.recherche.data.gouv.fr/dataset.xhtml?persistentId=doi%3A10.57745%2FRDMHWY),
[ANSES — the Ciqual table](https://www.anses.fr/en/article/ciqual-nutritional-composition-table),
[Ciqual 2020 on data.gouv.fr (superseded)](https://www.data.gouv.fr/datasets/table-de-composition-nutritionnelle-des-aliments-ciqual-2020),
[Canadian Nutrient File 2026 on open.canada.ca](https://open.canada.ca/data/en/dataset/1b6139bd-ed7e-4043-bc28-ff00e10f3109).
