import * as api from "@/lib/api";

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  Rocket,
  Loader2,
  GitBranch,
  Tag,
  GitCommitHorizontal,
  Wand2,
  AlertCircle,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { shortSha, timeAgo } from "@/lib/format";

const SOURCES = [
  { id: "default", label: "Project default", icon: Wand2 },
  { id: "branch", label: "Branch", icon: GitBranch },
  { id: "tag", label: "Release / tag", icon: Tag },
  { id: "commit", label: "Commit", icon: GitCommitHorizontal },
];

function SourceButton({ source, active, onClick }) {
  const Icon = source.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors",
        active
          ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary"
          : "border-border bg-card text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground"
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", active ? "text-primary" : "text-muted-foreground")} />
      {source.label}
    </button>
  );
}

// DeployDialog lets the user pick what to deploy — the project's configured
// target, a branch, a release/tag, or a specific commit — and starts a one-off
// deployment. Choosing a ref does not change the project's configured target.
export default function DeployDialog({ project, open, onOpenChange }) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [source, setSource] = useState("default");
  const [ref, setRef] = useState("");
  const [branch, setBranch] = useState("");
  const [note, setNote] = useState("");

  const isBuilding = project?.status === "building";

  const defaultTarget =
    project?.deploy_type === "release" && project?.deploy_ref
      ? project.deploy_ref
      : project?.branch || "main";

  const { data: refs, isLoading: refsLoading, error: refsError } = useQuery({
    queryKey: ["project-refs", project?.id],
    queryFn: () => api.projects.refs(project.id),
    enabled: !!project?.id && open && source !== "default",
    staleTime: 60_000,
  });

  const branches = refs?.branches || [];
  const versions = refs?.versions || [];

  // Reset the picker whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setSource("default");
      setRef("");
      setNote("");
      setBranch("");
    }
  }, [open]);

  // Preselect a sensible branch for commit mode once branches load.
  useEffect(() => {
    if (source !== "commit" || branch) return;
    if (!branches.length) return;
    const preferred = branches.find((b) => b.name === project?.branch) || branches[0];
    setBranch(preferred.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, branches, project?.branch]);

  // Preselect the latest version for tag mode.
  useEffect(() => {
    if (source === "tag" && !ref && versions.length) {
      setRef(versions[0].tag_name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, versions]);

  const { data: commits = [], isLoading: commitsLoading } = useQuery({
    queryKey: ["project-commits", project?.id, branch],
    queryFn: () => api.projects.commits(project.id, branch),
    enabled: !!project?.id && open && source === "commit" && !!branch,
    staleTime: 30_000,
  });

  const selectedRef = useMemo(() => {
    if (source === "default") return "";
    return ref;
  }, [source, ref]);

  const canDeploy = !isBuilding && (source === "default" || !!selectedRef);

  const deployMutation = useMutation({
    mutationFn: () =>
      api.deployments.create(project.id, {
        source,
        ref: selectedRef,
        commit_message: note.trim() || undefined,
        author: "you",
        trigger: "manual",
      }),
    onSuccess: (deployment) => {
      qc.invalidateQueries({ queryKey: ["deployments", project.id] });
      qc.invalidateQueries({ queryKey: ["deployments-recent"] });
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      onOpenChange(false);
      toast.success("Deployment started");
      navigate(`/projects/${project.id}/deployments/${deployment.id}`);
    },
    onError: (err) => {
      toast.error("Could not start deployment", { description: err?.message });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Deploy {project?.name}</DialogTitle>
          <DialogDescription>
            Choose what to build and run. This is a one-off deploy and does not change the
            project&apos;s configured target.
          </DialogDescription>
        </DialogHeader>

        {isBuilding && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            A deployment is already in progress. Wait for it to finish or cancel it first.
          </div>
        )}

        <div>
          <Label className="text-xs text-muted-foreground">Deploy from</Label>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SOURCES.map((s) => (
              <SourceButton
                key={s.id}
                source={s}
                active={source === s.id}
                onClick={() => {
                  setSource(s.id);
                  setRef("");
                  setBranch("");
                }}
              />
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/15 p-4">
          {source === "default" && (
            <p className="text-xs text-muted-foreground">
              Deploys the project&apos;s configured target:{" "}
              <span className="font-mono text-foreground">{defaultTarget}</span>.
            </p>
          )}

          {source !== "default" && refsError && (
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {refsError.message || "Could not load the repository refs."}
            </div>
          )}

          {source === "branch" && !refsError && (
            <div>
              <Label className="text-xs">Branch</Label>
              <Select value={ref || undefined} onValueChange={setRef} disabled={refsLoading}>
                <SelectTrigger className="mt-1.5 h-9 gap-2 bg-card font-mono text-xs">
                  <SelectValue placeholder={refsLoading ? "Loading branches…" : "Select a branch"} />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {branches.map((b) => (
                    <SelectItem key={b.name} value={b.name} className="font-mono text-xs">
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {source === "tag" && !refsError && (
            <div>
              <Label className="text-xs">Release / tag</Label>
              <Select value={ref || undefined} onValueChange={setRef} disabled={refsLoading}>
                <SelectTrigger className="mt-1.5 h-9 gap-2 bg-card font-mono text-xs">
                  <SelectValue
                    placeholder={refsLoading ? "Loading versions…" : "Select a release or tag"}
                  />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {versions.map((v) => (
                    <SelectItem key={v.tag_name} value={v.tag_name} className="font-mono text-xs">
                      {v.tag_name}
                      {v.name && v.name !== v.tag_name ? ` — ${v.name}` : ""}
                      {v.is_release ? "" : "  (tag)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {versions.length === 0 && !refsLoading && (
                <p className="mt-2 text-xs text-muted-foreground">
                  No releases or tags found in this repository.
                </p>
              )}
            </div>
          )}

          {source === "commit" && !refsError && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Branch</Label>
                <Select
                  value={branch || undefined}
                  onValueChange={(v) => {
                    setBranch(v);
                    setRef("");
                  }}
                  disabled={refsLoading}
                >
                  <SelectTrigger className="mt-1.5 h-9 gap-2 bg-card font-mono text-xs">
                    <SelectValue placeholder={refsLoading ? "Loading branches…" : "Select a branch"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {branches.map((b) => (
                      <SelectItem key={b.name} value={b.name} className="font-mono text-xs">
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Commit</Label>
                <div className="mt-1.5 max-h-56 overflow-y-auto rounded-md border border-border bg-card">
                  {commitsLoading ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading commits…
                    </div>
                  ) : commits.length === 0 ? (
                    <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                      No commits found.
                    </div>
                  ) : (
                    <div className="divide-y divide-border/60">
                      {commits.map((c) => {
                        const active = ref === c.sha;
                        return (
                          <button
                            key={c.sha}
                            type="button"
                            onClick={() => setRef(c.sha)}
                            className={cn(
                              "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors",
                              active ? "bg-primary/5" : "hover:bg-muted/40"
                            )}
                          >
                            <span
                              className={cn(
                                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                                active
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-muted-foreground/40"
                              )}
                            >
                              {active && <Check className="h-3 w-3" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs text-foreground/90">
                                {c.message || "(no message)"}
                              </span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                                <span>{shortSha(c.sha)}</span>
                                {c.author && <span>{c.author}</span>}
                                {c.date && <span>{timeAgo(c.date)}</span>}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Note (optional)</Label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why are you deploying this?"
            className="mt-1.5 h-9 text-sm"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deployMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => deployMutation.mutate()}
            disabled={!canDeploy || deployMutation.isPending}
            className="gap-2"
          >
            {deployMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            Deploy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
