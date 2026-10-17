"use client";

import { useActionState, useState } from "react";
import { Check } from "lucide-react";
import { updateProjectSettings, type ProjectSettingsState } from "@/app/projects/actions";
import { RepoFields } from "@/components/project/repo-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type Props = { projectId: number; name: string; repoPath: string | null; devUrl: string | null };

export function ProjectSettingsForm({ projectId, name: initialName, repoPath: initialRepoPath, devUrl: initialDevUrl }: Props) {
  const [name, setName] = useState(initialName);
  const [repoPath, setRepoPath] = useState(initialRepoPath ?? "");
  const [devUrl, setDevUrl] = useState(initialDevUrl ?? "");
  const [state, formAction, pending] = useActionState<ProjectSettingsState, FormData>(updateProjectSettings.bind(null, projectId), {});

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <Field>
        <FieldLabel htmlFor="project-name" className="font-semibold">
          Project name
        </FieldLabel>
        <Input id="project-name" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-12 rounded-xl px-4 text-base md:text-sm" />
      </Field>

      <RepoFields repoPath={repoPath} onRepoPathChange={setRepoPath} devUrl={devUrl} onDevUrlChange={setDevUrl} />

      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-end gap-3">
        {state.saved && !pending && (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Check className="size-4 text-primary" /> Saved
          </span>
        )}
        <Button type="submit" size="lg" disabled={pending} className="h-11 min-w-32 rounded-xl px-6">
          {pending && <Spinner />}
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
