import * as api from "@/lib/api";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Play, Square, RotateCw, Loader2, Cpu, MapPin, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/dev/StatusBadge";
import { INSTANCE_TYPES, REGIONS } from "@/lib/devStatus";

export default function RuntimeControls({ project }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(null);

  const run = async (action, status) => {
    setBusy(action);
    try {
      await api.projects.update(project.id, { status });
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    } finally {
      setBusy(null);
    }
  };

  const updateConfig = async (field, value) => {
    await api.projects.update(project.id, { [field]: value });
    qc.invalidateQueries({ queryKey: ["project", project.id] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const isRunning = project.status === "running";
  const isStopped = project.status === "stopped";

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-medium">Runtime</h3>
        <p className="text-xs text-muted-foreground">Control the live process and resource allocation.</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Current state</span>
          </div>
          <StatusBadge status={project.status} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => run("start", "running")}
            disabled={busy !== null || isRunning}
            className="gap-2"
          >
            {busy === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Start
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => run("restart", "running")}
            disabled={busy !== null}
            className="gap-2"
          >
            {busy === "restart" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
            Restart
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => run("stop", "stopped")}
            disabled={busy !== null || isStopped}
            className="gap-2 hover:border-destructive/40 hover:text-destructive"
          >
            {busy === "stop" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
            Stop
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Cpu className="h-3.5 w-3.5" />
            Instance type
          </label>
          <select
            value={project.instance_type || "nano"}
            onChange={(e) => updateConfig("instance_type", e.target.value)}
            className="mt-2 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
          >
            {INSTANCE_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} · {t.cpu} · {t.ram} · {t.price}/mo
              </option>
            ))}
          </select>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            Region
          </label>
          <select
            value={project.region || "fra1"}
            onChange={(e) => updateConfig("region", e.target.value)}
            className="mt-2 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
          >
            {REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.flag} {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}