"use client";

/**
 * Light, dark, or whatever the phone says.
 *
 * Both sets of tokens live in `globals.css`; this only decides which one is
 * on. The choice is kept on the device (it is a property of the screen in
 * front of you, not of the account), and "System" follows the phone, so the
 * app is dark at the gym at night without anyone asking it to be.
 */

import { Monitor, Moon, Sun } from "lucide-react";
import { ThemeProvider as NextThemes, useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="caldef.theme"
    >
      {children}
    </NextThemes>
  );
}

const OPTIONS = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

const subscribe = () => () => {};

/** Three choices, the current one filled and pressed — not colour alone. */
export function AppearanceSetting() {
  const { theme, setTheme } = useTheme();
  // The stored choice exists only in the browser; until it is read, no
  // option is shown as chosen rather than the wrong one.
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  const current = isClient ? (theme ?? "system") : null;

  return (
    <div role="group" aria-label="Appearance" className="bg-muted grid grid-cols-3 gap-1 rounded-xl p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = current === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => setTheme(value)}
            className={cn(
              "flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm",
              active ? "bg-card font-semibold shadow-sm" : "text-muted-foreground font-medium",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
