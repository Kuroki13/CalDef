import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { ExerciseLibrary } from "@/components/training/exercise-library";
import { listExercises } from "@/lib/training/store";

export const metadata: Metadata = { title: "Exercises · CalDef" };

export default async function ExercisesPage() {
  const exercises = await listExercises();
  const own = exercises.filter((exercise) => exercise.custom).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Training"
        title="Exercises"
        description={`${exercises.length - own} in the library${own > 0 ? `, ${own} of your own` : ""}. Missing one? Create it.`}
      />
      <ExerciseLibrary exercises={exercises} />
    </div>
  );
}
