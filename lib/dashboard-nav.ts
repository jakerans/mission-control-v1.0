import { Bot, Building2, LayoutGrid, ListChecks, Settings, type LucideIcon } from "lucide-react";

export type NavItem = {
  // Route segment under /dashboard ("" is the office, the dashboard's home)
  slug: string;
  label: string;
  description: string;
  Icon: LucideIcon;
  // false: shows a "coming soon" placeholder until the section is built
  ready: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { slug: "", label: "Office", description: "Watch your agents at work", Icon: Building2, ready: true },
  { slug: "overview", label: "Overview", description: "Your project at a glance", Icon: LayoutGrid, ready: false },
  { slug: "agents", label: "Agents", description: "Brief your team and see what each agent is doing", Icon: Bot, ready: false },
  { slug: "tasks", label: "Tasks", description: "Everything queued, running and done", Icon: ListChecks, ready: false },
  { slug: "settings", label: "Settings", description: "Project and workspace preferences", Icon: Settings, ready: false },
];

export function navHref(slug: string) {
  return slug ? `/dashboard/${slug}` : "/dashboard";
}

// Nav item matching the current pathname (falls back to the office).
export function getActiveNav(pathname: string) {
  const slug = pathname.replace(/^\/dashboard\/?/, "").split("/")[0] ?? "";
  return NAV_ITEMS.find((item) => item.slug === slug) ?? NAV_ITEMS[0];
}

export const SIDEBAR_COOKIE = "mc-sidebar-expanded";
