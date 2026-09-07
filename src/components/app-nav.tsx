"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LinkPending } from "@/components/pending-nav";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Sidebar, shown from `md` upwards. */
export function AppSidebar() {
  const pathname = usePathname();

  return (
    <nav className="hidden md:flex md:w-56 md:shrink-0 md:flex-col md:gap-1 md:border-r md:p-4">
      <span className="px-3 pb-4 text-lg font-semibold tracking-tight">
        CalDef
      </span>
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(pathname, href) ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
            isActive(pathname, href)
              ? "bg-accent text-accent-foreground font-medium"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          <LinkPending>
            <Icon className="size-4" aria-hidden />
          </LinkPending>
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** Bottom tab bar, shown below `md`. */
export function AppTabBar() {
  const pathname = usePathname();

  return (
    <nav className="bg-background fixed inset-x-0 bottom-0 z-20 flex border-t md:hidden">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(pathname, href) ? "page" : undefined}
          className={cn(
            "flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors",
            isActive(pathname, href)
              ? "text-foreground font-medium"
              : "text-muted-foreground",
          )}
        >
          <LinkPending spinnerClassName="size-5">
            <Icon className="size-5" aria-hidden />
          </LinkPending>
          {label}
        </Link>
      ))}
    </nav>
  );
}
