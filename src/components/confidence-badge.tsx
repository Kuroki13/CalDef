/**
 * How far an entry's figures can be trusted, in one word (spec §11.3).
 *
 * Quiet for the two reliable levels and plainer for the two uncertain ones,
 * because the uncertain ones are what a reader needs to notice — not as a
 * warning, just as a fact about the number beside it. The explanation is in
 * the title and the accessible name, so the word is never the only signal.
 */

import { Badge } from "@/components/ui/badge";
import {
  CONFIDENCE_EXPLANATION,
  CONFIDENCE_LABEL,
  type Confidence,
} from "@/lib/nutrition/confidence";

export function ConfidenceBadge({ level }: { level: Confidence }) {
  const uncertain = level === "estimated" || level === "rough";
  return (
    <Badge
      variant={uncertain ? "secondary" : "outline"}
      className={uncertain ? "shrink-0" : "text-muted-foreground shrink-0 font-normal"}
      title={CONFIDENCE_EXPLANATION[level]}
      aria-label={`${CONFIDENCE_LABEL[level]} confidence: ${CONFIDENCE_EXPLANATION[level]}`}
    >
      {CONFIDENCE_LABEL[level]}
    </Badge>
  );
}
