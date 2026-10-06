import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { admin, update } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { PERM } from "@/lib/permissions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Cpu, MemoryStick, HardDrive, Thermometer, Server, Container, Boxes,
  Users, FolderGit2, Database, Download, CheckCircle2, AlertCircle, Loader2,
  RefreshCw, Gauge,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

const HISTORY_LIMIT = 30;

function formatBytes(bytes) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatUptime(seconds) {
  if (!seconds) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function percent(used, total) {
  if (!total) return null;
  return Math.max(0, Math.min(100, (used / total) * 100));
}

function GaugeCard({ icon: Icon, label, percent: pct, detail }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
          <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
        </div>
        <div className="mt-3 text-2xl font-semibold text-foreground">
          {pct != null ? `${Math.round(pct)}%` : "—"}
        </div>
        <Progress value={pct ?? 0} className="mt-3" />
        <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function Tile({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 text-xl font-semibold text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function CardHeader({ icon: Icon, title, aside }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Icon className="h-4 w-4" />
      <span className="text-xs font-medium uppercase tracking-wider">{title}</span>
      {aside && <span className="ml-auto text-xs normal-case tracking-normal text-muted-foreground">{aside}</span>}
    </div>
  );
}

function HistoryChart({ title, dataKey, color, data }) {
  const hasData = data.some((p) => p[dataKey] != null);
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          <span className="text-xs text-muted-foreground">last {data.length} samples</span>
        </div>
        <div className="mt-3 h-[200px]">
          {hasData ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id={`overview-fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" vertical={false} />
                <XAxis
                  dataKey="t"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  interval="preserveStartEnd"
                  minTickGap={40}
                />
                <YAxis
                  domain={[0, 100]}
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={38}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--border))" }}
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v) => [`${Number(v).toFixed(1)}%`, title]}
                />
                <Area
                  type="monotone"
                  dataKey={dataKey}
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#overview-fill-${dataKey})`}
                  connectNulls
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Collecting samples…
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function UpdateStateBadge({ state }) {
  if (state === "success") {
    return <Badge variant="default"><CheckCircle2 className="mr-1 h-3 w-3" />Healthy</Badge>;
  }
  if (state === "failed") {
    return <Badge variant="destructive"><AlertCircle className="mr-1 h-3 w-3" />Failed</Badge>;
  }
  if (state === "building" || state === "swapping") {
    return <Badge variant="secondary"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Updating…</Badge>;
  }
  return <Badge variant="outline">Idle</Badge>;
}

export default function AdminOverview() {
  const { hasPermission } = useAuth();
  const canSeeSystem = hasPermission(PERM.ADMIN_SYSTEM_READ);
  const canSeeUpdates = hasPermission(PERM.UPDATES_READ);

  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["admin-system"],
    queryFn: () => admin.system(),
    enabled: canSeeSystem,
    refetchInterval: 5000,
  });

  const { data: updateInfo } = useQuery({
    queryKey: ["update-status"],
    queryFn: () => update.status(),
    enabled: canSeeUpdates,
    refetchInterval: 30000,
  });

  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!data?.system || !dataUpdatedAt) return;
    const s = data.system;
    const point = {
      t: new Date(dataUpdatedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      cpu: typeof s.cpu_percent === "number" ? s.cpu_percent : null,
      mem: percent(s.mem_used, s.mem_total),
    };
    setHistory((prev) => [...prev, point].slice(-HISTORY_LIMIT));
  }, [dataUpdatedAt, data]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[124px] rounded-lg" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[280px] rounded-lg" />
          <Skeleton className="h-[280px] rounded-lg" />
        </div>
      </div>
    );
  }

  const sys = data?.system || {};
  const memPct = percent(sys.mem_used, sys.mem_total);
  const diskPct = percent(sys.disk_used, sys.disk_total);
  const cpuPct = typeof sys.cpu_percent === "number" ? sys.cpu_percent : null;
  const temps = Array.isArray(sys.temperatures) ? sys.temperatures : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Overview</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Live host, container and instance health
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("mr-1 h-3.5 w-3.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <GaugeCard
          icon={Cpu}
          label="CPU"
          percent={cpuPct}
          detail={sys.cpus ? `${sys.cpus} cores` : "utilisation"}
        />
        <GaugeCard
          icon={MemoryStick}
          label="Memory"
          percent={memPct}
          detail={sys.mem_total ? `${formatBytes(sys.mem_used)} / ${formatBytes(sys.mem_total)}` : "—"}
        />
        <GaugeCard
          icon={HardDrive}
          label="Disk"
          percent={diskPct}
          detail={sys.disk_total ? `${formatBytes(sys.disk_used)} / ${formatBytes(sys.disk_total)}` : "not reported"}
        />
        <Tile
          icon={Gauge}
          label="Load avg"
          value={sys.load_avg != null ? sys.load_avg.toFixed(2) : "—"}
          hint={sys.cpus ? `across ${sys.cpus} cores` : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <HistoryChart title="CPU load" dataKey="cpu" color="hsl(var(--info))" data={history} />
        <HistoryChart title="Memory usage" dataKey="mem" color="hsl(var(--success))" data={history} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <CardHeader icon={Thermometer} title="Temperatures" />
            {temps.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No thermal sensors are exposed on this host.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {temps.map((t, i) => (
                  <div key={`${t.label}-${i}`} className="flex items-center justify-between text-sm">
                    <span className="truncate text-muted-foreground">{t.label}</span>
                    <span className="font-mono text-foreground">{t.celsius.toFixed(1)}°C</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 space-y-3">
            <CardHeader
              icon={Container}
              title="Container health"
              aside={sys.docker_version ? `docker ${sys.docker_version}` : undefined}
            />
            <div className="grid grid-cols-3 gap-3">
              <Tile
                icon={Boxes}
                label="Running"
                value={sys.docker_available ? sys.containers_running ?? 0 : "—"}
              />
              <Tile
                icon={Boxes}
                label="Stopped"
                value={sys.docker_available ? sys.containers_stopped ?? 0 : "—"}
              />
              <Tile
                icon={Boxes}
                label="Images"
                value={sys.docker_available ? sys.images ?? 0 : "—"}
              />
            </div>
            <div className="space-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <p className="flex justify-between">
                <span>Daemon</span>
                <span className="font-mono text-foreground/80">
                  {sys.docker_available ? sys.docker_os || "connected" : "unavailable"}
                </span>
              </p>
              <p className="flex justify-between">
                <span>Images / volumes / cache</span>
                <span className="font-mono text-foreground/80">
                  {sys.disk_images || "—"} · {sys.disk_volumes || "—"} · {sys.disk_build_cache || "—"}
                </span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-6 space-y-3">
            <CardHeader icon={Server} title="Instance" />
            <div className="grid grid-cols-3 gap-3">
              <Tile icon={Users} label="Users" value={data?.users_total ?? 0} />
              <Tile icon={FolderGit2} label="Projects" value={data?.projects_total ?? 0} />
              <Tile icon={Database} label="Databases" value={data?.databases_total ?? 0} />
            </div>
            <div className="space-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <p className="flex justify-between">
                <span>Hostname</span>
                <span className="max-w-[220px] truncate font-mono text-foreground/80">{sys.hostname || "—"}</span>
              </p>
              <p className="flex justify-between">
                <span>Platform</span>
                <span className="font-mono text-foreground/80">{sys.os}/{sys.arch} · Go {sys.go_version || "—"}</span>
              </p>
              <p className="flex justify-between">
                <span>Uptime</span>
                <span className="font-mono text-foreground/80">{formatUptime(sys.uptime_seconds)}</span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 space-y-3">
            <CardHeader icon={Download} title="Updates" />
            {!canSeeUpdates ? (
              <p className="text-sm text-muted-foreground">
                Viewing update status needs the updates permission.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-muted px-2 py-0.5 font-mono text-sm">
                    {updateInfo?.current_version || "dev"}
                  </code>
                  <UpdateStateBadge state={updateInfo?.state} />
                </div>
                {updateInfo?.update_available ? (
                  <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/5 p-3 text-sm">
                    <Download className="h-4 w-4 text-success" />
                    <span className="text-foreground">
                      Version {updateInfo.latest_version} is available
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    Running the latest version
                  </div>
                )}
                {updateInfo?.message && (
                  <p className="text-xs text-muted-foreground">{updateInfo.message}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
