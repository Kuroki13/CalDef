import {
  BookOpen,
  ChefHat,
  Dumbbell,
  MessageCircle,
  LayoutDashboard,
  Scale,
  Settings,
  Target,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * On a phone, primary items are the tab bar and the rest sit behind
   * "More". Five targets is what a thumb can tell apart at the bottom of a
   * screen; the app has eight destinations.
   */
  primary: boolean;
};

/**
 * Navigation is grown one phase at a time on purpose.
 *
 * An entry is added here only once its route renders something real. That
 * keeps the shipped app free of links that lead nowhere, which the spec's
 * acceptance criteria require. Every route listed here now renders.
 *
 * Assistant is listed unconditionally even though the user can switch the AI
 * off: the page itself explains the switch and links to settings, which is a
 * better answer than a nav item that appears and disappears.
 *
 * The four primary items are the daily loop — what is left today, what was
 * eaten, the session at the gym, the morning weigh-in. Everything else is
 * opened weekly at most and lives one tap further away on a phone. The
 * desktop sidebar has the room to show all of them.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Today", icon: LayoutDashboard, primary: true },
  { href: "/diary", label: "Diary", icon: BookOpen, primary: true },
  { href: "/training", label: "Training", icon: Dumbbell, primary: true },
  { href: "/weight", label: "Weight", icon: Scale, primary: true },
  { href: "/recipes", label: "Recipes & foods", icon: ChefHat, primary: false },
  { href: "/phase", label: "Phase", icon: Target, primary: false },
  { href: "/assistant", label: "Assistant", icon: MessageCircle, primary: false },
  { href: "/settings", label: "Settings", icon: Settings, primary: false },
];

export const PRIMARY_NAV = NAV_ITEMS.filter((item) => item.primary);
export const SECONDARY_NAV = NAV_ITEMS.filter((item) => !item.primary);

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
