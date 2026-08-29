const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { Rocket, Loader2, GitCommitHorizontal, Clock, Zap, GitBranch, RotateCw } from "lucide-react";
import StatusDot from "@/components/dev/StatusDot";
import EmptyState from "@/components/dev/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo, formatDuration, shortSha } from "@/lib/format";
import { randomSha } from "@/lib/format";

const TRIGGER_LABEL = {
  git: "git push",
  manual: "manual",
  redeploy: "redeploy",
};

export default function ProjectDeployments({ project, deployments = [], environment, isProd = true, onDeploy }) {
  const qc = useQueryClient();
  const [deploying, setDeploying] = useState(false);

  const deploy = async () => {
    if (!isProd) {
      onDeploy?.();
      return;
    }
    setDeploying(true);
    try {
      const sha = randomSha();
      const deployment = await db.entities.Deployment.create({
        project_id: project.id,
        project_name: project.name,
        status: "building",
        commit_sha: sha,
        commit_message: "Manual deployment from dashboard",
        branch: project.branch || "main",
        author: "you",
        trigger: "manual",
      });
      await db.entities.Project.update(project.id, {
        status: "building",
        last_deployed_at: new Date().toISOString(),
      });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["deployments", project.id] });
      qc.invalidateQueries({ queryKey: ["deployments-recent"] });
      window.location.href = `/projects/${project.id}/deployments/${deployment.id}`;
    } catch (e) {
      console.error(e);
      setDeploying(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Deployment history</h3>
          <p className="text-xs text-muted-foreground">
            {deployments.length} deployment{deployments.length === 1 ? "" : "s"} for this project
          </p>
        </div>
        <Button onClick={deploy} disabled={deploying} size="sm" className="gap-2">
          {deploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
          Deploy now
        </Button>
      </div>

      {deployments.length === 0 ? (
        <EmptyState
          icon={GitCommitHorizontal}
          title="No deployments yet"
          description="Trigger your first deployment to start building."
          action={
            <Button onClick={deploy} disabled={deploying} size="sm" className="gap-2">
              {deploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
              Deploy now
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <div className="divide-y divide-border/60">
            {deployments.map((d) => {
              const inner = (
                <>
                  <StatusDot status={d.status} kind="deployment" className="h-2.5 w-2.5" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground/90">{d.commit_message}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs text-muted-foreground">
                      <span className="text-foreground/70">{shortSha(d.commit_sha)}</span>
                      <span className="flex items-center gap-1">
                        <GitBranch className="h-3 w-3" />
                        {d.branch}
                      </span>
                      <span>{d.author}</span>
                    </div>
                  </div>
                  <span className="hidden rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
                    {TRIGGER_LABEL[d.trigger] || d.trigger}
                  </span>
                  <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
                    <Zap className="h-3 w-3" />
                    {formatDuration(d.duration)}
                  </span>
                  <span className="hidden items-center gap-1 text-xs text-muted-foreground md:flex">
                    <Clock className="h-3 w-3" />
                    {timeAgo(d.created_date)}
                  </span>
                </>
              );
              return isProd ? (
                <Link
                  key={d.id}
                  to={`/projects/${project.id}/deployments/${d.id}`}
                  className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
                >
                  {inner}
                </Link>
              ) : (
                <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                  {inner}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}