import {
  Activity,
  ChefHat,
  Dumbbell,
  MessageCircle,
  Settings,
  Sun,
  Target,
  Utensils,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Other paths that belong to this destination, for the active state. */
  also?: string[];
};

/**
 * Four destinations, the daily loop: what is left today, what was eaten,
 * the session at the gym, where it is all going. They are the phone's tab
 * bar and the head of the desktop sidebar.
 *
 * An entry is added here only once its route renders something real, so
 * the shipped app has no link that leads nowhere.
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Today", icon: Sun },
  { href: "/diary", label: "Nutrition", icon: Utensils, also: ["/recipes"] },
  { href: "/training", label: "Training", icon: Dumbbell },
  { href: "/weight", label: "Progress", icon: Activity, also: ["/phase"] },
];

/**
 * Everything opened weekly at most. On a phone these sit behind the menu
 * button in the top bar — not a fifth tab; on desktop they are the lower
 * half of the sidebar.
 *
 * Assistant is listed unconditionally even though the AI can be switched
 * off: the page explains the switch and links to settings, which is a
 * better answer than an item that appears and disappears.
 */
export const SECONDARY_NAV: NavItem[] = [
  { href: "/recipes", label: "Recipes & foods", icon: ChefHat },
  { href: "/phase", label: "Cut phase", icon: Target },
  { href: "/assistant", label: "Assistant", icon: MessageCircle },
  { href: "/settings", label: "Settings", icon: Settings },
];

export const NAV_ITEMS: NavItem[] = [...PRIMARY_NAV, ...SECONDARY_NAV];

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Is this primary destination the one the current page belongs to? */
export function isActiveItem(pathname: string, item: NavItem): boolean {
  return [item.href, ...(item.also ?? [])].some((href) => isActivePath(pathname, href));
}
