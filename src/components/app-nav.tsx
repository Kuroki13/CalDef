"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { LinkPending } from "@/components/pending-nav";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NAV_ITEMS, PRIMARY_NAV, SECONDARY_NAV, isActivePath } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** Sidebar, shown from `md` upwards. */
export function AppSidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="bg-sidebar hidden md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:gap-1 md:border-r md:p-4"
    >
      <span className="flex items-center gap-2 px-3 pt-1 pb-5 text-lg font-bold tracking-tight">
        <span aria-hidden className="bg-primary size-2.5 rounded-full" />
        CalDef
      </span>
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-accent text-accent-foreground font-semibold"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <LinkPending>
              <Icon className="size-4" aria-hidden />
            </LinkPending>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

const TAB_CLASS =
  "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[0.6875rem] transition-colors";

/**
 * Bottom tab bar, shown below `md`.
 *
 * Four destinations and "More". The bar pads itself by the home
 * indicator's height, so on an installed iPhone the labels sit above the
 * swipe area rather than under it.
 */
export function AppTabBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const inMore = SECONDARY_NAV.some((item) => isActivePath(pathname, item.href));

  return (
    <nav
      aria-label="Main"
      className="bg-card/95 pb-safe supports-backdrop-filter:backdrop-blur fixed inset-x-0 bottom-0 z-20 flex border-t md:hidden"
    >
      {PRIMARY_NAV.map(({ href, label, icon: Icon }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              TAB_CLASS,
              active ? "text-primary font-semibold" : "text-muted-foreground",
            )}
          >
            <ActiveMark active={active} />
            <LinkPending spinnerClassName="size-[22px]">
              <Icon className="size-[22px]" aria-hidden />
            </LinkPending>
            {label}
          </Link>
        );
      })}

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetTrigger
          className={cn(
            TAB_CLASS,
            inMore ? "text-primary font-semibold" : "text-muted-foreground",
          )}
        >
          <ActiveMark active={inMore} />
          <Menu className="size-[22px]" aria-hidden />
          More
        </SheetTrigger>
        <SheetContent side="bottom" className="pb-safe rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
            <SheetDescription>
              Recipes, the cut phase, the assistant and your settings.
            </SheetDescription>
          </SheetHeader>
          <ul className="px-2 pb-4">
            {SECONDARY_NAV.map(({ href, label, icon: Icon }) => {
              const active = isActivePath(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-lg px-3 text-base",
                      active
                        ? "bg-accent text-accent-foreground font-semibold"
                        : "hover:bg-muted",
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
    </nav>
  );
}

/** The short bar above the active tab: position, not only colour, says where you are. */
function ActiveMark({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-0 h-0.5 w-8 rounded-full transition-opacity",
        active ? "bg-primary opacity-100" : "opacity-0",
      )}
    />
  );
}
