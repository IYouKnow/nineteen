import { useQuery } from "@tanstack/react-query";
import { admin } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UpdateSection } from "@/components/update/UpdateSection";
import { Server, Cpu, MemoryStick, HardDrive, Container, Boxes } from "lucide-react";

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

function Stat({ icon: Icon, label, value, hint }) {
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

export default function AdminSystem() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-system"],
    queryFn: () => admin.system(),
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  const sys = data?.system || {};
  const memPct = sys.mem_total ? Math.round((sys.mem_used / sys.mem_total) * 100) : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          icon={Server}
          label="Nineteen"
          value={sys.version || "dev"}
          hint={`${sys.os}/${sys.arch} · up ${formatUptime(sys.uptime_seconds)}`}
        />
        <Stat
          icon={Container}
          label="Docker"
          value={sys.docker_available ? (sys.docker_version || "connected") : "unavailable"}
          hint={sys.docker_available ? sys.docker_os : "daemon not reachable"}
        />
        <Stat
          icon={Boxes}
          label="Containers"
          value={sys.docker_available ? `${sys.containers_running}/${sys.containers_total}` : "—"}
          hint={sys.docker_available ? `${sys.containers_stopped} stopped · ${sys.images} images` : undefined}
        />
        <Stat
          icon={Cpu}
          label="CPU"
          value={sys.cpus ? `${sys.cpus} cores` : "—"}
          hint={sys.load_avg ? `load ${sys.load_avg.toFixed(2)}` : undefined}
        />
        <Stat
          icon={MemoryStick}
          label="Memory"
          value={sys.mem_total ? `${formatBytes(sys.mem_used)} / ${formatBytes(sys.mem_total)}` : "—"}
          hint={memPct !== null ? `${memPct}% used` : undefined}
        />
        <Stat
          icon={HardDrive}
          label="Docker disk"
          value={sys.disk_images || "—"}
          hint={sys.disk_volumes ? `volumes ${sys.disk_volumes} · build cache ${sys.disk_build_cache || "—"}` : undefined}
        />
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Hostname</span>
              <span className="font-mono text-foreground">{sys.hostname || "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Users</span>
              <Badge variant="secondary">{data?.users_total ?? 0}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Projects</span>
              <Badge variant="secondary">{data?.projects_total ?? 0}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Databases</span>
              <Badge variant="secondary">{data?.databases_total ?? 0}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <UpdateSection />
    </div>
  );
}
