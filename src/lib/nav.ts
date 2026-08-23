import {
  BookOpen,
  LayoutDashboard,
  Scale,
  Settings,
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
 * acceptance criteria require. Phases still to come will add: Phase,
 * Recipes, Assistant.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/diary", label: "Diary", icon: BookOpen },
  { href: "/weight", label: "Weight", icon: Scale },
  { href: "/settings", label: "Settings", icon: Settings },
];
