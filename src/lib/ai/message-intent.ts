export type AssistantMode = "auto" | "question" | "log" | "save" | "create";
export type AssistantIntent = Exclude<AssistantMode, "auto">;

/** Routing only, never authorisation to write. Ambiguous text remains a
 * question; the visible mode selector lets the user override this cheaply.
 */
export function assistantIntent(text: string, mode: AssistantMode = "auto"): AssistantIntent {
  if (mode !== "auto") return mode;
  const value = text.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[’]/g, "'");
  if (/\b(create|new|custom)\b.*\bfood\b|\bcr[eé]er\b.*\baliment\b/.test(value)) return "create";
  if (/\b(save|add)\b.*\b(library|database|db|my foods)\b/.test(value)) return "save";
  if (/\b(if|would|should|could|did|can|haven't|hadn't|didn't|never)\b/.test(value) || value.includes("?")) return "question";
  if (/\bi (?:just |already )?(?:ate|had|drank|eaten)\b|^(?:log|record|add to (?:my )?diary)\b|\bj'ai mang[eé]\b/.test(value)) return "log";
  return "question";
}
