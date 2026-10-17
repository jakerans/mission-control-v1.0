import {
  Coffee,
  Compass,
  Flame,
  Leaf,
  Moon,
  Mountain,
  Rocket,
  Sparkles,
  Star,
  type LucideIcon,
} from "lucide-react";

export type ProjectIconPreset = {
  id: string;
  label: string;
  Icon: LucideIcon;
  // Tailwind classes for the icon tile background + foreground
  tone: string;
};

export const PROJECT_ICONS: ProjectIconPreset[] = [
  { id: "rocket", label: "Rocket", Icon: Rocket, tone: "bg-linear-to-br from-sky-400 to-blue-600 text-white" },
  { id: "coffee", label: "Coffee", Icon: Coffee, tone: "bg-linear-to-br from-amber-600 to-orange-800 text-white" },
  { id: "flame", label: "Flame", Icon: Flame, tone: "bg-linear-to-br from-amber-400 to-orange-500 text-white" },
  { id: "mountain", label: "Mountain", Icon: Mountain, tone: "bg-linear-to-br from-slate-400 to-slate-700 text-white" },
  { id: "leaf", label: "Leaf", Icon: Leaf, tone: "bg-linear-to-br from-emerald-400 to-green-700 text-white" },
  { id: "moon", label: "Moon", Icon: Moon, tone: "bg-linear-to-br from-indigo-400 to-violet-700 text-white" },
  { id: "sparkles", label: "Sparkles", Icon: Sparkles, tone: "bg-linear-to-br from-fuchsia-400 to-purple-600 text-white" },
  { id: "compass", label: "Compass", Icon: Compass, tone: "bg-linear-to-br from-teal-400 to-cyan-700 text-white" },
  { id: "star", label: "Star", Icon: Star, tone: "bg-linear-to-br from-yellow-300 to-amber-500 text-white" },
];

export function getProjectIcon(id: string | null | undefined) {
  return PROJECT_ICONS.find((icon) => icon.id === id);
}
