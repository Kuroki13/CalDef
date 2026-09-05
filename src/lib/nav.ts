import {
  BookOpen,
  ChefHat,
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
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/diary", label: "Diary", icon: BookOpen },
  { href: "/weight", label: "Weight", icon: Scale },
  { href: "/phase", label: "Phase", icon: Target },
  { href: "/recipes", label: "Recipes", icon: ChefHat },
  { href: "/assistant", label: "Assistant", icon: MessageCircle },
  { href: "/settings", label: "Settings", icon: Settings },
];
