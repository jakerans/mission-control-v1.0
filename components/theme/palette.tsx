"use client";

import { useEffect, useState } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { Coffee, Droplet } from "lucide-react";
import { cn } from "@/lib/utils";

const PALETTES = [
  { id: "warm", label: "Cozy", Icon: Coffee },
  { id: "blue", label: "Blue", Icon: Droplet },
] as const;

// Stores the chosen palette in localStorage and sets data-palette on <html> before first paint.
export function PaletteProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="data-palette"
      themes={PALETTES.map((p) => p.id)}
      defaultTheme="warm"
      enableSystem={false}
      storageKey="mc-palette"
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}

// Segmented Cozy / Blue switch.
export function PaletteToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const active = mounted ? theme : null;

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className={cn("inline-flex items-center gap-0.5 rounded-full border bg-card/80 p-0.5 shadow-sm backdrop-blur", className)}
    >
      {PALETTES.map(({ id, label, Icon }) => {
        const selected = active === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(id)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              selected ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
