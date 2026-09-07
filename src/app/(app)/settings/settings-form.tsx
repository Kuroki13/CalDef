"use client";

import { useActionState, useState, useTransition } from "react";

import {
  setAiEnabled,
  updateSettings,
  type SettingsState,
} from "@/app/(app)/settings/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PendingButton, Spinner } from "@/components/pending-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  cmToDisplay,
  kgToDisplay,
  lengthUnitLabel,
  massUnitLabel,
  type UnitSystem,
} from "@/lib/units";

const ACTIVITY_LEVELS = [
  { value: "sedentary", label: "Sedentary — desk job, little exercise" },
  { value: "light", label: "Light — 1–3 sessions a week" },
  { value: "moderate", label: "Moderate — 3–5 sessions a week" },
  { value: "very", label: "Very active — 6–7 sessions a week" },
  { value: "extra", label: "Extremely active — physical job or two-a-days" },
] as const;

export type SettingsFormProps = {
  displayName: string;
  sex: "male" | "female" | "other";
  birthDate: string;
  unitSystem: UnitSystem;
  heightCm: number;
  goalType: "lose" | "maintain" | "gain" | "recomp";
  goalWeightKg: number | null;
  activityLevel: "sedentary" | "light" | "moderate" | "very" | "extra";
  proteinPerKg: number;
};

export function SettingsForm(props: SettingsFormProps) {
  const [state, formAction] = useActionState<SettingsState, FormData>(
    updateSettings,
    {},
  );
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(props.unitSystem);

  const mass = massUnitLabel(unitSystem);
  const length = lengthUnitLabel(unitSystem);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="unitSystem" value={unitSystem} />
      {/*
        Re-synced from the browser on every save, rather than exposed as a
        field nobody would think to set. Onboarding defaults to UTC when
        JavaScript is off, and without this there was no way to correct that
        afterwards — which matters, because the timezone decides which
        calendar day an entry lands on.
      */}
      <input
        type="hidden"
        name="timezone"
        value={Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"}
      />

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.saved ? (
        <Alert>
          <AlertDescription>Settings saved.</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="displayName">First name</Label>
        <Input
          id="displayName"
          name="displayName"
          maxLength={80}
          defaultValue={props.displayName}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="sex">Sex</Label>
          <Select name="sex" defaultValue={props.sex}>
            <SelectTrigger id="sex" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="other">Prefer not to say</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="birthDate">Date of birth</Label>
          <Input
            id="birthDate"
            name="birthDate"
            type="date"
            required
            defaultValue={props.birthDate}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="unit-system">Units</Label>
          <Select
            value={unitSystem}
            onValueChange={(value) => setUnitSystem(value as UnitSystem)}
          >
            <SelectTrigger id="unit-system" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="metric">Metric (kg, cm)</SelectItem>
              <SelectItem value="imperial">Imperial (lb, in)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="height">Height ({length})</Label>
          <Input
            id="height"
            name="height"
            type="number"
            step="0.1"
            min="1"
            required
            inputMode="decimal"
            key={`height-${unitSystem}`}
            defaultValue={cmToDisplay(props.heightCm, unitSystem).toFixed(1)}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="goalType">Goal</Label>
          <Select name="goalType" defaultValue={props.goalType}>
            <SelectTrigger id="goalType" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lose">Lose fat</SelectItem>
              <SelectItem value="maintain">Maintain</SelectItem>
              <SelectItem value="gain">Gain weight</SelectItem>
              <SelectItem value="recomp">Recomposition</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="goalWeight">Final goal weight ({mass})</Label>
          <Input
            id="goalWeight"
            name="goalWeight"
            type="number"
            step="0.1"
            min="1"
            required
            inputMode="decimal"
            key={`goal-${unitSystem}`}
            defaultValue={
              props.goalWeightKg === null
                ? ""
                : kgToDisplay(props.goalWeightKg, unitSystem).toFixed(1)
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="activityLevel">Activity level</Label>
        <Select name="activityLevel" defaultValue={props.activityLevel}>
          <SelectTrigger id="activityLevel" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTIVITY_LEVELS.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="proteinPerKg">Protein target (g per kg bodyweight)</Label>
        <Input
          id="proteinPerKg"
          name="proteinPerKg"
          type="number"
          step="0.1"
          min="0.5"
          max="4"
          required
          inputMode="decimal"
          defaultValue={props.proteinPerKg}
        />
        <p className="text-muted-foreground text-xs">
          Higher protein protects muscle in a deficit. 1.6–2.2 g/kg is the
          usual range.
        </p>
      </div>

      <PendingButton type="submit" pendingLabel="Saving…">
        Save settings
      </PendingButton>
    </form>
  );
}

export function AiToggle({ enabled }: { enabled: boolean }) {
  const [optimistic, setOptimistic] = useState(enabled);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor="ai-enabled">AI features</Label>
        <p className="text-muted-foreground text-sm">
          Natural-language logging and the nutrition assistant. Only food text
          is ever sent — never your name, email or weight history. Everything
          else in CalDef works with this off.
        </p>
      </div>
      <div className="flex items-center gap-2">
        {/* The switch moves optimistically, so without this there is nothing
            to say the change has not reached the server yet. */}
        {pending ? <Spinner className="text-muted-foreground size-4" /> : null}
        <Switch
          id="ai-enabled"
          checked={optimistic}
          disabled={pending}
          aria-busy={pending}
          onCheckedChange={(next) => {
            setOptimistic(next);
            startTransition(async () => {
              await setAiEnabled(next);
            });
          }}
        />
      </div>
    </div>
  );
}
