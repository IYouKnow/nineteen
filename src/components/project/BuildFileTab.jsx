import * as api from "@/lib/api";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Check, Copy, FileCode2, FileText, Loader2, GitBranch, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const KIND_LABELS = { dockerfile: "Dockerfile", compose: "Docker Compose" };

export default function BuildFileTab({ project }) {
  const [copied, setCopied] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["buildfile", project.id],
    queryFn: () => api.projects.buildFile(project.id),
    retry: false,
  });

  const copy = async () => {
    if (!data?.content) return;
    try {
      await navigator.clipboard.writeText(data.content);
      setCopied(true);
      toast.success("Build file copied");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  const KindIcon = data?.kind === "compose" ? FileCode2 : FileText;
  const lineCount = data?.content ? data.content.split("\n").length : 0;
  const language = data?.kind === "compose" ? "YAML" : "Dockerfile";

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-medium">Build file</h3>
        <p className="text-xs text-muted-foreground">
          The Dockerfile or Docker Compose file currently used to build this project. Read-only for now.
        </p>
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
                <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
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
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={copy} className="gap-1.5">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          <div className="relative rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                {language}
              </span>
              {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
            <pre className="max-h-[520px] overflow-auto p-4 font-mono text-xs leading-relaxed text-foreground/90">
              <code>{data.content}</code>
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
