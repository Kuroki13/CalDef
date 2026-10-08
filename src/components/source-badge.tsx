/**
 * Where a food's numbers came from, in one word.
 *
 * The spec requires distinguishing USDA-verified data from community
 * contributions and from the user's own entries, wherever a food is offered
 * — so search and the personal library use this one badge, not two that
 * could drift apart.
 */

import { Badge } from "@/components/ui/badge";
import type { Food } from "@/lib/food/types";

export function SourceBadge({ food }: { food: Food }) {
  if (food.source === "usda") {
    return (
      <Badge variant={food.isVerified ? "default" : "secondary"}>
        {food.isVerified ? "USDA verified" : "USDA"}
      </Badge>
    );
  }
  // National reference tables, credited by name as their licences require.
  if (food.source === "ciqual") return <Badge variant="default">Ciqual</Badge>;
  if (food.source === "cnf") return <Badge variant="default">Health Canada</Badge>;
  if (food.source === "off") {
    // Community-contributed. The spec requires not presenting it as verified.
    return <Badge variant="outline">Community</Badge>;
  }
  return <Badge variant="secondary">Yours</Badge>;
}
