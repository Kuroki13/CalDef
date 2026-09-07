"use client";

import { useActionState, useState } from "react";

import {
  completeOnboarding,
  type OnboardingState,
} from "@/app/onboarding/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PendingButton } from "@/components/pending-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { lengthUnitLabel, massUnitLabel, type UnitSystem } from "@/lib/units";

const ACTIVITY_LEVELS = [
  { value: "sedentary", label: "Sedentary — desk job, little exercise" },
  { value: "light", label: "Light — 1–3 sessions a week" },
  { value: "moderate", label: "Moderate — 3–5 sessions a week" },
  { value: "very", label: "Very active — 6–7 sessions a week" },
  { value: "extra", label: "Extremely active — physical job or two-a-days" },
] as const;

export function OnboardingForm() {
  const [state, formAction] = useActionState<OnboardingState, FormData>(
    completeOnboarding,
    {},
  );
  const [unitSystem, setUnitSystem] = useState<UnitSystem>("metric");

  const mass = massUnitLabel(unitSystem);
  const length = lengthUnitLabel(unitSystem);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="unitSystem" value={unitSystem} />

      {/*
        The browser's IANA timezone, written straight to the DOM node rather
        than held in state: reading it during render would disagree with the
        server's HTML, and an effect would cost an extra render. Diary days
        resolve against this — see lib/dates.
      */}
      <input
        type="hidden"
        name="timezone"
        ref={(node) => {
          if (node) {
            node.value =
              Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
          }
        }}
      />

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium">About you</legend>

        <div className="space-y-2">
          <Label htmlFor="displayName">First name (optional)</Label>
          <Input id="displayName" name="displayName" maxLength={80} />
          <p className="text-muted-foreground text-xs">
            Used only to greet you in this app. Never sent to the AI.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sex">Sex</Label>
            <Select name="sex" defaultValue="male">
              <SelectTrigger id="sex" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Prefer not to say</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Used by the metabolic-rate formula only.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="birthDate">Date of birth</Label>
            <Input id="birthDate" name="birthDate" type="date" required />
          </div>
        </div>

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

        <div className="grid gap-4 sm:grid-cols-2">
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
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="currentWeight">Current weight ({mass})</Label>
            <Input
              id="currentWeight"
              name="currentWeight"
              type="number"
              step="0.1"
              min="1"
              required
              inputMode="decimal"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium">Your goal</legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="goalType">Goal</Label>
            <Select name="goalType" defaultValue="lose">
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
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="activityLevel">Activity level</Label>
          <Select name="activityLevel" defaultValue="moderate">
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
          <p className="text-muted-foreground text-xs">
            A starting point only. CalDef replaces it with your measured
            expenditure once it has enough data.
          </p>
        </div>
      </fieldset>

      <PendingButton type="submit" className="w-full" pendingLabel="Saving…">
        Finish setup
      </PendingButton>
    </form>
  );
}
