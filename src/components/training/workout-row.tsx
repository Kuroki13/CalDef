"use client";

/**
 * One workout in the list: what it is, a way to start it, and — behind one
 * button — everything else that can be done to it.
 *
 * Start is the only action a workout is opened for most days, so it is the
 * only one on the row. Edit, duplicate, plan, file under a programme and
 * delete are a menu away; delete is never one stray tap from the name.
 */

import {
  CalendarPlus,
  Copy,
  EllipsisVertical,
  FolderInput,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  assignProgramAction,
  createProgramAction,
  deleteTemplateAction,
  duplicateTemplateAction,
  scheduleWorkoutAction,
  type ActionResult,
} from "@/app/(app)/training/actions";
import { PendingButton } from "@/components/pending-button";
import { StartWorkoutButton } from "@/components/training/start-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MUSCLE_LABEL,
  type WorkoutProgram,
  type WorkoutTemplate,
} from "@/lib/training/types";

type Panel = "plan" | "programme" | "delete" | null;

export function WorkoutRow({
  template,
  programs,
  today,
  canStart,
  plannedTodayId = null,
}: {
  template: WorkoutTemplate;
  programs: WorkoutProgram[];
  /** ISO date, the user's today — the default day to plan. */
  today: string;
  /** False while another session is running. */
  canStart: boolean;
  /** Today's open plan of this workout: starting here carries it out. */
  plannedTodayId?: number | null;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [programId, setProgramId] = useState(String(template.programId ?? ""));
  const [newProgram, setNewProgram] = useState("");

  async function run(work: () => Promise<ActionResult>, close = true) {
    setPending(true);
    setError(null);
    try {
      const result = await work();
      if (!result.ok) return setError(result.error);
      if (close) setPanel(null);
      router.refresh();
    } catch {
      setError("No connection. Nothing was changed.");
    } finally {
      setPending(false);
    }
  }

  async function saveProgramme() {
    await run(async () => {
      let target: number | null = programId === "" ? null : Number(programId);
      if (programId === "new") {
        const created = await createProgramAction(newProgram);
        if (!created.ok) return created;
        target = created.id;
      }
      return assignProgramAction({ templateId: template.id, programId: target });
    });
  }

  const muscles = template.muscles.slice(0, 3).map((m) => MUSCLE_LABEL[m]);
  const open = (next: Panel) => {
    setError(null);
    setPanel(next);
  };

  return (
    <li className="flex items-center gap-2 py-3">
      <Link href={`/training/templates/${template.id}`} className="min-w-0 flex-1 py-1">
        <span className="display block truncate text-2xl">{template.name}</span>
        <span className="text-muted-foreground block truncate text-sm">
          {template.items.length} {template.items.length === 1 ? "exercise" : "exercises"}
          {muscles.length > 0 ? ` · ${muscles.join(", ")}` : ""}
        </span>
      </Link>

      {canStart ? (
        <StartWorkoutButton templateId={template.id} scheduleId={plannedTodayId} className="rounded-full px-5">
          Start
        </StartWorkoutButton>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`More for ${template.name}`}>
            <EllipsisVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem asChild>
            <Link href={`/training/templates/${template.id}`}>
              <Pencil aria-hidden /> Edit
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void run(() => duplicateTemplateAction(template.id))}>
            <Copy aria-hidden /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => open("plan")}>
            <CalendarPlus aria-hidden /> Plan for a date
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => open("programme")}>
            <FolderInput aria-hidden /> Programme…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => open("delete")}>
            <Trash2 aria-hidden /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={panel !== null} onOpenChange={(value) => (value ? null : setPanel(null))}>
        <DialogContent>
          {panel === "plan" ? (
            <>
              <DialogHeader>
                <DialogTitle>Plan “{template.name}”</DialogTitle>
                <DialogDescription>
                  It appears on that day in your calendar and on Today. You can
                  move or cancel it later; the workout itself is not changed.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor={`plan-date-${template.id}`}>Date</Label>
                <Input
                  id={`plan-date-${template.id}`}
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
            </>
          ) : null}

          {panel === "programme" ? (
            <>
              <DialogHeader>
                <DialogTitle>Programme</DialogTitle>
                <DialogDescription>
                  A programme groups workouts that belong together — Push,
                  Pull, Legs. It only organises the list.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`programme-${template.id}`}>File under</Label>
                  <select
                    id={`programme-${template.id}`}
                    className="border-input bg-card h-10 w-full rounded-lg border px-3 text-base md:text-sm"
                    value={programId}
                    onChange={(event) => setProgramId(event.target.value)}
                  >
                    <option value="">No programme</option>
                    {programs.map((program) => (
                      <option key={program.id} value={program.id}>{program.name}</option>
                    ))}
                    <option value="new">New programme…</option>
                  </select>
                </div>
                {programId === "new" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={`programme-name-${template.id}`}>Name</Label>
                    <Input
                      id={`programme-name-${template.id}`}
                      value={newProgram}
                      maxLength={80}
                      placeholder="Push / Pull / Legs"
                      onChange={(event) => setNewProgram(event.target.value)}
                    />
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {panel === "delete" ? (
            <DialogHeader>
              <DialogTitle>Delete “{template.name}”?</DialogTitle>
              <DialogDescription>
                The workout and its planned dates are removed. Sessions you
                already did with it stay in your history, unchanged.
              </DialogDescription>
            </DialogHeader>
          ) : null}

          {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPanel(null)}>
              Cancel
            </Button>
            {panel === "plan" ? (
              <PendingButton
                type="button"
                pending={pending}
                disabled={date === ""}
                onClick={() => void run(() => scheduleWorkoutAction({ templateId: template.id, date }))}
              >
                Plan it
              </PendingButton>
            ) : null}
            {panel === "programme" ? (
              <PendingButton
                type="button"
                pending={pending}
                disabled={programId === "new" && newProgram.trim() === ""}
                onClick={() => void saveProgramme()}
              >
                Save
              </PendingButton>
            ) : null}
            {panel === "delete" ? (
              <PendingButton
                type="button"
                variant="destructive"
                pending={pending}
                onClick={() => void run(() => deleteTemplateAction(template.id))}
              >
                Delete
              </PendingButton>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
