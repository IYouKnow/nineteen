import * as api from "@/lib/api";

import { useQueryClient } from "@tanstack/react-query";

import {
  GitBranch,
  Github,
  ExternalLink,
  GitCommitHorizontal,
  Clock,
  RefreshCw,
} from "lucide-react";
import FrameworkIcon from "@/components/dev/FrameworkIcon";
import StatusDot from "@/components/dev/StatusDot";
import { timeAgo, shortSha } from "@/lib/format";
import { getFramework } from "@/lib/devStatus";

const BRANCHES = ["main", "develop", "staging", "production"];

export default function ProjectSource({ project, deployments = [], environment, isProd = true, onBranchChange }) {
  const qc = useQueryClient();
  const fw = getFramework(project.framework);
  const repoOwner = project.repository?.split("/")[0] || "acme";
  const branch = isProd ? project.branch : environment?.branch;

  const changeBranch = (b) => {
    if (!isProd) {
      onBranchChange?.(b);
      return;
    }
    api.projects.update(project.id, { branch: b }).then(() => {
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    });
  };

  return (
    <div className="space-y-5">
      {/* Repository */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <FrameworkIcon framework={project.framework} size="lg" />
            <div>
              <p className="text-sm font-medium text-foreground">{project.repository || "No repository"}</p>
              <p className="text-xs text-muted-foreground">
                Detected as {fw.label} · connected to GitHub
              </p>
            </div>
          </div>
          {project.repository && (
            <a
              href={`https://github.com/${project.repository}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              <Github className="h-3.5 w-3.5" />
              Open
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {/* Branch */}
      <div className="rounded-lg border border-border bg-card p-4">
        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <GitBranch className="h-3.5 w-3.5" />
          {isProd ? "Production branch" : "Environment branch"}
        </label>
        <select
          value={branch || "main"}
          onChange={(e) => changeBranch(e.target.value)}
          className="mt-2 h-9 w-full rounded-md border border-input bg-background px-2.5 font-mono text-sm"
        >
          {BRANCHES.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <p className="mt-2 text-xs text-muted-foreground">
          Pushes to this branch trigger a new deployment.
        </p>
      </div>

      {/* Recent commits */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">Recent commits</h3>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <RefreshCw className="h-3 w-3" />
            live
          </span>
        </div>
        <div className="rounded-lg border border-border bg-card">
          {deployments.length === 0 ? (
            <div className="flex items-center justify-center px-6 py-10 text-sm text-muted-foreground">
              <GitCommitHorizontal className="mr-2 h-4 w-4 text-muted-foreground/50" />
              No commits deployed yet.
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {deployments.slice(0, 8).map((d) => (
                <div key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                  <StatusDot status={d.status} kind="deployment" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground/90">{d.commit_message}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {shortSha(d.commit_sha)} · {d.author}
                    </p>
                  </div>
                  <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
                    <Clock className="h-3 w-3" />
                    {timeAgo(d.created_date)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}