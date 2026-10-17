"use client";

/* eslint-disable @next/next/no-img-element -- office thumbnails are served from our own API */
import { useState, useTransition } from "react";
import { Building2, Check, ChevronsUpDown, Film } from "lucide-react";
import { cn } from "@/lib/utils";
import { changeOffice } from "@/app/projects/actions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";

export type OfficeOption = { id: string; name: string; background: string; video: string | null };

const triggerClass =
  "flex h-10 items-center gap-2 rounded-full border bg-card/85 py-1 pr-3 pl-1 text-sm font-semibold shadow-md backdrop-blur transition-colors outline-none hover:bg-card focus-visible:ring-3 focus-visible:ring-ring/50";

// Moves the current project's agents to another office.
export function OfficeSwitcher({ projectId, offices, activeId }: { projectId: number; offices: OfficeOption[]; activeId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const active = offices.find((o) => o.id === activeId);

  const choose = (officeId: string) => {
    if (officeId === activeId) return setOpen(false);
    setError(undefined);
    startTransition(async () => {
      const result = await changeOffice(projectId, officeId);
      if (result.error) setError(result.error);
      else setOpen(false);
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={cn(triggerClass, "pl-3")}>
        {pending ? <Spinner className="text-muted-foreground" /> : <Building2 className="size-4 text-muted-foreground" />}
        <span className="max-w-48 truncate">{active?.name ?? "Choose office"}</span>
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(34rem,calc(100vw-2rem))] gap-2 rounded-2xl p-3">
        <div className="px-1">
          <p className="text-sm font-semibold">Move to another office</p>
          <p className="text-xs text-muted-foreground">Your agents pack up and keep working in the new room.</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {offices.map((o) => {
            const selected = o.id === activeId;
            return (
              <button
                key={o.id}
                type="button"
                disabled={pending}
                onClick={() => choose(o.id)}
                className={cn(
                  "overflow-hidden rounded-xl border-2 bg-background p-1 text-left transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
                  selected ? "border-primary" : "border-transparent hover:border-primary/40"
                )}
              >
                <div className="relative aspect-3/2 overflow-hidden rounded-lg bg-muted">
                  <img src={o.background} alt="" className="size-full object-cover" />
                  {selected && (
                    <span className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow ring-2 ring-card">
                      <Check className="size-3.5" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1.5 px-1 pt-1.5 pb-0.5">
                  <span className="truncate text-xs font-semibold">{o.name}</span>
                  {o.video && <Film className="size-3.5 shrink-0 text-primary" aria-label="Live video background" />}
                </div>
              </button>
            );
          })}
        </div>
        {error && <p className="px-1 text-xs text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}
