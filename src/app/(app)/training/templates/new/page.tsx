import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { TemplateEditor } from "@/components/training/template-editor";
import { getAccountSetup } from "@/lib/profile";
import { listExercises } from "@/lib/training/store";

export const metadata: Metadata = { title: "New workout · CalDef" };

export default async function NewTemplatePage() {
  const { profile } = await getAccountSetup();
  if (!profile) return null;
  const exercises = await listExercises();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Training"
        title="New workout"
        description="A reusable plan. You start sessions from it; what you actually do is saved separately."
      />
      <TemplateEditor template={null} exercises={exercises} units={profile.unit_system} />
    </div>
  );
}
