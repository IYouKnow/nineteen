import * as api from "@/lib/api";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Check,
  Copy,
  FileCode2,
  FileText,
  GitBranch,
  Loader2,
  Pencil,
  RefreshCw,
  Rocket,
  RotateCcw,
  Save,
  XCircle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, copyText } from "@/lib/utils";

const KIND_LABELS = { dockerfile: "Dockerfile", compose: "Docker Compose" };

export default function BuildFileTab({ project }) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["buildfile", project.id],
    queryFn: () => api.projects.buildFile(project.id),
    retry: false,
  });

  useEffect(() => {
    if (data && data.content != null) setDraft(data.content);
    if (data && !data.overridden) setEditing(false);
  }, [data]);

  const copy = async () => {
    if (!draft) return;
    const ok = await copyText(draft);
    if (ok) {
      setCopied(true);
      toast.success("Build file copied");
      setTimeout(() => setCopied(false), 1600);
    } else {
      toast.error("Could not copy to clipboard");
    }
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["buildfile", project.id] });
    qc.invalidateQueries({ queryKey: ["project", project.id] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const save = async (oneShot) => {
    if (!draft.trim()) return;
    setBusy(oneShot ? "deploy" : "save");
    try {
      const saved = await api.projects.buildFileSave(project.id, { content: draft, one_shot: oneShot });
      invalidate();
      if (oneShot) {
        toast.success("Deploying with this file…", {
          description: "The edit is used for this deployment only, then reset.",
        });
        const deployment = await api.deployments.create(project.id, {
          commit_message: "Deploy with edited build file",
          branch: project.branch || "main",
          author: "you",
          trigger: "manual",
        });
        setEditing(false);
        navigate(`/projects/${project.id}/deployments/${deployment.id}`);
      } else {
        toast.success("Build file saved", {
          description: saved?.path
            ? "Future deploys will use this version until you reset."
            : undefined,
        });
        setEditing(false);
      }
    } catch (e) {
      toast.error(oneShot ? "Could not deploy" : "Could not save", { description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    setBusy("reset");
    try {
      await api.projects.buildFileReset(project.id);
      invalidate();
      setEditing(false);
      toast.success("Reverted to the repository file");
    } catch (e) {
      toast.error("Could not reset", { description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const KindIcon = data?.kind === "compose" ? FileCode2 : FileText;
  const language = data?.kind === "compose" ? "YAML" : "Dockerfile";
  const lineCount = draft ? draft.split("\n").length : 0;
  const dirty = data && draft !== data.content;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Build file</h3>
          <p className="text-xs text-muted-foreground">
            The file used to build this project. Edit it to test something without committing to git.
          </p>
        </div>
        {data && (
          <Button variant="outline" size="sm" onClick={() => setEditing((e) => !e)} className="gap-1.5">
            {editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            {editing ? "Cancel" : "Edit"}
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <XCircle className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium text-foreground">Could not load the build file</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            {error?.message || "The file may not exist in this branch, or the repository is unreachable."}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-4 gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      )}

      {data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30">
                <KindIcon className="h-4 w-4 text-muted-foreground" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-foreground">{data.path}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                      data.kind === "compose" ? "bg-blue-500/10 text-blue-500" : "bg-emerald-500/10 text-emerald-500"
                    )}
                  >
                    {KIND_LABELS[data.kind] || data.kind}
                  </span>
                  <span className="flex items-center gap-1">
                    <GitBranch className="h-3 w-3" />
                    {data.branch}
                  </span>
                  <span>{lineCount} lines</span>
                  {data.overridden && (
                    <span className="flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-500">
                      <RotateCcw className="h-3 w-3" />
                      {data.one_shot ? "one-shot edit" : "edited"}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!editing && (
                <Button variant="outline" size="sm" onClick={copy} className="gap-1.5">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              )}
              {!editing && data.overridden && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={reset}
                  disabled={busy !== null}
                  className="gap-1.5 text-destructive hover:border-destructive/40 hover:text-destructive"
                >
                  {busy === "reset" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  Reset to repo
                </Button>
              )}
            </div>
          </div>

          <div className="relative rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                {language}
              </span>
              {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>

            {editing ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                className="block min-h-[360px] w-full resize-y bg-transparent p-4 font-mono text-xs leading-relaxed text-foreground outline-none"
                placeholder="Paste the Dockerfile / compose content here…"
              />
            ) : (
              <pre className="max-h-[520px] overflow-auto p-4 font-mono text-xs leading-relaxed text-foreground/90">
                <code>{data.content}</code>
              </pre>
            )}
          </div>

          {editing && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
              <p className="text-xs text-muted-foreground">
                {dirty
                  ? "You have unsaved changes. Save to use across future deploys, or apply once and deploy now."
                  : "No changes yet. Edit the file below."}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy !== null}>
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => save(false)}
                  disabled={!draft.trim() || busy !== null || !dirty}
                  className="gap-1.5"
                >
                  {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save
                </Button>
                <Button
                  size="sm"
                  onClick={() => save(true)}
                  disabled={!draft.trim() || busy !== null}
                  className="gap-1.5"
                >
                  {busy === "deploy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                  {busy === "deploy" ? "Deploying…" : "Save & deploy once"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
