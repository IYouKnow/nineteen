import { Link } from "react-router-dom";
import {
  ExternalLink,
  Rocket,
  Clock,
  ArrowUpRight,
  KeyRound,
  HardDrive,
  Zap,
  Calendar,
  GitBranch,
  Cpu,
  MapPin,
} from "lucide-react";
import StatusDot from "@/components/dev/StatusDot";
import FrameworkIcon from "@/components/dev/FrameworkIcon";
import EmptyState from "@/components/dev/EmptyState";
import { Button } from "@/components/ui/button";
import { timeAgo, formatDate, formatDuration, shortSha } from "@/lib/format";
import { getFramework, INSTANCE_TYPES, REGIONS } from "@/lib/devStatus";
import { getEnvType } from "@/lib/environments";

function InfoTile({ icon: Icon, label, value, mono }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
        {label}
      </div>
      <p className={`mt-1.5 text-sm text-foreground/90 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

export default function ProjectOverview({ project, deployments = [], envVars = [], mounts = [], environment }) {
  const latest = deployments[0];
  const envType = environment ? getEnvType(environment.type) : null;
  const fw = getFramework(project.framework);
  const instance = INSTANCE_TYPES.find((i) => i.id === project.instance_type) || INSTANCE_TYPES[0];
  const region = REGIONS.find((r) => r.id === project.region) || REGIONS[0];

  return (
    <div className="space-y-5">
      {/* Status hero */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="relative">
          <div className="pointer-events-none absolute inset-0 bg-grid opacity-20" />
          <div className="relative flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-4">
              <FrameworkIcon framework={project.framework} size="lg" />
              <div>
                {envType && (
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: envType.color }} />
                    <span className="text-xs font-medium text-muted-foreground">
                      {environment.name} environment
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2.5">
                  <StatusDot status={project.status} className="h-2.5 w-2.5" />
                  <span className="text-lg font-semibold capitalize tracking-tight">
                    {project.status}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {fw.label} · {instance.label} ({instance.ram}) · {region.flag} {region.label}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {project.domain && (
                <Button asChild variant="outline" size="sm" className="gap-2">
                  <a href={`https://${project.domain}`} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                    {project.domain}
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Latest deployment */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">Latest deployment</h3>
          {latest && (
            <Link
              to={`/projects/${project.id}/deployments/${latest.id}`}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              View logs
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          )}
        </div>
        {latest ? (
          <Link
            to={`/projects/${project.id}/deployments/${latest.id}`}
            className="group flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-card/60"
          >
            <StatusDot status={latest.status} kind="deployment" className="h-2.5 w-2.5" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{latest.commit_message}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {shortSha(latest.commit_sha)} · {latest.author}
              </p>
            </div>
            <div className="hidden items-center gap-4 text-xs text-muted-foreground sm:flex">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {timeAgo(latest.created_date)}
              </span>
              <span className="flex items-center gap-1">
                <Zap className="h-3 w-3" />
                {formatDuration(latest.duration)}
              </span>
            </div>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground/40 transition group-hover:text-foreground" />
          </Link>
        ) : (
          <EmptyState
            icon={Rocket}
            title="No deployments yet"
            description="Trigger your first deployment to see it here."
            className="py-10"
          />
        )}
      </div>

      {/* Info grid */}
      <div>
        <h3 className="mb-2 text-sm font-medium">Details</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <InfoTile icon={GitBranch} label="Branch" value={environment?.branch || project.branch || "main"} mono />
          <InfoTile icon={Cpu} label="Instance" value={instance.label} />
          <InfoTile icon={MapPin} label="Region" value={region.label} />
          <InfoTile
            icon={Zap}
            label="Auto-deploy"
            value={project.auto_deploy ? "Enabled" : "Disabled"}
          />
          <InfoTile icon={KeyRound} label="Env variables" value={envVars.length} />
          <InfoTile icon={HardDrive} label="Mounts" value={mounts.length} />
          <InfoTile
            icon={Calendar}
            label="Created"
            value={formatDate(project.created_date, "MMM d, yyyy")}
          />
          <InfoTile
            icon={Rocket}
            label="Last deploy"
            value={timeAgo(project.last_deployed_at)}
          />
        </div>
      </div>
    </div>
  );
}