/**
 * Spelling-tolerant keys for food words (spec §13A).
 *
 * `مقلوبة`, `maqlouba`, `maqluba`, `makloubeh`, `maqlooba` and `ma2loubeh`
 * are one dish written six ways: Arabic script, English and French
 * transliteration, and Arabizi, which writes Arabic sounds with digits.
 * This module reduces each to a key so they can be compared. It decides
 * nothing about nutrition — two words with the same key name the same
 * *concept*, which may still be many different recipes.
 *
 * Two scripts, two keys:
 *
 * - **Arabic** is normalised the way Arabic search usually is: diacritics
 *   and tatweel removed, the hamza-carrying alefs to bare alef, taa marbuta
 *   to haa, alef maqsura to yaa. The article "ال" is dropped by the caller,
 *   which knows where a word starts.
 * - **Latin** is collapsed by sound. Arabizi digits become letters (2 is
 *   the glottal stop that stands for qaf in Levantine speech, so it joins
 *   q and k; 3, the ain, is dropped; 7 is h; 5 is kh), vowels fold into
 *   three classes, French spellings meet English ones (ou → u, dj → j,
 *   ch → sh), doubled letters collapse, and a closing -eh/-ah drops its h.
 *
 * The folding is deliberately coarse, so it is used only to compare a word
 * with the dictionary's own aliases, never to match arbitrary text. And it
 * is not so coarse that "laban" meets "labneh": see the tests.
 *
 * Pure.
 */

const ARABIC_LETTER = /[ء-ي]/;

export function isArabic(text: string): boolean {
  return ARABIC_LETTER.test(text);
}

/** Arabic search normalisation; leaves Latin text alone. */
export function normalizeArabic(text: string): string {
  return text
    .normalize("NFD")
    // Harakat, shadda, sukun and the combining hamza/madda NFD splits off
    // أ إ آ — which is what turns all three into a bare alef.
    .replace(/[ً-ٰٟ]/g, "")
    .normalize("NFC")
    .replace(/ـ/g, "") // tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

/** One Arabic word, without the article. */
export function arabicKey(word: string): string {
  const normal = normalizeArabic(word).replace(/[^ء-ي]/g, "");
  return normal.length > 3 && normal.startsWith("ال") ? normal.slice(2) : normal;
}

/** One Latin-script word, collapsed by sound. */
export function latinKey(word: string): string {
  let s = word
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  // Arabizi. Done first, while the digits still mean letters.
  s = s
    .replace(/5/g, "kh")
    .replace(/7/g, "h")
    .replace(/2/g, "k")
    .replace(/3/g, "")
    .replace(/6/g, "t")
    .replace(/8/g, "gh")
    .replace(/9/g, "s");

  s = s.replace(/[^a-z]/g, "");
  if (s.length === 0) return "";

  s = s
    .replace(/dj/g, "j")
    .replace(/tch/g, "sh")
    .replace(/ch/g, "sh")
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/q/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "z");

  // A closing -eh/-ah is how both transliterations write taa marbuta.
  s = s.replace(/([aeiou])h$/, "$1");

  // Vowels into three classes. Order matters: digraphs before singles.
  s = s
    .replace(/(oo|ou|ow|o|u)/g, "u")
    .replace(/(ee|ie|ei|ey|i|y(?![aeiou]))/g, "i")
    .replace(/(aa|ai|ay|ae|e|a)/g, "a");

  // Doubled letters, which transliteration adds and drops freely.
  s = s.replace(/(.)\1+/g, "$1");

  return s;
}

/** The key for one word of either script. */
export function wordKey(word: string): string {
  return isArabic(word) ? arabicKey(word) : latinKey(word);
}

/**
 * Splits text into words, keeping Arabic and Latin runs apart even when
 * typed together ("400gmaqlouba" is rare; "maqlouba و laban" is not).
 * Digits stay inside Latin words, where they are Arabizi letters; a bare
 * number is a quantity and is dropped.
 */
export function words(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[ء-يً-ٰٟـ]+|[\p{L}\p{M}0-9']+/gu)) {
    const token = m[0];
    if (/^[0-9]+([.,][0-9]+)?$/.test(token)) continue;
    // "400g" is a quantity with its unit glued on, not a word.
    if (/^[0-9]+([.,][0-9]+)?(g|gr|kg|ml|cl|l)$/i.test(token)) continue;
    out.push(token);
  }
  return out;
}

/**
 * Edit distance, for the narrow fuzzy fallback: a one-letter slip in a
 * key of five letters or more, two in one of nine or more.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

export function closeEnough(input: string, alias: string): boolean {
  if (input === alias) return true;
  const length = Math.min(input.length, alias.length);
  const allowed = length >= 9 ? 2 : length >= 5 ? 1 : 0;
  return allowed > 0 && levenshtein(input, alias) <= allowed;
}
