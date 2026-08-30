import db from '@/lib/db';

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import {
  FolderGit2,
  Rocket,
  Activity,
  CheckCircle2,
  ArrowUpRight,
  Plus,
  GitCommitHorizontal,
  Zap,
} from "lucide-react";
import StatusBadge from "@/components/dev/StatusBadge";
import StatusDot from "@/components/dev/StatusDot";
import FrameworkIcon from "@/components/dev/FrameworkIcon";
import EmptyState from "@/components/dev/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo, formatDuration, shortSha } from "@/lib/format";
import { getFramework } from "@/lib/devStatus";

function StatCard({ icon: Icon, label, value, sub, accent }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${accent || "text-muted-foreground/50"}`} />
      </div>
      <p className="mt-2.5 text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ProjectStatusCard({ project }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="group flex flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-card/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <FrameworkIcon framework={project.framework} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{project.name}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {project.repository || "no repository"}
            </p>
          </div>
        </div>
        <StatusBadge status={project.status} />
      </div>
      <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="font-mono">{getFramework(project.framework).label}</span>
        <span className="text-muted-foreground/30">·</span>
        <span className="font-mono">{project.branch || "main"}</span>
        <span className="ml-auto">{timeAgo(project.last_deployed_at)}</span>
      </div>
    </Link>
  );
}

function DeploymentRow({ deployment }) {
  return (
    <Link
      to={`/projects/${deployment.project_id}/deployments/${deployment.id}`}
      className="flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted/30"
    >
      <StatusDot status={deployment.status} kind="deployment" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground/90">{deployment.commit_message}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {deployment.project_name} · {shortSha(deployment.commit_sha)}
        </p>
      </div>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
        {timeAgo(deployment.created_date)}
      </span>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition group-hover:text-foreground" />
    </Link>
  );
}

export default function Dashboard() {
  const { data: projects, isLoading, isError } = useQuery({
    queryKey: ["projects"],
    queryFn: () => db.entities.Project.list("-created_date", 100),
    enabled: true,
  });

  const { data: deployments } = useQuery({
    queryKey: ["deployments-recent"],
    queryFn: () => db.entities.Deployment.list("-created_date", 30),
    enabled: true,
  });

  const list = projects || [];
  const deploys = deployments || [];
  const running = list.filter((p) => p.status === "running").length;
  const building = list.filter((p) => p.status === "building").length;
  const errored = list.filter((p) => p.status === "error").length;
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recent = deploys.filter((d) => new Date(d.created_date).getTime() > dayAgo);
  const ready = deploys.filter((d) => d.status === "ready" && d.duration != null);
  const avgBuild =
    ready.length > 0
      ? Math.round(ready.reduce((a, d) => a + d.duration, 0) / ready.length)
      : null;
  const successRate = deploys.length
    ? Math.round((deploys.filter((d) => d.status === "ready").length / deploys.length) * 100)
    : null;

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-grid bg-grid-fade opacity-40" />
      <div className="relative mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Monitor your projects, deployments and cluster health.
            </p>
          </div>
          <Button asChild className="gap-2">
            <Link to="/projects/new">
              <Plus className="h-4 w-4" />
              New Project
            </Link>
          </Button>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[110px] rounded-lg" />
            ))
          ) : (
            <>
              <StatCard
                icon={FolderGit2}
                label="Projects"
                value={list.length}
                sub={`${running} running · ${building} building`}
              />
              <StatCard
                icon={Rocket}
                label="Deployments / 24h"
                value={recent.length}
                sub={`${deploys.length} total`}
                accent="text-info"
              />
              <StatCard
                icon={Zap}
                label="Avg build"
                value={avgBuild != null ? formatDuration(avgBuild) : "—"}
                sub={successRate != null ? `${successRate}% success` : "no data"}
                accent="text-success"
              />
              <StatCard
                icon={Activity}
                label="Cluster"
                value={errored > 0 ? "Degraded" : "Healthy"}
                sub={errored > 0 ? `${errored} errors` : "all systems go"}
                accent={errored > 0 ? "text-destructive" : "text-success"}
              />
            </>
          )}
        </div>

        <section className="mt-9">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">Projects</h2>
            <Link
              to="/projects"
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              View all
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[104px] rounded-lg" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <EmptyState
              icon={FolderGit2}
              title="No projects yet"
              description="Import a repository from GitHub to deploy your first project."
              action={
                <Button asChild className="gap-2">
                  <Link to="/projects/new">
                    <Plus className="h-4 w-4" />
                    New Project
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.slice(0, 6).map((p) => (
                <ProjectStatusCard key={p.id} project={p} />
              ))}
            </div>
          )}
        </section>

        <section className="mt-9">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">Recent deployments</h2>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <GitCommitHorizontal className="h-3.5 w-3.5" />
              {deploys.length} total
            </span>
          </div>
          <div className="rounded-lg border border-border bg-card">
            {!deployments ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-md" />
                ))}
              </div>
            ) : deploys.length === 0 ? (
              <div className="flex items-center justify-center px-6 py-12 text-sm text-muted-foreground">
                <CheckCircle2 className="mr-2 h-4 w-4 text-muted-foreground/50" />
                No deployments yet.
              </div>
            ) : (
              <div className="divide-y divide-border/60 p-1">
                {deploys.slice(0, 8).map((d) => (
                  <DeploymentRow key={d.id} deployment={d} />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}