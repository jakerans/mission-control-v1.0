/* eslint-disable @next/next/no-img-element -- avatars are sprite frames served from our own API */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, GitBranch } from "lucide-react";
import { eq } from "drizzle-orm";
import { agents, db } from "@/db";
import { DEFAULT_MODEL } from "@/lib/agent-models";
import { ROLE_LABELS, STATUS_LABELS } from "@/lib/agents";
import { getAgentFeed } from "@/lib/feed";
import { getOfficeScene } from "@/lib/offices";
import { getActiveProject } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { AgentChat } from "@/components/agents/agent-chat";
import { ModelPicker } from "@/components/agents/model-picker";

type Props = { params: Promise<{ id: string }> };

async function findAgent(params: Props["params"]) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  return agent ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const agent = await findAgent(params);
  return { title: `${agent?.name ?? "Agent"} · Mission Control` };
}

const STATUS_DOT = {
  idle: "bg-muted-foreground/50",
  working: "bg-emerald-500 animate-pulse",
  blocked: "bg-red-500",
  needs_approval: "bg-amber-500 animate-pulse",
  offline: "bg-muted-foreground/30",
} as const;

// One agent: chat with the lead, or see what a team member is for.
export default async function AgentPage({ params }: Props) {
  const [agent, project] = await Promise.all([findAgent(params), getActiveProject()]);
  if (!project) redirect("/projects/new");
  if (!agent) notFound();
  // Switched projects while on another project's agent
  if (agent.projectId !== project.id) redirect("/dashboard/agents");

  const [feed, scene] = await Promise.all([getAgentFeed(agent.id), getOfficeScene(project.officeId)]);
  const avatarUrl = agent.desk !== null ? (scene?.agents[agent.desk]?.frames[0] ?? null) : null;
  const isLead = agent.role === "lead";

  return (
    <div className="flex h-[calc(100svh-6rem)] min-h-96 flex-col overflow-hidden rounded-3xl bg-card shadow-xl ring-1 ring-border/60">
      <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
        <Link href="/dashboard/agents" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="All agents">
          <ArrowLeft className="size-4" />
        </Link>
        <span className="flex size-10 shrink-0 items-end justify-center overflow-hidden rounded-full bg-accent">
          {avatarUrl ? <img src={avatarUrl} alt="" className="h-[125%] w-auto max-w-none translate-y-[10%]" /> : <span className="self-center font-bold">{agent.name[0]}</span>}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{agent.name}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", STATUS_DOT[feed!.status])} />
            {ROLE_LABELS[agent.role]} · {STATUS_LABELS[feed!.status]}
          </p>
        </div>
        <ModelPicker agentId={agent.id} model={agent.model ?? DEFAULT_MODEL} />
        {project.repoUrl && (
          <a
            href={project.repoUrl}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground hover:text-foreground sm:flex"
          >
            <GitBranch className="size-3.5" />
            {new URL(project.repoUrl).pathname.slice(1)}
          </a>
        )}
      </div>

      {isLead ? (
        <AgentChat
          agentId={agent.id}
          agentName={agent.name}
          avatarUrl={avatarUrl}
          initialFeed={feed!}
          blockedReason={project.repoPath ? undefined : "Link a code repository in Settings first."}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="max-w-md text-sm text-muted-foreground">{agent.description}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {agent.name} takes work from the lead once you approve a plan. Talk to the lead to get something started.
          </p>
        </div>
      )}
    </div>
  );
}
