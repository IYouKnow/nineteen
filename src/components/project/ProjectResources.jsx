import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cpu, MemoryStick } from "lucide-react";
import * as api from "@/lib/api";
import { INSTANCE_TYPES } from "@/lib/devStatus";
import { cn } from "@/lib/utils";

const SIZE_UNITS = {
  B: 1,
  KB: 1000,
  MB: 1000 * 1000,
  GB: 1000 * 1000 * 1000,
  TB: 1000 * 1000 * 1000 * 1000,
  KiB: 1 << 10,
  MiB: 1 << 20,
  GiB: 1 << 30,
  TiB: 1 << 40,
};

function ramToBytes(label) {
  const m = String(label || "").match(/^([\d.]+)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)?$/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = m[2] || "B";
  return Math.round(val * (SIZE_UNITS[unit] || 1));
}

function cpuFromLabel(label) {
  const m = String(label || "").match(/^([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
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

function toneFor(pct) {
  if (pct >= 90) return "bg-destructive";
  if (pct >= 70) return "bg-warning";
  return "bg-success";
}

function Meter({ value, tone }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full transition-all", tone)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function ResourceRow({ icon: Icon, label, value, quota, pct }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
          {label}
        </span>
        <span className="font-mono text-foreground/80">
          {value} <span className="text-muted-foreground/60">/ {quota}</span>
        </span>
      </div>
      <div className="mt-1.5">
        <Meter value={pct} tone={toneFor(pct)} />
      </div>
    </div>
  );
}

export default function ProjectResources({ project }) {
  const instance =
    INSTANCE_TYPES.find((i) => i.id === project.instance_type) || INSTANCE_TYPES[0];
  const cpuLimit = cpuFromLabel(instance.cpu);
  const ramLimit = ramToBytes(instance.ram);

  const [live, setLive] = useState(null);
  const [offline, setOffline] = useState(false);

  // Initial snapshot so the card paints before the stream's first frame.
  const { data: initial } = useQuery({
    queryKey: ["project-resources", project.id],
    queryFn: () => api.projects.resources(project.id),
    enabled: !!project.id,
  });

  // Real-time updates via SSE. EventSource auto-reconnects; the server sends a
  // frame every second, so a dropped/stopped container clears `offline` once
  // a fresh frame arrives.
  useEffect(() => {
    if (!project?.id) return;
    const es = new EventSource(api.projects.resourcesStreamUrl(project.id));
    let alive = true;

    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.connected) { setOffline(false); return; }
        setLive(d);
        setOffline(false);
      } catch { /* ignore malformed frame */ }
    };
    es.onerror = () => { if (alive) setOffline(true); };

    return () => { alive = false; es.close(); };
  }, [project?.id]);

  const data = live || initial;
  const running = !!data?.running;
  const cpuPct = running && cpuLimit ? (data.cpu / (cpuLimit * 100)) * 100 : 0;
  const ramPct = running && ramLimit ? (data.memory / ramLimit) * 100 : 0;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Resources</h3>
        <span className="font-mono text-xs text-muted-foreground">{instance.label}</span>
      </div>

      {!running ? (
        offline ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/40" />
            Connecting…
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-warning/60" />
            No container running — deploy or start this project to see usage.
          </div>
        )
      ) : (
        <div className="mt-4 space-y-3">
          <ResourceRow
            icon={Cpu}
            label="CPU"
            value={`${data.cpu.toFixed(1)}%`}
            quota={instance.cpu}
            pct={cpuPct}
          />
          <ResourceRow
            icon={MemoryStick}
            label="Memory"
            value={formatBytes(data.memory)}
            quota={instance.ram}
            pct={ramPct}
          />
        </div>
      )}
    </div>
  );
}
