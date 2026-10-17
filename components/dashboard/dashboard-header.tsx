"use client";

import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { getActiveNav } from "@/lib/dashboard-nav";
import { useDashboardShell } from "@/components/dashboard/dashboard-shell";
import { OfficeSwitcher, type OfficeOption } from "@/components/dashboard/office-switcher";
import { PaletteToggle } from "@/components/theme/palette";
import { Button } from "@/components/ui/button";

type Props = { projectId: number; offices: OfficeOption[]; activeOfficeId: string };

export function DashboardHeader({ projectId, offices, activeOfficeId }: Props) {
  const pathname = usePathname();
  const { openMobile } = useDashboardShell();
  const page = getActiveNav(pathname);

  return (
    <header className="sticky top-0 z-20 px-4 py-3 sm:px-6 md:pl-3">
      <div className="flex h-14 w-full items-center gap-3">
        <Button variant="outline" size="icon-lg" className="rounded-xl bg-card md:hidden" onClick={openMobile} aria-label="Open navigation">
          <Menu />
        </Button>

        {/* Keyed so the title re-animates on navigation */}
        <div key={page.slug} className="min-w-0 animate-in duration-300 fade-in-0 slide-in-from-left-1">
          <h1 className="truncate text-lg leading-tight font-bold tracking-tight sm:text-xl">{page.label}</h1>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">{page.description}</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <OfficeSwitcher projectId={projectId} offices={offices} activeId={activeOfficeId} />
          <PaletteToggle className="hidden h-10 p-1 shadow-md sm:inline-flex [&_button]:h-8" />
        </div>
      </div>
    </header>
  );
}
