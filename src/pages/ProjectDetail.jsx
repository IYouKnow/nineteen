import db from '@/lib/db';
import * as api from "@/lib/api";

import { useEffect, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ExternalLink,
  MoreHorizontal,
  RotateCw,
  Play,
  Square,
  Trash2,
  Loader2,
  Settings as SettingsIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import FrameworkIcon from "@/components/dev/FrameworkIcon";
import StatusBadge from "@/components/dev/StatusBadge";
import ConfirmDialog from "@/components/dev/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import ProjectOverview from "@/components/project/ProjectOverview";
import ProjectDeployments from "@/components/project/ProjectDeployments";
import ProjectSource from "@/components/project/ProjectSource";
import ProjectSettings from "@/components/project/ProjectSettings";
import BuildFileTab from "@/components/project/BuildFileTab";
import ProjectDatabases from "@/components/project/ProjectDatabases";
import ProjectStrategy from "@/components/project/ProjectStrategy";
import ProjectArchitecture from "@/components/project/ProjectArchitecture";
import ProjectLogs from "@/components/project/ProjectLogs";
import EnvironmentsTab from "@/components/project/EnvironmentsTab";
import EnvironmentSelector from "@/components/project/EnvironmentSelector";
import EnvArchitecture from "@/components/project/EnvArchitecture";
import EnvDatabases from "@/components/project/EnvDatabases";
import { randomSha } from "@/lib/format";
import { projectAddress } from "@/lib/devStatus";
import { cn } from "@/lib/utils";
import {
  defaultEnvironments,
  isProductionEnv,
  mockVariables,
  mockDeployments,
  makeMockConnection,
} from "@/lib/environments";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "deployments", label: "Deployments" },
  { id: "logs", label: "Logs" },
  { id: "strategy", label: "Strategy", disabled: true },
  { id: "source", label: "Source" },
  { id: "buildfile", label: "Build file" },
  { id: "architecture", label: "Architecture", disabled: true },
  { id: "databases", label: "Databases", disabled: true },
  { id: "environments", label: "Environments", disabled: true },
  { id: "settings", label: "Settings" },
];

export default function ProjectDetail() {
  const { projectId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(null);
  const requestedTab = searchParams.get("tab") || "overview";
  const requestedTabDef = TABS.find((t) => t.id === requestedTab);
  const tab = requestedTabDef?.disabled ? "overview" : (requestedTabDef?.id || "overview");

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.projects.get(projectId),
    refetchInterval: (query) =>
      ["building", "restarting"].includes(query.state.data?.status) ? 1500 : false,
  });

  const { data: deployments = [] } = useQuery({
    queryKey: ["deployments", projectId],
    queryFn: () => api.deployments.list(projectId),
  });

  const latestDeployment = deployments[0];
  const liveUrl = project ? projectAddress(project) : (latestDeployment?.url || "");
  const isRunning = project?.status === "running";

  const { data: envVars = [] } = useQuery({
    queryKey: ["envvars", projectId],
    queryFn: () => api.envVars.list(projectId),
  });

  const { data: mounts = [] } = useQuery({
    queryKey: ["mounts", projectId],
    queryFn: () => db.entities.Mount.filter({ project_id: projectId }),
  });

  // --- Environments (frontend mock layer) ---
  const [environments, setEnvironments] = useState([]);
  const [envOverrides, setEnvOverrides] = useState({});

  useEffect(() => {
    if (project && environments.length === 0) {
      setEnvironments(defaultEnvironments(project));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const urlEnv = searchParams.get("env");
  const selectedEnvId =
    (urlEnv && environments.find((e) => e.id === urlEnv) ? urlEnv : environments[0]?.id) || null;
  const environment = environments.find((e) => e.id === selectedEnvId) || null;
  const isProd = isProductionEnv(environment);

  const setEnv = (id) => {
    const next = new URLSearchParams(searchParams);
    if (id === environments[0]?.id) next.delete("env");
    else next.set("env", id);
    setSearchParams(next);
  };
  const setTab = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", id);
    setSearchParams(next);
  };
  const openEnv = (id, t) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", t);
    if (id === environments[0]?.id) next.delete("env");
    else next.set("env", id);
    setSearchParams(next);
  };

  const createEnv = ({ name, type, branch }) => {
    const id = `env-${Date.now()}`;
    const env = { id, name, type, branch: branch || "main", status: "running" };
    setEnvironments((e) => [...e, env]);
    setEnvOverrides((o) => ({
      ...o,
      [id]: { variables: mockVariables(env), connections: [], deployments: mockDeployments(env) },
    }));
  };
  const deleteEnv = (id) => {
    setEnvironments((e) => e.filter((x) => x.id !== id));
    setEnvOverrides((o) => {
      const n = { ...o };
      delete n[id];
      return n;
    });
    if (id === selectedEnvId) {
      const next = new URLSearchParams(searchParams);
      next.delete("env");
      setSearchParams(next);
    }
  };

  // env-scoped data
  const override = environment ? envOverrides[environment.id] : null;
  const envDeployments = isProd ? deployments : override?.deployments || [];
  const envVariables = isProd ? envVars : override?.variables || [];
  const envConnections = isProd ? [] : override?.connections || [];

  // mock mutations
  const onBranchChange = (branch) => {
    if (isProd) return;
    setEnvironments((e) => e.map((x) => (x.id === environment.id ? { ...x, branch } : x)));
  };
  const onDeployMock = () => {
    if (isProd) return;
    const dep = {
      id: `dep-${environment.id}-${Date.now()}`,
      status: "ready",
      commit_sha: randomSha(),
      commit_message: "Manual deployment",
      branch: environment.branch || "main",
      author: "you",
      trigger: "manual",
      duration: 31,
      created_date: new Date().toISOString(),
    };
    setEnvOverrides((o) => {
      const cur = o[environment.id] || {};
      return { ...o, [environment.id]: { ...cur, deployments: [dep, ...(cur.deployments || [])] } };
    });
  };
  const onVarAdd = (v) =>
    setEnvOverrides((o) => {
      const cur = o[environment.id] || {};
      return {
        ...o,
        [environment.id]: { ...cur, variables: [...(cur.variables || []), { id: `var-${environment.id}-${Date.now()}`, ...v }] },
      };
    });
  const onVarUpdate = (id, patch) =>
    setEnvOverrides((o) => {
      const cur = o[environment.id] || {};
      return { ...o, [environment.id]: { ...cur, variables: (cur.variables || []).map((v) => (v.id === id ? { ...v, ...patch } : v)) } };
    });
  const onVarDelete = (id) =>
    setEnvOverrides((o) => {
      const cur = o[environment.id] || {};
      return { ...o, [environment.id]: { ...cur, variables: (cur.variables || []).filter((v) => v.id !== id) } };
    });
  const onConnAdd = (items) => {
    if (isProd) return;
    const conns = items.map((it) =>
      makeMockConnection(it.db, it.scope.mode === "tables" ? "tables" : "all", it.scope.tables || [])
    );
    setEnvOverrides((o) => {
      const cur = o[environment.id] || {};
      return { ...o, [environment.id]: { ...cur, connections: [...(cur.connections || []), ...conns] } };
    });
  };
  const onConnDelete = (conn) =>
    setEnvOverrides((o) => {
      const cur = o[environment.id] || {};
      return { ...o, [environment.id]: { ...cur, connections: (cur.connections || []).filter((c) => c.id !== conn.id) } };
    });

  const run = async (action) => {
    const labels = { start: "Start", stop: "Stop", restart: "Restart" };
    setBusy(action);
    try {
      await api.projects.action(project.id, action);
      if (action === "restart") {
        toast.success("Restarting project…", { description: "It will go back to running when ready." });
      } else {
        toast.success(`${labels[action]} successful`);
      }
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["deployments", projectId] });
    } catch (e) {
      toast.error(`${labels[action]} failed`, { description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    await api.projects.delete(project.id);
    if (envVars.length) await db.entities.EnvironmentVariable.deleteMany({ project_id: projectId });
    if (mounts.length) await db.entities.Mount.deleteMany({ project_id: projectId });
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["deployments-recent"] });
    navigate("/projects");
  };

  if (isLoading || !project) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-24 w-full rounded-lg" />
        <Skeleton className="mt-4 h-10 w-full rounded-md" />
        <Skeleton className="mt-4 h-64 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <FrameworkIcon framework={project.framework} size="lg" />
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="truncate text-xl font-semibold tracking-tight">{project.name}</h1>
              <StatusBadge status={project.status} />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-muted-foreground">
              {project.repository && (
                <a
                  href={`https://github.com/${project.repository}`}
                  target="_blank"
                  rel="noreferrer"
                  className="transition-colors hover:text-foreground"
                >
                  {project.repository}
                </a>
              )}
              <span className="text-muted-foreground/30">·</span>
              <span>{isProd ? project.branch || "main" : environment?.branch || "main"}</span>
              {liveUrl && (
                <>
                  <span className="text-muted-foreground/30">·</span>
                  <span>{liveUrl}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {environments.length > 0 && (
            <EnvironmentSelector
              environments={environments}
              selectedEnvId={selectedEnvId}
              onSelect={setEnv}
              onManage={() => setTab("environments")}
            />
          )}
          <Button variant="outline" size="sm" onClick={() => run("start")} disabled={!!busy} className="gap-1.5">
            {busy === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Start
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => run("restart")}
            disabled={!isRunning || !!busy}
            className="gap-1.5"
          >
            {busy === "restart" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
            {busy === "restart" ? "Restarting…" : "Restart"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => run("stop")}
            disabled={!isRunning || !!busy}
            className="gap-1.5"
          >
            {busy === "stop" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
            Stop
          </Button>
          {liveUrl && (
            <Button asChild variant="outline" size="icon" className="h-9 w-9">
              <a href={liveUrl} target="_blank" rel="noreferrer" title="Visit">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 border-border bg-popover">
              <DropdownMenuItem onClick={() => setTab("settings")} className="gap-2">
                <SettingsIcon className="h-3.5 w-3.5" /> Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <ConfirmDialog
                trigger={
                  <DropdownMenuItem
                    onSelect={(e) => e.preventDefault()}
                    className="gap-2 text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </DropdownMenuItem>
                }
                title={`Delete "${project.name}"?`}
                description="This permanently removes the project and all associated data."
                confirmLabel="Delete project"
                onConfirm={remove}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 border-b border-border">
        <nav className="flex gap-1 overflow-x-auto overflow-y-hidden">
          {TABS.map((t) => {
            const disabled = !!t.disabled;
            return (
              <button
                key={t.id}
                type="button"
                disabled={disabled}
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative whitespace-nowrap px-3 py-2.5 text-sm transition-colors",
                  disabled
                    ? "cursor-not-allowed text-muted-foreground/50"
                    : tab === t.id
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
                {!disabled && tab === t.id && (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      <div className="mt-6 animate-fade-in">
        {tab === "overview" && (
          <ProjectOverview
            project={project}
            environment={environment}
            deployments={envDeployments}
            envVars={envVariables}
            mounts={mounts}
          />
        )}
        {tab === "deployments" && (
          <ProjectDeployments
            project={project}
            environment={environment}
            isProd={isProd}
            deployments={envDeployments}
            onDeploy={onDeployMock}
          />
        )}
        {tab === "logs" && <ProjectLogs project={project} environment={environment} isProd={isProd} />}
        {tab === "strategy" && <ProjectStrategy project={project} />}
        {tab === "source" && (
          <ProjectSource
            project={project}
            environment={environment}
            isProd={isProd}
            deployments={envDeployments}
            onBranchChange={onBranchChange}
          />
        )}
        {tab === "buildfile" && <BuildFileTab project={project} />}
        {tab === "architecture" &&
          (isProd ? (
            <ProjectArchitecture project={project} onOpenLogs={() => setTab("logs")} />
          ) : (
            <EnvArchitecture
              project={project}
              environment={environment}
              connections={envConnections}
              onAddConnections={onConnAdd}
              onRemoveConnection={onConnDelete}
              onOpenLogs={() => setTab("logs")}
            />
          ))}
        {tab === "databases" &&
          (isProd ? (
            <ProjectDatabases project={project} />
          ) : (
            <EnvDatabases
              project={project}
              environment={environment}
              connections={envConnections}
              onAddConnections={onConnAdd}
              onRemoveConnection={onConnDelete}
            />
          ))}
        {tab === "environments" && (
          <EnvironmentsTab
            environments={environments}
            selectedEnvId={selectedEnvId}
            onOpenEnv={openEnv}
            onCreateEnv={createEnv}
            onDeleteEnv={deleteEnv}
          />
        )}
        {tab === "settings" && (
          <ProjectSettings
            project={project}
            environment={environment}
            isProd={isProd}
            envVars={envVariables}
            mounts={mounts}
            onVarAdd={onVarAdd}
            onVarUpdate={onVarUpdate}
            onVarDelete={onVarDelete}
          />
        )}
      </div>
    </div>
  );
}