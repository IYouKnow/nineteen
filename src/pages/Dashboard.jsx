import { useMemo } from "react";
import * as api from "@/lib/api";
import { admin } from "@/lib/api";

import { useQuery, useQueries } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LineChart,
  Line,
} from "recharts";

import {
  FolderGit2,
  Rocket,
  Activity,
  Zap,
  Cpu,
  MemoryStick,
  Server,
  Container,
} from "lucide-react";
import FrameworkIcon from "@/components/dev/FrameworkIcon";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration } from "@/lib/format";
import { PERM } from "@/lib/permissions";

function StatCard({ icon: Icon, label, value, sub, accent, to }) {
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${accent || "text-muted-foreground/50"}`} />
      </div>
      <p className="mt-2.5 text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </>
  );
  if (!to) {
    return <div className="rounded-lg border border-border bg-card p-4">{inner}</div>;
  }
  return (
    <Link
      to={to}
      className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-card/60"
    >
      {inner}
    </Link>
  );
}

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function buildDailySeries(deployments, days = 14) {
  const buckets = [];
  const map = new Map();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = dayKey(d);
    const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const entry = { key, label, total: 0, success: 0, failed: 0, durations: [] };
    buckets.push(entry);
    map.set(key, entry);
  }
  for (const dep of deployments || []) {
    const t = new Date(dep.created_date);
    if (Number.isNaN(t.getTime())) continue;
    const entry = map.get(dayKey(t));
    if (!entry) continue;
    entry.total += 1;
    if (dep.status === "ready") {
      entry.success += 1;
      if (dep.duration != null) entry.durations.push(dep.duration);
    } else if (dep.status === "error" || dep.status === "failed") {
      entry.failed += 1;
    }
  }
  return buckets.map((b) => ({
    ...b,
    avgDuration:
      b.durations.length > 0
        ? Math.round(b.durations.reduce((a, v) => a + v, 0) / b.durations.length)
        : null,
  }));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function ChartCard({ title, hint, children, empty }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {empty ? (
        <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
          {empty}
        </div>
      ) : (
        <div className="h-[220px]">{children}</div>
      )}
    </div>
  );
}

function ClusterHealthCard({ system, isLoading, noAccess, running, errored }) {
  if (isLoading) return <Skeleton className="h-[248px] rounded-lg" />;
  if (noAccess || !system) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground/60" />
          <h3 className="text-sm font-medium">Cluster</h3>
        </div>
        <p className="mt-3 text-2xl font-semibold tracking-tight">
          {errored > 0 ? "Degraded" : "Healthy"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {errored > 0 ? `${errored} projects in error` : `${running} running · all systems go`}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Detailed host metrics need the admin system permission.
        </p>
      </div>
    );
  }
  const memPct = system.mem_total
    ? Math.round((system.mem_used / system.mem_total) * 100)
    : null;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Container className="h-4 w-4 text-muted-foreground/60" />
        <h3 className="text-sm font-medium">Cluster</h3>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {system.docker_version ? `docker ${system.docker_version}` : ""}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-2xl font-semibold tracking-tight">
            {system.containers_running ?? "—"}
          </p>
          <p className="text-xs text-muted-foreground">
            running / {system.containers_total ?? "—"} total
          </p>
        </div>
        <div>
          <p className="text-2xl font-semibold tracking-tight">
            {memPct != null ? `${memPct}%` : "—"}
          </p>
          <p className="text-xs text-muted-foreground">
            {system.mem_used ? formatBytes(system.mem_used) : "mem"} used
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        <p className="flex justify-between">
          <span>Images</span>
          <span className="font-mono text-foreground/80">{system.images ?? "—"}</span>
        </p>
        <p className="flex justify-between">
          <span>Load avg</span>
          <span className="font-mono text-foreground/80">
            {system.load_avg != null ? system.load_avg.toFixed(2) : "—"}
          </span>
        </p>
        <p className="flex justify-between">
          <span>Host</span>
          <span className="max-w-[140px] truncate font-mono text-foreground/80">
            {system.hostname || `${system.os}/${system.arch}`}
          </span>
        </p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { hasPermission } = useAuth();
  const canSeeSystem = hasPermission(PERM.ADMIN_SYSTEM_READ);

  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects.list(),
    enabled: true,
  });

  const { data: deployments } = useQuery({
    queryKey: ["deployments-recent"],
    queryFn: () => api.deployments.recent(),
    enabled: true,
  });

  const { data: systemData, isLoading: systemLoading } = useQuery({
    queryKey: ["admin-system"],
    queryFn: () => admin.system(),
    enabled: canSeeSystem,
    refetchInterval: 15000,
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
  const successPct = deploys.length
    ? Math.round((deploys.filter((d) => d.status === "ready").length / deploys.length) * 100)
    : null;

  const daily = useMemo(() => buildDailySeries(deploys, 14), [deploys]);
  const hasChartData = daily.some((d) => d.total > 0);
  const hasDurationData = daily.some((d) => d.avgDuration != null);

  const runningTop = useMemo(
    () => list.filter((p) => p.status === "running").slice(0, 5),
    [list]
  );
  const resourceQueries = useQueries({
    queries: runningTop.map((p) => ({
      queryKey: ["project-resources", p.id],
      queryFn: () => api.projects.resources(p.id),
      enabled: !!p.id,
      refetchInterval: 10000,
    })),
  });
  const topResources = runningTop.map((p, i) => ({
    project: p,
    stats: resourceQueries[i]?.data,
  }));

  const system = systemData?.system;

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-grid bg-grid-fade opacity-40" />
      <div className="relative mx-auto max-w-7xl px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monitor your projects, deployments and cluster health.
          </p>
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
                to="/projects"
              />
              <StatCard
                icon={Rocket}
                label="Deployments / 24h"
                value={recent.length}
                sub={`${deploys.length} total`}
                accent="text-info"
                to="/projects"
              />
              <StatCard
                icon={Zap}
                label="Avg build"
                value={avgBuild != null ? formatDuration(avgBuild) : "—"}
                sub={successPct != null ? `${successPct}% success` : "no data"}
                accent="text-success"
              />
              <StatCard
                icon={Activity}
                label="Cluster"
                value={
                  system ? `${system.containers_running ?? "—"} running` : errored > 0 ? "Degraded" : "Healthy"
                }
                sub={
                  system
                    ? `${system.containers_total ?? 0} containers · ${system.images ?? 0} images`
                    : errored > 0
                      ? `${errored} errors`
                      : "all systems go"
                }
                accent={errored > 0 ? "text-destructive" : "text-success"}
                to={canSeeSystem ? "/admin/system" : undefined}
              />
            </>
          )}
        </div>

        <section className="mt-6 grid gap-3 lg:grid-cols-2">
          <ChartCard
            title="Deploy activity"
            hint="last 14 days"
            empty={!deployments ? null : !hasChartData ? "No deployments in the last 14 days." : null}
          >
            {!deployments ? (
              <Skeleton className="h-[220px] rounded-md" />
            ) : hasChartData ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="success" stackId="a" fill="hsl(var(--success))" radius={[0, 0, 0, 0]} name="ready" />
                  <Bar dataKey="failed" stackId="a" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} name="failed" />
                </BarChart>
              </ResponsiveContainer>
            ) : null}
          </ChartCard>

          <ChartCard
            title="Build duration"
            hint="avg / day"
            empty={!deployments ? null : !hasDurationData ? "No successful builds yet." : null}
          >
            {!deployments ? (
              <Skeleton className="h-[220px] rounded-md" />
            ) : hasDurationData ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={daily} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} />
                  <Tooltip
                    cursor={{ stroke: "hsl(var(--border))" }}
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v) => [formatDuration(v), "avg"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="avgDuration"
                    stroke="hsl(var(--info))"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    name="avg"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : null}
          </ChartCard>
        </section>

        <section className="mt-3 grid gap-3 lg:grid-cols-3">
          <ClusterHealthCard
            system={system}
            isLoading={canSeeSystem && systemLoading}
            noAccess={!canSeeSystem}
            running={running}
            errored={errored}
          />
          <div className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">Live resources</h3>
              <span className="text-xs text-muted-foreground">top running · 10s refresh</span>
            </div>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-md" />
                ))}
              </div>
            ) : topResources.length === 0 ? (
              <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
                No running projects — deploy or start a project to see CPU/memory.
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {topResources.map(({ project, stats }) => (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="flex items-center gap-3 px-2 py-2.5 transition-colors hover:bg-muted/30 rounded-md"
                  >
                    <FrameworkIcon framework={project.framework} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground/90">{project.name}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {project.branch || "main"}
                      </p>
                    </div>
                    <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                      <Cpu className="h-3.5 w-3.5" />
                      {stats?.running ? `${Number(stats.cpu).toFixed(1)}%` : "—"}
                    </span>
                    <span className="flex w-24 items-center justify-end gap-1 font-mono text-xs text-muted-foreground">
                      <MemoryStick className="h-3.5 w-3.5" />
                      {stats?.running ? formatBytes(stats.memory) : "—"}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
