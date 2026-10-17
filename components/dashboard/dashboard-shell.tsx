"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SIDEBAR_COOKIE } from "@/lib/dashboard-nav";
import { cn } from "@/lib/utils";
import { AppSidebar, type ProjectOption } from "@/components/dashboard/app-sidebar";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import type { OfficeOption } from "@/components/dashboard/office-switcher";
import { MusicProvider } from "@/components/music/lofi-player";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";

type ShellContext = {
  expanded: boolean;
  toggleSidebar: () => void;
  openMobile: () => void;
};

const ShellContext = createContext<ShellContext | null>(null);

export function useDashboardShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useDashboardShell must be used inside <DashboardShell>");
  return ctx;
}

type Props = {
  projects: ProjectOption[];
  activeProjectId: number;
  offices: OfficeOption[];
  activeOfficeId: string;
  defaultExpanded: boolean;
  children: React.ReactNode;
};

export function DashboardShell({ projects, activeProjectId, offices, activeOfficeId, defaultExpanded, children }: Props) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleSidebar = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      document.cookie = `${SIDEBAR_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      return next;
    });
  }, []);

  // Ctrl+B / ⌘B toggles the sidebar
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "b" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (window.matchMedia("(min-width: 768px)").matches) toggleSidebar();
        else setMobileOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

  const sidebarProps = { projects, activeProjectId, pathname };

  return (
    <ShellContext.Provider value={{ expanded, toggleSidebar, openMobile: () => setMobileOpen(true) }}>
      {/* Current sidebar width, so floating panels (the radio) sit just beside it */}
      <div className="contents" style={{ "--sidebar-w": expanded ? "16.5rem" : "5.5rem" } as React.CSSProperties}>
        <MusicProvider>
          <TooltipProvider delay={150}>
            <div className="relative flex min-h-svh bg-background">
              <div className="pointer-events-none fixed -top-40 -left-40 size-120 rounded-full bg-(--glow-1) blur-3xl" />
              <div className="pointer-events-none fixed -right-40 -bottom-40 size-120 rounded-full bg-(--glow-2) blur-3xl" />

              {/* Desktop: floating panel that animates between icon rail and full width */}
              <aside
                data-expanded={expanded}
                className={cn(
                  "sticky top-0 z-30 hidden h-svh shrink-0 p-3 transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] md:block",
                  expanded ? "w-66" : "w-22",
                )}
              >
                <AppSidebar {...sidebarProps} expanded={expanded} onToggle={toggleSidebar} />
              </aside>

              {/* Mobile: same panel in a drawer, always expanded */}
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetContent
                  side="left"
                  showCloseButton={false}
                  className="w-72 border-0 bg-transparent p-3 shadow-none data-[side=left]:w-72 md:hidden"
                >
                  <SheetTitle className="sr-only">Navigation</SheetTitle>
                  <AppSidebar {...sidebarProps} expanded onNavigate={() => setMobileOpen(false)} />
                </SheetContent>
              </Sheet>

              <div className="relative flex min-w-0 flex-1 flex-col">
                <DashboardHeader projectId={activeProjectId} offices={offices} activeOfficeId={activeOfficeId} />
                <main className="flex-1 px-4 pb-4 sm:px-6 md:pl-3">{children}</main>
              </div>
            </div>
          </TooltipProvider>
        </MusicProvider>
      </div>
    </ShellContext.Provider>
  );
}
