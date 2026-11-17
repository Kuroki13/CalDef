/**
 * An exercise's written cue, as short steps.
 *
 * The imported catalogue gives one paragraph per exercise, often eight
 * sentences long. Read at the gym, between sets, that is a wall. This
 * splits it into sentences and files them under the three questions a
 * reader has — how do I set up, what do I do, how do I come back — but only
 * on words the text itself uses ("starting position", "return", "back to"):
 * nothing is rewritten and nothing is invented. A sentence that only says
 * to repeat for the prescribed amount is dropped; tips and breathing go to
 * their own list. When no structure can be recognised, the steps are simply
 * numbered.
 */

export type InstructionPart = { title: "Set up" | "Move" | "Return" | null; steps: string[] };
export type Instructions = { parts: InstructionPart[]; tips: string[] };

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const BOILERPLATE = /^repeat\b.*\b(prescribed|recommended|desired)\b/i;
const TIP = /^(tip|tips|note|caution|variations?)\s*:|^breathe\b/i;
const SETUP_END = /\bstarting position\b|\bstart(ing)? position\b/i;
const RETURN = /\breturn\b|\bback to\b|\blower (it|them|the weight|yourself) back\b/i;

export function structureInstructions(text: string | null): Instructions {
  if (!text?.trim()) return { parts: [], tips: [] };
  const tips: string[] = [];
  const steps: string[] = [];
  for (const sentence of sentences(text)) {
    if (BOILERPLATE.test(sentence)) continue;
    if (TIP.test(sentence)) tips.push(sentence.replace(/^(tips?|note)\s*:\s*/i, ""));
    else steps.push(sentence);
  }

  const setupEnd = steps.findIndex((s) => SETUP_END.test(s));
  const returnStart = steps.findIndex((s, i) => i > setupEnd && RETURN.test(s));
  if (setupEnd < 0 && returnStart < 0) {
    return { parts: steps.length ? [{ title: null, steps }] : [], tips };
  }

  const setup = setupEnd >= 0 ? steps.slice(0, setupEnd + 1) : [];
  const moveEnd = returnStart >= 0 ? returnStart : steps.length;
  const move = steps.slice(setupEnd + 1, moveEnd);
  const back = returnStart >= 0 ? steps.slice(returnStart) : [];
  const parts: InstructionPart[] = [];
  if (setup.length) parts.push({ title: "Set up", steps: setup });
  if (move.length) parts.push({ title: "Move", steps: move });
  if (back.length) parts.push({ title: "Return", steps: back });
  return { parts, tips };
}
