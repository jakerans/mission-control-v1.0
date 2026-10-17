"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, PanelLeftClose, PanelLeftOpen, Plus, Rocket } from "lucide-react";
import { switchProject } from "@/app/projects/actions";
import { NAV_ITEMS, getActiveNav, navHref, type NavItem } from "@/lib/dashboard-nav";
import { cn } from "@/lib/utils";
import { LofiPlayer } from "@/components/music/lofi-player";
import { ProjectIcon } from "@/components/project/project-icon";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type ProjectOption = { id: number; name: string; icon: string | null; iconUrl: string | null };

// Geometry: the collapsed panel is 64px wide with 8px padding, leaving a 48px row —
// every row is p-1.5 around a 36px tile so icons line up in both states.

type Props = {
  projects: ProjectOption[];
  activeProjectId: number;
  pathname: string;
  expanded: boolean;
  // Desktop only: collapse/expand button at the bottom
  onToggle?: () => void;
  // Mobile drawer: close after navigating
  onNavigate?: () => void;
};

const MAIN_NAV = NAV_ITEMS.filter((item) => item.slug !== "settings");
const SETTINGS_NAV = NAV_ITEMS.find((item) => item.slug === "settings")!;

export function AppSidebar({ projects, activeProjectId, pathname, expanded, onToggle, onNavigate }: Props) {
  const activeSlug = getActiveNav(pathname).slug;

  return (
    <div className="flex h-full flex-col rounded-[28px] bg-card px-2 py-3 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_16px_40px_-16px_rgb(0_0_0/0.14)] ring-1 ring-border/60">
      <Link href="/dashboard" onClick={onNavigate} className="flex h-12 items-center gap-3 overflow-hidden rounded-2xl px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/30">
          <Rocket className="size-4.5" />
        </span>
        <span className={cn("text-base font-extrabold tracking-tight whitespace-nowrap", fade(expanded))}>Mission Control</span>
      </Link>

      <Divider />

      <ProjectSwitcher projects={projects} activeProjectId={activeProjectId} expanded={expanded} onNavigate={onNavigate} />

      <SectionLabel expanded={expanded}>Menu</SectionLabel>

      <nav aria-label="Main" className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
        <ul className="flex flex-col gap-1">
          {MAIN_NAV.map((item) => (
            <NavLink key={item.slug} item={item} active={item.slug === activeSlug} expanded={expanded} onNavigate={onNavigate} />
          ))}
        </ul>
      </nav>

      <div className="mt-3">
        <LofiPlayer expanded={expanded} />
      </div>

      <Divider />

      <ul className="flex flex-col gap-1">
        <NavLink item={SETTINGS_NAV} active={SETTINGS_NAV.slug === activeSlug} expanded={expanded} onNavigate={onNavigate} />
        {onToggle && (
          <li>
            <Tooltip disabled={expanded}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={onToggle}
                    aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
                    aria-expanded={expanded}
                    className={cn(rowClass, "w-full text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
                  />
                }
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-transform duration-300 group-hover/row:scale-105">
                  {expanded ? <PanelLeftClose className="size-4.5" /> : <PanelLeftOpen className="size-4.5" />}
                </span>
                <span className={cn("flex min-w-0 flex-1 items-center justify-between gap-2", fade(expanded))}>
                  Collapse
                  <Kbd>Ctrl B</Kbd>
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={14}>
                Expand <Kbd className="bg-background/15 text-background">Ctrl B</Kbd>
              </TooltipContent>
            </Tooltip>
          </li>
        )}
      </ul>
    </div>
  );
}

const rowClass =
  "group/row relative flex items-center gap-3 overflow-hidden rounded-2xl p-1.5 text-left text-sm font-semibold whitespace-nowrap outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/50";

// Labels slide + fade instead of popping in/out while the panel width animates.
function fade(expanded: boolean) {
  return cn(
    "transition-[opacity,translate] duration-300 ease-out",
    expanded ? "translate-x-0 opacity-100 delay-75" : "pointer-events-none -translate-x-1.5 opacity-0"
  );
}

function Divider() {
  return <div className="mx-2 my-3 h-px shrink-0 bg-border/70" />;
}

function SectionLabel({ expanded, children }: { expanded: boolean; children: React.ReactNode }) {
  return (
    <div className="relative mt-5 mb-2 flex h-4 items-center px-2.5">
      <span className={cn("text-[11px] font-bold tracking-wider text-muted-foreground/80 uppercase", fade(expanded))}>{children}</span>
      {/* Collapsed: a short rule stands in for the label */}
      <span
        className={cn(
          "absolute left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-border transition-opacity duration-300",
          expanded ? "opacity-0" : "opacity-100"
        )}
      />
    </div>
  );
}

function NavLink({ item, active, expanded, onNavigate }: { item: NavItem; active: boolean; expanded: boolean; onNavigate?: () => void }) {
  const { Icon } = item;

  return (
    <li className="relative">
      {/* Active marker on the panel edge */}
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 -left-2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary transition-[opacity,scale] duration-300",
          active ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0"
        )}
      />
      <Tooltip disabled={expanded}>
        <TooltipTrigger
          render={
            <Link
              href={navHref(item.slug)}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                rowClass,
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                expanded && (active ? "bg-muted/70" : "hover:bg-muted/50")
              )}
            />
          }
        >
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl transition-all duration-300 group-hover/row:scale-105",
              active ? "bg-primary text-primary-foreground shadow-lg shadow-primary/35" : "bg-accent text-accent-foreground"
            )}
          >
            <Icon className="size-4.5" strokeWidth={active ? 2.25 : 2} />
          </span>
          <span className={cn("flex min-w-0 flex-1 items-center justify-between gap-2", fade(expanded))}>
            <span className="truncate">{item.label}</span>
            {!item.ready && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Soon</span>}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={14}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

function ProjectSwitcher({
  projects,
  activeProjectId,
  expanded,
  onNavigate,
}: {
  projects: ProjectOption[];
  activeProjectId: number;
  expanded: boolean;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const active = projects.find((p) => p.id === activeProjectId) ?? projects[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Current project: ${active.name}. Switch project`}
        className={cn(rowClass, "w-full data-popup-open:bg-muted", expanded ? "bg-muted/50 ring-1 ring-border/70 hover:bg-muted" : "hover:bg-muted/60")}
      >
        <span className="relative shrink-0">
          <ProjectIcon
            icon={active.icon}
            iconUrl={active.iconUrl}
            className={cn("size-9 shadow-sm transition-transform duration-300 group-hover/row:scale-105", pending && "animate-pulse")}
          />
          {/* Collapsed: tiny badge hints that the tile opens a menu */}
          <span
            className={cn(
              "absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-card text-muted-foreground shadow-sm ring-1 ring-border transition-[opacity,scale] duration-300",
              expanded ? "scale-50 opacity-0" : "scale-100 opacity-100"
            )}
          >
            <ChevronsUpDown className="size-2.5" />
          </span>
        </span>
        <span className={cn("min-w-0 flex-1", fade(expanded))}>
          <span className="block text-[11px] font-medium tracking-wide text-muted-foreground">Project</span>
          <span className="block truncate text-sm font-bold text-foreground">{active.name}</span>
        </span>
        <ChevronsUpDown className={cn("mr-1 size-4 shrink-0 text-muted-foreground", fade(expanded))} />
      </PopoverTrigger>

      <PopoverContent side={expanded ? "bottom" : "right"} align="start" sideOffset={expanded ? 8 : 14} className="w-64 gap-1 rounded-2xl p-1.5 shadow-xl">
        <p className="px-2 pt-1 pb-1.5 text-xs font-semibold text-muted-foreground">Your projects</p>
        {projects.map((p) => {
          const isActive = p.id === active.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
                if (!isActive) startTransition(() => switchProject(p.id));
              }}
              className="flex items-center gap-2.5 rounded-xl p-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
            >
              <ProjectIcon icon={p.icon} iconUrl={p.iconUrl} className="size-8 rounded-lg" />
              <span className={cn("min-w-0 flex-1 truncate", isActive && "font-semibold")}>{p.name}</span>
              {isActive && <Check className="size-4 text-primary" strokeWidth={2.5} />}
            </button>
          );
        })}
        <div className="my-1 h-px bg-border" />
        <Link
          href="/projects/new"
          onClick={() => {
            setOpen(false);
            onNavigate?.();
          }}
          className="flex items-center gap-2.5 rounded-xl p-2 text-sm font-medium outline-none hover:bg-muted focus-visible:bg-muted"
        >
          <span className="flex size-8 items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 text-muted-foreground">
            <Plus className="size-4" />
          </span>
          New project
        </Link>
      </PopoverContent>
    </Popover>
  );
}
