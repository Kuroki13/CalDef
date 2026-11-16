import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { TemplateEditor } from "@/components/training/template-editor";
import { getAccountSetup } from "@/lib/profile";
import { getTemplate, listExercises } from "@/lib/training/store";

export const metadata: Metadata = { title: "Edit workout · CalDef" };

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const { profile } = await getAccountSetup();
  if (!profile) return null;

  // Someone else's template is simply not there: RLS returns nothing.
  const [template, exercises] = await Promise.all([getTemplate(id), listExercises()]);
  if (!template) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Training"
        title="Edit workout"
        description="Changes apply to sessions you start from now on. Past sessions keep what was done."
      />
      <TemplateEditor template={template} exercises={exercises} units={profile.unit_system} />
    </div>
  );
}
