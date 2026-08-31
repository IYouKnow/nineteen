import { GitBranch, Cpu, MapPin, Layers, Globe, Ship, Plug2 } from "lucide-react";
import { FRAMEWORKS, INSTANCE_TYPES, REGIONS } from "@/lib/devStatus";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const selectCls =
  "mt-1.5 h-9 w-full rounded-md border border-input bg-card px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

export default function ConfigurationStep({ config, setConfig, sourceLabel, buildLabel }) {
  const update = (patch) => setConfig((c) => ({ ...c, ...patch }));

  return (
    <div className="animate-fade-in">
      <header className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight">Project configuration</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Name your project and choose how it runs.
        </p>
      </header>

      <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2.5">
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Source</span>
        <span className="font-mono text-xs text-foreground">{sourceLabel}</span>
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2.5">
        <Ship className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Build</span>
        <span className="font-mono text-xs text-foreground">{buildLabel || "Dockerfile · auto-detected"}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label className="text-xs">Project name</Label>
          <Input
            value={config.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="my-project"
            className="mt-1.5"
          />
        </div>

        <div>
          <Label className="text-xs flex items-center gap-1"><GitBranch className="h-3 w-3" /> Production branch</Label>
          <div className="relative mt-1.5">
            <GitBranch className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              value={config.branch}
              onChange={(e) => update({ branch: e.target.value })}
              className="pl-9 font-mono text-sm"
            />
          </div>
        </div>

        <div>
          <Label className="text-xs flex items-center gap-1"><Layers className="h-3 w-3" /> Framework</Label>
          <select
            value={config.framework}
            onChange={(e) => update({ framework: e.target.value })}
            className={cn(selectCls)}
          >
            {Object.entries(FRAMEWORKS).map(([id, f]) => (
              <option key={id} value={id}>{f.label}</option>
            ))}
          </select>
        </div>

        <div>
          <Label className="text-xs flex items-center gap-1"><MapPin className="h-3 w-3" /> Region</Label>
          <select value={config.region} onChange={(e) => update({ region: e.target.value })} className={cn(selectCls)}>
            {REGIONS.map((r) => (
              <option key={r.id} value={r.id}>{r.flag} {r.label}</option>
            ))}
          </select>
        </div>

        <div>
          <Label className="text-xs flex items-center gap-1"><Cpu className="h-3 w-3" /> Instance size</Label>
          <select value={config.instance} onChange={(e) => update({ instance: e.target.value })} className={cn(selectCls)}>
            {INSTANCE_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label} · {t.cpu} / {t.ram}</option>
            ))}
          </select>
        </div>

        <div>
          <Label className="text-xs flex items-center gap-1"><Plug2 className="h-3 w-3" /> Port</Label>
          <Input
            value={config.port}
            onChange={(e) => update({ port: e.target.value.replace(/[^0-9]/g, "") })}
            placeholder="auto"
            inputMode="numeric"
            className="mt-1.5 font-mono text-sm"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Leave empty to auto-assign. Set a fixed port to match an app that expects one.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-md border border-border p-3">
        <div>
          <p className="text-sm font-medium">Auto-deploy on push</p>
          <p className="text-xs text-muted-foreground">Trigger a build when code is pushed to {config.branch}.</p>
        </div>
        <Switch checked={config.autoDeploy} onCheckedChange={(v) => update({ autoDeploy: v })} />
      </div>
    </div>
  );
}