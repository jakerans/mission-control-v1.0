import { Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import { getProjectIcon } from "@/lib/project-icons";

type Props = {
  icon?: string | null;
  iconUrl?: string | null;
  className?: string;
};

// Renders a project's preset icon or its uploaded custom image.
export function ProjectIcon({ icon, iconUrl, className }: Props) {
  if (iconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- local upload / blob preview
      <img src={iconUrl} alt="" className={cn("size-10 shrink-0 rounded-xl border bg-background object-cover", className)} />
    );
  }

  const preset = getProjectIcon(icon);
  const Icon = preset?.Icon ?? Rocket;
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-1/2",
        preset?.tone ?? "bg-muted text-muted-foreground",
        className
      )}
    >
      <Icon />
    </span>
  );
}
