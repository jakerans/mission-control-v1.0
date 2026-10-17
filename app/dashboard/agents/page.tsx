/* eslint-disable @next/next/no-img-element -- avatars are sprite frames served from our own API */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Armchair, ChevronDown, Cpu, ShieldCheck } from "lucide-react";
import type { AgentStatus } from "@/db/schema";
import { ensureTeam, ROLE_LABELS, STATUS_LABELS } from "@/lib/agents";
import { getOfficeScene } from "@/lib/offices";
import { getActiveProject } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Agents · Mission Control" };

const STATUS_STYLE: Record<AgentStatus, string> = {
  idle: "bg-muted text-muted-foreground",
  working: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  blocked: "bg-red-500/15 text-red-700 dark:text-red-400",
  needs_approval: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  offline: "bg-muted text-muted-foreground/70",
};

const ENGINE_LABELS = { claude: "Claude", codex: "Codex" } as const;

// "write_worktree" → "Write worktree"
const permissionLabel = (permission: string) => permission.charAt(0).toUpperCase() + permission.slice(1).replaceAll("_", " ");

// The project's agent team: who's on it, what each one is allowed to do, and what they're doing now.
export default async function AgentsPage() {
  const project = await getActiveProject();
  if (!project) redirect("/projects/new");
  const [team, scene] = await Promise.all([ensureTeam(project.id), getOfficeScene(project.officeId)]);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {team.map((agent) => {
        const seat = agent.desk !== null ? scene?.agents[agent.desk] : undefined;
        return (
          <article key={agent.id} className="flex flex-col rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border/60">
            <div className="flex items-start gap-3.5">
              <div className="flex size-16 shrink-0 items-end justify-center overflow-hidden rounded-2xl bg-accent/60">
                {seat ? (
                  <img src={seat.frames[0]} alt="" className="h-[115%] w-auto max-w-none translate-y-[8%] object-contain" />
                ) : (
                  <span className="self-center text-2xl font-bold text-accent-foreground">{agent.name[0]}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-bold tracking-tight">{agent.name}</h2>
                <p className="text-sm font-medium text-muted-foreground">{ROLE_LABELS[agent.role]}</p>
                <span className={cn("mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_STYLE[agent.status])}>
                  <span className={cn("size-1.5 rounded-full bg-current", agent.status === "working" && "animate-pulse")} />
                  {STATUS_LABELS[agent.status]}
                </span>
              </div>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-foreground/85">{agent.description}</p>

            <dl className="mt-4 grid gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <Cpu className="size-3.5" />
                <dt className="sr-only">Engine</dt>
                <dd>
                  {ENGINE_LABELS[agent.engine]}
                  {agent.model ? ` · ${agent.model}` : " · default model"}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <Armchair className="size-3.5" />
                <dt className="sr-only">Desk</dt>
                <dd>{agent.desk !== null ? `Desk ${agent.desk + 1}` : "No desk"}</dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-wrap gap-1.5">
              <ShieldCheck className="size-4 text-muted-foreground" aria-label="Permissions" />
              {agent.permissions.map((permission) => (
                <Badge key={permission} variant="outline" className="font-normal">
                  {permissionLabel(permission)}
                </Badge>
              ))}
            </div>

            <details className="group mt-auto pt-4">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-primary [&::-webkit-details-marker]:hidden">
                Instructions
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-2 rounded-xl bg-muted/60 p-3 text-xs leading-relaxed whitespace-pre-line text-muted-foreground">{agent.instructions}</p>
            </details>
          </article>
        );
      })}
    </div>
  );
}
