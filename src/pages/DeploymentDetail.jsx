const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import {
  ArrowLeft,
  ExternalLink,
  GitCommitHorizontal,
  User,
  Clock,
  Timer,
  GitBranch,
  Rocket,
  MapPin,
  Cpu,
  Globe,
} from "lucide-react";
import StatusBadge from "@/components/dev/StatusBadge";
import FrameworkIcon from "@/components/dev/FrameworkIcon";
import BuildLog from "@/components/dev/BuildLog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo, formatDate, formatDuration, shortSha } from "@/lib/format";
import { getFramework } from "@/lib/devStatus";

function Meta({ icon: Icon, label, value, mono }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
        {label}
      </span>
      <span className={`text-right text-xs text-foreground/90 ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

export default function DeploymentDetail() {
  const { projectId, deploymentId } = useParams();

  const { data: deployment, isLoading } = useQuery({
    queryKey: ["deployment", deploymentId],
    queryFn: () => db.entities.Deployment.get(deploymentId),
  });

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => db.entities.Project.get(projectId),
  });

  if (isLoading || !deployment) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-4 h-24 w-full rounded-lg" />
        <Skeleton className="mt-4 h-[440px] w-full rounded-lg" />
      </div>
    );
  }

  const fw = getFramework(project?.framework || deployment.framework);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <Link
        to={`/projects/${projectId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {project?.name || "project"}
      </Link>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <FrameworkIcon framework={project?.framework} size="lg" />
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-mono text-lg font-semibold tracking-tight">
                {shortSha(deployment.commit_sha)}
              </h1>
              <StatusBadge status={deployment.status} kind="deployment" />
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{deployment.commit_message}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {deployment.url && (
            <Button asChild variant="outline" size="sm" className="gap-2">
              <a href={deployment.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </a>
            </Button>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_280px]">
        <BuildLog deployment={deployment} project={project} />

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
              Deployment
            </h3>
            <div className="mt-1 divide-y divide-border/60">
              <Meta icon={Rocket} label="Project" value={deployment.project_name || project?.name} />
              <Meta icon={GitBranch} label="Branch" value={deployment.branch || "—"} mono />
              <Meta icon={GitCommitHorizontal} label="Commit" value={shortSha(deployment.commit_sha)} mono />
              <Meta icon={User} label="Author" value={deployment.author || "—"} />
              <Meta icon={Clock} label="Created" value={timeAgo(deployment.created_date)} />
              <Meta icon={Timer} label="Duration" value={formatDuration(deployment.duration)} />
            </div>
          </div>

          {project && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
                Runtime
              </h3>
              <div className="mt-1 divide-y divide-border/60">
                <Meta icon={Cpu} label="Instance" value={`${project.instance_type}`} mono />
                <Meta icon={MapPin} label="Region" value={project.region} mono />
                <Meta icon={Globe} label="Domain" value={project.domain} mono />
              </div>
              <Button asChild variant="outline" size="sm" className="mt-3 w-full gap-2">
                <Link to={`/projects/${projectId}`}>
                  View project
                </Link>
              </Button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}