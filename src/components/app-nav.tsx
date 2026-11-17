"use client";

/**
 * The shell's navigation (spec §16.2).
 *
 *   phone    an ink top bar (wordmark, menu) and a four-tab bar at the
 *            bottom. The top bar is the same ink as a screen's slab, so a
 *            slab reads as the bar opening downward.
 *   desktop  an ink sidebar with all eight destinations; no top bar.
 *
 * Where you are is said three ways — weight, a filled pill, and
 * `aria-current` — never by colour alone.
 */

import { Menu, Timer } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { LinkPending } from "@/components/pending-nav";
import { useIsClient, useNow } from "@/components/training/use-now";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  PRIMARY_NAV,
  SECONDARY_NAV,
  isActiveItem,
  isActivePath,
} from "@/lib/nav";
import { formatClock } from "@/lib/training/format";
import { elapsedSeconds } from "@/lib/training/timer";
import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("display flex items-center gap-1.5 text-xl", className)}>
      <span aria-hidden className="bg-volt size-2 rounded-full" />
      CalDef
    </span>
  );
}

/** Sidebar, shown from `lg` upwards. */
export function AppSidebar() {
  const pathname = usePathname();

  const item = (
    { href, label, icon: Icon }: (typeof PRIMARY_NAV)[number],
    active: boolean,
  ) => (
    <Link
      key={href}
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
        active
          ? "bg-volt text-volt-foreground font-semibold"
          : "text-slab-muted hover:bg-sidebar-accent hover:text-slab-foreground",
      )}
    >
      <LinkPending>
        <Icon className="size-[18px]" aria-hidden />
      </LinkPending>
      {label}
    </Link>
  );

  return (
    <nav
      aria-label="Main"
      className="on-slab hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:gap-1 lg:p-4"
    >
      <Wordmark className="px-3 pt-2 pb-6 text-2xl" />
      {/* The sidebar lists every destination, so each lights only for its
          own path. (The phone's four tabs have to stand in for the rest:
          there, Nutrition also covers Recipes, Progress also the phase.) */}
      {PRIMARY_NAV.map((entry) => item(entry, isActivePath(pathname, entry.href)))}
      <span className="eyebrow px-3 pt-6 pb-1">More</span>
      {SECONDARY_NAV.map((entry) =>
        item(entry, isActivePath(pathname, entry.href)),
      )}
    </nav>
  );
}

/**
 * The phone's top bar. Pads itself by the status bar's height, so in the
 * installed app the clock and battery — which iOS draws in white — sit on
 * ink.
 */
export function AppTopBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="on-slab pt-safe sticky top-0 z-30 lg:hidden">
      <div className="flex h-12 items-center justify-between px-4">
        <Link href="/dashboard" aria-label="CalDef — today">
          <Wordmark />
        </Link>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            aria-label="Menu"
            className="-mr-2 flex size-11 items-center justify-center rounded-full"
          >
            <Menu className="size-[22px]" aria-hidden />
          </SheetTrigger>
          <SheetContent side="right" className="w-[80vw] max-w-xs">
            <SheetHeader>
              <SheetTitle className="display text-2xl">Menu</SheetTitle>
              <SheetDescription>
                Recipes, the cut phase, the assistant and your settings.
              </SheetDescription>
            </SheetHeader>
            <ul className="px-2">
              {SECONDARY_NAV.map(({ href, label, icon: Icon }) => {
                const active = isActivePath(pathname, href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-13 items-center gap-3 rounded-xl px-3 text-base",
                        active ? "bg-muted font-semibold" : "hover:bg-muted",
                      )}
                    >
                      <Icon className="text-muted-foreground size-5" aria-hidden />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

/**
 * Bottom tab bar, below `lg`. Four tabs; the active one is a filled ink
 * pill behind its icon, with a heavier label.
 */
export function AppTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="bg-card pb-safe fixed inset-x-0 bottom-0 z-30 border-t lg:hidden"
    >
      <ul className="mx-auto flex max-w-md">
        {PRIMARY_NAV.map((entry) => {
          const { href, label, icon: Icon } = entry;
          const active = isActiveItem(pathname, entry);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-15 flex-col items-center justify-center gap-0.5 text-[0.6875rem]",
                  active ? "text-foreground font-bold" : "text-muted-foreground font-medium",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-14 items-center justify-center rounded-full transition-colors",
                    active ? "bg-foreground text-volt" : "",
                  )}
                >
                  <LinkPending spinnerClassName="size-5">
                    <Icon className="size-5" aria-hidden />
                  </LinkPending>
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * A session in progress follows you around the app (spec §16.2): one tap
 * back to it from any screen, with its clock running. Not shown on the
 * session screen itself.
 *
 * The clock is `now − startedAt`, so it is right after a lock; it renders
 * only in the browser, where "now" exists.
 */
export function SessionBar({
  session,
}: {
  session: { name: string; startedAt: string } | null;
}) {
  const pathname = usePathname();
  const isClient = useIsClient();
  const now = useNow(1000);

  // The training home and the session screen carry their own way back in.
  if (!session || ["/training/session", "/training", "/dashboard"].includes(pathname)) return null;

  return (
    <Link
      href="/training/session"
      className="on-slab fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 flex min-h-13 items-center gap-3 rounded-2xl px-4 shadow-lg lg:inset-x-auto lg:right-8 lg:bottom-8 lg:w-96"
    >
      <span className="bg-volt text-volt-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
        <Timer className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="eyebrow block">Session in progress</span>
        <span className="block truncate text-sm font-semibold">{session.name}</span>
      </span>
      <span className="figure text-2xl" aria-label="Session time">
        {isClient ? formatClock(elapsedSeconds(session.startedAt, now)) : ""}
      </span>
      <span className="text-volt text-sm font-semibold">Resume</span>
    </Link>
  );
}
