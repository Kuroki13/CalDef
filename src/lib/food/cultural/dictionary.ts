/**
 * The cultural food dictionary (spec §13B, §13C).
 *
 * Identity and semantics only — **no nutrition, deliberately**. A maqluba
 * is chicken or lamb, eggplant or cauliflower, a family's recipe or a
 * restaurant's, and no single calorie figure is true of "maqluba". What
 * this records is what a word *means*: the dish it names, its Arabic name,
 * the ways people spell it, the variants that change its nutrition, and the
 * English phrase food databases file it under, if they have it at all.
 * Nutrition is resolved afterwards, against the user's own recipes and
 * foods first and real databases second (§11.2) — never from here.
 *
 * Coverage follows §13C: a focused set of high-value Levantine, Egyptian,
 * Gulf and Maghrebi dishes, where aliases and variants matter more than
 * the count. Adding a dish is adding an entry; nothing else changes.
 *
 * Variant markers are the words that say which variant was meant —
 * "djej", "poulet", "دجاج" all say chicken — in any of the languages a
 * sentence might be in.
 */

export type Variant = {
  id: string;
  label: string;
  /** Words that select this variant, in any script or language. */
  markers: string[];
  /** The phrase to search the databases with for this variant. */
  searchAs: string;
};

export type Dish = {
  id: string;
  /** Canonical English name. */
  name: string;
  /** In Arabic script, as most often written. */
  arabic: string;
  /** Other names and spellings: transliterations, French, regional. */
  aliases: string[];
  /** Arabic-script aliases beyond `arabic`. */
  arabicAliases?: string[];
  family: "rice dish" | "stuffed" | "grill" | "street food" | "mezze" | "salad" | "bread" | "stew" | "dairy" | "grain" | "legumes" | "sausage";
  regions: string[];
  /** One line on what it is, to show the user what was understood. */
  about: string;
  /** What to search the databases with when no variant is known. */
  searchAs: string;
  /**
   * Nutritionally different versions. Present only where the difference is
   * material (§13D); the first is not a default, merely the first listed.
   */
  variants?: Variant[];
  /** Aliases that name one variant outright — "yalanji" is meatless. */
  impliedVariants?: Record<string, string>;
};

// Markers shared by many dishes. Lower-case; Arabic as commonly written.
const CHICKEN = ["chicken", "poulet", "djej", "djaj", "jaj", "dajaj", "farrouj", "frarij", "دجاج", "جاج", "فراخ", "فروج"];
const MEAT = ["meat", "beef", "lamb", "viande", "boeuf", "agneau", "lahme", "lahmeh", "lahma", "lahm", "la7me", "la7meh", "لحمة", "لحمه", "لحم", "غنم"];
const VEGETARIAN = ["vegetarian", "veggie", "veg", "meatless", "vegetable", "vegetables", "végétarien", "legumes", "khodra", "siyami", "صيامي", "خضرة", "خضار", "نباتي"];
const EGGPLANT = ["eggplant", "aubergine", "batinjan", "betenjen", "bitinjan", "باذنجان", "بتنجان"];
const CAULIFLOWER = ["cauliflower", "chou-fleur", "choufleur", "zahra", "arnabeet", "arnabit", "زهرة", "قرنبيط"];
const FISH = ["fish", "poisson", "samak", "سمك"];
const CHEESE = ["cheese", "fromage", "jibneh", "jebneh", "jibne", "jbneh", "جبنة", "جبنه", "akkawi", "عكاوي"];
const ZAATAR = ["zaatar", "za3tar", "zatar", "zaatr", "thyme", "زعتر"];
const SPINACH = ["spinach", "épinards", "epinards", "sabanekh", "sbanekh", "سبانخ"];

const chicken = (searchAs: string): Variant => ({ id: "chicken", label: "Chicken", markers: CHICKEN, searchAs });
const meat = (searchAs: string, label = "Meat"): Variant => ({ id: "meat", label, markers: MEAT, searchAs });
const vegetarian = (searchAs: string, label = "Vegetarian"): Variant => ({ id: "vegetarian", label, markers: VEGETARIAN, searchAs });

export const DISHES: Dish[] = [
  {
    id: "maqluba",
    name: "Maqluba",
    arabic: "مقلوبة",
    aliases: ["maqluba", "maqlouba", "maqloubeh", "makloubeh", "makluba", "maqlooba", "ma2loubeh", "ma2luba", "maklouba", "upside down rice"],
    family: "rice dish",
    regions: ["Palestine", "Jordan", "Syria", "Lebanon"],
    about: "Layered rice with meat or chicken and fried vegetables, turned upside down to serve.",
    searchAs: "maqluba",
    variants: [
      chicken("chicken maqluba"),
      meat("lamb maqluba", "Meat (lamb or beef)"),
      { id: "eggplant", label: "Eggplant", markers: EGGPLANT, searchAs: "eggplant maqluba" },
      { id: "cauliflower", label: "Cauliflower", markers: CAULIFLOWER, searchAs: "cauliflower maqluba" },
      vegetarian("vegetable maqluba", "Vegetables only"),
    ],
  },
  {
    id: "musakhan",
    name: "Musakhan",
    arabic: "مسخن",
    aliases: ["musakhan", "msakhan", "musakhkhan", "msa5an", "musa5an", "mousakhan"],
    family: "bread",
    regions: ["Palestine", "Jordan"],
    about: "Taboon bread baked with roast chicken, onions, sumac and olive oil.",
    searchAs: "musakhan chicken",
  },
  {
    id: "maftoul",
    name: "Maftoul",
    arabic: "مفتول",
    aliases: ["maftoul", "maftul", "moghrabieh", "mughrabiyeh", "moghrabia", "palestinian couscous"],
    arabicAliases: ["مغربية"],
    family: "grain",
    regions: ["Palestine", "Lebanon", "Jordan"],
    about: "Hand-rolled bulgur pearls, usually cooked with chicken and chickpeas.",
    searchAs: "maftoul",
    variants: [chicken("chicken maftoul"), vegetarian("maftoul with vegetables")],
  },
  {
    id: "warak-enab",
    name: "Stuffed grape leaves (warak enab)",
    arabic: "ورق عنب",
    aliases: ["warak enab", "waraq enab", "warak 3enab", "wara2 3enab", "warak einab", "warak dawali", "wara2 dawali", "dawali", "yalanji", "yalangi", "yabrak", "dolma", "dolmades", "feuilles de vigne", "feuilles de vigne farcies", "warak", "wara2", "stuffed grape leaves", "stuffed vine leaves"],
    arabicAliases: ["ورق دوالي", "دوالي", "يالنجي", "يبرق", "ورق"],
    family: "stuffed",
    regions: ["Palestine", "Lebanon", "Syria", "Jordan", "Egypt"],
    about: "Grape leaves rolled around rice — with meat, or meatless in oil.",
    searchAs: "stuffed grape leaves",
    variants: [
      meat("stuffed grape leaves with meat", "With meat and rice"),
      vegetarian("stuffed grape leaves rice", "Rice only, in oil (yalanji)"),
    ],
    impliedVariants: { yalanji: "vegetarian", yalangi: "vegetarian", "يالنجي": "vegetarian", yabrak: "meat", "يبرق": "meat" },
  },
  {
    id: "kibbeh",
    name: "Kibbeh",
    arabic: "كبة",
    aliases: ["kibbeh", "kibbe", "kebbeh", "kebbe", "kubba", "kubbeh", "kobeba", "kibbé", "kebbé", "kibbeh nayeh", "kibbeh labanieh"],
    arabicAliases: ["كبه", "كبة نية", "كبة لبنية"],
    family: "mezze",
    regions: ["Lebanon", "Syria", "Palestine", "Iraq"],
    about: "Bulgur and minced meat — fried, baked in a tray, or raw.",
    searchAs: "kibbeh",
    variants: [
      { id: "fried", label: "Fried balls", markers: ["fried", "frit", "frite", "maqliyeh", "مقلية"], searchAs: "kibbeh fried" },
      { id: "baked", label: "Baked tray", markers: ["baked", "tray", "four", "bil saniyeh", "saniyeh", "صينية"], searchAs: "kibbeh baked" },
      { id: "raw", label: "Raw (nayeh)", markers: ["raw", "nayeh", "nayye", "crue", "نية"], searchAs: "kibbeh raw" },
    ],
  },
  {
    id: "shish-tawook",
    name: "Shish tawook",
    arabic: "شيش طاووق",
    aliases: ["shish tawook", "shish taouk", "chich taouk", "shish tawouk", "shish tawuk", "tawook", "taouk", "tawouk"],
    arabicAliases: ["طاووق", "شيش طاوق"],
    family: "grill",
    regions: ["Lebanon", "Syria", "Turkey"],
    about: "Marinated grilled chicken skewers.",
    searchAs: "chicken shish kebab",
  },
  {
    id: "shawarma",
    name: "Shawarma",
    arabic: "شاورما",
    aliases: ["shawarma", "shawerma", "shawurma", "chawarma", "shwarma", "schawarma", "shawirma"],
    arabicAliases: ["شاورمه", "شورما"],
    family: "street food",
    regions: ["Levant", "Gulf", "Egypt"],
    about: "Spit-roasted meat or chicken — as a wrap or a plate, with sauces and sometimes fries inside.",
    searchAs: "shawarma",
    variants: [chicken("chicken shawarma"), meat("beef shawarma", "Beef or lamb")],
  },
  {
    id: "falafel",
    name: "Falafel",
    arabic: "فلافل",
    aliases: ["falafel", "felafel", "falafil", "ta'ameya", "taameya", "ta3meyya", "taamiya"],
    arabicAliases: ["طعمية"],
    family: "street food",
    regions: ["Levant", "Egypt"],
    about: "Fried balls of ground chickpeas or fava beans.",
    searchAs: "falafel",
  },
  {
    id: "hummus",
    name: "Hummus",
    arabic: "حمص",
    aliases: ["hummus", "houmous", "hommos", "humus", "hommus", "7ummus", "7oummos", "hummos", "houmos"],
    arabicAliases: ["حمّص"],
    family: "mezze",
    regions: ["Levant"],
    about: "Chickpea and tahini dip.",
    searchAs: "hummus",
  },
  {
    id: "moutabal",
    name: "Moutabal",
    arabic: "متبل",
    aliases: ["moutabal", "mutabbal", "mtabbal", "moutabbal", "mutabal"],
    family: "mezze",
    regions: ["Levant"],
    about: "Smoked eggplant with tahini, yogurt and garlic.",
    searchAs: "eggplant dip tahini",
  },
  {
    id: "baba-ghanoush",
    name: "Baba ghanoush",
    arabic: "بابا غنوج",
    aliases: ["baba ghanoush", "baba ganoush", "baba ghannouj", "baba ganouj", "baba ghanouj", "baba ghanoug"],
    arabicAliases: ["بابا غنوش"],
    family: "mezze",
    regions: ["Levant", "Egypt"],
    about: "Smoked eggplant with vegetables and olive oil (no tahini in the Lebanese version).",
    searchAs: "baba ghanoush",
  },
  {
    id: "labneh",
    name: "Labneh",
    arabic: "لبنة",
    aliases: ["labneh", "labne", "labna", "labni", "lebne", "lebneh", "labaneh"],
    arabicAliases: ["لبنه"],
    family: "dairy",
    regions: ["Levant"],
    about: "Strained yogurt, thick enough to spread.",
    searchAs: "labneh",
  },
  {
    id: "laban",
    name: "Laban (yogurt)",
    arabic: "لبن",
    aliases: ["laban", "leben", "lben", "rayeb", "laban zabadi", "zabadi"],
    arabicAliases: ["لبن زبادي", "زبادي", "رايب"],
    family: "dairy",
    regions: ["Levant", "Egypt", "Gulf"],
    about: "Plain yogurt — or, in the Gulf, a thin yogurt drink.",
    searchAs: "yogurt plain whole milk",
    variants: [
      { id: "yogurt", label: "Yogurt", markers: ["yogurt", "yoghurt", "yaourt", "zabadi", "زبادي"], searchAs: "yogurt plain whole milk" },
      { id: "drink", label: "Drink (ayran)", markers: ["drink", "ayran", "boisson", "عيران", "شنينة", "shanineh"], searchAs: "ayran yogurt drink" },
    ],
  },
  {
    id: "fattoush",
    name: "Fattoush",
    arabic: "فتوش",
    aliases: ["fattoush", "fatoush", "fattouche", "fattush", "fattouch"],
    family: "salad",
    regions: ["Lebanon", "Syria", "Palestine"],
    about: "Chopped salad with toasted or fried pita, sumac and pomegranate molasses.",
    searchAs: "fattoush salad",
  },
  {
    id: "tabbouleh",
    name: "Tabbouleh",
    arabic: "تبولة",
    aliases: ["tabbouleh", "tabouleh", "taboulé", "tabbouli", "taboule", "tabouli", "tabboule"],
    arabicAliases: ["تبوله"],
    family: "salad",
    regions: ["Lebanon", "Syria"],
    about: "Parsley salad with bulgur, tomato, lemon and olive oil.",
    searchAs: "tabbouleh",
  },
  {
    id: "manakish",
    name: "Manakish",
    arabic: "مناقيش",
    aliases: ["manakish", "manaqish", "manakeesh", "man2oushe", "man2ousheh", "mana2ish", "manouche", "manoushe", "manousheh", "mankousheh", "mankoushe"],
    arabicAliases: ["منقوشة", "منقوشه", "مناقيش"],
    family: "bread",
    regions: ["Lebanon", "Syria", "Palestine", "Jordan"],
    about: "Flatbread baked with za'atar and oil, or with cheese.",
    searchAs: "manakish",
    variants: [
      { id: "zaatar", label: "Za'atar", markers: ZAATAR, searchAs: "zaatar manakish" },
      { id: "cheese", label: "Cheese", markers: CHEESE, searchAs: "cheese manakish" },
    ],
  },
  {
    id: "fatayer",
    name: "Fatayer",
    arabic: "فطاير",
    aliases: ["fatayer", "fatayir", "fatayar", "fatayeh"],
    arabicAliases: ["فطائر", "فطيرة", "فطيره"],
    family: "bread",
    regions: ["Lebanon", "Syria", "Palestine"],
    about: "Small baked pies — spinach, cheese or meat.",
    searchAs: "fatayer",
    variants: [
      { id: "spinach", label: "Spinach", markers: SPINACH, searchAs: "spinach fatayer" },
      { id: "cheese", label: "Cheese", markers: CHEESE, searchAs: "cheese fatayer" },
      meat("meat fatayer"),
    ],
  },
  {
    id: "molokhia",
    name: "Molokhia",
    arabic: "ملوخية",
    aliases: ["molokhia", "mloukhieh", "mulukhiyah", "molokheya", "mloukhiyeh", "molokhiya", "mouloukhia", "mlo5ieh", "molo5eya"],
    arabicAliases: ["ملوخيه"],
    family: "stew",
    regions: ["Egypt", "Palestine", "Lebanon", "Syria"],
    about: "Jute-leaf stew, cooked with chicken, rabbit or meat, served with rice.",
    searchAs: "molokhia",
    variants: [chicken("chicken molokhia"), meat("beef molokhia")],
  },
  {
    id: "kofta",
    name: "Kofta",
    arabic: "كفتة",
    aliases: ["kofta", "kefta", "kufta", "kafta", "kifta", "kofte", "köfte"],
    arabicAliases: ["كفته"],
    family: "grill",
    regions: ["Levant", "Egypt", "Maghreb"],
    about: "Spiced minced meat, grilled on skewers or baked.",
    searchAs: "kofta",
  },
  {
    id: "kabsa",
    name: "Kabsa",
    arabic: "كبسة",
    aliases: ["kabsa", "kabseh", "kabsah", "machboos", "majboos", "machbous"],
    arabicAliases: ["كبسه", "مجبوس", "مكبوس"],
    family: "rice dish",
    regions: ["Saudi Arabia", "Gulf"],
    about: "Spiced rice cooked with chicken or lamb.",
    searchAs: "kabsa",
    variants: [chicken("chicken kabsa"), meat("lamb kabsa", "Lamb")],
  },
  {
    id: "mansaf",
    name: "Mansaf",
    arabic: "منسف",
    aliases: ["mansaf", "mensaf", "mansef"],
    family: "rice dish",
    regions: ["Jordan", "Palestine"],
    about: "Lamb cooked in fermented dried yogurt (jameed), over rice and bread.",
    searchAs: "mansaf",
  },
  {
    id: "koshari",
    name: "Koshari",
    arabic: "كشري",
    aliases: ["koshari", "kushari", "koshary", "kosheri", "koushari"],
    family: "rice dish",
    regions: ["Egypt"],
    about: "Rice, lentils and pasta with tomato sauce and fried onions.",
    searchAs: "koshari",
  },
  {
    id: "foul",
    name: "Ful medames",
    arabic: "فول",
    aliases: ["foul", "ful", "fool", "ful medames", "foul medammes", "foul moudammas", "fool mudammas"],
    arabicAliases: ["فول مدمس"],
    family: "legumes",
    regions: ["Egypt", "Levant", "Sudan"],
    about: "Stewed fava beans with oil, lemon and cumin.",
    searchAs: "fava beans cooked",
  },
  {
    id: "msabbaha",
    name: "Msabbaha",
    arabic: "مسبحة",
    aliases: ["msabbaha", "msabaha", "musabbaha", "msab7a", "masabaha"],
    arabicAliases: ["مسبحه"],
    family: "mezze",
    regions: ["Palestine", "Lebanon"],
    about: "Warm whole chickpeas with tahini, lemon and garlic.",
    searchAs: "chickpeas tahini",
  },
  {
    id: "couscous",
    name: "Couscous",
    arabic: "كسكس",
    aliases: ["couscous", "kuskus", "kesksou", "seksu", "couscous royal", "kousksi"],
    arabicAliases: ["كسكسي", "كسكسو"],
    family: "grain",
    regions: ["Maghreb", "France"],
    about: "Steamed semolina — on its own, or the full dish with vegetables and meat.",
    searchAs: "couscous cooked",
    variants: [
      { id: "plain", label: "Just the grain", markers: ["plain", "nature", "grain", "graine"], searchAs: "couscous cooked" },
      { id: "royal", label: "With meat and vegetables (royal)", markers: ["royal", "merguez", ...MEAT, ...CHICKEN], searchAs: "couscous with meat and vegetables" },
      { id: "fish", label: "With fish", markers: FISH, searchAs: "couscous fish" },
    ],
  },
  {
    id: "merguez",
    name: "Merguez",
    arabic: "مرقاز",
    aliases: ["merguez", "mergaz", "merguèz"],
    arabicAliases: ["مرقاز", "مركاز"],
    family: "sausage",
    regions: ["Maghreb", "France"],
    about: "Spiced lamb or beef sausage.",
    searchAs: "merguez",
  },
];
