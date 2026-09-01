import * as api from "@/lib/api";

import { useQueryClient } from "@tanstack/react-query";

import { Cpu, MapPin, Plug2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { INSTANCE_TYPES, REGIONS } from "@/lib/devStatus";

export default function RuntimeControls({ project }) {
  const qc = useQueryClient();

  const updateConfig = async (field, value) => {
    await api.projects.update(project.id, { [field]: value });
    qc.invalidateQueries({ queryKey: ["project", project.id] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-medium">Runtime</h3>
        <p className="text-xs text-muted-foreground">Configure instance type, region and port.</p>
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
        <div className="rounded-lg border border-border bg-card p-4">
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Plug2 className="h-3.5 w-3.5" />
            Public port
          </label>
          <Input
            defaultValue={project.port || ""}
            inputMode="numeric"
            onBlur={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, "");
              e.target.value = v;
              updateConfig("port", v ? Number(v) : null);
            }}
            placeholder="auto (random)"
            className="mt-2 h-9 rounded-md font-mono text-sm"
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Set a fixed port to match an app that expects one (e.g. 38427).
          </p>
        </div>
      </div>
    </div>
  );
}