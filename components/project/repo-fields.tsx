"use client";

import { useEffect, useState, useTransition } from "react";
import { CircleAlert, CircleCheck, GitBranch } from "lucide-react";
import { checkRepo } from "@/app/projects/actions";
import type { RepoInfo } from "@/lib/repos";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type Props = {
  repoPath: string;
  onRepoPathChange: (value: string) => void;
  devUrl: string;
  onDevUrlChange: (value: string) => void;
};

const inputClass = "h-12 rounded-xl px-4 text-base md:text-sm";

// The code-repository folder and dev-site fields. The folder is checked as you type (debounced), so
// you see the remote and main branch it found before saving.
export function RepoFields({ repoPath, onRepoPathChange, devUrl, onDevUrlChange }: Props) {
  const [result, setResult] = useState<{ path: string; repo?: RepoInfo; error?: string }>();
  const [checking, startCheck] = useTransition();
  const trimmed = repoPath.trim();

  useEffect(() => {
    if (!trimmed) return;
    const timer = window.setTimeout(() => {
      startCheck(async () => setResult({ path: trimmed, ...(await checkRepo(trimmed)) }));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [trimmed]);

  // Only show a result for the value currently in the box
  const current = result?.path === trimmed ? result : undefined;

  return (
    <>
      <Field>
        <FieldLabel htmlFor="repo-path" className="font-semibold">
          Repository folder
        </FieldLabel>
        <Input
          id="repo-path"
          name="repoPath"
          value={repoPath}
          onChange={(e) => onRepoPathChange(e.target.value)}
          placeholder="C:\Users\you\Herd\my-app"
          autoComplete="off"
          spellCheck={false}
          className={inputClass}
        />
        {trimmed && (checking || !current) ? (
          <FieldDescription className="flex items-center gap-1.5">
            <Spinner className="size-3.5" /> Checking…
          </FieldDescription>
        ) : current?.repo ? (
          <FieldDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <CircleCheck className="size-3.5 text-primary" />
              {current.repo.slug ?? "Local repository (no remote)"}
            </span>
            <span className="flex items-center gap-1">
              <GitBranch className="size-3.5" />
              {current.repo.defaultBranch}
            </span>
          </FieldDescription>
        ) : current?.error ? (
          <FieldDescription className="flex items-center gap-1.5 text-destructive">
            <CircleAlert className="size-3.5" />
            {current.error}
          </FieldDescription>
        ) : (
          <FieldDescription>The local git checkout your agents work on. Each agent gets its own copy, so this folder stays untouched.</FieldDescription>
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor="dev-url" className="font-semibold">
          Dev site <span className="font-normal text-muted-foreground">(optional)</span>
        </FieldLabel>
        <Input
          id="dev-url"
          name="devUrl"
          value={devUrl}
          onChange={(e) => onDevUrlChange(e.target.value)}
          placeholder="https://dev.example.com"
          autoComplete="off"
          spellCheck={false}
          className={inputClass}
        />
        <FieldDescription>Where merged work shows up for testing, e.g. the site your main branch deploys to.</FieldDescription>
      </Field>
    </>
  );
}
